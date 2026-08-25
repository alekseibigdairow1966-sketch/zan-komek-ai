import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLegalEmbeddingArtifact } from "./build-legal-embedding-artifact";
import type { LegalChunkEmbedding } from "./embed-legal-act-chunks";

const BASELINE_MODEL = "text-embedding-3-small";
const BASELINE_DIMENSIONS = 1536;

const ARTIFACT_VERSION = "1";
const CORPUS_VERSION = "2026-08-22";
const CREATED_AT = "2026-08-22T10:15:00.000Z";

const PERSONAL_DATA_ACT = {
  act_id: "personal-data-law-kz",
  act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
  source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
};

const LABOUR_CODE_ACT = {
  act_id: "labour-code-kz",
  act_name: "Трудовой кодекс Республики Казахстан",
  source_url: "https://adilet.zan.kz/rus/docs/K1500000414",
};

function createRecord(input: {
  act: typeof PERSONAL_DATA_ACT;
  article_number: string;
  article_title?: string;
  anchor?: string;
  chunk_index?: number;
  chunk_total?: number;
  embedding?: number[];
  embedding_model?: string;
  embedding_dimensions?: number;
}): LegalChunkEmbedding {
  const chunkIndex = input.chunk_index ?? 0;
  const record: LegalChunkEmbedding = {
    chunk_id: `${input.act.act_id}:${input.article_number}:${chunkIndex}`,
    act_id: input.act.act_id,
    act_name: input.act.act_name,
    article_number: input.article_number,
    source_url: input.act.source_url,
    chunk_text: `Текст статьи ${input.article_number}, фрагмент ${chunkIndex}.`,
    chunk_index: chunkIndex,
    chunk_total: input.chunk_total ?? 1,
    embedding_model: input.embedding_model ?? BASELINE_MODEL,
    embedding_dimensions: input.embedding_dimensions ?? BASELINE_DIMENSIONS,
    embedding: input.embedding ?? [0.1, 0.2, 0.3],
  };

  if (input.article_title !== undefined) {
    record.article_title = input.article_title;
  }

  if (input.anchor !== undefined) {
    record.anchor = input.anchor;
  }

  return record;
}

const RECORD_ARTICLE_7 = createRecord({
  act: PERSONAL_DATA_ACT,
  article_number: "7",
  article_title: "Условия сбора и обработки персональных данных",
  anchor: "#z17",
  embedding: [0.1, 0.2, 0.3],
});

const RECORD_ARTICLE_12 = createRecord({
  act: PERSONAL_DATA_ACT,
  article_number: "12",
  embedding: [0.4, 0.5, 0.6],
});

const RECORD_LABOUR_ARTICLE_23 = createRecord({
  act: LABOUR_CODE_ACT,
  article_number: "23",
  embedding: [0.7, 0.8, 0.9],
});

function buildBaselineArtifact(
  records: LegalChunkEmbedding[],
  overrides?: { chunkSize?: number; chunkOverlap?: number },
) {
  return buildLegalEmbeddingArtifact({
    records,
    artifactVersion: ARTIFACT_VERSION,
    corpusVersion: CORPUS_VERSION,
    createdAt: CREATED_AT,
    chunkStrategy: "article",
    ...overrides,
  });
}

test("buildLegalEmbeddingArtifact keeps every record in the original order", () => {
  const artifact = buildBaselineArtifact([RECORD_ARTICLE_7, RECORD_ARTICLE_12]);

  assert.equal(artifact.records.length, 2);
  assert.deepEqual(
    artifact.records.map((record) => record.chunk_id),
    [RECORD_ARTICLE_7.chunk_id, RECORD_ARTICLE_12.chunk_id],
  );
  assert.deepEqual(artifact.records[0], RECORD_ARTICLE_7);
  assert.deepEqual(artifact.records[1], RECORD_ARTICLE_12);
});

