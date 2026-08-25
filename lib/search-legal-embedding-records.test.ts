import assert from "node:assert/strict";
import { test } from "node:test";
import { cosineSimilarity } from "./cosine-similarity";
import type { LegalChunkEmbedding } from "./embed-legal-act-chunks";
import {
  searchLegalEmbeddingRecords,
  type LegalEmbeddingSearchResult,
} from "./search-legal-embedding-records";

const BASELINE_MODEL = "text-embedding-3-small";
const BASELINE_DIMENSIONS = 1536;

const QUERY_EMBEDDING = [1, 0, 0];

function createRecord(
  overrides: Partial<LegalChunkEmbedding> & {
    chunk_id: string;
    embedding: number[];
  },
): LegalChunkEmbedding {
  return {
    act_id: "personal-data-law-kz",
    act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
    article_number: "7",
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
const RECORD_BEST = createRecord({
  chunk_id: "personal-data-law-kz:7:0",
  article_number: "7",
  article_title: "Условия сбора и обработки персональных данных",
  anchor: "#z17",
  chunk_text:
    '1. Сбор, обработка персональных данных осуществляются с согласия субъекта.\n2. Согласие даётся "письменно".',
  embedding: [1, 0, 0],
});

// cosine(QUERY_EMBEDDING, [0.5, 0.5, 0]) === 1 / sqrt(2)
const RECORD_MIDDLE = createRecord({
  chunk_id: "personal-data-law-kz:12:0",
  article_number: "12",
  chunk_text: "1. Текст статьи без title и без anchor.",
  embedding: [0.5, 0.5, 0],
});

// cosine(QUERY_EMBEDDING, [0, 1, 0]) === 0
const RECORD_WORST = createRecord({
  chunk_id: "labour-code-kz:23:0",
  act_id: "labour-code-kz",
  act_name: "Трудовой кодекс Республики Казахстан",
  article_number: "23",
  article_title: "Права и обязанности работодателя",
  source_url: "https://adilet.zan.kz/rus/docs/K1500000414",
  chunk_text: "1. Работодатель имеет право на свободу выбора работников.",
  embedding: [0, 1, 0],
});

// cosine(QUERY_EMBEDDING, [-1, 0, 0]) === -1
const RECORD_OPPOSITE = createRecord({
  chunk_id: "labour-code-kz:52:0",
  act_id: "labour-code-kz",
  act_name: "Трудовой кодекс Республики Казахстан",
  article_number: "52",
  source_url: "https://adilet.zan.kz/rus/docs/K1500000414",
  chunk_text: "1. Расторжение трудового договора по инициативе работодателя.",
  embedding: [-1, 0, 0],
});

// Deliberately unsorted input order: worst, best, middle.
function createRecords(): LegalChunkEmbedding[] {
  return structuredClone([RECORD_WORST, RECORD_BEST, RECORD_MIDDLE]);
}

test("searchLegalEmbeddingRecords ranks records by cosine similarity descending", () => {
  const results = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: createRecords(),
    topK: 3,
  });

  assert.deepEqual(
    results.map((result) => result.chunk_id),
    [RECORD_BEST.chunk_id, RECORD_MIDDLE.chunk_id, RECORD_WORST.chunk_id],
  );

  for (let index = 1; index < results.length; index += 1) {
    assert.equal(
      results[index - 1].retrieval_score >= results[index].retrieval_score,
      true,
      "Results must be ordered by retrieval_score descending",
    );
  }
});

test("searchLegalEmbeddingRecords returns only the top K best matches", () => {
  const results = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: createRecords(),
    topK: 2,
  });

  assert.equal(results.length, 2);
  assert.deepEqual(
    results.map((result) => result.chunk_id),
    [RECORD_BEST.chunk_id, RECORD_MIDDLE.chunk_id],
  );
});

test("searchLegalEmbeddingRecords returns a single best match for topK = 1", () => {
  const results = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: createRecords(),
    topK: 1,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].chunk_id, RECORD_BEST.chunk_id);
});

