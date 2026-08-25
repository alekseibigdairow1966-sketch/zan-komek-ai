import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildLegalEmbeddingArtifact,
  type LegalEmbeddingArtifact,
} from "./build-legal-embedding-artifact";
import type { LegalChunkEmbedding } from "./embed-legal-act-chunks";
import { serializeLegalEmbeddingArtifact } from "./serialize-legal-embedding-artifact";
import { writeLegalEmbeddingArtifact } from "./write-legal-embedding-artifact";

const BASELINE_MODEL = "text-embedding-3-small";
const BASELINE_DIMENSIONS = 1536;

const ARTICLE_7_TEXT =
  '1. Сбор, обработка персональных данных осуществляются с согласия субъекта.\n2. Субъект даёт согласие "письменно" либо иным способом.';

const RECORDS: LegalChunkEmbedding[] = [
  {
    chunk_id: "personal-data-law-kz:7:0",
    act_id: "personal-data-law-kz",
    act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
    article_number: "7",
    article_title: "Условия сбора и обработки персональных данных",
    source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
    anchor: "#z17",
    chunk_text: ARTICLE_7_TEXT,
    chunk_index: 0,
    chunk_total: 1,
    embedding_model: BASELINE_MODEL,
    embedding_dimensions: BASELINE_DIMENSIONS,
    embedding: [0.1234567890123456, -0.98765432101234, 1e-7, 0],
  },
  {
    chunk_id: "personal-data-law-kz:12:0",
    act_id: "personal-data-law-kz",
    act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
    article_number: "12",
    source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
    chunk_text: "1. Текст статьи без title и без anchor.",
    chunk_index: 0,
    chunk_total: 1,
    embedding_model: BASELINE_MODEL,
    embedding_dimensions: BASELINE_DIMENSIONS,
    embedding: [-0.5, 0.25, 3.4028234663852886e38, 0.3333333333333333],
  },
];

const ARTIFACT_VERSION = "1";
const CORPUS_VERSION = "2026-08-22";

function createArtifact(): LegalEmbeddingArtifact {
  return buildLegalEmbeddingArtifact({
    records: structuredClone(RECORDS),
    artifactVersion: ARTIFACT_VERSION,
    corpusVersion: CORPUS_VERSION,
    createdAt: "2026-08-22T10:15:00.000Z",
    chunkStrategy: "article",
  });
}

async function withTempDir(
  run: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "zan-komek-embedding-artifact-"));

  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("writeLegalEmbeddingArtifact writes the serialized artifact to a UTF-8 file", async () => {
  await withTempDir(async (dir) => {
    const artifact = createArtifact();
    const outputPath = join(dir, "personal-data-law-kz.embeddings.json");

    const result = await writeLegalEmbeddingArtifact({
      artifact,
      outputPath,
    });

    const fileStat = await stat(result.outputPath);
    const fileContents = await readFile(result.outputPath, "utf8");

    assert.equal(fileStat.isFile(), true);
    assert.equal(result.outputPath, outputPath);
    assert.equal(fileContents, serializeLegalEmbeddingArtifact(artifact));
  });
});

test("writeLegalEmbeddingArtifact writes a file that round-trips back to the artifact", async () => {
  await withTempDir(async (dir) => {
    const artifact = createArtifact();
    const outputPath = join(dir, "artifact.json");

    await writeLegalEmbeddingArtifact({ artifact, outputPath });

    const parsed = JSON.parse(
      await readFile(outputPath, "utf8"),
    ) as LegalEmbeddingArtifact;

    assert.deepEqual(parsed, artifact);
    assert.deepEqual(parsed.manifest, artifact.manifest);
    assert.equal(parsed.records.length, 2);
    assert.deepEqual(parsed.records, artifact.records);
  });
});

test("writeLegalEmbeddingArtifact preserves vectors, cyrillic, quotes and newlines", async () => {
  await withTempDir(async (dir) => {
    const artifact = createArtifact();
    const outputPath = join(dir, "artifact.json");

    await writeLegalEmbeddingArtifact({ artifact, outputPath });

    const fileContents = await readFile(outputPath, "utf8");
    const parsed = JSON.parse(fileContents) as LegalEmbeddingArtifact;
    const [first, second] = parsed.records;

    assert.deepEqual(first.embedding, RECORDS[0].embedding);
    assert.equal(first.embedding[0], 0.1234567890123456);
    assert.equal(first.embedding[2], 1e-7);
    assert.deepEqual(second.embedding, RECORDS[1].embedding);
    assert.equal(second.embedding[2], 3.4028234663852886e38);

    assert.equal(first.act_name, RECORDS[0].act_name);
    assert.equal(first.article_title, RECORDS[0].article_title);
    assert.equal(first.chunk_text, ARTICLE_7_TEXT);
    assert.match(first.chunk_text, /"письменно"/);
    assert.match(first.chunk_text, /\n/);
    assert.match(fileContents, /персональных данных/);
  });
});

test("writeLegalEmbeddingArtifact returns the artifact metadata", async () => {
  await withTempDir(async (dir) => {
    const artifact = createArtifact();
    const outputPath = join(dir, "artifact.json");

    const result = await writeLegalEmbeddingArtifact({
      artifact,
      outputPath,
    });

    assert.equal(result.outputPath, outputPath);
    assert.equal(result.recordCount, artifact.manifest.record_count);
    assert.equal(result.recordCount, 2);
    assert.equal(result.artifactVersion, artifact.manifest.artifact_version);
    assert.equal(result.artifactVersion, ARTIFACT_VERSION);
    assert.equal(result.corpusVersion, artifact.manifest.corpus_version);
    assert.equal(result.corpusVersion, CORPUS_VERSION);
  });
});

test("writeLegalEmbeddingArtifact adds no BOM and no trailing newline", async () => {
  await withTempDir(async (dir) => {
    const artifact = createArtifact();
    const outputPath = join(dir, "artifact.json");

    await writeLegalEmbeddingArtifact({ artifact, outputPath });

    const buffer = await readFile(outputPath);
    const fileContents = buffer.toString("utf8");

    assert.notEqual(fileContents.charCodeAt(0), 0xfeff);
    assert.notDeepEqual(
      [buffer[0], buffer[1], buffer[2]],
      [0xef, 0xbb, 0xbf],
    );
    assert.equal(fileContents.endsWith("\n"), false);
    assert.equal(fileContents.startsWith("{"), true);
  });
});

test("writeLegalEmbeddingArtifact does not mutate the artifact", async () => {
  await withTempDir(async (dir) => {
    const artifact = createArtifact();
    const snapshot = structuredClone(artifact);
    const outputPath = join(dir, "artifact.json");

    await writeLegalEmbeddingArtifact({ artifact, outputPath });

    assert.deepEqual(artifact, snapshot);
  });
});

test("writeLegalEmbeddingArtifact lets filesystem errors propagate", async () => {
  await withTempDir(async (dir) => {
    const artifact = createArtifact();
    const outputPath = join(dir, "missing-directory", "artifact.json");

    await assert.rejects(() =>
      writeLegalEmbeddingArtifact({ artifact, outputPath }),
    );

    await assert.rejects(() => stat(outputPath));
  });
});

test("writeLegalEmbeddingArtifact performs no network request", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    throw new Error("Network access is not allowed in this test");
  }) as typeof fetch;

  try {
    await withTempDir(async (dir) => {
      const artifact = createArtifact();
      const outputPath = join(dir, "artifact.json");

      const result = await writeLegalEmbeddingArtifact({
        artifact,
        outputPath,
      });

      assert.equal(result.recordCount, 2);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
