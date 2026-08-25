import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildAndWriteLegalEmbeddingArtifact } from "./build-and-write-legal-embedding-artifact";
import type { LegalActCorpusItem } from "./build-legal-act-corpus";
import { chunkLegalActCorpus } from "./chunk-legal-act-corpus";
import type { LegalChunkEmbedder } from "./embed-legal-act-chunks";
import { parseLegalActCorpusJsonl } from "./parse-legal-act-corpus-jsonl";
import { readLegalEmbeddingArtifact } from "./read-legal-embedding-artifact";
import { serializeLegalActCorpusToJsonl } from "./serialize-legal-act-corpus-jsonl";

/**
 * RED: offline embedding runner.
 *
 * Все части пайплайна уже существуют по отдельности: parseLegalActCorpusJsonl,
 * chunkLegalActCorpus с token-aware splitting, embedLegalActChunks с
 * token-aware batching, buildLegalEmbeddingArtifact и writeLegalEmbeddingArtifact
 * (последние два — через buildAndWriteLegalEmbeddingArtifact). Нет только
 * offline entry point, который связывает их и владеет production-конфигурацией.
 *
 * Здесь фиксируется контракт такого runner-а. Он ничего не реализует сам:
 * ни парсинг, ни splitting, ни batching, ни сериализацию — только оркестрацию
 * существующих функций и выбор констант:
 *
 *   embedding model      text-embedding-3-small
 *   dimensions           1536
 *   chunk max tokens     8000     (per-input, ниже лимита модели 8192)
 *   batch max tokens     250000   (aggregate, с запасом на один запрос)
 *
 * Токенизатор и embedder инжектируются, поэтому тесту не нужны ни js-tiktoken,
 * ни сеть, ни API key. Корпус передаётся содержимым JSONL, а не путём, чтобы
 * вход не зависел от файловой системы; выход остаётся путём, так как artifact
 * пишет настоящий production writer.
 *
 * Это offline artifact generation, вне /api/analyze.
 */

const EXPECTED_MODEL = "text-embedding-3-small";
const EXPECTED_DIMENSIONS = 1536;
const EXPECTED_CHUNK_MAX_TOKENS = 8000;
const EXPECTED_BATCH_MAX_TOKENS = 250_000;

const ARTIFACT_VERSION = "1";
const CORPUS_VERSION = "2026-08-23";
const CREATED_AT = "2026-08-23T10:26:00.000Z";

interface RunLegalEmbeddingBuildInput {
  corpusJsonl: string;
  outputPath: string;
  artifactVersion: string;
  corpusVersion: string;
  createdAt: string;
  countTokens: (text: string) => number;
}

interface RunLegalEmbeddingBuildResult {
  outputPath: string;
  recordCount: number;
}

type RunLegalEmbeddingBuild = (
  input: RunLegalEmbeddingBuildInput,
  embedder: LegalChunkEmbedder,
) => Promise<RunLegalEmbeddingBuildResult>;

/**
 * Модуль ещё не существует. Загружаем его динамически, чтобы падение было
 * поведенческим, а не ошибкой компиляции: тип specifier-а намеренно расширен
 * до string.
 */
const RUNNER_MODULE: string = "./run-legal-embedding-build";

async function loadRunner(): Promise<RunLegalEmbeddingBuild> {
  let loaded: Record<string, unknown>;

  try {
    loaded = (await import(RUNNER_MODULE)) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `offline embedding runner ${RUNNER_MODULE} does not exist yet: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const runner = loaded.runLegalEmbeddingBuild;

  if (typeof runner !== "function") {
    throw new Error(
      `${RUNNER_MODULE} does not export runLegalEmbeddingBuild`,
    );
  }

  return runner as RunLegalEmbeddingBuild;
}

/**
 * Детерминированный счётчик вместо cl100k_base: одно слово — сто «токенов».
 * Такой вес делает наблюдаемыми оба лимита сразу — и 8000 на вход, и 250000
 * на запрос — на компактной фикстуре.
 */
function countHeavyTokens(text: string): number {
  return text.split(/\s+/).filter(Boolean).length * 100;
}

function words(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`).join(" ");
}

