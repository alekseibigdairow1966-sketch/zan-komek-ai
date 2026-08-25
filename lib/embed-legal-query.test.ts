import assert from "node:assert/strict";
import { test } from "node:test";
import type { LegalChunkEmbedder } from "./embed-legal-act-chunks";
import { embedLegalQuery } from "./embed-legal-query";

const BASELINE_MODEL = "text-embedding-3-small";
const BASELINE_DIMENSIONS = 1536;

const QUERY_TEXT =
  'Работодатель уволил меня без предупреждения.\nИмею ли я право на "компенсацию"?';

const VECTOR = [0.1, 0.2, 0.3];
const OTHER_VECTOR = [0.4, 0.5, 0.6];

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

function embedBaseline(queryText: string, embedder: LegalChunkEmbedder) {
  return embedLegalQuery(
    {
      queryText,
      model: BASELINE_MODEL,
      dimensions: BASELINE_DIMENSIONS,
    },
    embedder,
  );
}

test("embedLegalQuery returns a single query embedding", async () => {
  const { embedder } = createRecordingEmbedder([VECTOR]);
  const result = await embedBaseline(QUERY_TEXT, embedder);

  assert.equal(Array.isArray(result), false);
  assert.equal(result.query_text, QUERY_TEXT);
  assert.deepEqual(result.embedding, VECTOR);
});

test("embedLegalQuery calls the embedder exactly once with a single text", async () => {
  const { embedder, calls } = createRecordingEmbedder([VECTOR]);

  await embedBaseline(QUERY_TEXT, embedder);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].texts.length, 1);
  assert.deepEqual(calls[0].texts, [QUERY_TEXT]);
});

test("embedLegalQuery passes the query text to the embedder unchanged", async () => {
  const rawQuery = "  Договор аренды КВАРТИРЫ, пункт 5.1!  \n";
  const { embedder, calls } = createRecordingEmbedder([VECTOR]);
  const result = await embedBaseline(rawQuery, embedder);

  assert.equal(calls[0].texts[0], rawQuery);
  assert.equal(result.query_text, rawQuery);
  assert.equal(calls[0].texts[0].startsWith("  "), true);
  assert.equal(calls[0].texts[0].endsWith("\n"), true);
  assert.match(calls[0].texts[0], /КВАРТИРЫ/);
  assert.match(calls[0].texts[0], /!/);
});

test("embedLegalQuery passes the baseline model and dimensions to the embedder", async () => {
  const { embedder, calls } = createRecordingEmbedder([VECTOR]);
  const result = await embedBaseline(QUERY_TEXT, embedder);

  assert.equal(calls[0].model, "text-embedding-3-small");
  assert.equal(calls[0].dimensions, 1536);
  assert.equal(result.embedding_model, "text-embedding-3-small");
  assert.equal(result.embedding_dimensions, 1536);
});

test("embedLegalQuery uses whatever model and dimensions the caller provides", async () => {
  const { embedder, calls } = createRecordingEmbedder([VECTOR]);
  const result = await embedLegalQuery(
    {
      queryText: QUERY_TEXT,
      model: "text-embedding-3-large",
      dimensions: 3072,
    },
    embedder,
  );

  assert.equal(calls[0].model, "text-embedding-3-large");
  assert.equal(calls[0].dimensions, 3072);
  assert.equal(result.embedding_model, "text-embedding-3-large");
  assert.equal(result.embedding_dimensions, 3072);
});

test("embedLegalQuery returns the single vector produced by the embedder", async () => {
  const { embedder } = createRecordingEmbedder([OTHER_VECTOR]);
  const result = await embedBaseline(QUERY_TEXT, embedder);

  assert.deepEqual(result.embedding, OTHER_VECTOR);
  assert.equal(result.embedding[0], 0.4);
});