test("buildLegalEmbeddingArtifact stores vectors as-is without normalizing them", () => {
  const artifact = buildBaselineArtifact([RECORD_ARTICLE_7, RECORD_ARTICLE_12]);

  assert.deepEqual(artifact.records[0].embedding, [0.1, 0.2, 0.3]);
  assert.deepEqual(artifact.records[1].embedding, [0.4, 0.5, 0.6]);
});

test("buildLegalEmbeddingArtifact fills the manifest with the explicit versions and timestamp", () => {
  const { manifest } = buildBaselineArtifact([
    RECORD_ARTICLE_7,
    RECORD_ARTICLE_12,
  ]);

  assert.equal(manifest.artifact_version, ARTIFACT_VERSION);
  assert.equal(manifest.corpus_version, CORPUS_VERSION);
  assert.equal(manifest.created_at, CREATED_AT);
  assert.equal(manifest.chunk_strategy, "article");
  assert.equal(manifest.record_count, 2);
  assert.equal(Array.isArray(manifest.source_acts), true);
});

test("buildLegalEmbeddingArtifact derives the embedding model and dimensions from the records", () => {
  const { manifest } = buildBaselineArtifact([
    RECORD_ARTICLE_7,
    RECORD_ARTICLE_12,
  ]);

  assert.equal(manifest.embedding_model, "text-embedding-3-small");
  assert.equal(manifest.embedding_dimensions, 1536);

  const largeRecords = [
    createRecord({
      act: PERSONAL_DATA_ACT,
      article_number: "7",
      embedding_model: "text-embedding-3-large",
      embedding_dimensions: 3072,
    }),
  ];
  const large = buildBaselineArtifact(largeRecords);

  assert.equal(large.manifest.embedding_model, "text-embedding-3-large");
  assert.equal(large.manifest.embedding_dimensions, 3072);
});

test("buildLegalEmbeddingArtifact aggregates articles of one act into a single source_acts entry", () => {
  const { manifest } = buildBaselineArtifact([
    RECORD_ARTICLE_7,
    RECORD_ARTICLE_12,
  ]);

  assert.equal(manifest.source_acts.length, 1);
  assert.deepEqual(manifest.source_acts[0], {
    act_id: PERSONAL_DATA_ACT.act_id,
    act_name: PERSONAL_DATA_ACT.act_name,
    source_url: PERSONAL_DATA_ACT.source_url,
    article_count: 2,
  });
});

test("buildLegalEmbeddingArtifact lists one source_acts entry per act", () => {
  const { manifest } = buildBaselineArtifact([
    RECORD_ARTICLE_7,
    RECORD_ARTICLE_12,
    RECORD_LABOUR_ARTICLE_23,
  ]);

  assert.equal(manifest.source_acts.length, 2);
  assert.deepEqual(
    manifest.source_acts.map((act) => act.act_id),
    [PERSONAL_DATA_ACT.act_id, LABOUR_CODE_ACT.act_id],
  );
  assert.equal(manifest.source_acts[0].article_count, 2);
  assert.equal(manifest.source_acts[1].article_count, 1);
});

test("buildLegalEmbeddingArtifact counts unique articles, not chunks", () => {
  const firstHalf = createRecord({
    act: PERSONAL_DATA_ACT,
    article_number: "7",
    chunk_index: 0,
    chunk_total: 2,
  });
  const secondHalf = createRecord({
    act: PERSONAL_DATA_ACT,
    article_number: "7",
    chunk_index: 1,
    chunk_total: 2,
  });

  const { manifest } = buildBaselineArtifact([
    firstHalf,
    secondHalf,
    RECORD_ARTICLE_12,
  ]);

  assert.equal(manifest.record_count, 3);
  assert.equal(manifest.source_acts.length, 1);
  assert.equal(manifest.source_acts[0].article_count, 2);
});

