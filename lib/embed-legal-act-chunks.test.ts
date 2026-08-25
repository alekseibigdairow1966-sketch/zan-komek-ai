import assert from "node:assert/strict";
import { test } from "node:test";
import type { LegalActChunk } from "./chunk-legal-act-corpus";
import {
  embedLegalActChunks,
  type LegalChunkEmbedder,
} from "./embed-legal-act-chunks";

const BASELINE_MODEL = "text-embedding-3-small";
const BASELINE_DIMENSIONS = 1536;

const CHUNK_WITH_OPTIONALS: LegalActChunk = {
  chunk_id: "personal-data-law-kz:7:0",
  act_id: "personal-data-law-kz",
  act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
  article_number: "7",
  article_title: "Условия сбора и обработки персональных данных",
  source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
  anchor: "#z17",
  chunk_text:
    '1. Сбор, обработка персональных данных осуществляются с согласия субъекта.\n2. Субъект даёт согласие "письменно" либо иным способом.',
  chunk_index: 0,
  chunk_total: 1,
};

const CHUNK_WITHOUT_OPTIONALS: LegalActChunk = {
  chunk_id: "personal-data-law-kz:12:0",
  act_id: "personal-data-law-kz",
  act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
  article_number: "12",
  source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
  chunk_text: "1. Текст статьи без title и без anchor.",
  chunk_index: 0,
  chunk_total: 1,
};

const VECTOR_FIRST = [0.1, 0.2, 0.3];
const VECTOR_SECOND = [0.4, 0.5, 0.6];

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

function embedBaseline(
  chunks: LegalActChunk[],
  embedder: LegalChunkEmbedder,
) {
  return embedLegalActChunks(
    {
      chunks,
      model: BASELINE_MODEL,
      dimensions: BASELINE_DIMENSIONS,
    },
    embedder,
  );
}

test("embedLegalActChunks returns one embedding record per chunk", async () => {
  const { embedder } = createRecordingEmbedder([VECTOR_FIRST, VECTOR_SECOND]);
  const records = await embedBaseline(
    [CHUNK_WITH_OPTIONALS, CHUNK_WITHOUT_OPTIONALS],
    embedder,
  );

  assert.equal(Array.isArray(records), true);
  assert.equal(records.length, 2);
});

test("embedLegalActChunks passes chunk texts to the embedder in original order", async () => {
  const { embedder, calls } = createRecordingEmbedder([
    VECTOR_FIRST,
    VECTOR_SECOND,
  ]);

  await embedBaseline([CHUNK_WITH_OPTIONALS, CHUNK_WITHOUT_OPTIONALS], embedder);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].texts, [
    CHUNK_WITH_OPTIONALS.chunk_text,
    CHUNK_WITHOUT_OPTIONALS.chunk_text,
  ]);
});

test("embedLegalActChunks passes the baseline model and dimensions to the embedder", async () => {
  const { embedder, calls } = createRecordingEmbedder([
    VECTOR_FIRST,
    VECTOR_SECOND,
  ]);

  await embedBaseline([CHUNK_WITH_OPTIONALS, CHUNK_WITHOUT_OPTIONALS], embedder);

  assert.equal(calls[0].model, "text-embedding-3-small");
  assert.equal(calls[0].dimensions, 1536);
});

test("embedLegalActChunks uses whatever model and dimensions the caller provides", async () => {
  const { embedder, calls } = createRecordingEmbedder([VECTOR_FIRST]);
  const records = await embedLegalActChunks(
    {
      chunks: [CHUNK_WITH_OPTIONALS],
      model: "text-embedding-3-large",
      dimensions: 3072,
    },
    embedder,
  );

  assert.equal(calls[0].model, "text-embedding-3-large");
  assert.equal(calls[0].dimensions, 3072);
  assert.equal(records[0].embedding_model, "text-embedding-3-large");
  assert.equal(records[0].embedding_dimensions, 3072);
});

test("embedLegalActChunks aligns each returned vector with its chunk", async () => {
  const { embedder } = createRecordingEmbedder([VECTOR_FIRST, VECTOR_SECOND]);
  const [first, second] = await embedBaseline(
    [CHUNK_WITH_OPTIONALS, CHUNK_WITHOUT_OPTIONALS],
    embedder,
  );

  assert.equal(first.chunk_id, CHUNK_WITH_OPTIONALS.chunk_id);
  assert.deepEqual(first.embedding, VECTOR_FIRST);

  assert.equal(second.chunk_id, CHUNK_WITHOUT_OPTIONALS.chunk_id);
  assert.deepEqual(second.embedding, VECTOR_SECOND);
});

