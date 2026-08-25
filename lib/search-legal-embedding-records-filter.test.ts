import assert from "node:assert/strict";
import { test } from "node:test";
import { cosineSimilarity } from "./cosine-similarity";
import type { LegalChunkEmbedding } from "./embed-legal-act-chunks";
import {
  searchLegalEmbeddingRecords as searchLegalEmbeddingRecordsImpl,
  type LegalEmbeddingSearchResult,
} from "./search-legal-embedding-records";

interface LegalEmbeddingSearchFilter {
  actIds?: string[];
  articleNumbers?: string[];
}

type SearchWithFilter = (input: {
  queryEmbedding: number[];
  records: LegalChunkEmbedding[];
  topK: number;
  filter?: LegalEmbeddingSearchFilter;
}) => LegalEmbeddingSearchResult[];

const searchLegalEmbeddingRecords: SearchWithFilter =
  searchLegalEmbeddingRecordsImpl;

const BASELINE_MODEL = "text-embedding-3-small";
const BASELINE_DIMENSIONS = 1536;

const QUERY_EMBEDDING = [1, 0, 0];

function createRecord(
  overrides: Partial<LegalChunkEmbedding> & {
    chunk_id: string;
    act_id: string;
    article_number: string;
    embedding: number[];
  },
): LegalChunkEmbedding {
  return {
    act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
    source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
    chunk_text: "1. Сбор и обработка персональных данных.",
    chunk_index: 0,
    chunk_total: 1,
    embedding_model: BASELINE_MODEL,
    embedding_dimensions: BASELINE_DIMENSIONS,
    ...overrides,
  };
}

// cosine(QUERY_EMBEDDING, [1, 0, 0]) === 1
const RECORD_A7 = createRecord({
  chunk_id: "act-a:7:0",
  act_id: "act-a",
  article_number: "7",
  article_title: "Условия сбора и обработки персональных данных",
  anchor: "#z17",
  chunk_text:
    '1. Сбор, обработка персональных данных осуществляются с согласия субъекта.\n2. Согласие даётся "письменно".',
  embedding: [1, 0, 0],
});

// cosine(QUERY_EMBEDDING, [0.5, 0.5, 0]) === 1 / sqrt(2)
const RECORD_A8 = createRecord({
  chunk_id: "act-a:8:0",
  act_id: "act-a",
  article_number: "8",
  embedding: [0.5, 0.5, 0],
});

// cosine(QUERY_EMBEDDING, [0.25, 0.5, 0]) ≈ 0.4472
const RECORD_A12 = createRecord({
  chunk_id: "act-a:12:0",
  act_id: "act-a",
  article_number: "12",
  embedding: [0.25, 0.5, 0],
});

// cosine(QUERY_EMBEDDING, [0, 1, 0]) === 0
const RECORD_B7 = createRecord({
  chunk_id: "act-b:7:0",
  act_id: "act-b",
  act_name: "Трудовой кодекс Республики Казахстан",
  article_number: "7",
  article_title: "Права и обязанности работодателя",
  source_url: "https://adilet.zan.kz/rus/docs/K1500000414",
  embedding: [0, 1, 0],
});

// cosine(QUERY_EMBEDDING, [-1, 0, 0]) === -1
const RECORD_B9 = createRecord({
  chunk_id: "act-b:9:0",
  act_id: "act-b",
  act_name: "Трудовой кодекс Республики Казахстан",
  article_number: "9",
  source_url: "https://adilet.zan.kz/rus/docs/K1500000414",
  embedding: [-1, 0, 0],
});

const RECORD_ZERO_EMBEDDING = createRecord({
  chunk_id: "act-z:1:0",
  act_id: "act-z",
  article_number: "1",
  embedding: [0, 0, 0],
});

const RECORD_WRONG_DIMENSIONS = createRecord({
  chunk_id: "act-z:2:0",
  act_id: "act-z",
  article_number: "2",
  embedding: [1, 0],
});

// Deliberately unsorted input order.
function createRecords(): LegalChunkEmbedding[] {
  return structuredClone([
    RECORD_B7,
    RECORD_A8,
    RECORD_A7,
    RECORD_B9,
    RECORD_A12,
  ]);
}

function chunkIds(results: LegalEmbeddingSearchResult[]): string[] {
  return results.map((result) => result.chunk_id);
}

test("searchLegalEmbeddingRecords keeps the current ranking when no filter is passed", () => {
  const results = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: createRecords(),
    topK: 5,
  });

  assert.deepEqual(chunkIds(results), [
    RECORD_A7.chunk_id,
    RECORD_A8.chunk_id,
    RECORD_A12.chunk_id,
    RECORD_B7.chunk_id,
    RECORD_B9.chunk_id,
  ]);
});

test("searchLegalEmbeddingRecords treats an empty filter object as no filter", () => {
  const withoutFilter = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: createRecords(),
    topK: 5,
  });
  const withEmptyFilter = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: createRecords(),
    topK: 5,
    filter: {},
  });

  assert.deepEqual(withEmptyFilter, withoutFilter);
  assert.equal(withEmptyFilter.length, 5);
});

