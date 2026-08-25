import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { LegalActCorpusItem } from "./build-legal-act-corpus";
import { serializeLegalActCorpusToJsonl } from "./serialize-legal-act-corpus-jsonl";
import { writeLegalActCorpusJsonl } from "./write-legal-act-corpus-jsonl";

const ITEMS: LegalActCorpusItem[] = [
  {
    act_id: "personal-data-law-kz",
    act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
    source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
    article_number: "7",
    article_title: "Условия сбора и обработки персональных данных",
    article_text:
      '1. Сбор, обработка персональных данных осуществляются с согласия субъекта.\n2. Субъект даёт согласие "письменно" либо иным способом.',
    anchor: "#z17",
  },
  {
    act_id: "personal-data-law-kz",
    act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
    source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
    article_number: "12",
    article_text: "1. Текст статьи без title и без anchor.",
  },
];

async function withTempDir(
  run: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "zan-komek-corpus-"));

  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("writeLegalActCorpusJsonl writes serialized JSONL to a UTF-8 file", async () => {
  await withTempDir(async (dir) => {
    const items = structuredClone(ITEMS);
    const snapshot = structuredClone(items);
    const outputPath = join(dir, "personal-data-law-kz.jsonl");

    const result = await writeLegalActCorpusJsonl({
      items,
      outputPath,
    });

    const fileContents = await readFile(result.outputPath, "utf8");
    const expectedContents = serializeLegalActCorpusToJsonl(items);
    const lines = fileContents.split("\n").filter((line) => line.length > 0);

    assert.equal(result.outputPath, outputPath);
    assert.equal(result.itemCount, items.length);
    assert.equal(fileContents, expectedContents);
    assert.equal(lines.length, 2);
    assert.match(fileContents, /персональных данных/);
    assert.deepEqual(items, snapshot);
  });
});

test("writeLegalActCorpusJsonl writes an empty file for an empty corpus", async () => {
  await withTempDir(async (dir) => {
    const outputPath = join(dir, "empty.jsonl");

    const result = await writeLegalActCorpusJsonl({
      items: [],
      outputPath,
    });

    const fileContents = await readFile(result.outputPath, "utf8");

    assert.equal(result.outputPath, outputPath);
    assert.equal(result.itemCount, 0);
    assert.equal(fileContents, serializeLegalActCorpusToJsonl([]));
    assert.equal(fileContents, "");
  });
});