/** 10 слов = 1000 токенов: помещается в один chunk. */
const SMALL_ITEM: LegalActCorpusItem = {
  act_id: "personal-data-law-kz",
  act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
  source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
  article_number: "12",
  article_title: "Права субъекта персональных данных",
  article_text: words("норма", 10),
  anchor: "#z120",
};

/** 4000 слов = 400000 токенов: заведомо выше и лимита входа, и лимита запроса. */
const OVERSIZED_ITEM: LegalActCorpusItem = {
  act_id: "labour-code-kz",
  act_name: "Трудовой кодекс Республики Казахстан",
  source_url: "https://adilet.zan.kz/rus/docs/K1500000414",
  article_number: "1",
  article_title: "Основные понятия, используемые в настоящем Кодексе",
  article_text: words("понятие", 4000),
  anchor: "#z1",
};

const CORPUS_JSONL = serializeLegalActCorpusToJsonl([SMALL_ITEM, OVERSIZED_ITEM]);

interface EmbedderCall {
  texts: string[];
  model: string;
  dimensions: number;
}

function vectorFor(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0.5);
  vector[0] = text.split(/\s+/).filter(Boolean).length;
  return vector;
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

    return texts.map((text) => vectorFor(text, config.dimensions));
  };

  return { embedder, calls };
}

function batchTokens(call: EmbedderCall): number {
  return call.texts.reduce((total, text) => total + countHeavyTokens(text), 0);
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "zankomek-runner-red-"));

  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runBuild(
  dir: string,
  embedder: LegalChunkEmbedder,
): Promise<RunLegalEmbeddingBuildResult> {
  return loadRunner().then((runner) =>
    runner(
      {
        corpusJsonl: CORPUS_JSONL,
        outputPath: join(dir, "legal-embeddings.json"),
        artifactVersion: ARTIFACT_VERSION,
        corpusVersion: CORPUS_VERSION,
        createdAt: CREATED_AT,
        countTokens: countHeavyTokens,
      },
      embedder,
    ),
  );
}

test("the building blocks the offline runner has to orchestrate already exist", () => {
  assert.equal(typeof parseLegalActCorpusJsonl, "function");
  assert.equal(typeof chunkLegalActCorpus, "function");
  assert.equal(typeof buildAndWriteLegalEmbeddingArtifact, "function");

  // Корпус читается production-парсером, а chunker уже умеет token-aware
  // splitting — runner-у остаётся только связать это и задать конфигурацию.
  const items = parseLegalActCorpusJsonl(CORPUS_JSONL);
  assert.equal(items.length, 2);

  const chunks = chunkLegalActCorpus({
    items,
    strategy: "article",
    maxTokens: EXPECTED_CHUNK_MAX_TOKENS,
    countTokens: countHeavyTokens,
  });

  assert.ok(chunks.length > 2);
});

test("runLegalEmbeddingBuild splits oversized articles under the per-input token limit", async () => {
  await withTempDir(async (dir) => {
    const { embedder, calls } = createRecordingEmbedder();

    const result = await runBuild(dir, embedder);

    const embeddedTexts = calls.flatMap((call) => call.texts);

    assert.ok(
      embeddedTexts.length > 2,
      `the oversized article must be split, received ${embeddedTexts.length} input(s)`,
    );

    for (const text of embeddedTexts) {
      assert.ok(
        countHeavyTokens(text) <= EXPECTED_CHUNK_MAX_TOKENS,
        `an input carries ${countHeavyTokens(text)} tokens, limit is ${EXPECTED_CHUNK_MAX_TOKENS}`,
      );
    }

    assert.equal(result.recordCount, embeddedTexts.length);
  });
});

