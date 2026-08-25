import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  LegalChunkEmbedder,
  LegalChunkEmbedding,
} from "./embed-legal-act-chunks";
import {
  searchLegalEmbeddingRecords,
  type LegalEmbeddingSearchFilter,
} from "./search-legal-embedding-records";
import { runLegalSemanticRetrieval } from "./run-legal-semantic-retrieval";

const BASELINE_MODEL = "text-embedding-3-small";
const BASELINE_DIMENSIONS = 1536;

const QUERY_TEXT =
  'Работодатель уволил меня без предупреждения.\nИмею ли я право на "компенсацию"?';

const QUERY_VECTOR_X = [1, 0, 0];
const QUERY_VECTOR_Y = [0, 1, 0];

interface EmbedderCall {
  texts: string[];
  model: string;
  dimensions: number;
}

function createRecordingEmbedder(vectors: number[][]): {
  embedder: LegalChunkEmbedder;
  calls: EmbedderCall[];
} {
  const calls: EmbedderCall[] = [];

  const embedder: LegalChunkEmbedder = async (texts, config) => {
    calls.push({
      texts: [...texts],
      model: config.model,
      dimensions: config.dimensions,
    });

    return vectors;
  };

  return { embedder, calls };
}

function createRecord(
  overrides: Partial<LegalChunkEmbedding> & {
    chunk_id: string;
    act_id: string;
    article_number: string;
    embedding: number[];
  },
): LegalChunkEmbedding {
  return {
    act_name: "Трудовой кодекс Республики Казахстан",
    source_url: "https://adilet.zan.kz/rus/docs/K1500000414",
    chunk_text: "1. Расторжение трудового договора по инициативе работодателя.",
    chunk_index: 0,
    chunk_total: 1,
    embedding_model: BASELINE_MODEL,
    embedding_dimensions: BASELINE_DIMENSIONS,
    ...overrides,
  };
}

// Aligned with QUERY_VECTOR_X, orthogonal to QUERY_VECTOR_Y.
const RECORD_X = createRecord({
  chunk_id: "labour-code-kz:52:0",
  act_id: "labour-code-kz",
  article_number: "52",
  article_title: "Расторжение трудового договора по инициативе работодателя",
  anchor: "#z520",
  chunk_text:
    '1. Работодатель вправе расторгнуть договор.\n2. Выплачивается "компенсация".',
  embedding: [1, 0, 0],
});

// Aligned with QUERY_VECTOR_Y, orthogonal to QUERY_VECTOR_X.
const RECORD_Y = createRecord({
  chunk_id: "labour-code-kz:131:0",
  act_id: "labour-code-kz",
  article_number: "131",
  embedding: [0, 1, 0],
});

const RECORD_OTHER_ACT = createRecord({
  chunk_id: "personal-data-law-kz:7:0",
  act_id: "personal-data-law-kz",
  act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
  article_number: "7",
  source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
  embedding: [0.5, 0.5, 0],
});

const RECORD_ZERO_EMBEDDING = createRecord({
  chunk_id: "broken-act:1:0",
  act_id: "broken-act",
  article_number: "1",
  embedding: [0, 0, 0],
});

function createRecords(): LegalChunkEmbedding[] {
  return structuredClone([RECORD_Y, RECORD_OTHER_ACT, RECORD_X]);
}

function runBaseline(
  embedder: LegalChunkEmbedder,
  overrides?: {
    queryText?: string;
    records?: LegalChunkEmbedding[];
    topK?: number;
    filter?: LegalEmbeddingSearchFilter;
  },
) {
  return runLegalSemanticRetrieval(
    {
      queryText: overrides?.queryText ?? QUERY_TEXT,
      records: overrides?.records ?? createRecords(),
      model: BASELINE_MODEL,
      dimensions: BASELINE_DIMENSIONS,
      topK: overrides?.topK ?? 3,
      ...(overrides?.filter === undefined ? {} : { filter: overrides.filter }),
    },
    embedder,
  );
}

test("runLegalSemanticRetrieval calls the embedder once with the query text", async () => {
  const { embedder, calls } = createRecordingEmbedder([QUERY_VECTOR_X]);

  await runBaseline(embedder);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].texts, [QUERY_TEXT]);
});

test("runLegalSemanticRetrieval passes the model and dimensions to the embedder", async () => {
  const { embedder, calls } = createRecordingEmbedder([QUERY_VECTOR_X]);

  await runBaseline(embedder);

  assert.equal(calls[0].model, BASELINE_MODEL);
  assert.equal(calls[0].dimensions, BASELINE_DIMENSIONS);

  const other = createRecordingEmbedder([QUERY_VECTOR_X]);

  await runLegalSemanticRetrieval(
    {
      queryText: QUERY_TEXT,
      records: createRecords(),
      model: "text-embedding-3-large",
      dimensions: 3072,
      topK: 3,
    },
    other.embedder,
  );

  assert.equal(other.calls[0].model, "text-embedding-3-large");
  assert.equal(other.calls[0].dimensions, 3072);
});