test("searchLegalEmbeddingRecords returns every record when topK exceeds the record count", () => {
  const records = createRecords();

  assert.equal(
    searchLegalEmbeddingRecords({
      queryEmbedding: QUERY_EMBEDDING,
      records,
      topK: records.length,
    }).length,
    3,
  );
  assert.equal(
    searchLegalEmbeddingRecords({
      queryEmbedding: QUERY_EMBEDDING,
      records,
      topK: 25,
    }).length,
    3,
  );
});

test("searchLegalEmbeddingRecords scores results with the shared cosineSimilarity function", () => {
  const results = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: createRecords(),
    topK: 3,
  });

  assert.equal(
    results[0].retrieval_score,
    cosineSimilarity(QUERY_EMBEDDING, RECORD_BEST.embedding),
  );
  assert.equal(
    results[1].retrieval_score,
    cosineSimilarity(QUERY_EMBEDDING, RECORD_MIDDLE.embedding),
  );
  assert.equal(
    results[2].retrieval_score,
    cosineSimilarity(QUERY_EMBEDDING, RECORD_WORST.embedding),
  );
  assert.equal(results[0].retrieval_score, 1);
  assert.equal(results[2].retrieval_score, 0);
});

test("searchLegalEmbeddingRecords keeps every chunk metadata field", () => {
  const [result] = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: createRecords(),
    topK: 1,
  });

  assert.equal(result.chunk_id, RECORD_BEST.chunk_id);
  assert.equal(result.act_id, RECORD_BEST.act_id);
  assert.equal(result.act_name, RECORD_BEST.act_name);
  assert.equal(result.article_number, RECORD_BEST.article_number);
  assert.equal(result.article_title, RECORD_BEST.article_title);
  assert.equal(result.source_url, RECORD_BEST.source_url);
  assert.equal(result.anchor, RECORD_BEST.anchor);
  assert.equal(result.chunk_text, RECORD_BEST.chunk_text);
  assert.equal(result.chunk_index, RECORD_BEST.chunk_index);
  assert.equal(result.chunk_total, RECORD_BEST.chunk_total);
  assert.match(result.chunk_text, /"письменно"/);
  assert.match(result.chunk_text, /\n/);
});

test("searchLegalEmbeddingRecords omits the embedding vector and embedding config", () => {
  const results = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: createRecords(),
    topK: 3,
  });

  for (const result of results) {
    assert.equal("embedding" in result, false);
    assert.equal("embedding_model" in result, false);
    assert.equal("embedding_dimensions" in result, false);
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

test("searchLegalEmbeddingRecords omits optional fields that were absent", () => {
  const results = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: structuredClone([RECORD_MIDDLE]),
    topK: 1,
  });

  assert.equal("article_title" in results[0], false);
  assert.equal("anchor" in results[0], false);
});

test("searchLegalEmbeddingRecords exposes no verification fields", () => {
  const results = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: createRecords(),
    topK: 3,
  });

  for (const result of results) {
    assert.equal("source_confirmed" in result, false);
    assert.equal("search_confirmed" in result, false);
    assert.equal("content_checked" in result, false);
    assert.equal("verification_status" in result, false);
    assert.equal(typeof result.retrieval_score, "number");
  }
});

test("searchLegalEmbeddingRecords keeps the input order for equal scores", () => {
  const firstTied = createRecord({
    chunk_id: "tie-act:1:0",
    act_id: "tie-act",
    article_number: "1",
    embedding: [1, 0, 0],
  });
  const secondTied = createRecord({
    chunk_id: "tie-act:2:0",
    act_id: "tie-act",
    article_number: "2",
    embedding: [2, 0, 0],
  });
  const thirdTied = createRecord({
    chunk_id: "tie-act:3:0",
    act_id: "tie-act",
    article_number: "3",
    embedding: [5, 0, 0],
  });

  const results = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: [firstTied, secondTied, thirdTied],
    topK: 3,
  });

  assert.deepEqual(
    results.map((result) => result.chunk_id),
    [firstTied.chunk_id, secondTied.chunk_id, thirdTied.chunk_id],
  );
  assert.deepEqual(
    results.map((result) => result.retrieval_score),
    [1, 1, 1],
  );
});

