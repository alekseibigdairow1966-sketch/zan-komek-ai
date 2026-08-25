import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildAndWriteLegalEmbeddingArtifact } from "./build-and-write-legal-embedding-artifact";
import type { LegalActCorpusItem } from "./build-legal-act-corpus";
import { buildLegalEmbeddingArtifact } from "./build-legal-embedding-artifact";
import { chunkLegalActCorpus } from "./chunk-legal-act-corpus";
import {
  embedLegalActChunks,
  type LegalChunkEmbedder,
} from "./embed-legal-act-chunks";
import { readLegalEmbeddingArtifact } from "./read-legal-embedding-artifact";

const BASELINE_MODEL = "text-embedding-3-small";

// Kept equal to the mock vector length: the artifact is read back through
// parseLegalEmbeddingArtifact, which rejects vectors of a different length.
const BASELINE_DIMENSIONS = 4;

const LARGE_MODEL = "text-embedding-3-large";
const LARGE_DIMENSIONS = 6;

const ARTIFACT_VERSION = "1";
const CORPUS_VERSION = "2026-08-22";
const CREATED_AT = "2026-08-22T10:15:00.000Z";

const ARTICLE_7_TEXT =
  '1. Сбор, обработка персональных данных осуществляются с согласия субъекта.\n2. Субъект даёт согласие "письменно" либо иным способом.';

const ITEM_PDN_7: LegalActCorpusItem = {
  act_id: "personal-data-law-kz",
  act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
  source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
  article_number: "7",
  article_title: "Условия сбора и обработки персональных данных",
  article_text: ARTICLE_7_TEXT,
  anchor: "#z17",
};

const ITEM_PDN_12: LegalActCorpusItem = {
  act_id: "personal-data-law-kz",
  act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
  source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
  article_number: "12",
  article_text: "Статья 12\nПисьменное согласие субъекта.",
};

const ITEM_LABOUR_52: LegalActCorpusItem = {
  act_id: "labour-code-kz",
  act_name: "Трудовой кодекс Республики Казахстан",
  source_url: "https://adilet.zan.kz/rus/docs/K1500000414",
  article_number: "52",
  article_title: "Расторжение трудового договора по инициативе работодателя",
  article_text:
    '1. Работодатель вправе расторгнуть договор.\n2. Выплачивается "компенсация".',
  anchor: "#z520",
};

const ITEMS: LegalActCorpusItem[] = [ITEM_PDN_7, ITEM_PDN_12, ITEM_LABOUR_52];

function createBaselineVectors(): number[][] {
  return [
    [0.1234567890123456, -0.456789123456789, 1e-7, 0],
    [-0.5, 0.25, 0.3333333333333333, 3.4028234663852886e38],
    [1, -1, 0.5, -1e-7],
  ];
}

function createLargeVectors(): number[][] {
  return [
    [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    [-0.1, -0.2, -0.3, -0.4, -0.5, -0.6],
    [1, 0, 0, 0, 0, -1],
  ];
}

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

async function withTempDir(
  run: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "zan-komek-build-write-artifact-"));

  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

interface RunOverrides {
  items?: LegalActCorpusItem[];
  outputPath?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  chunkSize?: number;
  chunkOverlap?: number;
}

function createInput(dir: string, overrides?: RunOverrides) {
  return {
    items: overrides?.items ?? structuredClone(ITEMS),
    outputPath: overrides?.outputPath ?? join(dir, "artifact.json"),
    artifactVersion: ARTIFACT_VERSION,
    corpusVersion: CORPUS_VERSION,
    createdAt: CREATED_AT,
    chunkStrategy: "article" as const,
    embeddingModel: overrides?.embeddingModel ?? BASELINE_MODEL,
    embeddingDimensions: overrides?.embeddingDimensions ?? BASELINE_DIMENSIONS,
    ...(overrides?.chunkSize === undefined
      ? {}
      : { chunkSize: overrides.chunkSize }),
    ...(overrides?.chunkOverlap === undefined
      ? {}
      : { chunkOverlap: overrides.chunkOverlap }),
  };
}

function runBaseline(
  dir: string,
  embedder: LegalChunkEmbedder,
  overrides?: RunOverrides,
) {
  return buildAndWriteLegalEmbeddingArtifact(
    createInput(dir, overrides),
    embedder,
  );
}