test("runLegalSemanticRetrieval ranks records with the generated query embedding", async () => {
  const alignedWithX = createRecordingEmbedder([QUERY_VECTOR_X]);
  const alignedWithY = createRecordingEmbedder([QUERY_VECTOR_Y]);

  const rankedForX = await runBaseline(alignedWithX.embedder);
  const rankedForY = await runBaseline(alignedWithY.embedder);

  assert.equal(rankedForX.results[0].chunk_id, RECORD_X.chunk_id);
  assert.equal(rankedForX.results[0].retrieval_score, 1);

  assert.equal(rankedForY.results[0].chunk_id, RECORD_Y.chunk_id);
  assert.equal(rankedForY.results[0].retrieval_score, 1);

  assert.notEqual(
    rankedForX.results[0].chunk_id,
    rankedForY.results[0].chunk_id,
  );
});

test("runLegalSemanticRetrieval returns exactly the query and results keys", async () => {
  const { embedder } = createRecordingEmbedder([QUERY_VECTOR_X]);
  const result = await runBaseline(embedder);

  assert.deepEqual(Object.keys(result).sort(), ["query", "results"]);
});

test("runLegalSemanticRetrieval returns the full query embedding", async () => {
  const { embedder } = createRecordingEmbedder([QUERY_VECTOR_X]);
  const { query } = await runBaseline(embedder);

  assert.deepEqual(Object.keys(query).sort(), [
    "embedding",
    "embedding_dimensions",
    "embedding_model",
    "query_text",
  ]);
  assert.equal(query.query_text, QUERY_TEXT);
  assert.equal(query.embedding_model, BASELINE_MODEL);
  assert.equal(query.embedding_dimensions, BASELINE_DIMENSIONS);
  assert.deepEqual(query.embedding, QUERY_VECTOR_X);
  assert.match(query.query_text, /"компенсацию"/);
  assert.match(query.query_text, /\n/);
});

test("runLegalSemanticRetrieval returns search results with the retrieval contract", async () => {
  const { embedder } = createRecordingEmbedder([QUERY_VECTOR_X]);
  const { results } = await runBaseline(embedder);

  assert.equal(results.length, 3);
  assert.deepEqual(Object.keys(results[0]).sort(), [
    "act_id",
    "act_name",
    "anchor",
    "article_number",
    "article_title",
    "chunk_id",
    "chunk_index",
    "chunk_text",
    "chunk_total",
    "retrieval_score",
    "source_url",
  ]);

  for (const searchResult of results) {
    assert.equal("embedding" in searchResult, false);
    assert.equal("embedding_model" in searchResult, false);
    assert.equal("embedding_dimensions" in searchResult, false);
  }
});

test("runLegalSemanticRetrieval delegates ranking to searchLegalEmbeddingRecords", async () => {
  const { embedder } = createRecordingEmbedder([QUERY_VECTOR_X]);
  const { results } = await runBaseline(embedder);

  assert.deepEqual(
    results,
    searchLegalEmbeddingRecords({
      queryEmbedding: QUERY_VECTOR_X,
      records: createRecords(),
      topK: 3,
    }),
  );
});

test("runLegalSemanticRetrieval passes topK through to retrieval", async () => {
  const single = createRecordingEmbedder([QUERY_VECTOR_X]);
  const pair = createRecordingEmbedder([QUERY_VECTOR_X]);

  const one = await runBaseline(single.embedder, { topK: 1 });
  const two = await runBaseline(pair.embedder, { topK: 2 });

  assert.equal(one.results.length, 1);
  assert.equal(one.results[0].chunk_id, RECORD_X.chunk_id);

  assert.equal(two.results.length, 2);
  assert.deepEqual(
    two.results.map((searchResult) => searchResult.chunk_id),
    [RECORD_X.chunk_id, RECORD_OTHER_ACT.chunk_id],
  );
});

test("runLegalSemanticRetrieval passes filter.actIds through to retrieval", async () => {
  const { embedder } = createRecordingEmbedder([QUERY_VECTOR_X]);
  const { results } = await runBaseline(embedder, {
    filter: { actIds: ["personal-data-law-kz"] },
  });

  assert.deepEqual(
    results.map((searchResult) => searchResult.chunk_id),
    [RECORD_OTHER_ACT.chunk_id],
  );
});

test("runLegalSemanticRetrieval passes filter.articleNumbers through to retrieval", async () => {
  const { embedder } = createRecordingEmbedder([QUERY_VECTOR_X]);
  const { results } = await runBaseline(embedder, {
    filter: { articleNumbers: ["52", "131"] },
  });

  assert.deepEqual(
    results.map((searchResult) => searchResult.chunk_id),
    [RECORD_X.chunk_id, RECORD_Y.chunk_id],
  );
});

test("runLegalSemanticRetrieval treats a missing and an empty filter alike", async () => {
  const withoutFilter = createRecordingEmbedder([QUERY_VECTOR_X]);
  const withEmptyFilter = createRecordingEmbedder([QUERY_VECTOR_X]);

  const plain = await runBaseline(withoutFilter.embedder);
  const empty = await runBaseline(withEmptyFilter.embedder, { filter: {} });

  assert.deepEqual(empty, plain);
  assert.equal(empty.results.length, 3);
});

