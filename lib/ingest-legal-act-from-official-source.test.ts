import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PERSONAL_DATA_LAW_KZ } from "./core-legal-acts";
import { buildLegalActCorpusFromHtml } from "./build-legal-act-corpus-from-html";
import type { LegalActCorpusItem } from "./build-legal-act-corpus";
import { ingestLegalActFromOfficialSource } from "./ingest-legal-act-from-official-source";

const SOURCE_URL = PERSONAL_DATA_LAW_KZ.official_url;

const ADILET_HTML_FIXTURE = `
<article>
  <h3 id="z12"> Глава 2. СБОР И ОБРАБОТКА ПЕРСОНАЛЬНЫХ ДАННЫХ</h3>
  <p><b><a name="z17"></a>Статья 7. Условия сбора и обработки персональных данных</b></p>
  <p class="note">Сноска. Заголовок статьи 7 с изменением, внесенным Законом РК.</p>
  <p id="z15">1. Сбор, обработка персональных данных осуществляются с согласия субъекта.</p>
  <p id="z16">2. Распространение персональных данных допускается при наличии согласия.</p>
  <font color="#FF0000">Примечание ИЗПИ! В пункт 7 предусматривается изменение.</font>
  <p id="z90">7. Особенности сбора в электронных ресурсах устанавливаются законодательством.</p>
  <p><b><a name="z18"></a>Статья 8. Порядок дачи согласия субъекта</b></p>
  <p id="z19">1. Субъект дает согласие письменно либо иным способом.</p>
  <p id="z20">2. Согласие может быть отозвано субъектом.</p>
  <span class="note">Сноска. Статья 8 с изменениями, внесенными законами РК.</span>
  <p><b><a name="z371"></a>Статья 8-1. Государственный сервис</b></p>
  <p id="z372">1. Государственный сервис обеспечивает взаимодействие с субъектом.</p>
  <p><b><a name="z382"></a>Статья 8-2. Негосударственный сервис</b></p>
  <p id="z383">1. Негосударственный сервис применяется в негосударственных объектах.</p>
</article>
`.trim();

async function withTempDir(
  run: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "zan-komek-official-ingest-"));

  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("ingestLegalActFromOfficialSource fetches core-act HTML and writes JSONL corpus", async () => {
  await withTempDir(async (dir) => {
    const fetchedUrls: string[] = [];
    const mockFetch: typeof fetch = async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      fetchedUrls.push(url);

      if (url.includes("Z1300000094")) {
        return new Response(ADILET_HTML_FIXTURE, {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    };

    const outputPath = join(dir, `${PERSONAL_DATA_LAW_KZ.id}.jsonl`);
    const expectedItems = buildLegalActCorpusFromHtml({
      act: PERSONAL_DATA_LAW_KZ,
      sourceUrl: SOURCE_URL,
      html: ADILET_HTML_FIXTURE,
    });

    const result = await ingestLegalActFromOfficialSource(
      {
        act: PERSONAL_DATA_LAW_KZ,
        outputPath,
      },
      mockFetch,
    );

    const fileContents = await readFile(result.outputPath, "utf8");
    const lines = fileContents.split("\n").filter((line) => line.length > 0);
    const parsedItems = lines.map(
      (line) => JSON.parse(line) as LegalActCorpusItem,
    );

    assert.ok(expectedItems.length > 1);
    assert.ok(fetchedUrls.some((url) => url.includes("Z1300000094")));
    assert.ok(
      fetchedUrls.every((url) => url.includes("adilet.zan.kz")),
    );
    assert.equal(result.outputPath, outputPath);
    assert.equal(result.itemCount, expectedItems.length);
    assert.equal(result.actId, PERSONAL_DATA_LAW_KZ.id);
    assert.equal(result.sourceUrl, SOURCE_URL);
    assert.equal(lines.length, expectedItems.length);
    assert.deepEqual(parsedItems, expectedItems);
    assert.match(fileContents, /персональных данных/);

    for (const item of parsedItems) {
      assert.equal(item.act_id, PERSONAL_DATA_LAW_KZ.id);
      assert.equal(item.act_name, PERSONAL_DATA_LAW_KZ.title);
      assert.equal(item.source_url, SOURCE_URL);
      assert.equal(typeof item.article_number, "string");
      assert.ok(item.article_number.length > 0);
      assert.equal(typeof item.article_text, "string");
      assert.ok(item.article_text.trim().length > 0);
    }
  });
});