/** Composes the existing lower layers directly, as a reference pipeline. */
async function buildReferenceArtifact(
  items: LegalActCorpusItem[],
  vectors: number[][],
  config: { model: string; dimensions: number },
  chunkParams?: { chunkSize?: number; chunkOverlap?: number },
) {
  const { embedder } = createRecordingEmbedder(vectors);
  const chunks = chunkLegalActCorpus({ items, strategy: "article" });
  const records = await embedLegalActChunks(
    { chunks, model: config.model, dimensions: config.dimensions },
    embedder,
  );

  return buildLegalEmbeddingArtifact({
    records,
    artifactVersion: ARTIFACT_VERSION,
    corpusVersion: CORPUS_VERSION,
    createdAt: CREATED_AT,
    chunkStrategy: "article",
    ...(chunkParams?.chunkSize === undefined
      ? {}
      : { chunkSize: chunkParams.chunkSize }),
    ...(chunkParams?.chunkOverlap === undefined
      ? {}
      : { chunkOverlap: chunkParams.chunkOverlap }),
  });
}

test("buildAndWriteLegalEmbeddingArtifact runs valid corpus items through the whole pipeline", async () => {
  await withTempDir(async (dir) => {
    const { embedder } = createRecordingEmbedder(createBaselineVectors());

    const result = await runBaseline(dir, embedder);

    assert.equal(result.artifact.records.length, ITEMS.length);
    assert.equal(result.recordCount, ITEMS.length);
    assert.equal(result.artifact.manifest.embedding_model, BASELINE_MODEL);
  });
});

test("buildAndWriteLegalEmbeddingArtifact calls the embedder once with chunk texts in corpus order", async () => {
  await withTempDir(async (dir) => {
    const { embedder, calls } = createRecordingEmbedder(
      createBaselineVectors(),
    );

    await runBaseline(dir, embedder);

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].texts, [
      ITEM_PDN_7.article_text,
      ITEM_PDN_12.article_text,
      ITEM_LABOUR_52.article_text,
    ]);
  });
});

test("buildAndWriteLegalEmbeddingArtifact passes the configured model and dimensions to the embedder", async () => {
  await withTempDir(async (dir) => {
    const { embedder, calls } = createRecordingEmbedder(
      createBaselineVectors(),
    );

    await runBaseline(dir, embedder);

    assert.equal(calls[0].model, BASELINE_MODEL);
    assert.equal(calls[0].dimensions, BASELINE_DIMENSIONS);
  });
});

test("buildAndWriteLegalEmbeddingArtifact does not hardcode the embedding config", async () => {
  await withTempDir(async (dir) => {
    const { embedder, calls } = createRecordingEmbedder(createLargeVectors());

    const result = await runBaseline(dir, embedder, {
      embeddingModel: LARGE_MODEL,
      embeddingDimensions: LARGE_DIMENSIONS,
    });

    assert.equal(calls[0].model, LARGE_MODEL);
    assert.equal(calls[0].dimensions, LARGE_DIMENSIONS);
    assert.equal(result.artifact.manifest.embedding_model, LARGE_MODEL);
    assert.equal(
      result.artifact.manifest.embedding_dimensions,
      LARGE_DIMENSIONS,
    );

    for (const record of result.artifact.records) {
      assert.equal(record.embedding_model, LARGE_MODEL);
      assert.equal(record.embedding_dimensions, LARGE_DIMENSIONS);
      assert.equal(record.embedding.length, LARGE_DIMENSIONS);
    }
  });
});

test("buildAndWriteLegalEmbeddingArtifact returns exactly the five result keys", async () => {
  await withTempDir(async (dir) => {
    const { embedder } = createRecordingEmbedder(createBaselineVectors());

    const result = await runBaseline(dir, embedder);

    assert.deepEqual(Object.keys(result).sort(), [
      "artifact",
      "artifactVersion",
      "corpusVersion",
      "outputPath",
      "recordCount",
    ]);
  });
});

test("buildAndWriteLegalEmbeddingArtifact matches a direct composition of the lower layers", async () => {
  await withTempDir(async (dir) => {
    const { embedder } = createRecordingEmbedder(createBaselineVectors());

    const result = await runBaseline(dir, embedder);
    const reference = await buildReferenceArtifact(
      structuredClone(ITEMS),
      createBaselineVectors(),
      { model: BASELINE_MODEL, dimensions: BASELINE_DIMENSIONS },
    );

    assert.deepEqual(result.artifact, reference);
  });
});

