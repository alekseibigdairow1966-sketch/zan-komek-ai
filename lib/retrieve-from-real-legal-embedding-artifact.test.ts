import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { LegalChunkEmbedder, LegalChunkEmbedding } from "./embed-legal-act-chunks";
import { readLegalEmbeddingArtifact } from "./read-legal-embedding-artifact";
import { runLegalSemanticRetrieval } from "./run-legal-semantic-retrieval";
import {
  searchLegalEmbeddingRecords,
  type LegalEmbeddingSearchResult,
} from "./search-legal-embedding-records";

/**
 * Integration-уровень: runtime retrieval поверх настоящего artifact.
 *
 * Все инварианты retrieval уже закреплены на синтетических данных
 * (search-legal-embedding-records*.test.ts, cosine-similarity.test.ts).
 * Здесь проверяется то, что синтетика проверить не может: что реальный
 * artifact из 2002 записей по 1536 измерений действительно читается
 * production reader-ом и работает в существующем retrieval слое.
 *
 * Query embedding не запрашивается у OpenAI: в качестве вектора запроса
 * берётся embedding конкретной записи самого artifact. Это даёт точный
 * self-match и проверяет настоящие векторы, а не мок.
 *
 * Путь к artifact берётся из ZANKOMEK_EMBEDDING_ARTIFACT, иначе используется
 * текущее расположение вне репозитория: копировать 61 MB в repo не нужно.
 */

const ARTIFACT_PATH =
  process.env.ZANKOMEK_EMBEDDING_ARTIFACT ??
  join(tmpdir(), "zankomek-rag20o", "core-legal-embeddings-v1.json");

const EXPECTED_MODEL = "text-embedding-3-small";
const EXPECTED_DIMENSIONS = 1536;
const EXPECTED_RECORDS = 2002;

/** Одна из трёх статей, реально разрезанных token-aware splitting. */
const SPLIT_ACT_ID = "labour-code-kz";
const SPLIT_ARTICLE_NUMBER = "1";

const VERIFICATION_FIELDS = [
  "source_confirmed",
  "search_confirmed",
  "content_checked",
  "verification_status",
] as const;

let cached: Promise<LegalChunkEmbedding[]> | undefined;

