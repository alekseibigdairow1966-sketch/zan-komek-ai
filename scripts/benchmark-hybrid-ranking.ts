import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { embedLegalQuery } from "../lib/embed-legal-query";
import { createOpenAIClient } from "../lib/openai-client";
import { createOpenAiLegalChunkEmbedder } from "../lib/openai-legal-chunk-embedder";
import { readLegalEmbeddingArtifact } from "../lib/read-legal-embedding-artifact";
import { rerankLegalCandidates } from "../lib/rerank-legal-candidates";
import { LEGAL_RETRIEVAL_CANDIDATE_POOL } from "../lib/retrieve-legal-context";
import { searchLegalEmbeddingRecords } from "../lib/search-legal-embedding-records";

/**
 * Development benchmark tooling. NOT production runtime: nothing in lib/ or
 * app/ imports this file, and it writes nothing.
 *
 * Stage HYBRID-RERANK-BENCHMARK-RUN-01 — the first real TypeScript measurement
 * of the current ranking implementation on the 20 frozen benchmark cases.
 *
 * Ranking and relevance only. Nothing here touches source verification, the
 * Tavily search layer, Adilet fetching, prompt generation or chat analysis:
 * the sole outbound calls are OpenAI embeddings, one per benchmark query, the
 * same call the runtime retriever makes.
 *
 * Scoring is never reimplemented. Cosine similarity, ordering, the candidate
 * pool size, the hybrid weights and the Russian normalizer all come from the
 * production modules, so the numbers below describe the shipped code.
 *
 * Ranks are measured BEFORE the prompt Top-K truncation, otherwise Recall@10
 * upwards would be uncomputable. LEGAL_RETRIEVAL_TOP_K is neither imported nor
 * applied here; production keeps it unchanged.
 */

const ARTIFACT_PATH = "data/rag/core-legal-embeddings-v1.json";
const BENCHMARK_PATH = "data/benchmarks/zankomek_rag_benchmark_20_report.json";

const EXPECTED_MODEL = "text-embedding-3-small";
const EXPECTED_DIMENSIONS = 1536;

const RECALL_CUTOFFS = [1, 3, 5, 10, 20, 30, 50] as const;

/** Shape taken from the frozen Colab report; the schema is not modified. */
interface BenchmarkCase {
  case_id: string;
  query: string;
  expected_act_id: string;
  primary_articles: string;
  semantic_top1_act: string;
  semantic_law_at_1: boolean;
  semantic_primary_rank: number;
  hybrid_primary_rank: number;
}

interface ReferenceMetrics {
  law_recall_at_1?: number;
  primary_article_recall_at_1: number;
  primary_article_recall_at_3: number;
  primary_article_recall_at_5: number;
  primary_article_recall_at_10: number;
  primary_article_recall_at_20: number;
  primary_article_recall_at_30: number;
  primary_article_recall_at_50: number;
  mean_primary_rank: number;
  median_primary_rank: number;
  max_primary_rank: number;
}

interface BenchmarkReference {
  cases: BenchmarkCase[];
  baselineSemantic: ReferenceMetrics;
  hybridCandidate: ReferenceMetrics;
}

interface CaseResult {
  case_id: string;
  semantic_top1_act: string;
  semantic_law_at_1: boolean;
  semantic_primary_rank: number | null;
  hybrid_primary_rank: number | null;
  hybrid_in_pool: boolean;
}

interface RankStatistics {
  ranked: number;
  nulls: number;
  mean: number | null;
  median: number | null;
  max: number | null;
}

/** Only the fields the rank rule needs, so both real results and a small
 *  synthetic array satisfy it. */
interface RankableCandidate {
  act_id: string;
  article_number: string;
}

/**
 * Article-level rank: the smallest 1-based position of any chunk belonging to
 * the article. Two chunks of one article are one gold article, never two.
 * Returns null when the article is absent from the ranked list.
 */
export function findPrimaryArticleRank(
  results: ReadonlyArray<RankableCandidate>,
  expectedActId: string,
  primaryArticle: string,
): number | null {
  for (let index = 0; index < results.length; index += 1) {
    const candidate = results[index];

    if (
      candidate.act_id === expectedActId &&
      candidate.article_number === primaryArticle
    ) {
      return index + 1;
    }
  }

  return null;
}

