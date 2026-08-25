import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildLegalEmbeddingArtifact,
  type LegalEmbeddingArtifact,
} from "./build-legal-embedding-artifact";
import type { LegalChunkEmbedding } from "./embed-legal-act-chunks";
import { readLegalEmbeddingArtifact } from "./read-legal-embedding-artifact";
import { serializeLegalEmbeddingArtifact } from "./serialize-legal-embedding-artifact";
import { writeLegalEmbeddingArtifact } from "./write-legal-embedding-artifact";

const BASELINE_MODEL = "text-embedding-3-small";

// Kept equal to the fixture vector length, because parseLegalEmbeddingArtifact
// rejects an artifact whose vectors disagree with manifest.embedding_dimensions.
const BASELINE_DIMENSIONS = 4;

const ARTIFACT_VERSION = "1";
const CORPUS_VERSION = "2026-08-22";
const CREATED_AT = "2026-08-22T10:15:00.000Z";

const ARTICLE_7_TEXT =
  '1. Сбор, обработка персональных данных осуществляются с согласия субъекта.\n2. Субъект даёт согласие "письменно" либо иным способом.';

const UTF8_PROBE = "Статья 7\nПисьменное согласие";

const RECORD_ARTICLE_7: LegalChunkEmbedding = {
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
  embedding: [0.1234567890123456, -0.456789123456789, 1e-7, 0],
};

const RECORD_ARTICLE_12: LegalChunkEmbedding = {
  chunk_id: "personal-data-law-kz:12:0",
  act_id: "personal-data-law-kz",
  act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
  article_number: "12",
  source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
  chunk_text: UTF8_PROBE,
  chunk_index: 0,
  chunk_total: 1,
  embedding_model: BASELINE_MODEL,
  embedding_dimensions: BASELINE_DIMENSIONS,
  embedding: [-0.5, 0.25, 0.3333333333333333, 3.4028234663852886e38],
};

const RECORD_LABOUR_52: LegalChunkEmbedding = {
  chunk_id: "labour-code-kz:52:0",
  act_id: "labour-code-kz",
  act_name: "Трудовой кодекс Республики Казахстан",
  article_number: "52",
  article_title: "Расторжение трудового договора по инициативе работодателя",
  source_url: "https://adilet.zan.kz/rus/docs/K1500000414",
  anchor: "#z520",
  chunk_text:
    '1. Работодатель вправе расторгнуть договор.\n2. Выплачивается "компенсация".',
  chunk_index: 0,
  chunk_total: 1,
  embedding_model: BASELINE_MODEL,
  embedding_dimensions: BASELINE_DIMENSIONS,
  embedding: [1, -1, 0.5, -1e-7],
};

const RECORDS: LegalChunkEmbedding[] = [
  RECORD_ARTICLE_7,
  RECORD_ARTICLE_12,
  RECORD_LABOUR_52,
];

function createArtifact(overrides?: {
  records?: LegalChunkEmbedding[];
  chunkSize?: number;
  chunkOverlap?: number;
}): LegalEmbeddingArtifact {
  return buildLegalEmbeddingArtifact({
    records: structuredClone(overrides?.records ?? RECORDS),
    artifactVersion: ARTIFACT_VERSION,
    corpusVersion: CORPUS_VERSION,
    createdAt: CREATED_AT,
    chunkStrategy: "article",
    ...(overrides?.chunkSize === undefined
      ? {}
      : { chunkSize: overrides.chunkSize }),
    ...(overrides?.chunkOverlap === undefined
      ? {}
      : { chunkOverlap: overrides.chunkOverlap }),
  });
}

async function withTempDir(
  run: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "zan-komek-read-embedding-artifact-"));

  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Writes an artifact with the real writer and returns its path. */
async function writeArtifactFile(
  dir: string,
  overrides?: {
    records?: LegalChunkEmbedding[];
    chunkSize?: number;
    chunkOverlap?: number;
    fileName?: string;
  },
): Promise<{ inputPath: string; artifact: LegalEmbeddingArtifact }> {
  const artifact = createArtifact(overrides);
  const inputPath = join(dir, overrides?.fileName ?? "artifact.json");

  await writeLegalEmbeddingArtifact({ artifact, outputPath: inputPath });

  return { inputPath, artifact };
}

