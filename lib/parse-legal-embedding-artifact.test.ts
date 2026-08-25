import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildLegalEmbeddingArtifact,
  type LegalEmbeddingArtifact,
} from "./build-legal-embedding-artifact";
import type { LegalChunkEmbedding } from "./embed-legal-act-chunks";
import { parseLegalEmbeddingArtifact } from "./parse-legal-embedding-artifact";
import { serializeLegalEmbeddingArtifact } from "./serialize-legal-embedding-artifact";

const BASELINE_MODEL = "text-embedding-3-small";

// Kept equal to the fixture vector length so that valid fixtures satisfy the
// vector-length consistency rule the parser must enforce.
const BASELINE_DIMENSIONS = 4;

const ARTICLE_7_TEXT =
  '1. Сбор, обработка персональных данных осуществляются с согласия субъекта.\n2. Субъект даёт согласие "письменно" либо иным способом.';

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
  chunk_text: "1. Текст статьи без title и без anchor.",
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
  chunk_text: '1. Работодатель вправе расторгнуть договор.\n2. Выплачивается "компенсация".',
  chunk_index: 0,
  chunk_total: 1,
  embedding_model: BASELINE_MODEL,
  embedding_dimensions: BASELINE_DIMENSIONS,
  embedding: [1, -1, 0.5, -1e-7],
};

const RECORDS = [RECORD_ARTICLE_7, RECORD_ARTICLE_12, RECORD_LABOUR_52];

function createArtifact(overrides?: {
  records?: LegalChunkEmbedding[];
  chunkSize?: number;
  chunkOverlap?: number;
}): LegalEmbeddingArtifact {
  return buildLegalEmbeddingArtifact({
    records: overrides?.records ?? RECORDS,
    artifactVersion: "1",
    corpusVersion: "2026-08-22",
    createdAt: "2026-08-22T10:15:00.000Z",
    chunkStrategy: "article",
    ...(overrides?.chunkSize === undefined
      ? {}
      : { chunkSize: overrides.chunkSize }),
    ...(overrides?.chunkOverlap === undefined
      ? {}
      : { chunkOverlap: overrides.chunkOverlap }),
  });
}

function serializeArtifact(overrides?: {
  records?: LegalChunkEmbedding[];
  chunkSize?: number;
  chunkOverlap?: number;
}): string {
  return serializeLegalEmbeddingArtifact(createArtifact(overrides));
}

type JsonObject = Record<string, unknown>;

/** Serializes a valid artifact, breaks one rule in the JSON, re-serializes. */
function corrupt(mutate: (draft: JsonObject) => void): string {
  const draft = JSON.parse(serializeArtifact()) as JsonObject;

  mutate(draft);

  return JSON.stringify(draft);
}

function manifestOf(draft: JsonObject): JsonObject {
  return draft.manifest as JsonObject;
}

function recordsOf(draft: JsonObject): JsonObject[] {
  return draft.records as JsonObject[];
}

test("parseLegalEmbeddingArtifact parses a serialized artifact into an object", () => {
  const artifact = parseLegalEmbeddingArtifact(serializeArtifact());

  assert.equal(typeof artifact, "object");
  assert.notEqual(artifact, null);
  assert.equal(Array.isArray(artifact), false);
  assert.deepEqual(Object.keys(artifact).sort(), ["manifest", "records"]);
});

test("parseLegalEmbeddingArtifact round-trips the whole artifact", () => {
  const artifact = createArtifact();
  const serialized = serializeLegalEmbeddingArtifact(artifact);

  assert.deepEqual(parseLegalEmbeddingArtifact(serialized), artifact);
});

test("parseLegalEmbeddingArtifact round-trips an artifact with chunk parameters", () => {
  const artifact = createArtifact({ chunkSize: 800, chunkOverlap: 120 });
  const serialized = serializeLegalEmbeddingArtifact(artifact);

  assert.deepEqual(parseLegalEmbeddingArtifact(serialized), artifact);
});

