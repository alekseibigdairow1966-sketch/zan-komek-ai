import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildLegalEmbeddingArtifact,
  type LegalEmbeddingArtifact,
} from "./build-legal-embedding-artifact";
import type { LegalChunkEmbedding } from "./embed-legal-act-chunks";
import { serializeLegalEmbeddingArtifact } from "./serialize-legal-embedding-artifact";

const BASELINE_MODEL = "text-embedding-3-small";
const BASELINE_DIMENSIONS = 1536;

const ARTICLE_7_TEXT =
  '1. Сбор, обработка персональных данных осуществляются с согласия субъекта.\n2. Субъект даёт согласие "письменно" либо иным способом.';

const RECORD_ARTICLE_7: LegalChunkEmbedding = {
  chunk_id: "personal-data-law-kz:7:0",
  act_id: "personal-data-law-kz",
  act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
  article_number: "7",
  article_title: "Условия сбора и обработки персональных данных",
  source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
  anchor: "#z17",
  chunk_text: ARTICLE_7_TEXT,
  chunk_index: 0,
  chunk_total: 1,
  embedding_model: BASELINE_MODEL,
  embedding_dimensions: BASELINE_DIMENSIONS,
  embedding: [0.1234567890123456, -0.98765432101234, 1e-7, 0],
};

const RECORD_ARTICLE_12: LegalChunkEmbedding = {
  chunk_id: "personal-data-law-kz:12:0",
  act_id: "personal-data-law-kz",
  act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
  article_number: "12",
  source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
  chunk_text: "1. Текст статьи без title и без anchor.",
  chunk_index: 0,
  chunk_total: 1,
  embedding_model: BASELINE_MODEL,
  embedding_dimensions: BASELINE_DIMENSIONS,
  embedding: [-0.5, 0.25, 3.4028234663852886e38, 0.3333333333333333],
};

function createArtifact(overrides?: {
  chunkSize?: number;
  chunkOverlap?: number;
}): LegalEmbeddingArtifact {
  return buildLegalEmbeddingArtifact({
    records: [RECORD_ARTICLE_7, RECORD_ARTICLE_12],
    artifactVersion: "1",
    corpusVersion: "2026-08-22",
    createdAt: "2026-08-22T10:15:00.000Z",
    chunkStrategy: "article",
    ...overrides,
  });
}

function parseArtifact(json: string): LegalEmbeddingArtifact {
  return JSON.parse(json) as LegalEmbeddingArtifact;
}