test("runLegalSemanticRetrieval returns no results when the filter excludes everything", async () => {
  const { embedder } = createRecordingEmbedder([QUERY_VECTOR_X]);
  const result = await runBaseline(embedder, {
    filter: { actIds: ["act-missing"] },
  });

  assert.deepEqual(result.results, []);
  assert.deepEqual(result.query.embedding, QUERY_VECTOR_X);
});

test("runLegalSemanticRetrieval is unaffected by filtered-out invalid embeddings", async () => {
  const { embedder } = createRecordingEmbedder([QUERY_VECTOR_X]);
  const { results } = await runBaseline(embedder, {
    records: structuredClone([RECORD_X, RECORD_ZERO_EMBEDDING]),
    filter: { actIds: ["labour-code-kz"] },
  });

  assert.deepEqual(
    results.map((searchResult) => searchResult.chunk_id),
    [RECORD_X.chunk_id],
  );
  assert.equal(results[0].retrieval_score, 1);
});

test("runLegalSemanticRetrieval rejects an empty query text without calling the embedder", async () => {
  const { embedder, calls } = createRecordingEmbedder([QUERY_VECTOR_X]);

  await assert.rejects(
    () => runBaseline(embedder, { queryText: "" }),
    /empty/i,
  );
  await assert.rejects(
    () => runBaseline(embedder, { queryText: "   " }),
    /empty/i,
  );

  assert.equal(calls.length, 0);
});

test("runLegalSemanticRetrieval propagates an invalid topK error", async () => {
  const { embedder } = createRecordingEmbedder([QUERY_VECTOR_X]);

  await assert.rejects(() => runBaseline(embedder, { topK: 0 }), /topK/);
  await assert.rejects(() => runBaseline(embedder, { topK: -3 }), /topK/);
});

test("runLegalSemanticRetrieval propagates embedder errors", async () => {
  const failingEmbedder: LegalChunkEmbedder = async () => {
    throw new Error("Embedding provider unavailable");
  };

  await assert.rejects(
    () => runBaseline(failingEmbedder),
    /Embedding provider unavailable/,
  );
});

test("runLegalSemanticRetrieval propagates a wrong query embedding count", async () => {
  const { embedder } = createRecordingEmbedder([]);

  await assert.rejects(() => runBaseline(embedder), /exactly one/i);
});

test("runLegalSemanticRetrieval propagates dimension mismatch errors", async () => {
  const { embedder } = createRecordingEmbedder([[1, 0]]);

  await assert.rejects(() => runBaseline(embedder), /mismatch/i);
});

test("runLegalSemanticRetrieval propagates zero record embedding errors", async () => {
  const { embedder } = createRecordingEmbedder([QUERY_VECTOR_X]);

  await assert.rejects(
    () =>
      runBaseline(embedder, {
        records: structuredClone([RECORD_X, RECORD_ZERO_EMBEDDING]),
      }),
    /zero/i,
  );
});

test("runLegalSemanticRetrieval does not mutate the input, records or filter", async () => {
  const { embedder } = createRecordingEmbedder([QUERY_VECTOR_X]);
  const records = createRecords();
  const filter: LegalEmbeddingSearchFilter = {
    actIds: ["labour-code-kz"],
    articleNumbers: ["52"],
  };
  const input = {
    queryText: QUERY_TEXT,
    records,
    model: BASELINE_MODEL,
    dimensions: BASELINE_DIMENSIONS,
    topK: 2,
    filter,
  };
  const inputSnapshot = structuredClone(input);

  await runLegalSemanticRetrieval(input, embedder);

  assert.deepEqual(input, inputSnapshot);
  assert.deepEqual(records, inputSnapshot.records);
  assert.deepEqual(filter, inputSnapshot.filter);
  assert.deepEqual(
    records.map((record) => record.chunk_id),
    [RECORD_Y.chunk_id, RECORD_OTHER_ACT.chunk_id, RECORD_X.chunk_id],
  );
});

test("runLegalSemanticRetrieval exposes no verification fields", async () => {
  const { embedder } = createRecordingEmbedder([QUERY_VECTOR_X]);
  const result = await runBaseline(embedder);

  for (const searchResult of result.results) {
    assert.equal("source_confirmed" in searchResult, false);
    assert.equal("search_confirmed" in searchResult, false);
    assert.equal("content_checked" in searchResult, false);
    assert.equal("verification_status" in searchResult, false);
  }

  assert.equal("source_confirmed" in result, false);
  assert.equal("verification_status" in result, false);
});

test("runLegalSemanticRetrieval performs no network request of its own", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    throw new Error("Network access is not allowed in this test");
  }) as typeof fetch;

  try {
    const { embedder } = createRecordingEmbedder([QUERY_VECTOR_X]);
    const { results } = await runBaseline(embedder);

    assert.equal(results.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
