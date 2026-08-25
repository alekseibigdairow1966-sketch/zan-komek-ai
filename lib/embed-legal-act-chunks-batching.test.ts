import assert from "node:assert/strict";
import { test } from "node:test";
import type { LegalActChunk } from "./chunk-legal-act-corpus";
import {
  embedLegalActChunks,
  type LegalChunkEmbedder,
  type LegalChunkEmbedding,
} from "./embed-legal-act-chunks";

/**
 * RED: token-aware batching of embedding requests.
 *
 * embedLegalActChunks() сейчас отправляет весь массив chunks одним вызовом
 * embedder: для чистого корпуса это 1999 inputs в одном embeddings.create.
 * Per-input размер уже решён token-aware splitting в chunkLegalActCorpus;
 * здесь фиксируется другая ответственность — совокупный размер одного запроса.
 *
 * Будущий контракт: если caller передаёт maxBatchTokens и countTokens, chunks
 * группируются подряд так, что сумма токенов каждого batch не превышает лимит,
 * и на каждый batch приходится один вызов embedder. Без этих параметров
 * поведение обязано остаться прежним (один вызов на весь массив), что уже
 * закреплено существующим embed-legal-act-chunks.test.ts.
 *
 * Счётчик токенов инжектируется, как и embedder, поэтому тестам не нужен
 * настоящий токенизатор и на RED не добавляется ни одной зависимости.
 * Лимиты здесь синтетические и маленькие: конкретное production-значение
 * (с запасом ниже aggregate limit модели) выбирает будущий caller.
 */

const BASELINE_MODEL = "text-embedding-3-small";
const BASELINE_DIMENSIONS = 1536;

interface BatchingEmbedInput {
  chunks: LegalActChunk[];
  model: string;
  dimensions: number;
  maxBatchTokens: number;
  countTokens: (text: string) => number;
}

/**
 * Будущая сигнатура. Production ещё не принимает maxBatchTokens/countTokens,
 * поэтому вызов идёт через явно описанный контракт: тест падает на поведении,
 * а не на типах.
 */
const embedWithBatching = embedLegalActChunks as unknown as (
  input: BatchingEmbedInput,
  embedder: LegalChunkEmbedder,
) => Promise<LegalChunkEmbedding[]>;

/** Детерминированный счётчик вместо токенизатора: одно слово — один токен. */
function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Текст ровно на `weight` «токенов», уникальный по метке. */
function chunkOfWeight(
  articleNumber: string,
  label: string,
  weight: number,
): LegalActChunk {
  return {
    chunk_id: `personal-data-law-kz:${articleNumber}:0`,
    act_id: "personal-data-law-kz",
    act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
    article_number: articleNumber,
    article_title: `Статья ${articleNumber}`,
    source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
    anchor: `#z${articleNumber}`,
    chunk_text: Array.from({ length: weight }, () => label).join(" "),
    chunk_index: 0,
    chunk_total: 1,
  };
}

/** Различимый вектор на каждый входной текст. */
function vectorFor(text: string): number[] {
  return [text.length, text.charCodeAt(0), countWords(text)];
}

interface EmbedderCall {
  texts: string[];
  model: string;
  dimensions: number;
}

function createRecordingEmbedder(): {
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

    return texts.map((text) => vectorFor(text));
  };

  return { embedder, calls };
}

function batchTokens(call: EmbedderCall): number {
  return call.texts.reduce((total, text) => total + countWords(text), 0);
}

const CHUNK_A = chunkOfWeight("1", "a", 4);
const CHUNK_B = chunkOfWeight("2", "b", 4);
const CHUNK_C = chunkOfWeight("3", "c", 4);

test("embedLegalActChunks without batching options still makes one embedder call", async () => {
  const { embedder, calls } = createRecordingEmbedder();

  const records = await embedLegalActChunks(
    {
      chunks: [CHUNK_A, CHUNK_B, CHUNK_C],
      model: BASELINE_MODEL,
      dimensions: BASELINE_DIMENSIONS,
    },
    embedder,
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].texts, [
    CHUNK_A.chunk_text,
    CHUNK_B.chunk_text,
    CHUNK_C.chunk_text,
  ]);
  assert.equal(records.length, 3);
});

test("embedLegalActChunks splits chunks into several batches under the token limit", async () => {
  const { embedder, calls } = createRecordingEmbedder();

  await embedWithBatching(
    {
      chunks: [CHUNK_A, CHUNK_B, CHUNK_C],
      model: BASELINE_MODEL,
      dimensions: BASELINE_DIMENSIONS,
      maxBatchTokens: 8,
      countTokens: countWords,
    },
    embedder,
  );

  assert.equal(calls.length, 2, `expected 2 batches, received ${calls.length}`);
  assert.deepEqual(calls[0].texts, [CHUNK_A.chunk_text, CHUNK_B.chunk_text]);
  assert.deepEqual(calls[1].texts, [CHUNK_C.chunk_text]);
});