test("parseLegalEmbeddingArtifact restores every manifest field", () => {
  const artifact = createArtifact();
  const { manifest } = parseLegalEmbeddingArtifact(
    serializeLegalEmbeddingArtifact(artifact),
  );

  assert.equal(manifest.artifact_version, "1");
  assert.equal(manifest.corpus_version, "2026-08-22");
  assert.equal(manifest.created_at, "2026-08-22T10:15:00.000Z");
  assert.equal(manifest.embedding_model, BASELINE_MODEL);
  assert.equal(manifest.embedding_dimensions, BASELINE_DIMENSIONS);
  assert.equal(manifest.chunk_strategy, "article");
  assert.equal(manifest.record_count, RECORDS.length);
  assert.deepEqual(manifest.source_acts, artifact.manifest.source_acts);
});

test("parseLegalEmbeddingArtifact restores optional manifest fields when present", () => {
  const { manifest } = parseLegalEmbeddingArtifact(
    serializeArtifact({ chunkSize: 800, chunkOverlap: 120 }),
  );

  assert.equal(manifest.chunk_size, 800);
  assert.equal(manifest.chunk_overlap, 120);
});

test("parseLegalEmbeddingArtifact leaves absent optional manifest fields absent", () => {
  const { manifest } = parseLegalEmbeddingArtifact(serializeArtifact());

  assert.equal("chunk_size" in manifest, false);
  assert.equal("chunk_overlap" in manifest, false);
});

test("parseLegalEmbeddingArtifact restores every record field", () => {
  const { records } = parseLegalEmbeddingArtifact(serializeArtifact());

  assert.equal(records.length, RECORDS.length);
  assert.deepEqual(records[0], RECORD_ARTICLE_7);
  assert.deepEqual(records[1], RECORD_ARTICLE_12);
  assert.deepEqual(records[2], RECORD_LABOUR_52);

  assert.equal(records[0].chunk_id, RECORD_ARTICLE_7.chunk_id);
  assert.equal(records[0].act_id, RECORD_ARTICLE_7.act_id);
  assert.equal(records[0].act_name, RECORD_ARTICLE_7.act_name);
  assert.equal(records[0].article_number, RECORD_ARTICLE_7.article_number);
  assert.equal(records[0].article_title, RECORD_ARTICLE_7.article_title);
  assert.equal(records[0].source_url, RECORD_ARTICLE_7.source_url);
  assert.equal(records[0].anchor, RECORD_ARTICLE_7.anchor);
  assert.equal(records[0].chunk_text, RECORD_ARTICLE_7.chunk_text);
  assert.equal(records[0].chunk_index, RECORD_ARTICLE_7.chunk_index);
  assert.equal(records[0].chunk_total, RECORD_ARTICLE_7.chunk_total);
  assert.equal(records[0].embedding_model, BASELINE_MODEL);
  assert.equal(records[0].embedding_dimensions, BASELINE_DIMENSIONS);
  assert.deepEqual(records[0].embedding, RECORD_ARTICLE_7.embedding);
});

test("parseLegalEmbeddingArtifact leaves absent optional record fields absent", () => {
  const { records } = parseLegalEmbeddingArtifact(serializeArtifact());

  assert.equal("article_title" in records[1], false);
  assert.equal("anchor" in records[1], false);
});

test("parseLegalEmbeddingArtifact restores embedding numbers without rounding", () => {
  const { records } = parseLegalEmbeddingArtifact(serializeArtifact());

  assert.equal(records[0].embedding[0], 0.1234567890123456);
  assert.equal(records[0].embedding[1], -0.456789123456789);
  assert.equal(records[0].embedding[2], 1e-7);
  assert.equal(records[0].embedding[3], 0);
  assert.equal(records[1].embedding[2], 0.3333333333333333);
  assert.equal(records[1].embedding[3], 3.4028234663852886e38);
  assert.equal(records[2].embedding[3], -1e-7);
});

test("parseLegalEmbeddingArtifact does not normalize embedding vectors", () => {
  const { records } = parseLegalEmbeddingArtifact(serializeArtifact());

  // A normalizing parser would rescale this vector to unit length.
  assert.deepEqual(records[2].embedding, RECORD_LABOUR_52.embedding);
  assert.equal(records[2].embedding[0], 1);
  assert.equal(records[2].embedding[1], -1);
});