test("buildAndWriteLegalEmbeddingArtifact writes the artifact file to the output path", async () => {
  await withTempDir(async (dir) => {
    const { embedder } = createRecordingEmbedder(createBaselineVectors());
    const outputPath = join(dir, "personal-data-law-kz.embeddings.json");

    const result = await runBaseline(dir, embedder, { outputPath });

    const fileStat = await stat(outputPath);

    assert.equal(fileStat.isFile(), true);
    assert.equal(result.outputPath, outputPath);
    assert.deepEqual(await readdir(dir), [
      "personal-data-law-kz.embeddings.json",
    ]);
  });
});

test("buildAndWriteLegalEmbeddingArtifact writes a file that loads back to the same artifact", async () => {
  await withTempDir(async (dir) => {
    const { embedder } = createRecordingEmbedder(createBaselineVectors());

    const result = await runBaseline(dir, embedder);
    const loaded = await readLegalEmbeddingArtifact({
      inputPath: result.outputPath,
    });

    assert.deepEqual(loaded, result.artifact);
    assert.deepEqual(loaded.manifest, result.artifact.manifest);
    assert.deepEqual(loaded.records, result.artifact.records);
  });
});

test("buildAndWriteLegalEmbeddingArtifact reports recordCount from the manifest", async () => {
  await withTempDir(async (dir) => {
    const { embedder } = createRecordingEmbedder(createBaselineVectors());

    const result = await runBaseline(dir, embedder);

    assert.equal(result.recordCount, result.artifact.manifest.record_count);
    assert.equal(result.recordCount, 3);
  });
});

test("buildAndWriteLegalEmbeddingArtifact reports artifactVersion from the manifest", async () => {
  await withTempDir(async (dir) => {
    const { embedder } = createRecordingEmbedder(createBaselineVectors());

    const result = await runBaseline(dir, embedder);

    assert.equal(
      result.artifactVersion,
      result.artifact.manifest.artifact_version,
    );
    assert.equal(result.artifactVersion, ARTIFACT_VERSION);
  });
});

test("buildAndWriteLegalEmbeddingArtifact reports corpusVersion from the manifest", async () => {
  await withTempDir(async (dir) => {
    const { embedder } = createRecordingEmbedder(createBaselineVectors());

    const result = await runBaseline(dir, embedder);

    assert.equal(
      result.corpusVersion,
      result.artifact.manifest.corpus_version,
    );
    assert.equal(result.corpusVersion, CORPUS_VERSION);
  });
});

test("buildAndWriteLegalEmbeddingArtifact preserves createdAt unchanged", async () => {
  await withTempDir(async (dir) => {
    const { embedder } = createRecordingEmbedder(createBaselineVectors());

    const result = await runBaseline(dir, embedder);

    assert.equal(result.artifact.manifest.created_at, CREATED_AT);

    const loaded = await readLegalEmbeddingArtifact({
      inputPath: result.outputPath,
    });

    assert.equal(loaded.manifest.created_at, CREATED_AT);
  });
});

test("buildAndWriteLegalEmbeddingArtifact lets the artifact builder aggregate source_acts", async () => {
  await withTempDir(async (dir) => {
    const { embedder } = createRecordingEmbedder(createBaselineVectors());

    const result = await runBaseline(dir, embedder);
    const { source_acts: sourceActs } = result.artifact.manifest;

    assert.deepEqual(
      sourceActs.map((act) => act.act_id),
      ["personal-data-law-kz", "labour-code-kz"],
    );
    assert.equal(sourceActs[0].article_count, 2);
    assert.equal(sourceActs[1].article_count, 1);
    assert.equal(sourceActs[0].act_name, ITEM_PDN_7.act_name);
    assert.equal(sourceActs[0].source_url, ITEM_PDN_7.source_url);
    assert.equal(sourceActs[1].act_name, ITEM_LABOUR_52.act_name);
    assert.equal(sourceActs[1].source_url, ITEM_LABOUR_52.source_url);
  });
});

test("buildAndWriteLegalEmbeddingArtifact keeps records in corpus order", async () => {
  await withTempDir(async (dir) => {
    const { embedder } = createRecordingEmbedder(createBaselineVectors());
    const vectors = createBaselineVectors();

    const result = await runBaseline(dir, embedder);

    assert.deepEqual(
      result.artifact.records.map((record) => record.chunk_id),
      [
        "personal-data-law-kz:7:0",
        "personal-data-law-kz:12:0",
        "labour-code-kz:52:0",
      ],
    );
    assert.deepEqual(
      result.artifact.records.map((record) => record.chunk_text),
      [
        ITEM_PDN_7.article_text,
        ITEM_PDN_12.article_text,
        ITEM_LABOUR_52.article_text,
      ],
    );
    assert.deepEqual(
      result.artifact.records.map((record) => record.embedding),
      vectors,
    );
  });
});

