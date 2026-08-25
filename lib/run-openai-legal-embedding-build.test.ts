import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { LegalActCorpusItem } from "./build-legal-act-corpus";
import { countLegalEmbeddingTokens } from "./count-legal-embedding-tokens";
import { createOpenAiLegalChunkEmbedder } from "./openai-legal-chunk-embedder";
import type { OpenAiEmbeddingsClient } from "./openai-legal-chunk-embedder";
import { readLegalEmbeddingArtifact } from "./read-legal-embedding-artifact";
import {
  LEGAL_BATCH_MAX_TOKENS,
  LEGAL_CHUNK_MAX_TOKENS,
  LEGAL_EMBEDDING_DIMENSIONS,
  LEGAL_EMBEDDING_MODEL,
  runLegalEmbeddingBuild,
} from "./run-legal-embedding-build";
import { serializeLegalActCorpusToJsonl } from "./serialize-legal-act-corpus-jsonl";

/**
 * RED: offline entry point for real artifact generation.
 *
 * Все части уже существуют: countLegalEmbeddingTokens (cl100k_base),
 * runLegalEmbeddingBuild (конфигурация, splitting, batching, artifact) и
 * createOpenAiLegalChunkEmbedder (адаптер к embeddings.create). Не хватает
 * маленького слоя, который соединяет их: клиент → embedder → счётчик → runner.
 *
 * Здесь этот слой проверяется на mock-клиенте OpenAI: сеть, API key и реальные
 * embeddings не нужны. Токены считаются настоящим production-счётчиком, поэтому
 * границы 8000 и 250000 проверяются в реальных cl100k-токенах, а не в мок-весах.
 *
 * Это offline generation, вне /api/analyze.
 */

const MODULE: string = "./run-openai-legal-embedding-build";

const ARTIFACT_VERSION = "1";
const CORPUS_VERSION = "2026-08-23";
const CREATED_AT = "2026-08-23T13:40:00.000Z";

interface RunOpenAiLegalEmbeddingBuildInput {
  corpusJsonl: string;
  outputPath: string;
  artifactVersion: string;
  corpusVersion: string;
  createdAt: string;
}

type RunOpenAiLegalEmbeddingBuild = (
  input: RunOpenAiLegalEmbeddingBuildInput,
  client: OpenAiEmbeddingsClient,
) => Promise<{ outputPath: string; recordCount: number }>;

async function loadEntryPoint(): Promise<RunOpenAiLegalEmbeddingBuild> {
  let loaded: Record<string, unknown>;

  try {
    loaded = (await import(MODULE)) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `offline OpenAI embedding entry point ${MODULE} does not exist yet: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const entry = loaded.runOpenAiLegalEmbeddingBuild;

  if (typeof entry !== "function") {
    throw new Error(`${MODULE} does not export runOpenAiLegalEmbeddingBuild`);
  }

  return entry as RunOpenAiLegalEmbeddingBuild;
}

interface CreateCall {
  model: string;
  input: string[];
  dimensions?: number;
}

function vectorFor(text: string): number[] {
  const vector = new Array<number>(LEGAL_EMBEDDING_DIMENSIONS).fill(0.5);
  vector[0] = text.length;
  return vector;
}

function createMockClient(): {
  client: OpenAiEmbeddingsClient;
  calls: CreateCall[];
} {
  const calls: CreateCall[] = [];

  const client: OpenAiEmbeddingsClient = {
    embeddings: {
      async create(params) {
        calls.push({
          model: params.model,
          input: [...params.input],
          dimensions: params.dimensions,
        });

        return {
          data: params.input.map((text, index) => ({
            index,
            embedding: vectorFor(text),
          })),
        };
      },
    },
  };

  return { client, calls };
}

function corpusItem(
  articleNumber: string,
  articleText: string,
): LegalActCorpusItem {
  return {
    act_id: "labour-code-kz",
    act_name: "Трудовой кодекс Республики Казахстан",
    source_url: "https://adilet.zan.kz/rus/docs/K1500000414",
    article_number: articleNumber,
    article_title: `Статья ${articleNumber}`,
    article_text: articleText,
    anchor: `#z${articleNumber}`,
  };
}

/** Единица повторения, чтобы набирать заданный объём в реальных токенах. */
const UNIT = "Обработка персональных данных осуществляется с согласия субъекта. ";
const UNIT_TOKENS = countLegalEmbeddingTokens(UNIT);

function textOfTokens(targetTokens: number): string {
  return UNIT.repeat(Math.ceil(targetTokens / UNIT_TOKENS)).trim();
}

const SMALL_CORPUS_JSONL = serializeLegalActCorpusToJsonl([
  corpusItem("1", "1. Настоящий Кодекс регулирует трудовые отношения."),
  corpusItem("2", "1. Трудовое законодательство основывается на Конституции."),
]);

/**
 * Одна статья заведомо выше per-input лимита плюс наполнитель, чтобы корпус
 * превысил aggregate лимит одного запроса. Размеры заданы в реальных токенах.
 */
const LARGE_CORPUS_JSONL = serializeLegalActCorpusToJsonl([
  corpusItem("10", textOfTokens(LEGAL_CHUNK_MAX_TOKENS * 2 + 4000)),
  ...Array.from({ length: 32 }, (_, index) =>
    corpusItem(`${100 + index}`, textOfTokens(LEGAL_CHUNK_MAX_TOKENS - 200)),
  ),
]);

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "zankomek-openai-entry-red-"));

  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runEntry(
  corpusJsonl: string,
  dir: string,
  client: OpenAiEmbeddingsClient,
) {
  return loadEntryPoint().then((entry) =>
    entry(
      {
        corpusJsonl,
        outputPath: join(dir, "legal-embeddings.json"),
        artifactVersion: ARTIFACT_VERSION,
        corpusVersion: CORPUS_VERSION,
        createdAt: CREATED_AT,
      },
      client,
    ),
  );
}