type JsonObject = Record<string, unknown>;

/** Writes an artifact file with exactly one parser rule broken. */
async function writeCorruptArtifactFile(
  dir: string,
  mutate: (draft: JsonObject) => void,
): Promise<string> {
  const draft = JSON.parse(
    serializeLegalEmbeddingArtifact(createArtifact()),
  ) as JsonObject;

  mutate(draft);

  const inputPath = join(dir, "corrupt-artifact.json");

  await writeFile(inputPath, JSON.stringify(draft), "utf8");

  return inputPath;
}

function manifestOf(draft: JsonObject): JsonObject {
  return draft.manifest as JsonObject;
}

function recordsOf(draft: JsonObject): JsonObject[] {
  return draft.records as JsonObject[];
}

test("readLegalEmbeddingArtifact round-trips an artifact written by the writer", async () => {
  await withTempDir(async (dir) => {
    const { inputPath, artifact } = await writeArtifactFile(dir);

    const loaded = await readLegalEmbeddingArtifact({ inputPath });

    assert.deepEqual(loaded, artifact);
  });
});

test("readLegalEmbeddingArtifact round-trips an artifact with chunk parameters", async () => {
  await withTempDir(async (dir) => {
    const { inputPath, artifact } = await writeArtifactFile(dir, {
      chunkSize: 800,
      chunkOverlap: 120,
    });

    const loaded = await readLegalEmbeddingArtifact({ inputPath });

    assert.deepEqual(loaded, artifact);
    assert.equal(loaded.manifest.chunk_size, 800);
    assert.equal(loaded.manifest.chunk_overlap, 120);
  });
});

test("readLegalEmbeddingArtifact returns the artifact without a wrapper", async () => {
  await withTempDir(async (dir) => {
    const { inputPath } = await writeArtifactFile(dir);

    const loaded = await readLegalEmbeddingArtifact({ inputPath });

    assert.deepEqual(Object.keys(loaded).sort(), ["manifest", "records"]);
    assert.equal(Array.isArray(loaded), false);
    assert.equal("artifact" in loaded, false);
    assert.equal("inputPath" in loaded, false);
    assert.equal("recordCount" in loaded, false);
  });
});

test("readLegalEmbeddingArtifact restores every manifest field", async () => {
  await withTempDir(async (dir) => {
    const { inputPath, artifact } = await writeArtifactFile(dir);

    const { manifest } = await readLegalEmbeddingArtifact({ inputPath });

    assert.equal(manifest.artifact_version, ARTIFACT_VERSION);
    assert.equal(manifest.corpus_version, CORPUS_VERSION);
    assert.equal(manifest.created_at, CREATED_AT);
    assert.equal(manifest.embedding_model, BASELINE_MODEL);
    assert.equal(manifest.embedding_dimensions, BASELINE_DIMENSIONS);
    assert.equal(manifest.chunk_strategy, "article");
    assert.equal(manifest.record_count, RECORDS.length);
    assert.deepEqual(manifest.source_acts, artifact.manifest.source_acts);
    assert.equal("chunk_size" in manifest, false);
    assert.equal("chunk_overlap" in manifest, false);
  });
});

test("readLegalEmbeddingArtifact restores every record field", async () => {
  await withTempDir(async (dir) => {
    const { inputPath } = await writeArtifactFile(dir);

    const { records } = await readLegalEmbeddingArtifact({ inputPath });

    assert.equal(records.length, RECORDS.length);
    assert.deepEqual(records[0], RECORD_ARTICLE_7);
    assert.deepEqual(records[1], RECORD_ARTICLE_12);
    assert.deepEqual(records[2], RECORD_LABOUR_52);

    assert.equal(records[0].chunk_id, RECORD_ARTICLE_7.chunk_id);
    assert.equal(records[0].act_id, RECORD_ARTICLE_7.act_id);
    assert.equal(records[0].article_number, RECORD_ARTICLE_7.article_number);
    assert.equal(records[0].article_title, RECORD_ARTICLE_7.article_title);
    assert.equal(records[0].source_url, RECORD_ARTICLE_7.source_url);
    assert.equal(records[0].anchor, RECORD_ARTICLE_7.anchor);
    assert.equal(records[0].chunk_index, RECORD_ARTICLE_7.chunk_index);
    assert.equal(records[0].chunk_total, RECORD_ARTICLE_7.chunk_total);
    assert.equal(records[0].embedding_model, BASELINE_MODEL);
    assert.equal(records[0].embedding_dimensions, BASELINE_DIMENSIONS);
  });
});

