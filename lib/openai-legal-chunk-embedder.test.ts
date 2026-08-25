import assert from "node:assert/strict";
import { test } from "node:test";
import type { LegalChunkEmbedder } from "./embed-legal-act-chunks";
import {
  createOpenAiLegalChunkEmbedder,
  type OpenAiEmbeddingsClient,
} from "./openai-legal-chunk-embedder";

const BASELINE_MODEL = "text-embedding-3-small";
const BASELINE_DIMENSIONS = 1536;

const TEXTS = [
  "1. Сбор, обработка персональных данных осуществляются с согласия субъекта.",
  '2. Субъект даёт согласие "письменно" либо иным способом.',
];

interface EmbeddingsCreateCall {
  model: string;
  input: string[];
  dimensions?: number;
}

function createRecordingClient(
  data: Array<{ index: number; embedding: number[] }>,
): {
  client: OpenAiEmbeddingsClient;
  calls: EmbeddingsCreateCall[];
} {
  const calls: EmbeddingsCreateCall[] = [];

  const client: OpenAiEmbeddingsClient = {
    embeddings: {
      create: async (params) => {
        calls.push({
          model: params.model,
          input: [...params.input],
          dimensions: params.dimensions,
        });

        return { data };
      },
    },
  };

  return { client, calls };
}

const ORDERED_RESPONSE_DATA = [
  { index: 0, embedding: [0.1, 0.2] },
  { index: 1, embedding: [0.4, 0.5] },
];

const OUT_OF_ORDER_RESPONSE_DATA = [
  { index: 1, embedding: [0.4, 0.5] },
  { index: 0, embedding: [0.1, 0.2] },
];

test("createOpenAiLegalChunkEmbedder returns a LegalChunkEmbedder-compatible function", async () => {
  const { client } = createRecordingClient(ORDERED_RESPONSE_DATA);
  const embedder: LegalChunkEmbedder = createOpenAiLegalChunkEmbedder(client);

  assert.equal(typeof embedder, "function");

  const vectors = await embedder(TEXTS, {
    model: BASELINE_MODEL,
    dimensions: BASELINE_DIMENSIONS,
  });

  assert.equal(Array.isArray(vectors), true);
  assert.equal(vectors.length, 2);
  assert.equal(Array.isArray(vectors[0]), true);
  assert.equal(typeof vectors[0][0], "number");
});

test("createOpenAiLegalChunkEmbedder sends all texts in a single batch request", async () => {
  const { client, calls } = createRecordingClient(ORDERED_RESPONSE_DATA);
  const embedder = createOpenAiLegalChunkEmbedder(client);

  await embedder(TEXTS, {
    model: BASELINE_MODEL,
    dimensions: BASELINE_DIMENSIONS,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.length, 2);
});

test("createOpenAiLegalChunkEmbedder forwards the exact model and dimensions", async () => {
  const { client, calls } = createRecordingClient(ORDERED_RESPONSE_DATA);
  const embedder = createOpenAiLegalChunkEmbedder(client);

  await embedder(TEXTS, {
    model: BASELINE_MODEL,
    dimensions: BASELINE_DIMENSIONS,
  });

  assert.equal(calls[0].model, "text-embedding-3-small");
  assert.equal(calls[0].dimensions, 1536);
});

test("createOpenAiLegalChunkEmbedder forwards texts as input in original order", async () => {
  const { client, calls } = createRecordingClient(ORDERED_RESPONSE_DATA);
  const embedder = createOpenAiLegalChunkEmbedder(client);

  await embedder(TEXTS, {
    model: BASELINE_MODEL,
    dimensions: BASELINE_DIMENSIONS,
  });

  assert.deepEqual(calls[0].input, TEXTS);
});

test("createOpenAiLegalChunkEmbedder returns only embedding vectors from the response", async () => {
  const { client } = createRecordingClient(ORDERED_RESPONSE_DATA);
  const embedder = createOpenAiLegalChunkEmbedder(client);

  const vectors = await embedder(TEXTS, {
    model: BASELINE_MODEL,
    dimensions: BASELINE_DIMENSIONS,
  });

  assert.deepEqual(vectors, [
    [0.1, 0.2],
    [0.4, 0.5],
  ]);
});

test("createOpenAiLegalChunkEmbedder restores vector order by response index", async () => {
  const { client } = createRecordingClient(OUT_OF_ORDER_RESPONSE_DATA);
  const embedder = createOpenAiLegalChunkEmbedder(client);

  const vectors = await embedder(TEXTS, {
    model: BASELINE_MODEL,
    dimensions: BASELINE_DIMENSIONS,
  });

  assert.deepEqual(vectors, [
    [0.1, 0.2],
    [0.4, 0.5],
  ]);
});

test("createOpenAiLegalChunkEmbedder lets embeddings.create errors propagate", async () => {
  const client: OpenAiEmbeddingsClient = {
    embeddings: {
      create: async () => {
        throw new Error("OpenAI embeddings request failed");
      },
    },
  };

  const embedder = createOpenAiLegalChunkEmbedder(client);

  await assert.rejects(
    () =>
      embedder(TEXTS, {
        model: BASELINE_MODEL,
        dimensions: BASELINE_DIMENSIONS,
      }),
    /OpenAI embeddings request failed/,
  );
});

test("createOpenAiLegalChunkEmbedder does not mutate the texts array or the config", async () => {
  const { client } = createRecordingClient(OUT_OF_ORDER_RESPONSE_DATA);
  const embedder = createOpenAiLegalChunkEmbedder(client);

  const texts = [...TEXTS];
  const textsSnapshot = [...TEXTS];
  const config = {
    model: BASELINE_MODEL,
    dimensions: BASELINE_DIMENSIONS,
  };
  const configSnapshot = { ...config };

  await embedder(texts, config);

  assert.deepEqual(texts, textsSnapshot);
  assert.deepEqual(config, configSnapshot);
});

test("createOpenAiLegalChunkEmbedder performs no network request of its own", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    throw new Error("Network access is not allowed in this test");
  }) as typeof fetch;

  try {
    const { client, calls } = createRecordingClient(ORDERED_RESPONSE_DATA);
    const embedder = createOpenAiLegalChunkEmbedder(client);

    const vectors = await embedder(TEXTS, {
      model: BASELINE_MODEL,
      dimensions: BASELINE_DIMENSIONS,
    });

    assert.equal(calls.length, 1);
    assert.equal(vectors.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
