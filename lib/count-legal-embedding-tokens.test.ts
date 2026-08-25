import assert from "node:assert/strict";
import { test } from "node:test";
import type { LegalTokenCounter } from "./chunk-legal-act-corpus";
import { runLegalEmbeddingBuild } from "./run-legal-embedding-build";

/**
 * RED: production token counter for cl100k_base.
 *
 * runLegalEmbeddingBuild уже принимает countTokens как зависимость, splitting
 * и batching уже сделаны token-aware. Не хватает единственного адаптера,
 * который реально считает токены cl100k_base для text-embedding-3-small
 * (1536 dimensions) и подставляется в этот шов.
 *
 * Замер вне проекта на чистом корпусе дал 1 999 chunks / 1 051 944 токена,
 * максимум 10 352 и три статьи выше 8192 — те самые числа, ради которых и
 * появились per-input и aggregate лимиты.
 *
 * js-tiktoken пока не является зависимостью проекта, поэтому модуль
 * загружается динамически: падение должно быть поведенческим, а не ошибкой
 * компиляции.
 *
 * Имя модуля выбрано по текущему стилю проекта, где имя файла — kebab-case от
 * основной экспортируемой функции (chunk-legal-act-corpus → chunkLegalActCorpus,
 * embed-legal-query → embedLegalQuery, run-legal-embedding-build →
 * runLegalEmbeddingBuild).
 */

const COUNTER_MODULE: string = "./count-legal-embedding-tokens";

interface TokenCounterModule {
  countLegalEmbeddingTokens: LegalTokenCounter;
  LEGAL_EMBEDDING_ENCODING: string;
}

async function loadCounterModule(): Promise<TokenCounterModule> {
  let loaded: Record<string, unknown>;

  try {
    loaded = (await import(COUNTER_MODULE)) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `cl100k_base token counter ${COUNTER_MODULE} does not exist yet: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const countLegalEmbeddingTokens = loaded.countLegalEmbeddingTokens;

  if (typeof countLegalEmbeddingTokens !== "function") {
    throw new Error(`${COUNTER_MODULE} does not export countLegalEmbeddingTokens`);
  }

  return {
    countLegalEmbeddingTokens: countLegalEmbeddingTokens as LegalTokenCounter,
    LEGAL_EMBEDDING_ENCODING: loaded.LEGAL_EMBEDDING_ENCODING as string,
  };
}

async function loadCounter(): Promise<LegalTokenCounter> {
  return (await loadCounterModule()).countLegalEmbeddingTokens;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

const RUSSIAN_SAMPLE =
  "Сбор, обработка персональных данных осуществляются с согласия субъекта персональных данных.";

const KAZAKH_SAMPLE = "Дербес деректерді жинау және өңдеу субъектінің келісімімен жүзеге асырылады.";

const SAMPLES = [
  "",
  "a",
  "hello world",
  RUSSIAN_SAMPLE,
  KAZAKH_SAMPLE,
  "Статья 1. Основные понятия, используемые в настоящем Кодексе",
];

test("runLegalEmbeddingBuild already exposes the seam this counter plugs into", () => {
  assert.equal(typeof runLegalEmbeddingBuild, "function");

  // Любая функция такой формы подставляется как countTokens; не хватает только
  // настоящей реализации на cl100k_base.
  const stub: LegalTokenCounter = (text) => text.length;

  assert.equal(typeof stub, "function");
});

test("count-legal-embedding-tokens exports the counter and names cl100k_base", async () => {
  const module = await loadCounterModule();

  assert.equal(typeof module.countLegalEmbeddingTokens, "function");
  assert.equal(module.LEGAL_EMBEDDING_ENCODING, "cl100k_base");
});

test("countLegalEmbeddingTokens returns 0 for an empty string", async () => {
  const countLegalEmbeddingTokens = await loadCounter();

  assert.equal(countLegalEmbeddingTokens(""), 0);
});

test("countLegalEmbeddingTokens counts known ASCII samples", async () => {
  const countLegalEmbeddingTokens = await loadCounter();

  assert.equal(countLegalEmbeddingTokens("a"), 1);
  assert.equal(countLegalEmbeddingTokens("hello world"), 2);

  // cl100k_base has tokens for runs of spaces, unlike the older encodings.
  assert.ok(
    countLegalEmbeddingTokens("    ") < 4,
    "four spaces must not cost four tokens under cl100k_base",
  );
});

test("countLegalEmbeddingTokens tokenizes Russian and Kazakh legal text", async () => {
  const countLegalEmbeddingTokens = await loadCounter();

  const russian = countLegalEmbeddingTokens(RUSSIAN_SAMPLE);
  const kazakh = countLegalEmbeddingTokens(KAZAKH_SAMPLE);

  // Кириллица дробится на несколько токенов на слово, поэтому счёт заметно
  // больше числа слов — это и есть причина, по которой байты не годятся.
  assert.ok(
    russian > wordCount(RUSSIAN_SAMPLE),
    `expected more tokens than ${wordCount(RUSSIAN_SAMPLE)} words, received ${russian}`,
  );
  assert.ok(
    kazakh > wordCount(KAZAKH_SAMPLE),
    `expected more tokens than ${wordCount(KAZAKH_SAMPLE)} words, received ${kazakh}`,
  );

  assert.ok(russian < RUSSIAN_SAMPLE.length);
  assert.ok(kazakh < KAZAKH_SAMPLE.length);
});

test("countLegalEmbeddingTokens is deterministic for the same text", async () => {
  const countLegalEmbeddingTokens = await loadCounter();

  for (const sample of SAMPLES) {
    const first = countLegalEmbeddingTokens(sample);

    assert.equal(countLegalEmbeddingTokens(sample), first);
    assert.equal(countLegalEmbeddingTokens(sample), first);
  }

  const doubled = `${RUSSIAN_SAMPLE} ${RUSSIAN_SAMPLE}`;

  assert.ok(
    countLegalEmbeddingTokens(doubled) >= countLegalEmbeddingTokens(RUSSIAN_SAMPLE),
  );
});

test("countLegalEmbeddingTokens returns a finite non-negative integer", async () => {
  const countLegalEmbeddingTokens = await loadCounter();

  for (const sample of SAMPLES) {
    const tokens = countLegalEmbeddingTokens(sample);

    assert.equal(typeof tokens, "number");
    assert.ok(Number.isInteger(tokens), `${tokens} is not an integer`);
    assert.ok(Number.isFinite(tokens), `${tokens} is not finite`);
    assert.ok(tokens >= 0, `${tokens} is negative`);
  }
});