test("parseLegalEmbeddingArtifact preserves embedding value order", () => {
  const { records } = parseLegalEmbeddingArtifact(serializeArtifact());

  assert.deepEqual(records[0].embedding, [
    0.1234567890123456,
    -0.456789123456789,
    1e-7,
    0,
  ]);
});

test("parseLegalEmbeddingArtifact preserves cyrillic text", () => {
  const { records } = parseLegalEmbeddingArtifact(serializeArtifact());

  assert.equal(records[0].act_name, RECORD_ARTICLE_7.act_name);
  assert.equal(records[0].article_title, RECORD_ARTICLE_7.article_title);
  assert.match(records[0].act_name, /«О персональных данных и их защите»/);
  assert.match(records[0].chunk_text, /персональных данных/);
  assert.match(records[2].act_name, /Трудовой кодекс/);
});

test("parseLegalEmbeddingArtifact preserves quotes and newlines in chunk_text", () => {
  const { records } = parseLegalEmbeddingArtifact(serializeArtifact());

  assert.equal(records[0].chunk_text, ARTICLE_7_TEXT);
  assert.match(records[0].chunk_text, /"письменно"/);
  assert.match(records[0].chunk_text, /\n/);
  assert.match(records[2].chunk_text, /"компенсация"/);
});

test("parseLegalEmbeddingArtifact preserves record order", () => {
  const { records } = parseLegalEmbeddingArtifact(serializeArtifact());

  assert.deepEqual(
    records.map((record) => record.chunk_id),
    RECORDS.map((record) => record.chunk_id),
  );

  const reversed = parseLegalEmbeddingArtifact(
    serializeArtifact({ records: [...RECORDS].reverse() }),
  );

  assert.deepEqual(
    reversed.records.map((record) => record.chunk_id),
    [...RECORDS].reverse().map((record) => record.chunk_id),
  );
});

test("parseLegalEmbeddingArtifact preserves source_acts order", () => {
  const { manifest } = parseLegalEmbeddingArtifact(serializeArtifact());

  assert.deepEqual(
    manifest.source_acts.map((act) => act.act_id),
    ["personal-data-law-kz", "labour-code-kz"],
  );

  const reversed = parseLegalEmbeddingArtifact(
    serializeArtifact({ records: [...RECORDS].reverse() }),
  );

  assert.deepEqual(
    reversed.manifest.source_acts.map((act) => act.act_id),
    ["labour-code-kz", "personal-data-law-kz"],
  );
});

test("parseLegalEmbeddingArtifact does not mutate the input string", () => {
  const serialized = serializeArtifact();
  const snapshot = `${serialized}`;

  parseLegalEmbeddingArtifact(serialized);

  assert.equal(serialized, snapshot);
});

test("parseLegalEmbeddingArtifact throws on invalid JSON", () => {
  assert.throws(() => parseLegalEmbeddingArtifact("{not-json}"));
  assert.throws(() => parseLegalEmbeddingArtifact("{ manifest: }"));
  assert.throws(() => parseLegalEmbeddingArtifact(`${serializeArtifact()}}`));
});

test("parseLegalEmbeddingArtifact throws on an empty string", () => {
  assert.throws(() => parseLegalEmbeddingArtifact(""));
});

test("parseLegalEmbeddingArtifact throws on a whitespace-only string", () => {
  assert.throws(() => parseLegalEmbeddingArtifact("   "));
  assert.throws(() => parseLegalEmbeddingArtifact("\n\t"));
});

test("parseLegalEmbeddingArtifact rejects a root value that is not an object", () => {
  assert.throws(() => parseLegalEmbeddingArtifact("null"));
  assert.throws(() => parseLegalEmbeddingArtifact("[]"));
  assert.throws(() => parseLegalEmbeddingArtifact('"string"'));
  assert.throws(() => parseLegalEmbeddingArtifact("123"));
  assert.throws(() => parseLegalEmbeddingArtifact("true"));
});

test("parseLegalEmbeddingArtifact rejects a missing or non-object manifest", () => {
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        delete draft.manifest;
      }),
    ),
  );
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        draft.manifest = null;
      }),
    ),
  );
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        draft.manifest = [];
      }),
    ),
  );
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        draft.manifest = "manifest";
      }),
    ),
  );
});

