import assert from "node:assert/strict";
import { test } from "node:test";
import type { LegalActCorpusItem } from "./build-legal-act-corpus";
import { chunkLegalActCorpus } from "./chunk-legal-act-corpus";

const LONG_ARTICLE_TEXT = [
  "1. Сбор, обработка персональных данных осуществляются с согласия субъекта персональных данных.",
  '2. Субъект персональных данных даёт согласие "письменно" либо иным способом, установленным законом.',
  `3. ${"Дополнительный текст статьи для проверки того, что содержимое не обрезается. ".repeat(40)}`,
].join("\n");

const ITEM_WITH_OPTIONALS: LegalActCorpusItem = {
  act_id: "personal-data-law-kz",
  act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
  source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
  article_number: "7",
  article_title: "Условия сбора и обработки персональных данных",
  article_text: LONG_ARTICLE_TEXT,
  anchor: "#z17",
};

const ITEM_WITHOUT_OPTIONALS: LegalActCorpusItem = {
  act_id: "personal-data-law-kz",
  act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
  source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
  article_number: "12",
  article_text: "1. Текст статьи без title и без anchor.",
};

function chunkArticleCorpus(items: LegalActCorpusItem[]) {
  return chunkLegalActCorpus({ items, strategy: "article" });
}

test('chunkLegalActCorpus with strategy "article" produces one chunk per corpus item', () => {
  const chunks = chunkArticleCorpus([
    ITEM_WITH_OPTIONALS,
    ITEM_WITHOUT_OPTIONALS,
  ]);

  assert.equal(Array.isArray(chunks), true);
  assert.equal(chunks.length, 2);
});

test("chunkLegalActCorpus preserves corpus item order", () => {
  const chunks = chunkArticleCorpus([
    ITEM_WITH_OPTIONALS,
    ITEM_WITHOUT_OPTIONALS,
  ]);

  assert.deepEqual(
    chunks.map((chunk) => chunk.article_number),
    [ITEM_WITH_OPTIONALS.article_number, ITEM_WITHOUT_OPTIONALS.article_number],
  );
});

test("chunkLegalActCorpus copies article_text into chunk_text without truncation", () => {
  const [first, second] = chunkArticleCorpus([
    ITEM_WITH_OPTIONALS,
    ITEM_WITHOUT_OPTIONALS,
  ]);

  assert.equal(first.chunk_text, ITEM_WITH_OPTIONALS.article_text);
  assert.equal(
    first.chunk_text.length,
    ITEM_WITH_OPTIONALS.article_text.length,
  );
  assert.match(first.chunk_text, /персональных данных/);
  assert.match(first.chunk_text, /"письменно"/);
  assert.match(first.chunk_text, /\n/);
  assert.equal(second.chunk_text, ITEM_WITHOUT_OPTIONALS.article_text);
});

test("chunkLegalActCorpus builds a deterministic chunk_id", () => {
  const [first, second] = chunkArticleCorpus([
    ITEM_WITH_OPTIONALS,
    ITEM_WITHOUT_OPTIONALS,
  ]);

  assert.equal(
    first.chunk_id,
    `${ITEM_WITH_OPTIONALS.act_id}:${ITEM_WITH_OPTIONALS.article_number}:0`,
  );
  assert.equal(
    second.chunk_id,
    `${ITEM_WITHOUT_OPTIONALS.act_id}:${ITEM_WITHOUT_OPTIONALS.article_number}:0`,
  );

  const repeated = chunkArticleCorpus([ITEM_WITH_OPTIONALS]);

  assert.equal(repeated[0].chunk_id, first.chunk_id);
});

test("chunkLegalActCorpus sets chunk_index to 0 and chunk_total to 1 for the article baseline", () => {
  const chunks = chunkArticleCorpus([
    ITEM_WITH_OPTIONALS,
    ITEM_WITHOUT_OPTIONALS,
  ]);

  for (const chunk of chunks) {
    assert.equal(chunk.chunk_index, 0);
    assert.equal(chunk.chunk_total, 1);
  }
});

test("chunkLegalActCorpus carries over act and source metadata", () => {
  const [first, second] = chunkArticleCorpus([
    ITEM_WITH_OPTIONALS,
    ITEM_WITHOUT_OPTIONALS,
  ]);

  assert.equal(first.act_id, ITEM_WITH_OPTIONALS.act_id);
  assert.equal(first.act_name, ITEM_WITH_OPTIONALS.act_name);
  assert.equal(first.article_number, ITEM_WITH_OPTIONALS.article_number);
  assert.equal(first.source_url, ITEM_WITH_OPTIONALS.source_url);

  assert.equal(second.act_id, ITEM_WITHOUT_OPTIONALS.act_id);
  assert.equal(second.act_name, ITEM_WITHOUT_OPTIONALS.act_name);
  assert.equal(second.article_number, ITEM_WITHOUT_OPTIONALS.article_number);
  assert.equal(second.source_url, ITEM_WITHOUT_OPTIONALS.source_url);
});

test("chunkLegalActCorpus keeps optional fields only when the corpus item has them", () => {
  const [first, second] = chunkArticleCorpus([
    ITEM_WITH_OPTIONALS,
    ITEM_WITHOUT_OPTIONALS,
  ]);

  assert.equal(first.article_title, ITEM_WITH_OPTIONALS.article_title);
  assert.equal(first.anchor, ITEM_WITH_OPTIONALS.anchor);

  assert.equal("article_title" in second, false);
  assert.equal("anchor" in second, false);
  assert.deepEqual(
    Object.keys(second).filter(
      (key) => key === "article_title" || key === "anchor",
    ),
    [],
  );
});

test("chunkLegalActCorpus returns an empty array for an empty corpus", () => {
  assert.deepEqual(chunkArticleCorpus([]), []);
});

test("chunkLegalActCorpus does not mutate the input items", () => {
  const items = [ITEM_WITH_OPTIONALS, ITEM_WITHOUT_OPTIONALS];
  const snapshot = structuredClone(items);

  chunkArticleCorpus(items);

  assert.deepEqual(items, snapshot);
  assert.equal(items.length, 2);
});
