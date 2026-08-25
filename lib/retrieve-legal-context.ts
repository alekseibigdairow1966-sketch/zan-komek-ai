import { cosineSimilarity } from "./cosine-similarity";
import { countLegalEmbeddingTokens } from "./count-legal-embedding-tokens";
import type { LegalChunkEmbedding } from "./embed-legal-act-chunks";
import { createOpenAIClient } from "./openai-client";
import {
  createOpenAiLegalChunkEmbedder,
  type OpenAiEmbeddingsClient,
} from "./openai-legal-chunk-embedder";
import { readLegalEmbeddingArtifact } from "./read-legal-embedding-artifact";
import { rerankLegalCandidates } from "./rerank-legal-candidates";
import { runLegalSemanticRetrieval } from "./run-legal-semantic-retrieval";
import type { LegalEmbeddingSearchResult } from "./search-legal-embedding-records";

/**
 * Runtime retrieval for the analysis prompt: description → query embedding →
 * embedding artifact → ranked context. Purely a context layer — the results
 * carry a semantic score and never any verification field.
 */

export const LEGAL_EMBEDDING_ARTIFACT_PATH_ENV = "LEGAL_EMBEDDING_ARTIFACT_PATH";

export const LEGAL_RETRIEVAL_TOP_K = 5;

/**
 * How many semantic candidates hybrid reranking is allowed to look at. This is
 * not the prompt window: the ranked pool is cut back to LEGAL_RETRIEVAL_TOP_K
 * before anything reaches the model, so widening it changes the ordering the
 * prompt sees, never the number of chunks it carries.
 */
export const LEGAL_RETRIEVAL_CANDIDATE_POOL = 50;

/** Prompt budget, in cl100k_base tokens. */
export const LEGAL_RETRIEVAL_MAX_CHUNK_TOKENS = 2000;
export const LEGAL_RETRIEVAL_MAX_CONTEXT_TOKENS = 8000;

export interface LegalContextRetrieverOptions {
  client: OpenAiEmbeddingsClient;
  /** Overrides the configured path; the runtime reads the environment. */
  artifactPath?: string;
}

export interface LegalContextRetrievalInput {
  legalArea: string;
  userType: string;
  description: string;
}

function resolveArtifactPath(explicitPath?: string): string | undefined {
  const configured =
    explicitPath ?? process.env[LEGAL_EMBEDDING_ARTIFACT_PATH_ENV];
  const trimmed = configured?.trim();

  return trimmed ? trimmed : undefined;
}

/**
 * Longest whitespace-delimited prefix that fits the token budget, found by
 * binary search instead of cutting at an arbitrary offset. Returns an empty
 * string when not even the first word fits, so the budget is never exceeded.
 */
function fitToTokenBudget(text: string, maxTokens: number): string {
  if (maxTokens <= 0) {
    return "";
  }

  if (countLegalEmbeddingTokens(text) <= maxTokens) {
    return text;
  }

  const words = text.split(/\s+/).filter(Boolean);
  let taken = 0;
  let low = 1;
  let high = words.length;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);

    if (countLegalEmbeddingTokens(words.slice(0, middle).join(" ")) <= maxTokens) {
      taken = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return taken === 0 ? "" : words.slice(0, taken).join(" ");
}

/**
 * Statutory categories whose meaning is fixed by a definition article rather
 * than by everyday usage. Semantic ranking retrieves the operative provision
 * but not the definition, so the defining article is added deterministically.
 *
 * Deliberately a short declarative list, not a legal reasoning engine.
 */
interface LegalDefinitionExpansion {
  actId: string;
  concept: RegExp;
  definingArticleNumber: string;
}

const LEGAL_DEFINITION_EXPANSIONS: LegalDefinitionExpansion[] = [
  {
    actId: "consumer-protection-law-kz",
    concept: /технически сложн/i,
    definingArticleNumber: "1",
  },
];

function findDefinitionRecord(
  results: LegalEmbeddingSearchResult[],
  records: LegalChunkEmbedding[],
): LegalChunkEmbedding | undefined {
  for (const expansion of LEGAL_DEFINITION_EXPANSIONS) {
    const usesConcept = results.some(
      (result) =>
        result.act_id === expansion.actId &&
        result.article_number !== expansion.definingArticleNumber &&
        expansion.concept.test(result.chunk_text),
    );

    if (!usesConcept) {
      continue;
    }

    const alreadyPresent = results.some(
      (result) =>
        result.act_id === expansion.actId &&
        result.article_number === expansion.definingArticleNumber,
    );

    if (alreadyPresent) {
      continue;
    }

    const record = records.find(
      (candidate) =>
        candidate.act_id === expansion.actId &&
        candidate.article_number === expansion.definingArticleNumber,
    );

    if (record) {
      return record;
    }
  }

  return undefined;
}

/**
 * Same shape the search layer produces: metadata and the real similarity of
 * this record, never the vector and never a score it did not earn.
 */
function toSearchResult(
  record: LegalChunkEmbedding,
  queryEmbedding: number[],
): LegalEmbeddingSearchResult {
  const result: LegalEmbeddingSearchResult = {
    chunk_id: record.chunk_id,
    act_id: record.act_id,
    act_name: record.act_name,
    article_number: record.article_number,
    source_url: record.source_url,
    chunk_text: record.chunk_text,
    chunk_index: record.chunk_index,
    chunk_total: record.chunk_total,
    retrieval_score: cosineSimilarity(queryEmbedding, record.embedding),
  };

  if (record.article_title !== undefined) {
    result.article_title = record.article_title;
  }

  if (record.anchor !== undefined) {
    result.anchor = record.anchor;
  }

  return result;
}