test("buildAndWriteLegalEmbeddingArtifact carries optional item fields into the records", async () => {
  await withTempDir(async (dir) => {
    const { embedder } = createRecordingEmbedder(createBaselineVectors());

    const { artifact } = await runBaseline(dir, embedder);

    assert.equal(artifact.records[0].article_title, ITEM_PDN_7.article_title);
    assert.equal(artifact.records[0].anchor, ITEM_PDN_7.anchor);
    assert.equal("article_title" in artifact.records[1], false);
    assert.equal("anchor" in artifact.records[1], false);
    assert.equal(
      artifact.records[2].article_title,
      ITEM_LABOUR_52.article_title,
    );
    assert.equal(artifact.records[2].anchor, ITEM_LABOUR_52.anchor);
  });
});

test("buildAndWriteLegalEmbeddingArtifact puts chunkSize and chunkOverlap in the manifest when passed", async () => {
  await withTempDir(async (dir) => {
    const { embedder } = createRecordingEmbedder(createBaselineVectors());

    const result = await runBaseline(dir, embedder, {
      chunkSize: 800,
      chunkOverlap: 120,
    });

    assert.equal(result.artifact.manifest.chunk_size, 800);
    assert.equal(result.artifact.manifest.chunk_overlap, 120);

    const loaded = await readLegalEmbeddingArtifact({
      inputPath: result.outputPath,
    });

    assert.equal(loaded.manifest.chunk_size, 800);
    assert.equal(loaded.manifest.chunk_overlap, 120);
  });
});

test("buildAndWriteLegalEmbeddingArtifact omits chunkSize and chunkOverlap when not passed", async () => {
  await withTempDir(async (dir) => {
    const { embedder } = createRecordingEmbedder(createBaselineVectors());

    const result = await runBaseline(dir, embedder);

    assert.equal("chunk_size" in result.artifact.manifest, false);
    assert.equal("chunk_overlap" in result.artifact.manifest, false);

    const loaded = await readLegalEmbeddingArtifact({
      inputPath: result.outputPath,
    });

    assert.equal("chunk_size" in loaded.manifest, false);
    assert.equal("chunk_overlap" in loaded.manifest, false);
  });
});

test("buildAndWriteLegalEmbeddingArtifact preserves the chunk strategy in the manifest", async () => {
  await withTempDir(async (dir) => {
    const { embedder } = createRecordingEmbedder(createBaselineVectors());

    const result = await runBaseline(dir, embedder);

    assert.equal(result.artifact.manifest.chunk_strategy, "article");
  });
});

test("buildAndWriteLegalEmbeddingArtifact lets embedder failures propagate", async () => {
  await withTempDir(async (dir) => {
    const failingEmbedder: LegalChunkEmbedder = async () => {
      throw new Error("Embedding provider unavailable");
    };
    const outputPath = join(dir, "artifact.json");

    await assert.rejects(
      () => runBaseline(dir, failingEmbedder, { outputPath }),
      /Embedding provider unavailable/,
    );

    await assert.rejects(() => stat(outputPath));
    assert.deepEqual(await readdir(dir), []);
  });
});

test("buildAndWriteLegalEmbeddingArtifact lets a vector count mismatch propagate", async () => {
  await withTempDir(async (dir) => {
    const { embedder } = createRecordingEmbedder([
      [0.1, 0.2, 0.3, 0.4],
      [0.5, 0.6, 0.7, 0.8],
    ]);
    const outputPath = join(dir, "artifact.json");

    await assert.rejects(
      () => runBaseline(dir, embedder, { outputPath }),
      /Embedding count mismatch/,
    );

    await assert.rejects(() => stat(outputPath));
    assert.deepEqual(await readdir(dir), []);
  });
});

test("buildAndWriteLegalEmbeddingArtifact rejects empty corpus items from the artifact builder", async () => {
  await withTempDir(async (dir) => {
    const { embedder, calls } = createRecordingEmbedder(
      createBaselineVectors(),
    );
    const outputPath = join(dir, "artifact.json");

    // Existing composition: chunker returns [], the embedder is skipped, and
    // buildLegalEmbeddingArtifact refuses empty records.
    await assert.rejects(
      () => runBaseline(dir, embedder, { items: [], outputPath }),
      /empty records/i,
    );

    assert.equal(calls.length, 0);
    await assert.rejects(() => stat(outputPath));
    assert.deepEqual(await readdir(dir), []);
  });
});