test("embedLegalActChunks keeps every batch within maxBatchTokens", async () => {
  const { embedder, calls } = createRecordingEmbedder();

  await embedWithBatching(
    {
      chunks: [CHUNK_A, CHUNK_B, CHUNK_C],
      model: BASELINE_MODEL,
      dimensions: BASELINE_DIMENSIONS,
      maxBatchTokens: 8,
      countTokens: countWords,
    },
    embedder,
  );

  for (const [index, call] of calls.entries()) {
    assert.ok(
      batchTokens(call) <= 8,
      `batch ${index} carries ${batchTokens(call)} tokens, limit is 8`,
    );
    assert.ok(call.texts.length > 0, `batch ${index} is empty`);
    assert.equal(call.model, BASELINE_MODEL);
    assert.equal(call.dimensions, BASELINE_DIMENSIONS);
  }
});

test("embedLegalActChunks keeps record order across batches", async () => {
  const { embedder, calls } = createRecordingEmbedder();

  const records = await embedWithBatching(
    {
      chunks: [CHUNK_A, CHUNK_B, CHUNK_C],
      model: BASELINE_MODEL,
      dimensions: BASELINE_DIMENSIONS,
      maxBatchTokens: 8,
      countTokens: countWords,
    },
    embedder,
  );

  assert.ok(calls.length > 1, "the chunks must be batched before this contract applies");

  assert.deepEqual(
    records.map((record) => record.article_number),
    ["1", "2", "3"],
  );

  for (const [index, chunk] of [CHUNK_A, CHUNK_B, CHUNK_C].entries()) {
    assert.equal(records[index].chunk_id, chunk.chunk_id);
    assert.equal(records[index].chunk_text, chunk.chunk_text);
    assert.deepEqual(records[index].embedding, vectorFor(chunk.chunk_text));
  }
});

test("embedLegalActChunks runs the trailing partial batch", async () => {
  const { embedder, calls } = createRecordingEmbedder();
  const chunks = [
    chunkOfWeight("1", "a", 3),
    chunkOfWeight("2", "b", 3),
    chunkOfWeight("3", "c", 3),
    chunkOfWeight("4", "d", 3),
    chunkOfWeight("5", "e", 3),
  ];

  const records = await embedWithBatching(
    {
      chunks,
      model: BASELINE_MODEL,
      dimensions: BASELINE_DIMENSIONS,
      maxBatchTokens: 6,
      countTokens: countWords,
    },
    embedder,
  );

  assert.equal(calls.length, 3, `expected 3 batches, received ${calls.length}`);
  assert.deepEqual(
    calls.map((call) => call.texts.length),
    [2, 2, 1],
  );
  assert.equal(records.length, 5);
  assert.deepEqual(
    records.map((record) => record.article_number),
    ["1", "2", "3", "4", "5"],
  );
});

test("embedLegalActChunks lets a chunk exactly at the limit fill its own batch", async () => {
  const { embedder, calls } = createRecordingEmbedder();
  const first = chunkOfWeight("1", "a", 8);
  const second = chunkOfWeight("2", "b", 8);

  const records = await embedWithBatching(
    {
      chunks: [first, second],
      model: BASELINE_MODEL,
      dimensions: BASELINE_DIMENSIONS,
      maxBatchTokens: 8,
      countTokens: countWords,
    },
    embedder,
  );

  assert.equal(calls.length, 2, `expected 2 batches, received ${calls.length}`);
  assert.deepEqual(calls[0].texts, [first.chunk_text]);
  assert.deepEqual(calls[1].texts, [second.chunk_text]);
  assert.equal(batchTokens(calls[0]), 8);
  assert.equal(batchTokens(calls[1]), 8);
  assert.equal(records.length, 2);
});

test("embedLegalActChunks rejects a chunk above the batch limit before calling the embedder", async () => {
  const { embedder, calls } = createRecordingEmbedder();
  const oversized = chunkOfWeight("9", "x", 9);

  await assert.rejects(
    () =>
      embedWithBatching(
        {
          chunks: [CHUNK_A, oversized],
          model: BASELINE_MODEL,
          dimensions: BASELINE_DIMENSIONS,
          maxBatchTokens: 8,
          countTokens: countWords,
        },
        embedder,
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /personal-data-law-kz:9:0/);
      return true;
    },
  );

  assert.equal(calls.length, 0, "the embedder must not be called for an impossible batch");
});

test("embedLegalActChunks returns no records and skips the embedder for an empty batch input", async () => {
  const { embedder, calls } = createRecordingEmbedder();

  const records = await embedWithBatching(
    {
      chunks: [],
      model: BASELINE_MODEL,
      dimensions: BASELINE_DIMENSIONS,
      maxBatchTokens: 8,
      countTokens: countWords,
    },
    embedder,
  );

  assert.deepEqual(records, []);
  assert.equal(calls.length, 0);
});