test("readLegalEmbeddingArtifact leaves absent optional record fields absent", async () => {
  await withTempDir(async (dir) => {
    const { inputPath } = await writeArtifactFile(dir);

    const { records } = await readLegalEmbeddingArtifact({ inputPath });

    assert.equal("article_title" in records[1], false);
    assert.equal("anchor" in records[1], false);
    assert.equal("article_title" in records[2], true);
    assert.equal("anchor" in records[2], true);
  });
});

test("readLegalEmbeddingArtifact restores embedding vectors unchanged", async () => {
  await withTempDir(async (dir) => {
    const { inputPath } = await writeArtifactFile(dir);

    const { records } = await readLegalEmbeddingArtifact({ inputPath });

    assert.deepEqual(records[0].embedding, RECORD_ARTICLE_7.embedding);
    assert.deepEqual(records[1].embedding, RECORD_ARTICLE_12.embedding);
    assert.deepEqual(records[2].embedding, RECORD_LABOUR_52.embedding);

    assert.equal(records[0].embedding[0], 0.1234567890123456);
    assert.equal(records[0].embedding[1], -0.456789123456789);
    assert.equal(records[0].embedding[2], 1e-7);
    assert.equal(records[0].embedding[3], 0);
    assert.equal(records[1].embedding[2], 0.3333333333333333);
    assert.equal(records[1].embedding[3], 3.4028234663852886e38);
    assert.equal(records[2].embedding[3], -1e-7);
  });
});

test("readLegalEmbeddingArtifact does not normalize embedding vectors", async () => {
  await withTempDir(async (dir) => {
    const { inputPath } = await writeArtifactFile(dir);

    const { records } = await readLegalEmbeddingArtifact({ inputPath });

    // A normalizing loader would rescale this vector to unit length.
    assert.equal(records[2].embedding[0], 1);
    assert.equal(records[2].embedding[1], -1);
    assert.deepEqual(records[2].embedding, RECORD_LABOUR_52.embedding);
  });
});

test("readLegalEmbeddingArtifact reads the file as UTF-8", async () => {
  await withTempDir(async (dir) => {
    const { inputPath } = await writeArtifactFile(dir);
    const buffer = await readFile(inputPath);

    // Multi-byte content: a wrong encoding would decode to different text.
    assert.notEqual(buffer.toString("latin1"), buffer.toString("utf8"));

    const { records } = await readLegalEmbeddingArtifact({ inputPath });

    assert.equal(records[0].act_name, RECORD_ARTICLE_7.act_name);
    assert.match(records[0].act_name, /^Закон Республики Казахстан/);
    assert.equal(records[1].chunk_text, UTF8_PROBE);
    assert.match(records[1].chunk_text, /^Статья 7\nПисьменное согласие$/);
    assert.equal(records[2].act_name, "Трудовой кодекс Республики Казахстан");
  });
});

test("readLegalEmbeddingArtifact preserves quotes and newlines in chunk_text", async () => {
  await withTempDir(async (dir) => {
    const { inputPath } = await writeArtifactFile(dir);

    const { records } = await readLegalEmbeddingArtifact({ inputPath });

    assert.equal(records[0].chunk_text, ARTICLE_7_TEXT);
    assert.match(records[0].chunk_text, /"письменно"/);
    assert.match(records[0].chunk_text, /\n/);
    assert.match(records[2].chunk_text, /"компенсация"/);
    assert.match(records[1].chunk_text, /\n/);
  });
});

test("readLegalEmbeddingArtifact preserves record order", async () => {
  await withTempDir(async (dir) => {
    const { inputPath } = await writeArtifactFile(dir);

    const { records } = await readLegalEmbeddingArtifact({ inputPath });

    assert.deepEqual(
      records.map((record) => record.chunk_id),
      RECORDS.map((record) => record.chunk_id),
    );

    const reversed = await writeArtifactFile(dir, {
      records: [...RECORDS].reverse(),
      fileName: "reversed-artifact.json",
    });
    const loadedReversed = await readLegalEmbeddingArtifact({
      inputPath: reversed.inputPath,
    });

    assert.deepEqual(
      loadedReversed.records.map((record) => record.chunk_id),
      [...RECORDS].reverse().map((record) => record.chunk_id),
    );
  });
});

