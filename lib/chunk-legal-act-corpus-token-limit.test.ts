import assert from "node:assert/strict";
import { test } from "node:test";
import type { LegalActCorpusItem } from "./build-legal-act-corpus";
import {
  chunkLegalActCorpus,
  type LegalActChunk,
  type LegalChunkStrategy,
} from "./chunk-legal-act-corpus";

/**
 * RED: token-aware article splitting.
 *
 * Для embeddings выбрана модель text-embedding-3-small (1536 dimensions,
 * cl100k_base) с лимитом 8192 токенов на один input. Замер финального чистого
 * корпуса (1999 статей, 1 051 944 токена) дал три статьи выше лимита:
 *
 *   labour-code-kz art. 1          10352
 *   entrepreneurial-code-kz 85-2   10052
 *   entrepreneurial-code-kz 129     8627
 *
 * chunkLegalActCorpus() сейчас всегда делает одну статью — одним chunk, поэтому
 * такие статьи ушли бы в API как есть.
 *
 * Здесь фиксируется будущий контракт: если вызывающая сторона передаёт лимит и
 * счётчик токенов, статья сверх лимита режется на несколько chunks. Счётчик
 * инжектируется, как и embedder в остальном пайплайне, поэтому тестам не нужен
 * настоящий токенизатор и на RED не добавляется ни одной зависимости.
 *
 * Без maxTokens/countTokens поведение обязано остаться прежним (1 статья — 1
 * chunk); это уже закреплено существующим chunk-legal-act-corpus.test.ts.
 */

/** Официальный per-input limit модели. */
const MODEL_TOKEN_LIMIT = 8192;

/** Рабочий лимит с запасом ниже API limit. */
const SAFETY_TOKEN_LIMIT = 8000;

interface TokenAwareChunkInput {
  items: LegalActCorpusItem[];
  strategy: LegalChunkStrategy;
  maxTokens: number;
  countTokens: (text: string) => number;
}

/**
 * Будущая сигнатура. Production ещё не принимает maxTokens/countTokens, поэтому
 * вызов идёт через явно описанный контракт: тест падает на поведении, а не на
 * типах.
 */
const chunkWithTokenLimit = chunkLegalActCorpus as unknown as (
  input: TokenAwareChunkInput,
) => LegalActChunk[];