test("searchLegalEmbeddingRecords filters by a single act id", () => {
  const results = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: createRecords(),
    topK: 5,
    filter: { actIds: ["act-a"] },
  });

  assert.deepEqual(chunkIds(results), [
    RECORD_A7.chunk_id,
    RECORD_A8.chunk_id,
    RECORD_A12.chunk_id,
  ]);
});

test("searchLegalEmbeddingRecords combines several act ids with OR", () => {
  const results = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: createRecords(),
    topK: 5,
    filter: { actIds: ["act-a", "act-b"] },
  });

  assert.equal(results.length, 5);

  const onlyB = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: createRecords(),
    topK: 5,
    filter: { actIds: ["act-b", "act-missing"] },
  });

  assert.deepEqual(chunkIds(onlyB), [RECORD_B7.chunk_id, RECORD_B9.chunk_id]);
});

test("searchLegalEmbeddingRecords filters by a single article number", () => {
  const results = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: createRecords(),
    topK: 5,
    filter: { articleNumbers: ["7"] },
  });

  assert.deepEqual(chunkIds(results), [RECORD_A7.chunk_id, RECORD_B7.chunk_id]);
});

test("searchLegalEmbeddingRecords combines several article numbers with OR", () => {
  const results = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: createRecords(),
    topK: 5,
    filter: { articleNumbers: ["7", "9"] },
  });

  assert.deepEqual(chunkIds(results), [
    RECORD_A7.chunk_id,
    RECORD_B7.chunk_id,
    RECORD_B9.chunk_id,
  ]);
});

test("searchLegalEmbeddingRecords combines act ids and article numbers with AND", () => {
  const results = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: createRecords(),
    topK: 5,
    filter: { actIds: ["act-a"], articleNumbers: ["7"] },
  });

  assert.deepEqual(chunkIds(results), [RECORD_A7.chunk_id]);

  const noIntersection = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: createRecords(),
    topK: 5,
    filter: { actIds: ["act-b"], articleNumbers: ["12"] },
  });

  assert.deepEqual(noIntersection, []);
});

test("searchLegalEmbeddingRecords still ranks the filtered records by cosine descending", () => {
  const records = createRecords();
  const results = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records,
    topK: 5,
    filter: { actIds: ["act-a", "act-b"] },
  });

  assert.deepEqual(chunkIds(results), [
    RECORD_A7.chunk_id,
    RECORD_A8.chunk_id,
    RECORD_A12.chunk_id,
    RECORD_B7.chunk_id,
    RECORD_B9.chunk_id,
  ]);
  assert.notDeepEqual(
    chunkIds(results),
    records.map((record) => record.chunk_id),
  );

  for (let index = 1; index < results.length; index += 1) {
    assert.equal(
      results[index - 1].retrieval_score >= results[index].retrieval_score,
      true,
      "Filtered results must still be ordered by retrieval_score descending",
    );
  }
});

test("searchLegalEmbeddingRecords applies topK after filtering and ranking", () => {
  const results = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: createRecords(),
    topK: 2,
    filter: { actIds: ["act-a"] },
  });

  assert.equal(results.length, 2);
  assert.deepEqual(chunkIds(results), [RECORD_A7.chunk_id, RECORD_A8.chunk_id]);
});

test("searchLegalEmbeddingRecords returns an empty array when the filter excludes everything", () => {
  const results = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: createRecords(),
    topK: 5,
    filter: { actIds: ["act-missing"] },
  });

  assert.deepEqual(results, []);
});

test("searchLegalEmbeddingRecords filters before computing cosine similarity", () => {
  // A zero query vector would make cosineSimilarity throw. Returning []
  // proves the metadata filter runs first and leaves nothing to score.
  const results = searchLegalEmbeddingRecords({
    queryEmbedding: [0, 0, 0],
    records: createRecords(),
    topK: 5,
    filter: { actIds: ["act-missing"] },
  });

  assert.deepEqual(results, []);
});

test("searchLegalEmbeddingRecords never scores filtered-out invalid embeddings", () => {
  const records = structuredClone([
    RECORD_A7,
    RECORD_ZERO_EMBEDDING,
    RECORD_WRONG_DIMENSIONS,
  ]);

  const results = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records,
    topK: 5,
    filter: { actIds: ["act-a"] },
  });

  assert.deepEqual(chunkIds(results), [RECORD_A7.chunk_id]);
  assert.equal(results[0].retrieval_score, 1);
});

test("searchLegalEmbeddingRecords propagates invalid embedding errors for records that pass the filter", () => {
  assert.throws(
    () =>
      searchLegalEmbeddingRecords({
        queryEmbedding: QUERY_EMBEDDING,
        records: structuredClone([RECORD_A7, RECORD_ZERO_EMBEDDING]),
        topK: 5,
        filter: { actIds: ["act-a", "act-z"] },
      }),
    /zero/i,
  );

  assert.throws(
    () =>
      searchLegalEmbeddingRecords({
        queryEmbedding: QUERY_EMBEDDING,
        records: structuredClone([RECORD_A7, RECORD_WRONG_DIMENSIONS]),
        topK: 5,
        filter: { articleNumbers: ["7", "2"] },
      }),
    /mismatch/i,
  );
});