test("readLegalEmbeddingArtifact preserves source_acts order", async () => {
  await withTempDir(async (dir) => {
    const { inputPath } = await writeArtifactFile(dir);

    const { manifest } = await readLegalEmbeddingArtifact({ inputPath });

    assert.deepEqual(
      manifest.source_acts.map((act) => act.act_id),
      ["personal-data-law-kz", "labour-code-kz"],
    );

    const reversed = await writeArtifactFile(dir, {
      records: [...RECORDS].reverse(),
      fileName: "reversed-artifact.json",
    });
    const loadedReversed = await readLegalEmbeddingArtifact({
      inputPath: reversed.inputPath,
    });

    assert.deepEqual(
      loadedReversed.manifest.source_acts.map((act) => act.act_id),
      ["labour-code-kz", "personal-data-law-kz"],
    );
  });
});

test("readLegalEmbeddingArtifact does not mutate the input object", async () => {
  await withTempDir(async (dir) => {
    const { inputPath } = await writeArtifactFile(dir);
    const input = { inputPath };
    const snapshot = structuredClone(input);

    await readLegalEmbeddingArtifact(input);

    assert.deepEqual(input, snapshot);
    assert.deepEqual(Object.keys(input), ["inputPath"]);
    assert.equal(input.inputPath, inputPath);
  });
});

test("readLegalEmbeddingArtifact lets an invalid JSON file reject", async () => {
  await withTempDir(async (dir) => {
    const inputPath = join(dir, "not-json.json");

    await writeFile(inputPath, "{not-json}", "utf8");

    await assert.rejects(() => readLegalEmbeddingArtifact({ inputPath }));
  });
});

test("readLegalEmbeddingArtifact rejects instead of returning a fallback for invalid JSON", async () => {
  await withTempDir(async (dir) => {
    const inputPath = join(dir, "not-json.json");

    await writeFile(inputPath, "{not-json}", "utf8");

    let loaded: unknown = "not-called";

    try {
      loaded = await readLegalEmbeddingArtifact({ inputPath });
    } catch {
      loaded = "rejected";
    }

    assert.equal(loaded, "rejected");
  });
});

test("readLegalEmbeddingArtifact lets a structurally invalid artifact reject", async () => {
  await withTempDir(async (dir) => {
    const inputPath = join(dir, "empty-manifest.json");

    await writeFile(
      inputPath,
      JSON.stringify({ manifest: {}, records: [] }),
      "utf8",
    );

    await assert.rejects(() => readLegalEmbeddingArtifact({ inputPath }));
  });
});

test("readLegalEmbeddingArtifact lets a non-object root reject", async () => {
  await withTempDir(async (dir) => {
    const inputPath = join(dir, "root-array.json");

    await writeFile(inputPath, "[]", "utf8");

    await assert.rejects(() => readLegalEmbeddingArtifact({ inputPath }));
  });
});

test("readLegalEmbeddingArtifact lets a record_count mismatch reject", async () => {
  await withTempDir(async (dir) => {
    const inputPath = await writeCorruptArtifactFile(dir, (draft) => {
      manifestOf(draft).record_count = 2;
    });

    await assert.rejects(() => readLegalEmbeddingArtifact({ inputPath }));
  });
});

test("readLegalEmbeddingArtifact lets a vector dimension mismatch reject", async () => {
  await withTempDir(async (dir) => {
    const inputPath = await writeCorruptArtifactFile(dir, (draft) => {
      recordsOf(draft)[1].embedding = [0.1, 0.2];
    });

    await assert.rejects(() => readLegalEmbeddingArtifact({ inputPath }));
  });
});

test("readLegalEmbeddingArtifact lets a record embedding_dimensions mismatch reject", async () => {
  await withTempDir(async (dir) => {
    const inputPath = await writeCorruptArtifactFile(dir, (draft) => {
      recordsOf(draft)[2].embedding_dimensions = 1536;
    });

    await assert.rejects(() => readLegalEmbeddingArtifact({ inputPath }));
  });
});