test("buildLegalEmbeddingArtifact orders source_acts by first appearance in records", () => {
  const labourFirst = buildBaselineArtifact([
    RECORD_LABOUR_ARTICLE_23,
    RECORD_ARTICLE_7,
  ]);
  const personalDataFirst = buildBaselineArtifact([
    RECORD_ARTICLE_7,
    RECORD_LABOUR_ARTICLE_23,
  ]);

  assert.deepEqual(
    labourFirst.manifest.source_acts.map((act) => act.act_id),
    [LABOUR_CODE_ACT.act_id, PERSONAL_DATA_ACT.act_id],
  );
  assert.deepEqual(
    personalDataFirst.manifest.source_acts.map((act) => act.act_id),
    [PERSONAL_DATA_ACT.act_id, LABOUR_CODE_ACT.act_id],
  );
});

test("buildLegalEmbeddingArtifact omits chunk_size and chunk_overlap when they are not provided", () => {
  const { manifest } = buildBaselineArtifact([RECORD_ARTICLE_7]);

  assert.equal("chunk_size" in manifest, false);
  assert.equal("chunk_overlap" in manifest, false);
  assert.deepEqual(
    Object.keys(manifest).filter(
      (key) => key === "chunk_size" || key === "chunk_overlap",
    ),
    [],
  );
});

test("buildLegalEmbeddingArtifact keeps chunk_size and chunk_overlap when they are provided", () => {
  const { manifest } = buildBaselineArtifact([RECORD_ARTICLE_7], {
    chunkSize: 800,
    chunkOverlap: 120,
  });

  assert.equal(manifest.chunk_size, 800);
  assert.equal(manifest.chunk_overlap, 120);
});

test("buildLegalEmbeddingArtifact keeps chunk_size alone when only chunk_size is provided", () => {
  const { manifest } = buildBaselineArtifact([RECORD_ARTICLE_7], {
    chunkSize: 800,
  });

  assert.equal(manifest.chunk_size, 800);
  assert.equal("chunk_overlap" in manifest, false);
});

test("buildLegalEmbeddingArtifact does not mutate the input records", () => {
  const records = [RECORD_ARTICLE_7, RECORD_ARTICLE_12];
  const snapshot = structuredClone(records);

  buildBaselineArtifact(records);

  assert.deepEqual(records, snapshot);
  assert.equal(records.length, 2);
});

test("buildLegalEmbeddingArtifact throws when records mix embedding models", () => {
  const mixed = [
    RECORD_ARTICLE_7,
    createRecord({
      act: PERSONAL_DATA_ACT,
      article_number: "12",
      embedding_model: "text-embedding-3-large",
    }),
  ];

  assert.throws(() => buildBaselineArtifact(mixed), /model/i);
});

test("buildLegalEmbeddingArtifact throws when records mix embedding dimensions", () => {
  const mixed = [
    RECORD_ARTICLE_7,
    createRecord({
      act: PERSONAL_DATA_ACT,
      article_number: "12",
      embedding_dimensions: 3072,
    }),
  ];

  assert.throws(() => buildBaselineArtifact(mixed), /dimension/i);
});

test("buildLegalEmbeddingArtifact throws for empty records", () => {
  assert.throws(() => buildBaselineArtifact([]), /empty/i);
});

test("buildLegalEmbeddingArtifact does not read the current time on its own", () => {
  const originalNow = Date.now;

  Date.now = () => {
    throw new Error("Date.now is not allowed in this test");
  };

  try {
    const { manifest } = buildBaselineArtifact([RECORD_ARTICLE_7]);

    assert.equal(manifest.created_at, CREATED_AT);
  } finally {
    Date.now = originalNow;
  }
});

test("buildLegalEmbeddingArtifact performs no network request", () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    throw new Error("Network access is not allowed in this test");
  }) as typeof fetch;

  try {
    const artifact = buildBaselineArtifact([RECORD_ARTICLE_7]);

    assert.equal(artifact.records.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