function boundToTokens(
  results: LegalEmbeddingSearchResult[],
  budget: number,
): LegalEmbeddingSearchResult[] {
  const bounded: LegalEmbeddingSearchResult[] = [];
  let remainingTokens = budget;

  for (const result of results) {
    if (remainingTokens <= 0) {
      break;
    }

    const chunkText = fitToTokenBudget(
      result.chunk_text,
      Math.min(LEGAL_RETRIEVAL_MAX_CHUNK_TOKENS, remainingTokens),
    );

    if (!chunkText) {
      break;
    }

    bounded.push({ ...result, chunk_text: chunkText });
    remainingTokens -= countLegalEmbeddingTokens(chunkText);
  }

  return bounded;
}

/**
 * Trims the ranked results to the prompt budget, top down, returning copies:
 * the artifact records keep their full text. Room for the defining article is
 * reserved up front, so mandatory context is never squeezed out by ranking.
 */
function boundRetrievalContext(
  results: LegalEmbeddingSearchResult[],
  definition?: LegalEmbeddingSearchResult,
): LegalEmbeddingSearchResult[] {
  const reservedTokens = definition
    ? Math.min(
        LEGAL_RETRIEVAL_MAX_CHUNK_TOKENS,
        countLegalEmbeddingTokens(definition.chunk_text),
      )
    : 0;

  const bounded = boundToTokens(
    results,
    LEGAL_RETRIEVAL_MAX_CONTEXT_TOKENS - reservedTokens,
  );

  if (!definition) {
    return bounded;
  }

  const usedTokens = bounded.reduce(
    (sum, result) => sum + countLegalEmbeddingTokens(result.chunk_text),
    0,
  );
  const definitionText = fitToTokenBudget(
    definition.chunk_text,
    Math.min(
      LEGAL_RETRIEVAL_MAX_CHUNK_TOKENS,
      LEGAL_RETRIEVAL_MAX_CONTEXT_TOKENS - usedTokens,
    ),
  );

  if (!definitionText) {
    return bounded;
  }

  return [...bounded, { ...definition, chunk_text: definitionText }];
}

export function createLegalContextRetriever(
  options: LegalContextRetrieverOptions,
): (
  input: LegalContextRetrievalInput,
) => Promise<LegalEmbeddingSearchResult[]> {
  // The artifact is immutable between deploys, so one retriever reads and
  // parses it once and reuses it for every later retrieval. The promise is
  // cached rather than its value, so concurrent first calls share a single
  // read instead of each parsing their own copy. Scope is this retriever
  // instance only — no module-level or global state.
  //
  // A failed load is not swallowed or retried: the rejected promise is what
  // later calls await, so retrieval keeps throwing exactly as before.
  let artifactPromise:
    | ReturnType<typeof readLegalEmbeddingArtifact>
    | undefined;

  return async function retrieve(input) {
    const artifactPath = resolveArtifactPath(options.artifactPath);

    // Not configured is a normal state: no context, and no embedding request.
    if (!artifactPath) {
      return [];
    }

    artifactPromise ??= readLegalEmbeddingArtifact({
      inputPath: artifactPath,
    });

    const artifact = await artifactPromise;

    // The query must use the same model and dimensions as the artifact.
    const retrieval = await runLegalSemanticRetrieval(
      {
        queryText: input.description,
        records: artifact.records,
        model: artifact.manifest.embedding_model,
        dimensions: artifact.manifest.embedding_dimensions,
        topK: LEGAL_RETRIEVAL_CANDIDATE_POOL,
      },
      createOpenAiLegalChunkEmbedder(options.client),
    );

    // Hybrid reranking sees the whole pool, the prompt still sees Top-K: the
    // cut back happens here, before anything else looks at the results. Purely
    // an ordering step — no candidate is filtered out and no verification
    // field is read or written.
    const rankedResults = rerankLegalCandidates({
      queryText: input.description,
      candidates: retrieval.results,
    }).slice(0, LEGAL_RETRIEVAL_TOP_K);

    // The definition comes from the records already loaded and is scored with
    // the query embedding already computed: no extra read, request or search.
    // It is decided on the final Top-K, not on the candidate pool, so the
    // existing expansion behaviour is unchanged by the wider pool.
    const definitionRecord = findDefinitionRecord(
      rankedResults,
      artifact.records,
    );
    const definition = definitionRecord
      ? toSearchResult(definitionRecord, retrieval.query.embedding)
      : undefined;

    return boundRetrievalContext(rankedResults, definition);
  };
}

/**
 * The retriever the analyze route reuses across requests, so the artifact it
 * caches survives the request boundary and is read once per process instead of
 * once per request. Built lazily, only after the artifact path is configured.
 */
let runtimeRetriever:
  | ReturnType<typeof createLegalContextRetriever>
  | undefined;

/**
 * No artifactPath is passed on purpose: the retriever resolves it from the
 * environment on every call, so a configuration that appears later is picked
 * up instead of being frozen into the instance.
 */
function getRuntimeRetriever(): ReturnType<typeof createLegalContextRetriever> {
  runtimeRetriever ??= createLegalContextRetriever({
    client: createOpenAIClient(),
  });

  return runtimeRetriever;
}

/**
 * Default runtime dependency of the analyze route. The OpenAI client is built
 * only when the artifact is configured, so an unconfigured deploy behaves
 * exactly as before and issues no embedding request.
 */
export async function retrieveLegalContext(
  input: LegalContextRetrievalInput,
): Promise<LegalEmbeddingSearchResult[]> {
  const artifactPath = resolveArtifactPath();

  if (!artifactPath) {
    return [];
  }

  return getRuntimeRetriever()(input);
}