test("readLegalEmbeddingArtifact lets a non-numeric embedding value reject", async () => {
  await withTempDir(async (dir) => {
    const inputPath = await writeCorruptArtifactFile(dir, (draft) => {
      recordsOf(draft)[0].embedding = [0.1, "0.2", 0.3, 0.4];
    });

    await assert.rejects(() => readLegalEmbeddingArtifact({ inputPath }));
  });
});

test("readLegalEmbeddingArtifact rejects a missing file without creating it", async () => {
  await withTempDir(async (dir) => {
    const inputPath = join(dir, "missing-artifact.json");
    const before = (await readdir(dir)).sort();

    await assert.rejects(() => readLegalEmbeddingArtifact({ inputPath }));
    await assert.rejects(() => stat(inputPath));

    assert.deepEqual((await readdir(dir)).sort(), before);
    assert.deepEqual(before, []);
  });
});

test("readLegalEmbeddingArtifact rejects when inputPath is a directory", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(() =>
      readLegalEmbeddingArtifact({ inputPath: dir }),
    );

    const dirStat = await stat(dir);

    assert.equal(dirStat.isDirectory(), true);
  });
});

test("readLegalEmbeddingArtifact does not modify the artifact file", async () => {
  await withTempDir(async (dir) => {
    const { inputPath } = await writeArtifactFile(dir);
    const before = await readFile(inputPath, "utf8");

    await readLegalEmbeddingArtifact({ inputPath });

    const after = await readFile(inputPath, "utf8");

    assert.equal(after, before);
    assert.equal(
      after,
      serializeLegalEmbeddingArtifact(createArtifact()),
    );
  });
});

test("readLegalEmbeddingArtifact does not delete the artifact file", async () => {
  await withTempDir(async (dir) => {
    const { inputPath } = await writeArtifactFile(dir);

    await readLegalEmbeddingArtifact({ inputPath });

    const fileStat = await stat(inputPath);

    assert.equal(fileStat.isFile(), true);
  });
});

test("readLegalEmbeddingArtifact creates no extra files and no directories", async () => {
  await withTempDir(async (dir) => {
    const { inputPath } = await writeArtifactFile(dir);
    const before = (await readdir(dir, { withFileTypes: true }))
      .map((entry) => `${entry.name}:${entry.isDirectory() ? "dir" : "file"}`)
      .sort();

    await readLegalEmbeddingArtifact({ inputPath });

    const after = (await readdir(dir, { withFileTypes: true }))
      .map((entry) => `${entry.name}:${entry.isDirectory() ? "dir" : "file"}`)
      .sort();

    assert.deepEqual(after, before);
    assert.deepEqual(after, ["artifact.json:file"]);
  });
});

test("readLegalEmbeddingArtifact creates no sibling directory on a failed load", async () => {
  await withTempDir(async (dir) => {
    const inputPath = join(dir, "nested", "artifact.json");

    await assert.rejects(() => readLegalEmbeddingArtifact({ inputPath }));

    assert.deepEqual(await readdir(dir), []);
  });
});

test("readLegalEmbeddingArtifact adds no verification fields", async () => {
  await withTempDir(async (dir) => {
    const { inputPath } = await writeArtifactFile(dir);

    const loaded = await readLegalEmbeddingArtifact({ inputPath });

    assert.equal("source_confirmed" in loaded, false);
    assert.equal("search_confirmed" in loaded, false);
    assert.equal("content_checked" in loaded, false);
    assert.equal("verification_status" in loaded, false);

    assert.equal("source_confirmed" in loaded.manifest, false);
    assert.equal("verification_status" in loaded.manifest, false);

    for (const record of loaded.records) {
      assert.equal("source_confirmed" in record, false);
      assert.equal("search_confirmed" in record, false);
      assert.equal("content_checked" in record, false);
      assert.equal("verification_status" in record, false);
      assert.equal("retrieval_score" in record, false);
    }
  });
});

test("readLegalEmbeddingArtifact performs no network request", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    throw new Error("Network access is not allowed in this test");
  }) as typeof fetch;

  try {
    await withTempDir(async (dir) => {
      const { inputPath, artifact } = await writeArtifactFile(dir);

      const loaded = await readLegalEmbeddingArtifact({ inputPath });

      assert.deepEqual(loaded, artifact);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