test("buildAndWriteLegalEmbeddingArtifact lets a missing output directory propagate", async () => {
  await withTempDir(async (dir) => {
    const { embedder } = createRecordingEmbedder(createBaselineVectors());
    const outputPath = join(dir, "missing-directory", "artifact.json");

    await assert.rejects(() => runBaseline(dir, embedder, { outputPath }));

    await assert.rejects(() => stat(outputPath));
    assert.deepEqual(await readdir(dir), []);
  });
});

test("buildAndWriteLegalEmbeddingArtifact does not mutate the input object", async () => {
  await withTempDir(async (dir) => {
    const { embedder } = createRecordingEmbedder(createBaselineVectors());
    const input = createInput(dir, { chunkSize: 800, chunkOverlap: 120 });
    const snapshot = structuredClone(input);

    await buildAndWriteLegalEmbeddingArtifact(input, embedder);

    assert.deepEqual(input, snapshot);
  });
});

test("buildAndWriteLegalEmbeddingArtifact does not mutate the corpus items", async () => {
  await withTempDir(async (dir) => {
    const { embedder } = createRecordingEmbedder(createBaselineVectors());
    const items = structuredClone(ITEMS);
    const snapshot = structuredClone(items);

    await runBaseline(dir, embedder, { items });

    assert.deepEqual(items, snapshot);
    assert.equal(items.length, 3);
    assert.deepEqual(
      items.map((item) => item.article_number),
      ["7", "12", "52"],
    );
  });
});

test("buildAndWriteLegalEmbeddingArtifact does not modify the embedder vectors", async () => {
  await withTempDir(async (dir) => {
    const vectors = createBaselineVectors();
    const snapshot = structuredClone(vectors);
    const { embedder } = createRecordingEmbedder(vectors);

    const result = await runBaseline(dir, embedder);

    assert.deepEqual(vectors, snapshot);
    assert.deepEqual(
      result.artifact.records.map((record) => record.embedding),
      snapshot,
    );
    assert.equal(result.artifact.records[0].embedding[0], 0.1234567890123456);
    assert.equal(result.artifact.records[0].embedding[2], 1e-7);
    assert.equal(
      result.artifact.records[1].embedding[3],
      3.4028234663852886e38,
    );
  });
});

test("buildAndWriteLegalEmbeddingArtifact preserves cyrillic, quotes and newlines end to end", async () => {
  await withTempDir(async (dir) => {
    const { embedder } = createRecordingEmbedder(createBaselineVectors());

    const result = await runBaseline(dir, embedder);
    const loaded = await readLegalEmbeddingArtifact({
      inputPath: result.outputPath,
    });

    assert.equal(loaded.records[0].chunk_text, ARTICLE_7_TEXT);
    assert.match(loaded.records[0].chunk_text, /"письменно"/);
    assert.match(loaded.records[0].chunk_text, /\n/);
    assert.match(loaded.records[0].act_name, /«О персональных данных и их защите»/);
    assert.match(loaded.records[1].chunk_text, /^Статья 12\nПисьменное согласие/);
    assert.equal(
      loaded.records[2].act_name,
      "Трудовой кодекс Республики Казахстан",
    );
  });
});

test("buildAndWriteLegalEmbeddingArtifact introduces no verification fields", async () => {
  await withTempDir(async (dir) => {
    const { embedder } = createRecordingEmbedder(createBaselineVectors());

    const result = await runBaseline(dir, embedder);

    for (const key of [
      "source_confirmed",
      "search_confirmed",
      "content_checked",
      "verification_status",
      "retrieval_score",
    ]) {
      assert.equal(key in result, false);
      assert.equal(key in result.artifact, false);
      assert.equal(key in result.artifact.manifest, false);

      for (const record of result.artifact.records) {
        assert.equal(key in record, false);
      }
    }
  });
});

test("buildAndWriteLegalEmbeddingArtifact performs no network request", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    throw new Error("Network access is not allowed in this test");
  }) as typeof fetch;

  try {
    await withTempDir(async (dir) => {
      const { embedder } = createRecordingEmbedder(createBaselineVectors());

      const result = await runBaseline(dir, embedder);
      const loaded = await readLegalEmbeddingArtifact({
        inputPath: result.outputPath,
      });

      assert.equal(result.recordCount, 3);
      assert.deepEqual(loaded, result.artifact);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