test("parseLegalEmbeddingArtifact rejects a missing or non-array records field", () => {
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        delete draft.records;
      }),
    ),
  );
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        draft.records = null;
      }),
    ),
  );
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        draft.records = {};
      }),
    ),
  );
});

test("parseLegalEmbeddingArtifact rejects a non-number manifest.record_count", () => {
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        manifestOf(draft).record_count = "3";
      }),
    ),
  );
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        delete manifestOf(draft).record_count;
      }),
    ),
  );
});

test("parseLegalEmbeddingArtifact rejects a non-string manifest.embedding_model", () => {
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        manifestOf(draft).embedding_model = 3;
      }),
    ),
  );
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        delete manifestOf(draft).embedding_model;
      }),
    ),
  );
});

test("parseLegalEmbeddingArtifact rejects a non-number manifest.embedding_dimensions", () => {
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        manifestOf(draft).embedding_dimensions = "4";
      }),
    ),
  );
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        delete manifestOf(draft).embedding_dimensions;
      }),
    ),
  );
});

test("parseLegalEmbeddingArtifact rejects a missing or non-array record embedding", () => {
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        delete recordsOf(draft)[1].embedding;
      }),
    ),
  );
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        recordsOf(draft)[1].embedding = null;
      }),
    ),
  );
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        recordsOf(draft)[1].embedding = "0.1,0.2,0.3,0.4";
      }),
    ),
  );
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        recordsOf(draft)[1].embedding = { 0: 0.1 };
      }),
    ),
  );
});

test("parseLegalEmbeddingArtifact rejects a record embedding holding a non-number", () => {
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        recordsOf(draft)[0].embedding = [0.1, "0.2", 0.3, 0.4];
      }),
    ),
  );
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        recordsOf(draft)[0].embedding = [0.1, null, 0.3, 0.4];
      }),
    ),
  );
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        recordsOf(draft)[0].embedding = [0.1, 0.2, 0.3, [0.4]];
      }),
    ),
  );
});

test("parseLegalEmbeddingArtifact rejects record_count that disagrees with records.length", () => {
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        manifestOf(draft).record_count = 2;
      }),
    ),
  );
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        recordsOf(draft).pop();
      }),
    ),
  );
});

test("parseLegalEmbeddingArtifact rejects a record embedding_model that differs from the manifest", () => {
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        recordsOf(draft)[2].embedding_model = "text-embedding-3-large";
      }),
    ),
  );
});

test("parseLegalEmbeddingArtifact rejects record embedding_dimensions that differ from the manifest", () => {
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        recordsOf(draft)[2].embedding_dimensions = 1536;
      }),
    ),
  );
});

test("parseLegalEmbeddingArtifact rejects a vector length that differs from manifest dimensions", () => {
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        recordsOf(draft)[1].embedding = [0.1, 0.2];
      }),
    ),
  );
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        recordsOf(draft)[1].embedding = [0.1, 0.2, 0.3, 0.4, 0.5];
      }),
    ),
  );
  assert.throws(() =>
    parseLegalEmbeddingArtifact(
      corrupt((draft) => {
        recordsOf(draft)[1].embedding = [];
      }),
    ),
  );
});

test("parseLegalEmbeddingArtifact exposes no verification fields", () => {
  const artifact = parseLegalEmbeddingArtifact(serializeArtifact());

  assert.equal("source_confirmed" in artifact, false);
  assert.equal("search_confirmed" in artifact, false);
  assert.equal("content_checked" in artifact, false);
  assert.equal("verification_status" in artifact, false);

  assert.equal("source_confirmed" in artifact.manifest, false);
  assert.equal("verification_status" in artifact.manifest, false);

  for (const record of artifact.records) {
    assert.equal("source_confirmed" in record, false);
    assert.equal("search_confirmed" in record, false);
    assert.equal("content_checked" in record, false);
    assert.equal("verification_status" in record, false);
    assert.equal("retrieval_score" in record, false);
  }
});

test("parseLegalEmbeddingArtifact performs no network request", () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    throw new Error("Network access is not allowed in this test");
  }) as typeof fetch;

  try {
    const artifact = parseLegalEmbeddingArtifact(serializeArtifact());

    assert.equal(artifact.records.length, RECORDS.length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
