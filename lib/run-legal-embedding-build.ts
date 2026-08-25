import { buildAndWriteLegalEmbeddingArtifact } from "./build-and-write-legal-embedding-artifact";
import type {
  LegalChunkStrategy,
  LegalTokenCounter,
} from "./chunk-legal-act-corpus";
import type { LegalChunkEmbedder } from "./embed-legal-act-chunks";
import { parseLegalActCorpusJsonl } from "./parse-legal-act-corpus-jsonl";

/**
 * Offline artifact generation: builds the embedding artifact from a corpus
 * JSONL outside the web application. Every step is an existing production
 * function; this module only wires them together and owns the configuration.
 *
 * The token counter and the embedder are injected, so the runner reads no
 * environment and creates no OpenAI client.
 */

export const LEGAL_EMBEDDING_MODEL = "text-embedding-3-small";
export const LEGAL_EMBEDDING_DIMENSIONS = 1536;

/** Per-input limit, kept under the model's 8192-token limit. */
export const LEGAL_CHUNK_MAX_TOKENS = 8000;

/** Aggregate limit for one embedding request. */
export const LEGAL_BATCH_MAX_TOKENS = 250_000;

export const LEGAL_CHUNK_STRATEGY: LegalChunkStrategy = "article";

export async function runLegalEmbeddingBuild(
  input: {
    corpusJsonl: string;
    outputPath: string;
    artifactVersion: string;
    corpusVersion: string;
    createdAt: string;
    countTokens: LegalTokenCounter;
  },
  embedder: LegalChunkEmbedder,
): Promise<{
  outputPath: string;
  recordCount: number;
  artifactVersion: string;
  corpusVersion: string;
}> {
  const items = parseLegalActCorpusJsonl(input.corpusJsonl);

  const written = await buildAndWriteLegalEmbeddingArtifact(
    {
      items,
      outputPath: input.outputPath,
      artifactVersion: input.artifactVersion,
      corpusVersion: input.corpusVersion,
      createdAt: input.createdAt,
      chunkStrategy: LEGAL_CHUNK_STRATEGY,
      chunkMaxTokens: LEGAL_CHUNK_MAX_TOKENS,
      batchMaxTokens: LEGAL_BATCH_MAX_TOKENS,
      countTokens: input.countTokens,
      embeddingModel: LEGAL_EMBEDDING_MODEL,
      embeddingDimensions: LEGAL_EMBEDDING_DIMENSIONS,
    },
    embedder,
  );

  return {
    outputPath: written.outputPath,
    recordCount: written.recordCount,
    artifactVersion: written.artifactVersion,
    corpusVersion: written.corpusVersion,
  };
}