function articleKey(actId: string, articleNumber: string): string {
  return `${actId}:${articleNumber}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readReferenceMetrics(
  source: unknown,
  label: string,
): ReferenceMetrics {
  assert.ok(
    source !== null && typeof source === "object",
    `${BENCHMARK_PATH} must contain ${label}`,
  );

  return source as ReferenceMetrics;
}

async function readBenchmarkReference(): Promise<BenchmarkReference> {
  const parsed: unknown = JSON.parse(await readFile(BENCHMARK_PATH, "utf8"));

  assert.ok(
    parsed !== null && typeof parsed === "object",
    `${BENCHMARK_PATH} must contain an object`,
  );

  const report = parsed as Record<string, unknown>;
  const casesDetail = report.cases_detail;

  assert.ok(
    Array.isArray(casesDetail),
    `${BENCHMARK_PATH} must contain a cases_detail array`,
  );

  assert.equal(
    casesDetail.length,
    20,
    `expected 20 benchmark cases, found ${casesDetail.length}`,
  );

  const cases = casesDetail.map((entry, index) => {
    const row = entry as Record<string, unknown>;

    for (const field of [
      "case_id",
      "query",
      "expected_act_id",
      "primary_articles",
    ]) {
      assert.ok(
        isNonEmptyString(row[field]),
        `cases_detail[${index}].${field} must be a non-empty string`,
      );
    }

    return {
      case_id: row.case_id as string,
      query: row.query as string,
      expected_act_id: row.expected_act_id as string,
      primary_articles: row.primary_articles as string,
      semantic_top1_act: row.semantic_top1_act as string,
      semantic_law_at_1: row.semantic_law_at_1 === true,
      semantic_primary_rank: row.semantic_primary_rank as number,
      hybrid_primary_rank: row.hybrid_primary_rank as number,
    };
  });

  return {
    cases,
    baselineSemantic: readReferenceMetrics(
      report.baseline_semantic,
      "baseline_semantic",
    ),
    hybridCandidate: readReferenceMetrics(
      report.hybrid_candidate,
      "hybrid_candidate",
    ),
  };
}

/** Fixed positions, so the assertion proves the rule and not the ordering. */
function checkArticleRankHelper(): void {
  const ranked: RankableCandidate[] = [
    { act_id: "labour-code-kz", article_number: "68" },
    { act_id: "labour-code-kz", article_number: "1" },
    { act_id: "civil-code-general-kz", article_number: "273" },
    { act_id: "labour-code-kz", article_number: "1" },
    { act_id: "labour-code-kz", article_number: "88" },
  ];

  // Article 1 occupies ranks 2 and 4: the earlier one wins, and the article
  // counts once rather than twice.
  assert.equal(
    findPrimaryArticleRank(ranked, "labour-code-kz", "1"),
    2,
    "a split article must take the minimum rank of its chunks",
  );

  assert.equal(findPrimaryArticleRank(ranked, "labour-code-kz", "68"), 1);
  assert.equal(
    findPrimaryArticleRank(ranked, "civil-code-general-kz", "273"),
    3,
  );

  assert.equal(
    findPrimaryArticleRank(ranked, "labour-code-kz", "999"),
    null,
    "an absent article must return null, never a rank",
  );

  // The act must match too: the same number under another act is not the gold.
  assert.equal(
    findPrimaryArticleRank(ranked, "entrepreneurial-code-kz", "1"),
    null,
    "act_id must be part of the match",
  );
}

function recallAt(ranks: ReadonlyArray<number | null>, cutoff: number): number {
  const hits = ranks.filter((rank) => rank !== null && rank <= cutoff).length;
  return hits / ranks.length;
}

/**
 * Statistics over the ranked cases only. The number of nulls is reported
 * alongside instead of being silently dropped or substituted with a number.
 */
function rankStatistics(ranks: ReadonlyArray<number | null>): RankStatistics {
  const present = ranks.filter((rank): rank is number => rank !== null);
  const nulls = ranks.length - present.length;

  if (present.length === 0) {
    return { ranked: 0, nulls, mean: null, median: null, max: null };
  }

  const sorted = [...present].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];

  return {
    ranked: present.length,
    nulls,
    mean: present.reduce((sum, rank) => sum + rank, 0) / present.length,
    median,
    max: sorted[sorted.length - 1],
  };
}

function formatNumber(value: number | null, digits = 4): string {
  return value === null ? "n/a" : value.toFixed(digits);
}

function formatDelta(
  actual: number | null,
  reference: number | undefined,
  digits = 4,
): string {
  if (actual === null || reference === undefined) {
    return "n/a";
  }

  const delta = actual - reference;
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(digits)}`;
}

function referenceRecall(
  metrics: ReferenceMetrics,
  cutoff: number,
): number | undefined {
  return (metrics as unknown as Record<string, number>)[
    `primary_article_recall_at_${cutoff}`
  ];
}