test("searchLegalEmbeddingRecords does not mutate the records or the query", () => {
  const records = createRecords();
  const recordsSnapshot = structuredClone(records);
  const queryEmbedding = [...QUERY_EMBEDDING];
  const querySnapshot = [...queryEmbedding];

  searchLegalEmbeddingRecords({ queryEmbedding, records, topK: 2 });

  assert.deepEqual(records, recordsSnapshot);
  assert.deepEqual(
    records.map((record) => record.chunk_id),
    [RECORD_WORST.chunk_id, RECORD_BEST.chunk_id, RECORD_MIDDLE.chunk_id],
  );
  assert.deepEqual(queryEmbedding, querySnapshot);
});

test("searchLegalEmbeddingRecords applies no similarity threshold", () => {
  const results = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: structuredClone([RECORD_OPPOSITE, RECORD_WORST]),
    topK: 2,
  });

  assert.equal(results.length, 2);
  assert.deepEqual(
    results.map((result) => result.chunk_id),
    [RECORD_WORST.chunk_id, RECORD_OPPOSITE.chunk_id],
  );
  assert.equal(results[1].retrieval_score, -1);
});

test("searchLegalEmbeddingRecords returns an empty array for empty records", () => {
  const results: LegalEmbeddingSearchResult[] = searchLegalEmbeddingRecords({
    queryEmbedding: QUERY_EMBEDDING,
    records: [],
    topK: 5,
  });

  assert.deepEqual(results, []);
});

test("searchLegalEmbeddingRecords never scores anything when records are empty", () => {
  // A zero query vector would make cosineSimilarity throw, so returning []
  // proves no scoring happened.
  assert.deepEqual(
    searchLegalEmbeddingRecords({
      queryEmbedding: [0, 0, 0],
      records: [],
      topK: 3,
    }),
    [],
  );
});

test("searchLegalEmbeddingRecords rejects a non-positive topK", () => {
  assert.throws(
    () =>
      searchLegalEmbeddingRecords({
        queryEmbedding: QUERY_EMBEDDING,
        records: createRecords(),
        topK: 0,
      }),
    /topK/,
  );
  assert.throws(
    () =>
      searchLegalEmbeddingRecords({
        queryEmbedding: QUERY_EMBEDDING,
        records: createRecords(),
        topK: -1,
      }),
    /topK/,
  );
  assert.throws(
    () =>
      searchLegalEmbeddingRecords({
        queryEmbedding: QUERY_EMBEDDING,
        records: createRecords(),
        topK: 0,
      }),
    /greater than 0/i,
  );
});

test("searchLegalEmbeddingRecords propagates dimension mismatch errors", () => {
  assert.throws(
    () =>
      searchLegalEmbeddingRecords({
        queryEmbedding: [1, 0],
        records: createRecords(),
        topK: 2,
      }),
    /mismatch/i,
  );
});

test("searchLegalEmbeddingRecords propagates zero query vector errors", () => {
  assert.throws(
    () =>
      searchLegalEmbeddingRecords({
        queryEmbedding: [0, 0, 0],
        records: createRecords(),
        topK: 2,
      }),
    /zero/i,
  );
});

test("searchLegalEmbeddingRecords propagates zero record embedding errors", () => {
  const zeroRecord = createRecord({
    chunk_id: "zero-act:1:0",
    act_id: "zero-act",
    embedding: [0, 0, 0],
  });

  assert.throws(
    () =>
      searchLegalEmbeddingRecords({
        queryEmbedding: QUERY_EMBEDDING,
        records: [zeroRecord],
        topK: 1,
      }),
    /zero/i,
  );
});

test("searchLegalEmbeddingRecords performs no network request", () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    throw new Error("Network access is not allowed in this test");
  }) as typeof fetch;

  try {
    const results = searchLegalEmbeddingRecords({
      queryEmbedding: QUERY_EMBEDDING,
      records: createRecords(),
      topK: 2,
    });

    assert.equal(results.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