async function loadRecords(): Promise<LegalChunkEmbedding[]> {
  cached ??= readLegalEmbeddingArtifact({ inputPath: ARTIFACT_PATH })
    .then((artifact) => artifact.records)
    .catch((error: unknown) => {
      throw new Error(
        `real embedding artifact ${ARTIFACT_PATH} is not readable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });

  return cached;
}

function recordByChunkId(
  records: LegalChunkEmbedding[],
  chunkId: string,
): LegalChunkEmbedding {
  const record = records.find((candidate) => candidate.chunk_id === chunkId);

  assert.ok(record, `record ${chunkId} is missing from the artifact`);

  return record;
}

function assertNoVerificationFields(result: LegalEmbeddingSearchResult): void {
  for (const field of VERIFICATION_FIELDS) {
    assert.equal(
      field in (result as unknown as Record<string, unknown>),
      false,
      `retrieval result must not carry ${field}`,
    );
  }
}

test("the real artifact loads through the production reader", async () => {
  const artifact = await readLegalEmbeddingArtifact({ inputPath: ARTIFACT_PATH });

  assert.equal(artifact.manifest.embedding_model, EXPECTED_MODEL);
  assert.equal(artifact.manifest.embedding_dimensions, EXPECTED_DIMENSIONS);
  assert.equal(artifact.manifest.chunk_strategy, "article");
  assert.equal(artifact.manifest.record_count, EXPECTED_RECORDS);
  assert.equal(artifact.records.length, EXPECTED_RECORDS);
  assert.equal(artifact.manifest.source_acts.length, 7);

  for (const record of artifact.records.slice(0, 50)) {
    assert.equal(record.embedding.length, EXPECTED_DIMENSIONS);
  }
});

test("retrieval accepts the real 1536-dimensional records", async () => {
  const records = await loadRecords();
  const query = records[0];

  const results = searchLegalEmbeddingRecords({
    queryEmbedding: query.embedding,
    records,
    topK: 5,
  });

  assert.equal(results.length, 5);

  for (const result of results) {
    assert.equal(typeof result.retrieval_score, "number");
    assert.ok(Number.isFinite(result.retrieval_score));
    assert.ok(result.chunk_text.trim().length > 0);
    assert.ok(result.source_url.startsWith("https://adilet.zan.kz/"));
  }
});

test("a record's own embedding retrieves that record first with a score of ~1", async () => {
  const records = await loadRecords();
  const target = recordByChunkId(records, "civil-code-special-kz:406:0");

  const results = searchLegalEmbeddingRecords({
    queryEmbedding: target.embedding,
    records,
    topK: 3,
  });

  assert.equal(results[0].chunk_id, target.chunk_id);
  assert.ok(
    results[0].retrieval_score > 0.999_999,
    `self-match score is ${results[0].retrieval_score}`,
  );
  assert.ok(results[0].retrieval_score <= 1 + 1e-9);
  assert.ok(
    results[1].retrieval_score < results[0].retrieval_score,
    "the runner-up must score below an exact self-match",
  );
});

test("topK limits the number of real results", async () => {
  const records = await loadRecords();
  const query = recordByChunkId(records, "personal-data-law-kz:1:0");

  for (const topK of [1, 3, 10, 50]) {
    const results = searchLegalEmbeddingRecords({
      queryEmbedding: query.embedding,
      records,
      topK,
    });

    assert.equal(results.length, topK);
  }

  const all = searchLegalEmbeddingRecords({
    queryEmbedding: query.embedding,
    records,
    topK: EXPECTED_RECORDS + 100,
  });

  assert.equal(all.length, EXPECTED_RECORDS);
});

test("real results come back sorted by score descending", async () => {
  const records = await loadRecords();
  const query = recordByChunkId(records, "labour-code-kz:52:0");

  const results = searchLegalEmbeddingRecords({
    queryEmbedding: query.embedding,
    records,
    topK: 100,
  });

  for (let index = 1; index < results.length; index += 1) {
    assert.ok(
      results[index - 1].retrieval_score >= results[index].retrieval_score,
      `result ${index} scores above its predecessor`,
    );
  }
});

test("equal scores keep the artifact order", async () => {
  const records = await loadRecords();
  const target = recordByChunkId(records, "personal-data-law-kz:7:0");
  const twin: LegalChunkEmbedding = {
    ...target,
    chunk_id: `${target.chunk_id}-twin`,
  };

  const results = searchLegalEmbeddingRecords({
    queryEmbedding: target.embedding,
    records: [...records, twin],
    topK: 2,
  });

  assert.deepEqual(
    results.map((result) => result.chunk_id),
    [target.chunk_id, twin.chunk_id],
  );
  assert.equal(results[0].retrieval_score, results[1].retrieval_score);
});

test("the metadata filter runs before cosine scoring on real records", async () => {
  const records = await loadRecords();
  const query = recordByChunkId(records, "civil-code-general-kz:1:0");
  const unscorable: LegalChunkEmbedding = {
    ...records[0],
    chunk_id: "unscorable:0:0",
    act_id: "unscorable-act",
    embedding: [1, 2, 3],
  };
  const withPoison = [...records, unscorable];

  // Без фильтра запись с другой размерностью действительно доходит до scoring.
  assert.throws(
    () =>
      searchLegalEmbeddingRecords({
        queryEmbedding: query.embedding,
        records: withPoison,
        topK: 5,
      }),
    /dimension mismatch/i,
  );

  const results = searchLegalEmbeddingRecords({
    queryEmbedding: query.embedding,
    records: withPoison,
    topK: 5,
    filter: { actIds: ["civil-code-general-kz"] },
  });

  assert.equal(results.length, 5);
  assert.ok(results.every((result) => result.act_id === "civil-code-general-kz"));
});

test("the act filter excludes records of every other act", async () => {
  const records = await loadRecords();
  const query = recordByChunkId(records, "labour-code-kz:52:0");

  const results = searchLegalEmbeddingRecords({
    queryEmbedding: query.embedding,
    records,
    topK: 25,
    filter: { actIds: ["consumer-protection-law-kz"] },
  });

  assert.ok(results.length > 0);
  assert.ok(results.every((result) => result.act_id === "consumer-protection-law-kz"));
  assert.equal(
    results.some((result) => result.act_id === "labour-code-kz"),
    false,
  );

  const unfiltered = searchLegalEmbeddingRecords({
    queryEmbedding: query.embedding,
    records,
    topK: 25,
  });

  assert.equal(unfiltered[0].act_id, "labour-code-kz");
});

test("split article chunks take part in retrieval as ordinary records", async () => {
  const records = await loadRecords();
  const parts = records.filter(
    (record) =>
      record.act_id === SPLIT_ACT_ID &&
      record.article_number === SPLIT_ARTICLE_NUMBER,
  );

  assert.equal(parts.length, 2);
  assert.deepEqual(
    parts.map((part) => part.chunk_index),
    [0, 1],
  );

  const secondPart = parts[1];
  const results = searchLegalEmbeddingRecords({
    queryEmbedding: secondPart.embedding,
    records,
    topK: 5,
  });

  assert.equal(results[0].chunk_id, secondPart.chunk_id);
  assert.equal(results[0].chunk_index, 1);
  assert.equal(results[0].chunk_total, 2);

  const bothParts = searchLegalEmbeddingRecords({
    queryEmbedding: secondPart.embedding,
    records,
    topK: 2,
    filter: {
      actIds: [SPLIT_ACT_ID],
      articleNumbers: [SPLIT_ARTICLE_NUMBER],
    },
  });

  assert.equal(bothParts.length, 2);
  assert.deepEqual(
    [...bothParts].map((result) => result.chunk_index).sort(),
    [0, 1],
  );
});

test("retrieval_score never touches the verification fields", async () => {
  const records = await loadRecords();
  const query = recordByChunkId(records, "personal-data-law-kz:1:0");
  const before = JSON.stringify(records.slice(0, 20));

  const results = searchLegalEmbeddingRecords({
    queryEmbedding: query.embedding,
    records,
    topK: 20,
  });

  for (const result of results) {
    assertNoVerificationFields(result);
    assert.equal("embedding" in (result as unknown as Record<string, unknown>), false);
    assert.equal(
      "embedding_model" in (result as unknown as Record<string, unknown>),
      false,
    );
  }

  // Записи artifact не мутируются и сами не несут verification-полей.
  assert.equal(JSON.stringify(records.slice(0, 20)), before);

  for (const record of records.slice(0, 100)) {
    for (const field of VERIFICATION_FIELDS) {
      assert.equal(
        field in (record as unknown as Record<string, unknown>),
        false,
        `artifact record must not carry ${field}`,
      );
    }
  }
});

test("the query-embedding seam works against the real artifact without OpenAI", async () => {
  const records = await loadRecords();
  const target = recordByChunkId(records, "entrepreneurial-code-kz:129:0");

  const embedder: LegalChunkEmbedder = async (texts, config) => {
    assert.deepEqual(texts, ["проверка порядка государственного контроля"]);
    assert.equal(config.model, EXPECTED_MODEL);
    assert.equal(config.dimensions, EXPECTED_DIMENSIONS);

    return [target.embedding];
  };

  const retrieval = await runLegalSemanticRetrieval(
    {
      queryText: "проверка порядка государственного контроля",
      records,
      model: EXPECTED_MODEL,
      dimensions: EXPECTED_DIMENSIONS,
      topK: 3,
      filter: { actIds: ["entrepreneurial-code-kz"] },
    },
    embedder,
  );

  assert.equal(retrieval.query.embedding_model, EXPECTED_MODEL);
  assert.equal(retrieval.query.embedding_dimensions, EXPECTED_DIMENSIONS);
  assert.equal(retrieval.results.length, 3);
  assert.equal(retrieval.results[0].chunk_id, target.chunk_id);
  assert.ok(
    retrieval.results.every((result) => result.act_id === "entrepreneurial-code-kz"),
  );

  for (const result of retrieval.results) {
    assertNoVerificationFields(result);
  }
});