function printMetricsBlock(
  label: string,
  ranks: ReadonlyArray<number | null>,
  lawRecallAt1: number | null,
): RankStatistics {
  const stats = rankStatistics(ranks);

  console.log(`--- ${label} ---`);

  if (lawRecallAt1 !== null) {
    console.log(`Law Recall@1            ${formatNumber(lawRecallAt1)}`);
  }

  for (const cutoff of RECALL_CUTOFFS) {
    console.log(
      `Primary Recall@${String(cutoff).padEnd(2)}      ${formatNumber(recallAt(ranks, cutoff))}`,
    );
  }

  console.log(`mean primary rank       ${formatNumber(stats.mean, 2)}`);
  console.log(`median primary rank     ${formatNumber(stats.median, 2)}`);
  console.log(`max primary rank        ${formatNumber(stats.max, 0)}`);
  console.log(`ranked cases            ${stats.ranked}`);
  console.log(`null (unranked) cases   ${stats.nulls}`);
  console.log();

  return stats;
}

function printDeltaBlock(
  label: string,
  ranks: ReadonlyArray<number | null>,
  stats: RankStatistics,
  reference: ReferenceMetrics,
  lawRecallAt1: number | null,
): void {
  console.log(`--- ${label} ---`);

  if (lawRecallAt1 !== null && reference.law_recall_at_1 !== undefined) {
    console.log(
      `Law Recall@1            ts ${formatNumber(lawRecallAt1)}  colab ${formatNumber(reference.law_recall_at_1)}  delta ${formatDelta(lawRecallAt1, reference.law_recall_at_1)}`,
    );
  }

  for (const cutoff of RECALL_CUTOFFS) {
    const actual = recallAt(ranks, cutoff);
    const expected = referenceRecall(reference, cutoff);

    console.log(
      `Primary Recall@${String(cutoff).padEnd(2)}      ts ${formatNumber(actual)}  colab ${formatNumber(expected ?? null)}  delta ${formatDelta(actual, expected)}`,
    );
  }

  console.log(
    `mean primary rank       ts ${formatNumber(stats.mean, 2)}  colab ${formatNumber(reference.mean_primary_rank, 2)}  delta ${formatDelta(stats.mean, reference.mean_primary_rank, 2)}`,
  );
  console.log(
    `median primary rank     ts ${formatNumber(stats.median, 2)}  colab ${formatNumber(reference.median_primary_rank, 2)}  delta ${formatDelta(stats.median, reference.median_primary_rank, 2)}`,
  );
  console.log(
    `max primary rank        ts ${formatNumber(stats.max, 0)}  colab ${formatNumber(reference.max_primary_rank, 0)}  delta ${formatDelta(stats.max, reference.max_primary_rank, 0)}`,
  );
  console.log();
}