test("embedLegalQuery exposes exactly the query embedding fields", async () => {
  const { embedder } = createRecordingEmbedder([VECTOR]);
  const result = await embedBaseline(QUERY_TEXT, embedder);

  assert.deepEqual(Object.keys(result).sort(), [
    "embedding",
    "embedding_dimensions",
    "embedding_model",
    "query_text",
  ]);
  assert.equal("retrieval_score" in result, false);
  assert.equal("act_id" in result, false);
  assert.equal("article_number" in result, false);
  assert.equal("source_confirmed" in result, false);
  assert.equal("search_confirmed" in result, false);
  assert.equal("content_checked" in result, false);
  assert.equal("verification_status" in result, false);
});

test("embedLegalQuery preserves cyrillic, quotes and newlines in the query text", async () => {
  const { embedder, calls } = createRecordingEmbedder([VECTOR]);
  const result = await embedBaseline(QUERY_TEXT, embedder);

  assert.equal(result.query_text, QUERY_TEXT);
  assert.equal(calls[0].texts[0], QUERY_TEXT);
  assert.match(result.query_text, /Работодатель/);
  assert.match(result.query_text, /"компенсацию"/);
  assert.match(result.query_text, /\n/);
});

test("embedLegalQuery does not mutate the input object", async () => {
  const { embedder } = createRecordingEmbedder([VECTOR]);
  const input = {
    queryText: QUERY_TEXT,
    model: BASELINE_MODEL,
    dimensions: BASELINE_DIMENSIONS,
  };
  const snapshot = structuredClone(input);

  await embedLegalQuery(input, embedder);

  assert.deepEqual(input, snapshot);
});

test("embedLegalQuery lets embedder errors propagate", async () => {
  const failingEmbedder: LegalChunkEmbedder = async () => {
    throw new Error("Embedding provider unavailable");
  };

  await assert.rejects(
    () => embedBaseline(QUERY_TEXT, failingEmbedder),
    /Embedding provider unavailable/,
  );
});

test("embedLegalQuery rejects when the embedder returns no vectors", async () => {
  const { embedder } = createRecordingEmbedder([]);

  await assert.rejects(
    () => embedBaseline(QUERY_TEXT, embedder),
    /received 0/,
  );
  await assert.rejects(
    () => embedBaseline(QUERY_TEXT, embedder),
    /exactly one/i,
  );
});

test("embedLegalQuery rejects when the embedder returns more than one vector", async () => {
  const { embedder } = createRecordingEmbedder([VECTOR, OTHER_VECTOR]);

  await assert.rejects(
    () => embedBaseline(QUERY_TEXT, embedder),
    /received 2/,
  );
  await assert.rejects(
    () => embedBaseline(QUERY_TEXT, embedder),
    /exactly one/i,
  );
});

test("embedLegalQuery rejects an empty query text", async () => {
  const { embedder } = createRecordingEmbedder([VECTOR]);

  await assert.rejects(() => embedBaseline("", embedder), /quer/i);
  await assert.rejects(() => embedBaseline("", embedder), /empty/i);
});

test("embedLegalQuery rejects a whitespace-only query text", async () => {
  const { embedder } = createRecordingEmbedder([VECTOR]);

  await assert.rejects(() => embedBaseline("   ", embedder), /empty/i);
  await assert.rejects(() => embedBaseline("\n\t  ", embedder), /empty/i);
});

test("embedLegalQuery never calls the embedder for an empty query text", async () => {
  const { embedder, calls } = createRecordingEmbedder([VECTOR]);

  await assert.rejects(() => embedBaseline("", embedder));
  await assert.rejects(() => embedBaseline("   ", embedder));

  assert.equal(calls.length, 0);
});

test("embedLegalQuery performs no network request of its own", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    throw new Error("Network access is not allowed in this test");
  }) as typeof fetch;

  try {
    const { embedder } = createRecordingEmbedder([VECTOR]);
    const result = await embedBaseline(QUERY_TEXT, embedder);

    assert.deepEqual(result.embedding, VECTOR);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