/** Детерминированный счётчик вместо токенизатора: одно слово — один токен. */
function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function words(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`).join(" ");
}

const SHORT_ITEM: LegalActCorpusItem = {
  act_id: "personal-data-law-kz",
  act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
  source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
  article_number: "12",
  article_title: "Права субъекта персональных данных",
  article_text: "1. Субъект имеет право на доступ к своим персональным данным.",
  anchor: "#z120",
};

/** 24 «токена» по счётчику слов — заметно выше маленького тестового лимита. */
const OVERSIZED_ITEM: LegalActCorpusItem = {
  act_id: "labour-code-kz",
  act_name: "Трудовой кодекс Республики Казахстан",
  source_url: "https://adilet.zan.kz/rus/docs/K1500000414",
  article_number: "1",
  article_title: "Основные понятия, используемые в настоящем Кодексе",
  article_text: words("понятие", 24),
  anchor: "#z1",
};

const SMALL_LIMIT = 10;

/** Статья масштаба labour-code-kz art. 1 (10352 токена по реальному замеру). */
const REAL_SCALE_ITEM: LegalActCorpusItem = {
  act_id: "labour-code-kz",
  act_name: "Трудовой кодекс Республики Казахстан",
  source_url: "https://adilet.zan.kz/rus/docs/K1500000414",
  article_number: "1",
  article_title: "Основные понятия, используемые в настоящем Кодексе",
  article_text: words("термин", 10352),
  anchor: "#z1",
};

function partsOf(chunks: LegalActChunk[], articleNumber: string): LegalActChunk[] {
  return chunks.filter((chunk) => chunk.article_number === articleNumber);
}

test("chunkLegalActCorpus keeps an article under the token limit as a single chunk", () => {
  const chunks = chunkWithTokenLimit({
    items: [SHORT_ITEM],
    strategy: "article",
    maxTokens: SMALL_LIMIT,
    countTokens: countWords,
  });

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].chunk_text, SHORT_ITEM.article_text);
  assert.equal(chunks[0].chunk_index, 0);
  assert.equal(chunks[0].chunk_total, 1);
  assert.equal(chunks[0].chunk_id, "personal-data-law-kz:12:0");
});

test("chunkLegalActCorpus splits an article above the token limit into several chunks", () => {
  const chunks = chunkWithTokenLimit({
    items: [OVERSIZED_ITEM],
    strategy: "article",
    maxTokens: SMALL_LIMIT,
    countTokens: countWords,
  });

  assert.ok(
    chunks.length > 1,
    `expected the oversized article to be split, received ${chunks.length} chunk(s)`,
  );
  assert.ok(chunks.length >= 3, `expected at least 3 parts, received ${chunks.length}`);
});

test("chunkLegalActCorpus keeps every chunk of a split article within the token limit", () => {
  const chunks = chunkWithTokenLimit({
    items: [OVERSIZED_ITEM],
    strategy: "article",
    maxTokens: SMALL_LIMIT,
    countTokens: countWords,
  });

  for (const chunk of chunks) {
    assert.ok(
      countWords(chunk.chunk_text) <= SMALL_LIMIT,
      `${chunk.chunk_id} has ${countWords(chunk.chunk_text)} tokens, limit is ${SMALL_LIMIT}`,
    );
    assert.ok(chunk.chunk_text.trim().length > 0, `${chunk.chunk_id} is empty`);
    assert.equal(chunk.chunk_text, chunk.chunk_text.trim());
  }
});

test("chunkLegalActCorpus preserves the whole article text across the split parts", () => {
  const chunks = chunkWithTokenLimit({
    items: [OVERSIZED_ITEM],
    strategy: "article",
    maxTokens: SMALL_LIMIT,
    countTokens: countWords,
  });

  assert.ok(chunks.length > 1, "the article must be split before this contract applies");
  assert.equal(
    chunks.map((chunk) => chunk.chunk_text).join(" "),
    OVERSIZED_ITEM.article_text,
  );
});

test("chunkLegalActCorpus repeats article metadata on every part of a split article", () => {
  const chunks = chunkWithTokenLimit({
    items: [OVERSIZED_ITEM],
    strategy: "article",
    maxTokens: SMALL_LIMIT,
    countTokens: countWords,
  });

  assert.ok(chunks.length > 1, "the article must be split before this contract applies");

  for (const chunk of chunks) {
    assert.equal(chunk.act_id, OVERSIZED_ITEM.act_id);
    assert.equal(chunk.act_name, OVERSIZED_ITEM.act_name);
    assert.equal(chunk.article_number, OVERSIZED_ITEM.article_number);
    assert.equal(chunk.article_title, OVERSIZED_ITEM.article_title);
    assert.equal(chunk.source_url, OVERSIZED_ITEM.source_url);
    assert.equal(chunk.anchor, OVERSIZED_ITEM.anchor);
  }
});

test("chunkLegalActCorpus numbers split parts with chunk_index, chunk_total and unique chunk_id", () => {
  const chunks = chunkWithTokenLimit({
    items: [OVERSIZED_ITEM],
    strategy: "article",
    maxTokens: SMALL_LIMIT,
    countTokens: countWords,
  });

  assert.ok(chunks.length > 1, "the article must be split before this contract applies");

  assert.deepEqual(
    chunks.map((chunk) => chunk.chunk_index),
    chunks.map((_, index) => index),
  );

  for (const chunk of chunks) {
    assert.equal(chunk.chunk_total, chunks.length);
    assert.equal(
      chunk.chunk_id,
      `${OVERSIZED_ITEM.act_id}:${OVERSIZED_ITEM.article_number}:${chunk.chunk_index}`,
    );
  }

  assert.equal(new Set(chunks.map((chunk) => chunk.chunk_id)).size, chunks.length);
});

test("chunkLegalActCorpus splits a real-scale article under the model token limit", () => {
  const chunks = chunkWithTokenLimit({
    items: [REAL_SCALE_ITEM],
    strategy: "article",
    maxTokens: SAFETY_TOKEN_LIMIT,
    countTokens: countWords,
  });

  assert.ok(
    chunks.length > 1,
    `a ${countWords(REAL_SCALE_ITEM.article_text)}-token article must be split`,
  );

  for (const chunk of chunks) {
    const tokens = countWords(chunk.chunk_text);
    assert.ok(tokens <= SAFETY_TOKEN_LIMIT, `${chunk.chunk_id} has ${tokens} tokens`);
    assert.ok(tokens <= MODEL_TOKEN_LIMIT, `${chunk.chunk_id} exceeds the model limit`);
  }

  assert.equal(
    chunks.map((chunk) => chunk.chunk_text).join(" "),
    REAL_SCALE_ITEM.article_text,
  );
});

test("chunkLegalActCorpus splits only the oversized article of a mixed corpus", () => {
  const chunks = chunkWithTokenLimit({
    items: [SHORT_ITEM, OVERSIZED_ITEM],
    strategy: "article",
    maxTokens: SMALL_LIMIT,
    countTokens: countWords,
  });

  const shortParts = partsOf(chunks, SHORT_ITEM.article_number);
  const oversizedParts = partsOf(chunks, OVERSIZED_ITEM.article_number);

  assert.equal(shortParts.length, 1);
  assert.equal(shortParts[0].chunk_text, SHORT_ITEM.article_text);
  assert.equal(shortParts[0].chunk_total, 1);
  assert.ok(oversizedParts.length > 1, "the oversized article must be split");

  // Порядок статей сохраняется: все части первой статьи идут раньше второй.
  assert.deepEqual(
    chunks.map((chunk) => chunk.article_number),
    [
      ...shortParts.map(() => SHORT_ITEM.article_number),
      ...oversizedParts.map(() => OVERSIZED_ITEM.article_number),
    ],
  );

  for (const chunk of chunks) {
    assert.ok(
      countWords(chunk.chunk_text) <= SMALL_LIMIT,
      `${chunk.chunk_id} exceeds the limit`,
    );
  }
});