test("embedLegalActChunks carries over all chunk metadata", async () => {
  const { embedder } = createRecordingEmbedder([VECTOR_FIRST, VECTOR_SECOND]);
  const [first, second] = await embedBaseline(
    [CHUNK_WITH_OPTIONALS, CHUNK_WITHOUT_OPTIONALS],
    embedder,
  );

  assert.equal(first.chunk_id, CHUNK_WITH_OPTIONALS.chunk_id);
  assert.equal(first.act_id, CHUNK_WITH_OPTIONALS.act_id);
  assert.equal(first.act_name, CHUNK_WITH_OPTIONALS.act_name);
  assert.equal(first.article_number, CHUNK_WITH_OPTIONALS.article_number);
  assert.equal(first.article_title, CHUNK_WITH_OPTIONALS.article_title);
  assert.equal(first.source_url, CHUNK_WITH_OPTIONALS.source_url);
  assert.equal(first.anchor, CHUNK_WITH_OPTIONALS.anchor);
  assert.equal(first.chunk_text, CHUNK_WITH_OPTIONALS.chunk_text);
  assert.equal(first.chunk_index, CHUNK_WITH_OPTIONALS.chunk_index);
  assert.equal(first.chunk_total, CHUNK_WITH_OPTIONALS.chunk_total);

  assert.equal(second.chunk_id, CHUNK_WITHOUT_OPTIONALS.chunk_id);
  assert.equal(second.act_id, CHUNK_WITHOUT_OPTIONALS.act_id);
  assert.equal(second.act_name, CHUNK_WITHOUT_OPTIONALS.act_name);
  assert.equal(second.article_number, CHUNK_WITHOUT_OPTIONALS.article_number);
  assert.equal(second.source_url, CHUNK_WITHOUT_OPTIONALS.source_url);
  assert.equal(second.chunk_text, CHUNK_WITHOUT_OPTIONALS.chunk_text);
  assert.equal(second.chunk_index, CHUNK_WITHOUT_OPTIONALS.chunk_index);
  assert.equal(second.chunk_total, CHUNK_WITHOUT_OPTIONALS.chunk_total);
});

test("embedLegalActChunks stores embedding_model and embedding_dimensions on every record", async () => {
  const { embedder } = createRecordingEmbedder([VECTOR_FIRST, VECTOR_SECOND]);
  const records = await embedBaseline(
    [CHUNK_WITH_OPTIONALS, CHUNK_WITHOUT_OPTIONALS],
    embedder,
  );

  for (const record of records) {
    assert.equal(record.embedding_model, BASELINE_MODEL);
    assert.equal(record.embedding_dimensions, BASELINE_DIMENSIONS);
  }
});

test("embedLegalActChunks keeps optional fields only when the chunk has them", async () => {
  const { embedder } = createRecordingEmbedder([VECTOR_FIRST, VECTOR_SECOND]);
  const [first, second] = await embedBaseline(
    [CHUNK_WITH_OPTIONALS, CHUNK_WITHOUT_OPTIONALS],
    embedder,
  );

  assert.equal("article_title" in first, true);
  assert.equal("anchor" in first, true);

  assert.equal("article_title" in second, false);
  assert.equal("anchor" in second, false);
  assert.deepEqual(
    Object.keys(second).filter(
      (key) => key === "article_title" || key === "anchor",
    ),
    [],
  );
});

test("embedLegalActChunks preserves chunk order", async () => {
  const { embedder } = createRecordingEmbedder([VECTOR_FIRST, VECTOR_SECOND]);
  const records = await embedBaseline(
    [CHUNK_WITH_OPTIONALS, CHUNK_WITHOUT_OPTIONALS],
    embedder,
  );

  assert.deepEqual(
    records.map((record) => record.chunk_id),
    [CHUNK_WITH_OPTIONALS.chunk_id, CHUNK_WITHOUT_OPTIONALS.chunk_id],
  );
});

test("embedLegalActChunks does not mutate the input chunks", async () => {
  const { embedder } = createRecordingEmbedder([VECTOR_FIRST, VECTOR_SECOND]);
  const chunks = [CHUNK_WITH_OPTIONALS, CHUNK_WITHOUT_OPTIONALS];
  const snapshot = structuredClone(chunks);

  await embedBaseline(chunks, embedder);

  assert.deepEqual(chunks, snapshot);
  assert.equal(chunks.length, 2);
});

test("embedLegalActChunks returns an empty array and skips the embedder for an empty input", async () => {
  const { embedder, calls } = createRecordingEmbedder([VECTOR_FIRST]);
  const records = await embedBaseline([], embedder);

  assert.deepEqual(records, []);
  assert.equal(calls.length, 0);
});

test("embedLegalActChunks lets embedder errors propagate", async () => {
  const failingEmbedder: LegalChunkEmbedder = async () => {
    throw new Error("Embedding provider unavailable");
  };

  await assert.rejects(
    () => embedBaseline([CHUNK_WITH_OPTIONALS], failingEmbedder),
    /Embedding provider unavailable/,
  );
});

test("embedLegalActChunks rejects when the embedder returns a different number of vectors", async () => {
  const { embedder: tooFew } = createRecordingEmbedder([VECTOR_FIRST]);
  const { embedder: tooMany } = createRecordingEmbedder([
    VECTOR_FIRST,
    VECTOR_SECOND,
  ]);

  await assert.rejects(() =>
    embedBaseline([CHUNK_WITH_OPTIONALS, CHUNK_WITHOUT_OPTIONALS], tooFew),
  );

  await assert.rejects(() => embedBaseline([CHUNK_WITH_OPTIONALS], tooMany));
});

test("embedLegalActChunks performs no network request of its own", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    throw new Error("Network access is not allowed in this test");
  }) as typeof fetch;

  try {
    const { embedder } = createRecordingEmbedder([VECTOR_FIRST, VECTOR_SECOND]);
    const records = await embedBaseline(
      [CHUNK_WITH_OPTIONALS, CHUNK_WITHOUT_OPTIONALS],
      embedder,
    );

    assert.equal(records.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