test("runLegalEmbeddingBuild keeps every embedding request under the batch token limit", async () => {
  await withTempDir(async (dir) => {
    const { embedder, calls } = createRecordingEmbedder();

    await runBuild(dir, embedder);

    assert.ok(
      calls.length > 1,
      `the corpus exceeds ${EXPECTED_BATCH_MAX_TOKENS} tokens and must be batched, received ${calls.length} request(s)`,
    );

    for (const [index, call] of calls.entries()) {
      assert.ok(
        batchTokens(call) <= EXPECTED_BATCH_MAX_TOKENS,
        `request ${index} carries ${batchTokens(call)} tokens, limit is ${EXPECTED_BATCH_MAX_TOKENS}`,
      );
      assert.ok(call.texts.length > 0, `request ${index} is empty`);
    }
  });
});

test("runLegalEmbeddingBuild embeds with the production model and dimensions", async () => {
  await withTempDir(async (dir) => {
    const { embedder, calls } = createRecordingEmbedder();

    await runBuild(dir, embedder);

    assert.ok(calls.length > 0, "the embedder must be called");

    for (const call of calls) {
      assert.equal(call.model, EXPECTED_MODEL);
      assert.equal(call.dimensions, EXPECTED_DIMENSIONS);
    }
  });
});

test("runLegalEmbeddingBuild writes an artifact built from the returned vectors", async () => {
  await withTempDir(async (dir) => {
    const { embedder, calls } = createRecordingEmbedder();
    const outputPath = join(dir, "legal-embeddings.json");

    const result = await runBuild(dir, embedder);

    assert.equal(result.outputPath, outputPath);
    assert.ok((await stat(outputPath)).isFile());

    const artifact = await readLegalEmbeddingArtifact({ inputPath: outputPath });

    assert.equal(artifact.manifest.embedding_model, EXPECTED_MODEL);
    assert.equal(artifact.manifest.embedding_dimensions, EXPECTED_DIMENSIONS);
    assert.equal(artifact.manifest.chunk_strategy, "article");
    assert.equal(artifact.manifest.artifact_version, ARTIFACT_VERSION);
    assert.equal(artifact.manifest.corpus_version, CORPUS_VERSION);
    assert.equal(artifact.manifest.created_at, CREATED_AT);

    const embeddedTexts = calls.flatMap((call) => call.texts);
    assert.equal(artifact.manifest.record_count, embeddedTexts.length);
    assert.equal(artifact.records.length, embeddedTexts.length);

    // Порядок записей соответствует порядку статей корпуса, а вектор каждой
    // записи — тот, который вернул embedder для её собственного текста.
    assert.equal(artifact.records[0].act_id, SMALL_ITEM.act_id);
    assert.equal(artifact.records[0].article_number, SMALL_ITEM.article_number);
    assert.equal(
      artifact.records[artifact.records.length - 1].act_id,
      OVERSIZED_ITEM.act_id,
    );

    for (const record of artifact.records) {
      assert.deepEqual(
        record.embedding,
        vectorFor(record.chunk_text, EXPECTED_DIMENSIONS),
      );
      assert.equal(record.embedding_model, EXPECTED_MODEL);
      assert.equal(record.embedding_dimensions, EXPECTED_DIMENSIONS);
    }

    assert.deepEqual(
      artifact.records.map((record) => record.chunk_text),
      embeddedTexts,
    );
  });
});

test("runLegalEmbeddingBuild writes no artifact when embedding fails", async () => {
  await withTempDir(async (dir) => {
    const outputPath = join(dir, "legal-embeddings.json");
    const failing: LegalChunkEmbedder = async () => {
      throw new Error("embedding provider unavailable");
    };

    await assert.rejects(
      () => runBuild(dir, failing),
      /embedding provider unavailable/,
    );

    await assert.rejects(() => stat(outputPath));
    assert.deepEqual(await readdir(dir), []);
  });
});