async function main(): Promise<void> {
  console.log("HYBRID-RERANK-BENCHMARK-RUN-01");
  console.log("ranking measurement only — embeddings requests, no writes");
  console.log();

  // Structural checks first: everything that can fail for free fails before a
  // single embeddings request is spent.
  const artifact = await readLegalEmbeddingArtifact({
    inputPath: ARTIFACT_PATH,
  });
  const { manifest, records } = artifact;

  console.log("--- artifact ---");
  console.log(`path:                  ${ARTIFACT_PATH}`);
  console.log(`artifact_version:      ${manifest.artifact_version}`);
  console.log(`corpus_version:        ${manifest.corpus_version}`);
  console.log(`embedding_model:       ${manifest.embedding_model}`);
  console.log(`embedding_dimensions:  ${manifest.embedding_dimensions}`);
  console.log(`manifest.record_count: ${manifest.record_count}`);
  console.log(`records.length:        ${records.length}`);

  assert.equal(
    manifest.record_count,
    records.length,
    "manifest.record_count must equal records.length",
  );
  assert.equal(manifest.embedding_model, EXPECTED_MODEL);
  assert.equal(manifest.embedding_dimensions, EXPECTED_DIMENSIONS);

  const chunksByArticle = new Map<string, number>();

  for (const record of records) {
    const key = articleKey(record.act_id, record.article_number);
    chunksByArticle.set(key, (chunksByArticle.get(key) ?? 0) + 1);
  }

  const splitArticles = [...chunksByArticle.entries()].filter(
    ([, chunks]) => chunks > 1,
  );

  console.log(`unique articles:       ${chunksByArticle.size}`);
  console.log(`split articles:        ${splitArticles.length}`);
  console.log();

  const reference = await readBenchmarkReference();
  const { cases } = reference;

  for (const benchmarkCase of cases) {
    const key = articleKey(
      benchmarkCase.expected_act_id,
      benchmarkCase.primary_articles,
    );

    assert.ok(
      (chunksByArticle.get(key) ?? 0) >= 1,
      `gold article missing from the artifact: ${key}`,
    );
    assert.equal(
      splitArticles.some(([splitKey]) => splitKey === key),
      false,
      `gold article is split, the rank rule needs review: ${key}`,
    );
  }

  checkArticleRankHelper();

  console.log("--- configuration ---");
  console.log(`benchmark cases:              ${cases.length}`);
  console.log(`LEGAL_RETRIEVAL_CANDIDATE_POOL: ${LEGAL_RETRIEVAL_CANDIDATE_POOL}`);
  console.log(`semantic ranking depth:       ${records.length} (full corpus)`);
  console.log("prompt Top-K truncation:      not applied (benchmark only)");
  console.log();

  // The key check happens here, before any request: a missing key fails with a
  // readable message instead of twenty network errors. Nothing about the key
  // or the environment is printed.
  const client = createOpenAIClient();
  const embedder = createOpenAiLegalChunkEmbedder(client);

  const results: CaseResult[] = [];
  let embeddingOperations = 0;

  for (const benchmarkCase of cases) {
    // Production query path, one operation per case, exactly as the runtime
    // retriever does it.
    const query = await embedLegalQuery(
      {
        queryText: benchmarkCase.query,
        model: manifest.embedding_model,
        dimensions: manifest.embedding_dimensions,
      },
      embedder,
    );
    embeddingOperations += 1;

    const semantic = searchLegalEmbeddingRecords({
      queryEmbedding: query.embedding,
      records,
      topK: records.length,
    });

    const pool = searchLegalEmbeddingRecords({
      queryEmbedding: query.embedding,
      records,
      topK: LEGAL_RETRIEVAL_CANDIDATE_POOL,
    });

    const hybrid = rerankLegalCandidates({
      queryText: benchmarkCase.query,
      candidates: pool,
    });

    const semanticRank = findPrimaryArticleRank(
      semantic,
      benchmarkCase.expected_act_id,
      benchmarkCase.primary_articles,
    );
    const hybridRank = findPrimaryArticleRank(
      hybrid,
      benchmarkCase.expected_act_id,
      benchmarkCase.primary_articles,
    );

    results.push({
      case_id: benchmarkCase.case_id,
      semantic_top1_act: semantic[0].act_id,
      semantic_law_at_1: semantic[0].act_id === benchmarkCase.expected_act_id,
      semantic_primary_rank: semanticRank,
      hybrid_primary_rank: hybridRank,
      hybrid_in_pool: hybridRank !== null,
    });
  }

  assert.equal(
    results.length,
    cases.length,
    "every benchmark case must produce a result",
  );

  console.log("=== PER-CASE RESULTS (TypeScript) ===");
  console.log(
    "case_id".padEnd(40) +
      "sem_top1_act".padEnd(34) +
      "law@1".padEnd(7) +
      "sem".padStart(5) +
      "hyb".padStart(6) +
      "in_pool".padStart(9) +
      "delta".padStart(7),
  );

  for (const result of results) {
    const delta =
      result.semantic_primary_rank !== null &&
      result.hybrid_primary_rank !== null
        ? result.semantic_primary_rank - result.hybrid_primary_rank
        : null;

    console.log(
      result.case_id.padEnd(40) +
        result.semantic_top1_act.padEnd(34) +
        String(result.semantic_law_at_1).padEnd(7) +
        String(result.semantic_primary_rank ?? "null").padStart(5) +
        String(result.hybrid_primary_rank ?? "null").padStart(6) +
        String(result.hybrid_in_pool).padStart(9) +
        (delta === null
          ? "n/a".padStart(7)
          : `${delta >= 0 ? "+" : ""}${delta}`.padStart(7)),
    );
  }

  console.log();

  const semanticRanks = results.map((result) => result.semantic_primary_rank);
  const hybridRanks = results.map((result) => result.hybrid_primary_rank);
  const lawRecallAt1 =
    results.filter((result) => result.semantic_law_at_1).length /
    results.length;

  console.log("=== TYPESCRIPT METRICS ===");
  const semanticStats = printMetricsBlock(
    "semantic baseline",
    semanticRanks,
    lawRecallAt1,
  );
  const hybridStats = printMetricsBlock("hybrid", hybridRanks, null);

  console.log("=== COLAB REFERENCE (read from the frozen report) ===");
  console.log("--- semantic baseline ---");
  console.log(
    `Law Recall@1            ${formatNumber(reference.baselineSemantic.law_recall_at_1 ?? null)}`,
  );

  for (const cutoff of RECALL_CUTOFFS) {
    console.log(
      `Primary Recall@${String(cutoff).padEnd(2)}      ${formatNumber(referenceRecall(reference.baselineSemantic, cutoff) ?? null)}`,
    );
  }

  console.log(
    `mean primary rank       ${formatNumber(reference.baselineSemantic.mean_primary_rank, 2)}`,
  );
  console.log(
    `median primary rank     ${formatNumber(reference.baselineSemantic.median_primary_rank, 2)}`,
  );
  console.log(
    `max primary rank        ${formatNumber(reference.baselineSemantic.max_primary_rank, 0)}`,
  );
  console.log();

  console.log("--- hybrid ---");

  for (const cutoff of RECALL_CUTOFFS) {
    console.log(
      `Primary Recall@${String(cutoff).padEnd(2)}      ${formatNumber(referenceRecall(reference.hybridCandidate, cutoff) ?? null)}`,
    );
  }

  console.log(
    `mean primary rank       ${formatNumber(reference.hybridCandidate.mean_primary_rank, 2)}`,
  );
  console.log(
    `median primary rank     ${formatNumber(reference.hybridCandidate.median_primary_rank, 2)}`,
  );
  console.log(
    `max primary rank        ${formatNumber(reference.hybridCandidate.max_primary_rank, 0)}`,
  );
  console.log();

  console.log("=== TYPESCRIPT VS COLAB DELTA ===");
  printDeltaBlock(
    "semantic baseline",
    semanticRanks,
    semanticStats,
    reference.baselineSemantic,
    lawRecallAt1,
  );
  printDeltaBlock("hybrid", hybridRanks, hybridStats, reference.hybridCandidate, null);

  const semanticSame: string[] = [];
  const semanticDifferent: string[] = [];
  const hybridSame: string[] = [];
  const hybridDifferent: string[] = [];

  for (const [index, result] of results.entries()) {
    const referenceCase = cases[index];

    if (result.semantic_primary_rank === referenceCase.semantic_primary_rank) {
      semanticSame.push(result.case_id);
    } else {
      semanticDifferent.push(
        `${result.case_id}: ts ${result.semantic_primary_rank ?? "null"} vs colab ${referenceCase.semantic_primary_rank}`,
      );
    }

    if (result.hybrid_primary_rank === referenceCase.hybrid_primary_rank) {
      hybridSame.push(result.case_id);
    } else {
      hybridDifferent.push(
        `${result.case_id}: ts ${result.hybrid_primary_rank ?? "null"} vs colab ${referenceCase.hybrid_primary_rank}`,
      );
    }
  }

  console.log("=== PER-CASE RANK COMPARISON ===");
  console.log(`identical semantic_primary_rank: ${semanticSame.length}`);
  console.log(`different semantic_primary_rank: ${semanticDifferent.length}`);

  for (const line of semanticDifferent) {
    console.log(`  ${line}`);
  }

  console.log(`identical hybrid_primary_rank:   ${hybridSame.length}`);
  console.log(`different hybrid_primary_rank:   ${hybridDifferent.length}`);

  for (const line of hybridDifferent) {
    console.log(`  ${line}`);
  }

  console.log();

  const outsidePool = results.filter((result) => !result.hybrid_in_pool);

  console.log("=== CANDIDATE POOL COVERAGE ===");
  console.log(
    `gold inside hybrid candidate pool: ${results.length - outsidePool.length}/${results.length}`,
  );

  for (const result of outsidePool) {
    console.log(
      `  outside pool: ${result.case_id} (semantic rank ${result.semantic_primary_rank ?? "null"})`,
    );
  }

  console.log();
  console.log("BENCHMARK COMPLETED");
  console.log(`cases completed:        ${results.length}/${cases.length}`);
  console.log(`embedding operations:   ${embeddingOperations}`);
  console.log(`candidate pool:         ${LEGAL_RETRIEVAL_CANDIDATE_POOL}`);
  console.log(
    `hybrid gold in pool:    ${results.length - outsidePool.length}/${results.length}`,
  );
  console.log("chat/completion calls:  0");
  console.log("search/verification:    0");
  console.log("files written:          0");
}

main().catch((error: unknown) => {
  console.error("BENCHMARK FAILED");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