test("the pieces the offline OpenAI entry point has to connect already exist", () => {
  assert.equal(typeof countLegalEmbeddingTokens, "function");
  assert.equal(typeof createOpenAiLegalChunkEmbedder, "function");
  assert.equal(typeof runLegalEmbeddingBuild, "function");

  assert.equal(LEGAL_EMBEDDING_MODEL, "text-embedding-3-small");
  assert.equal(LEGAL_EMBEDDING_DIMENSIONS, 1536);
  assert.equal(LEGAL_CHUNK_MAX_TOKENS, 8000);
  assert.equal(LEGAL_BATCH_MAX_TOKENS, 250_000);

  assert.ok(UNIT_TOKENS > 0);
});

test("runOpenAiLegalEmbeddingBuild sends chunk texts through the OpenAI adapter", async () => {
  await withTempDir(async (dir) => {
    const { client, calls } = createMockClient();

    const result = await runEntry(SMALL_CORPUS_JSONL, dir, client);

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].input, [
      "1. Настоящий Кодекс регулирует трудовые отношения.",
      "1. Трудовое законодательство основывается на Конституции.",
    ]);
    assert.equal(result.recordCount, 2);
  });
});

test("runOpenAiLegalEmbeddingBuild requests the production model and dimensions", async () => {
  await withTempDir(async (dir) => {
    const { client, calls } = createMockClient();

    await runEntry(SMALL_CORPUS_JSONL, dir, client);

    assert.ok(calls.length > 0, "the client must be called");

    for (const call of calls) {
      assert.equal(call.model, "text-embedding-3-small");
      assert.equal(call.dimensions, 1536);
    }
  });
});

test("runOpenAiLegalEmbeddingBuild splits and batches by real cl100k token counts", async () => {
  await withTempDir(async (dir) => {
    const { client, calls } = createMockClient();

    const result = await runEntry(LARGE_CORPUS_JSONL, dir, client);

    assert.ok(
      calls.length > 1,
      `the corpus exceeds ${LEGAL_BATCH_MAX_TOKENS} tokens and must be batched, received ${calls.length} request(s)`,
    );

    const inputs = calls.flatMap((call) => call.input);

    assert.ok(
      inputs.length > 33,
      `the oversized article must be split, received ${inputs.length} input(s)`,
    );
    assert.equal(result.recordCount, inputs.length);

    let largestInput = 0;

    for (const text of inputs) {
      const tokens = countLegalEmbeddingTokens(text);

      assert.ok(
        tokens <= LEGAL_CHUNK_MAX_TOKENS,
        `an input carries ${tokens} tokens, the per-input limit is ${LEGAL_CHUNK_MAX_TOKENS}`,
      );
      largestInput = Math.max(largestInput, tokens);
    }

    // Packed against the real counter, not a proxy: a char- or byte-based
    // counter could not land this close under the token limit.
    assert.ok(
      largestInput > LEGAL_CHUNK_MAX_TOKENS - 1000,
      `largest input is only ${largestInput} tokens, splitting does not use the cl100k counter`,
    );

    for (const [index, call] of calls.entries()) {
      const batch = call.input.reduce(
        (total, text) => total + countLegalEmbeddingTokens(text),
        0,
      );

      assert.ok(
        batch <= LEGAL_BATCH_MAX_TOKENS,
        `request ${index} carries ${batch} tokens, the aggregate limit is ${LEGAL_BATCH_MAX_TOKENS}`,
      );
      assert.ok(call.input.length > 0, `request ${index} is empty`);
    }
  });
});

test("runOpenAiLegalEmbeddingBuild writes the artifact after successful embeddings", async () => {
  await withTempDir(async (dir) => {
    const { client, calls } = createMockClient();
    const outputPath = join(dir, "legal-embeddings.json");

    const result = await runEntry(SMALL_CORPUS_JSONL, dir, client);

    assert.equal(result.outputPath, outputPath);
    assert.ok((await stat(outputPath)).isFile());

    const artifact = await readLegalEmbeddingArtifact({ inputPath: outputPath });

    assert.equal(artifact.manifest.embedding_model, "text-embedding-3-small");
    assert.equal(artifact.manifest.embedding_dimensions, 1536);
    assert.equal(artifact.manifest.chunk_strategy, "article");
    assert.equal(artifact.manifest.artifact_version, ARTIFACT_VERSION);
    assert.equal(artifact.manifest.corpus_version, CORPUS_VERSION);
    assert.equal(artifact.manifest.created_at, CREATED_AT);
    assert.equal(artifact.manifest.record_count, 2);

    const embeddedTexts = calls.flatMap((call) => call.input);

    assert.deepEqual(
      artifact.records.map((record) => record.chunk_text),
      embeddedTexts,
    );

    for (const record of artifact.records) {
      assert.deepEqual(record.embedding, vectorFor(record.chunk_text));
    }
  });
});

test("runOpenAiLegalEmbeddingBuild writes no artifact when the OpenAI client fails", async () => {
  await withTempDir(async (dir) => {
    const outputPath = join(dir, "legal-embeddings.json");
    const failing: OpenAiEmbeddingsClient = {
      embeddings: {
        async create() {
          throw new Error("openai embeddings unavailable");
        },
      },
    };

    await assert.rejects(
      () => runEntry(SMALL_CORPUS_JSONL, dir, failing),
      /openai embeddings unavailable/,
    );

    await assert.rejects(() => stat(outputPath));
    assert.deepEqual(await readdir(dir), []);
  });
});