test("searchLegalEmbeddingRecords treats an empty actIds array as matching nothing", () => {
  assert.deepEqual(
    searchLegalEmbeddingRecords({
      queryEmbedding: QUERY_EMBEDDING,
      records: createRecords(),
      topK: 5,
      filter: { actIds: [] },
    }),
    [],
  );
});

test("searchLegalEmbeddingRecords treats an empty articleNumbers array as matching nothing", () => {
  assert.deepEqual(
    searchLegalEmbeddingRecords({
      queryEmbedding: QUERY_EMBEDDING,
      records: createRecords(),
      topK: 5,
      filter: { articleNumbers: [] },
    }),
    [],
  );

  assert.deepEqual(
    searchLegalEmbeddingRecords({
      queryEmbedding: QUERY_EMBEDDING,
      records: createRecords(),
      topK: 5,
      filter: { actIds: ["act-a"], articleNumbers: [] },
    }),
    [],
  );
});

test("searchLegalEmbeddingRecords keeps stable ties after filtering", () => {
  const firstTied = createRecord({
    chunk_id: "act-a:100:0",
    act_id: "act-a",
    article_number: "100",
    embedding: [1, 0, 0],
  });
  const secondTied = createRecord({
    chunk_id: "act-a:101:0",
    act_id: "act-a",
    article_number: "101",
    embedding: [4, 0, 0],
  });
  const excluded = createRecord({
    chunk_id: "act-b:100:0",
    act_id: "act-b",
    article_number: "100",
    embedding: [2, 0, 0],
  });
  const thirdTied = createRecord({
    chunk_id: "act-a:102:0",
    act_id: "act-a",
    article_number: "102",
    embedding: [7, 0, 0],
  });

  const results = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: [firstTied, secondTied, excluded, thirdTied],
    topK: 5,
    filter: { actIds: ["act-a"] },
  });

  assert.deepEqual(chunkIds(results), [
    firstTied.chunk_id,
    secondTied.chunk_id,
    thirdTied.chunk_id,
  ]);
  assert.deepEqual(
    results.map((result) => result.retrieval_score),
    [1, 1, 1],
  );
});

test("searchLegalEmbeddingRecords does not mutate records, filter or query", () => {
  const records = createRecords();
  const recordsSnapshot = structuredClone(records);
  const queryEmbedding = [...QUERY_EMBEDDING];
  const querySnapshot = [...queryEmbedding];
  const filter: LegalEmbeddingSearchFilter = {
    actIds: ["act-a", "act-b"],
    articleNumbers: ["7", "8"],
  };
  const filterSnapshot = structuredClone(filter);

  searchLegalEmbeddingRecords({ queryEmbedding, records, topK: 2, filter });

  assert.deepEqual(records, recordsSnapshot);
  assert.deepEqual(queryEmbedding, querySnapshot);
  assert.deepEqual(filter, filterSnapshot);
});

test("searchLegalEmbeddingRecords exposes no filter, embedding or verification fields", () => {
  const results = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: createRecords(),
    topK: 5,
    filter: { actIds: ["act-a"], articleNumbers: ["7"] },
  });

  for (const result of results) {
    assert.equal("filter" in result, false);
    assert.equal("actIds" in result, false);
    assert.equal("articleNumbers" in result, false);
    assert.equal("embedding" in result, false);
    assert.equal("embedding_model" in result, false);
    assert.equal("embedding_dimensions" in result, false);
    assert.equal("source_confirmed" in result, false);
    assert.equal("search_confirmed" in result, false);
    assert.equal("content_checked" in result, false);
    assert.equal("verification_status" in result, false);
  }

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
});

test("searchLegalEmbeddingRecords keeps retrieval_score equal to cosine similarity under filtering", () => {
  const results = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: createRecords(),
    topK: 5,
    filter: { actIds: ["act-a"] },
  });

  assert.equal(
    results[0].retrieval_score,
    cosineSimilarity(QUERY_EMBEDDING, RECORD_A7.embedding),
  );
  assert.equal(
    results[1].retrieval_score,
    cosineSimilarity(QUERY_EMBEDDING, RECORD_A8.embedding),
  );
  assert.equal(
    results[2].retrieval_score,
    cosineSimilarity(QUERY_EMBEDDING, RECORD_A12.embedding),
  );
});

test("searchLegalEmbeddingRecords still rejects a non-positive topK with a filter", () => {
  assert.throws(
    () =>
      searchLegalEmbeddingRecords({
        queryEmbedding: QUERY_EMBEDDING,
        records: createRecords(),
        topK: 0,
        filter: { actIds: ["act-a"] },
      }),
    /topK/,
  );
});

test("searchLegalEmbeddingRecords performs no network request when filtering", () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    throw new Error("Network access is not allowed in this test");
  }) as typeof fetch;

  try {
    const results = searchLegalEmbeddingRecords({
      queryEmbedding: QUERY_EMBEDDING,
      records: createRecords(),
      topK: 5,
      filter: { actIds: ["act-a"] },
    });

    assert.equal(results.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