test("serializeLegalEmbeddingArtifact returns a parseable JSON string", () => {
  const json = serializeLegalEmbeddingArtifact(createArtifact());

  assert.equal(typeof json, "string");
  assert.doesNotThrow(() => JSON.parse(json));
  assert.match(json.trimStart(), /^\{/);
  assert.notEqual(json.charCodeAt(0), 0xfeff);
});

test("serializeLegalEmbeddingArtifact writes exactly the manifest and records keys", () => {
  const parsed = parseArtifact(
    serializeLegalEmbeddingArtifact(createArtifact()),
  );

  assert.deepEqual(Object.keys(parsed).sort(), ["manifest", "records"]);
});

test("serializeLegalEmbeddingArtifact preserves every manifest field", () => {
  const artifact = createArtifact();
  const { manifest } = parseArtifact(
    serializeLegalEmbeddingArtifact(artifact),
  );

  assert.equal(manifest.artifact_version, "1");
  assert.equal(manifest.corpus_version, "2026-08-22");
  assert.equal(manifest.created_at, "2026-08-22T10:15:00.000Z");
  assert.equal(manifest.embedding_model, BASELINE_MODEL);
  assert.equal(manifest.embedding_dimensions, BASELINE_DIMENSIONS);
  assert.equal(manifest.chunk_strategy, "article");
  assert.equal(manifest.record_count, 2);
  assert.deepEqual(manifest.source_acts, artifact.manifest.source_acts);
  assert.equal(manifest.source_acts[0].article_count, 2);
});

test("serializeLegalEmbeddingArtifact omits optional manifest fields that were absent", () => {
  const { manifest } = parseArtifact(
    serializeLegalEmbeddingArtifact(createArtifact()),
  );

  assert.equal("chunk_size" in manifest, false);
  assert.equal("chunk_overlap" in manifest, false);
});

test("serializeLegalEmbeddingArtifact preserves optional manifest fields that were present", () => {
  const { manifest } = parseArtifact(
    serializeLegalEmbeddingArtifact(
      createArtifact({ chunkSize: 800, chunkOverlap: 120 }),
    ),
  );

  assert.equal(manifest.chunk_size, 800);
  assert.equal(manifest.chunk_overlap, 120);
});

test("serializeLegalEmbeddingArtifact preserves records with all metadata in order", () => {
  const { records } = parseArtifact(
    serializeLegalEmbeddingArtifact(createArtifact()),
  );

  assert.equal(records.length, 2);
  assert.deepEqual(
    records.map((record) => record.chunk_id),
    [RECORD_ARTICLE_7.chunk_id, RECORD_ARTICLE_12.chunk_id],
  );
  assert.deepEqual(records[0], RECORD_ARTICLE_7);
  assert.deepEqual(records[1], RECORD_ARTICLE_12);
  assert.equal("article_title" in records[1], false);
  assert.equal("anchor" in records[1], false);
});

test("serializeLegalEmbeddingArtifact preserves cyrillic text", () => {
  const { records } = parseArtifact(
    serializeLegalEmbeddingArtifact(createArtifact()),
  );

  assert.equal(records[0].act_name, RECORD_ARTICLE_7.act_name);
  assert.equal(records[0].article_title, RECORD_ARTICLE_7.article_title);
  assert.equal(records[0].chunk_text, RECORD_ARTICLE_7.chunk_text);
  assert.match(records[0].act_name, /«О персональных данных и их защите»/);
  assert.match(records[0].chunk_text, /персональных данных/);
});

test("serializeLegalEmbeddingArtifact preserves quotes and newlines in chunk_text", () => {
  const { records } = parseArtifact(
    serializeLegalEmbeddingArtifact(createArtifact()),
  );

  assert.equal(records[0].chunk_text, ARTICLE_7_TEXT);
  assert.match(records[0].chunk_text, /"письменно"/);
  assert.match(records[0].chunk_text, /\n/);
});

test("serializeLegalEmbeddingArtifact preserves embedding numbers exactly", () => {
  const { records } = parseArtifact(
    serializeLegalEmbeddingArtifact(createArtifact()),
  );

  assert.deepEqual(records[0].embedding, RECORD_ARTICLE_7.embedding);
  assert.deepEqual(records[1].embedding, RECORD_ARTICLE_12.embedding);
  assert.equal(records[0].embedding[0], 0.1234567890123456);
  assert.equal(records[0].embedding[1], -0.98765432101234);
  assert.equal(records[0].embedding[2], 1e-7);
  assert.equal(records[1].embedding[2], 3.4028234663852886e38);
  assert.equal(records[1].embedding[3], 0.3333333333333333);
});

test("serializeLegalEmbeddingArtifact does not mutate the artifact", () => {
  const artifact = createArtifact({ chunkSize: 800 });
  const snapshot = structuredClone(artifact);

  serializeLegalEmbeddingArtifact(artifact);

  assert.deepEqual(artifact, snapshot);
});

test("serializeLegalEmbeddingArtifact round-trips the whole artifact", () => {
  const artifact = createArtifact();

  assert.deepEqual(
    parseArtifact(serializeLegalEmbeddingArtifact(artifact)),
    artifact,
  );

  const withChunkParams = createArtifact({ chunkSize: 800, chunkOverlap: 120 });

  assert.deepEqual(
    parseArtifact(serializeLegalEmbeddingArtifact(withChunkParams)),
    withChunkParams,
  );
});

test("serializeLegalEmbeddingArtifact performs no network request", () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    throw new Error("Network access is not allowed in this test");
  }) as typeof fetch;

  try {
    const json = serializeLegalEmbeddingArtifact(createArtifact());

    assert.equal(parseArtifact(json).records.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
