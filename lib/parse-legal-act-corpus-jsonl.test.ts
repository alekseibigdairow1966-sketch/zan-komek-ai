import assert from "node:assert/strict";
import { test } from "node:test";
import type { LegalActCorpusItem } from "./build-legal-act-corpus";
import { parseLegalActCorpusJsonl } from "./parse-legal-act-corpus-jsonl";
import { serializeLegalActCorpusToJsonl } from "./serialize-legal-act-corpus-jsonl";

const ITEM_WITH_OPTIONALS: LegalActCorpusItem = {
  act_id: "personal-data-law-kz",
  act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
  source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
  article_number: "7",
  article_title: "Условия сбора и обработки персональных данных",
  article_text:
    '1. Сбор, обработка персональных данных осуществляются с согласия субъекта.\n2. Субъект даёт согласие "письменно" либо иным способом.',
  anchor: "#z17",
};

const ITEM_WITHOUT_OPTIONALS: LegalActCorpusItem = {
  act_id: "personal-data-law-kz",
  act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
  source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
  article_number: "12",
  article_text: "1. Текст статьи без title и без anchor.",
};

const JSONL_TWO_ITEMS = [
  JSON.stringify(ITEM_WITH_OPTIONALS),
  JSON.stringify(ITEM_WITHOUT_OPTIONALS),
].join("\n");

test("parseLegalActCorpusJsonl restores two corpus items from two JSONL lines", () => {
  const items = parseLegalActCorpusJsonl(JSONL_TWO_ITEMS);

  assert.equal(Array.isArray(items), true);
  assert.equal(items.length, 2);
});

test("parseLegalActCorpusJsonl restores required fields", () => {
  const [first, second] = parseLegalActCorpusJsonl(JSONL_TWO_ITEMS);

  assert.equal(first.act_id, ITEM_WITH_OPTIONALS.act_id);
  assert.equal(first.act_name, ITEM_WITH_OPTIONALS.act_name);
  assert.equal(first.source_url, ITEM_WITH_OPTIONALS.source_url);
  assert.equal(first.article_number, ITEM_WITH_OPTIONALS.article_number);
  assert.equal(first.article_text, ITEM_WITH_OPTIONALS.article_text);

  assert.equal(second.act_id, ITEM_WITHOUT_OPTIONALS.act_id);
  assert.equal(second.act_name, ITEM_WITHOUT_OPTIONALS.act_name);
  assert.equal(second.source_url, ITEM_WITHOUT_OPTIONALS.source_url);
  assert.equal(second.article_number, ITEM_WITHOUT_OPTIONALS.article_number);
  assert.equal(second.article_text, ITEM_WITHOUT_OPTIONALS.article_text);
});

test("parseLegalActCorpusJsonl restores optional fields only when present", () => {
  const [first, second] = parseLegalActCorpusJsonl(JSONL_TWO_ITEMS);

  assert.equal(first.article_title, ITEM_WITH_OPTIONALS.article_title);
  assert.equal(first.anchor, ITEM_WITH_OPTIONALS.anchor);

  assert.equal("article_title" in second, false);
  assert.equal("anchor" in second, false);
});

test("parseLegalActCorpusJsonl preserves cyrillic quotes and newlines in article_text", () => {
  const [first] = parseLegalActCorpusJsonl(JSONL_TWO_ITEMS);

  assert.equal(first.article_text, ITEM_WITH_OPTIONALS.article_text);
  assert.match(first.article_text, /персональных данных/);
  assert.match(first.article_text, /"письменно"/);
  assert.match(first.article_text, /\n/);
  assert.match(first.act_name, /«О персональных данных и их защите»/);
});

test("parseLegalActCorpusJsonl returns an empty array for an empty string", () => {
  assert.deepEqual(parseLegalActCorpusJsonl(""), []);
});

test("parseLegalActCorpusJsonl ignores a trailing newline", () => {
  const items = parseLegalActCorpusJsonl(`${JSONL_TWO_ITEMS}\n`);

  assert.equal(items.length, 2);
  assert.equal(items[1].article_number, ITEM_WITHOUT_OPTIONALS.article_number);
});

test("parseLegalActCorpusJsonl ignores blank lines between records", () => {
  const jsonl = [
    JSON.stringify(ITEM_WITH_OPTIONALS),
    "",
    "   ",
    JSON.stringify(ITEM_WITHOUT_OPTIONALS),
    "",
  ].join("\n");

  const items = parseLegalActCorpusJsonl(jsonl);

  assert.equal(items.length, 2);
});

test("parseLegalActCorpusJsonl preserves item order", () => {
  const items = parseLegalActCorpusJsonl(JSONL_TWO_ITEMS);

  assert.deepEqual(
    items.map((item) => item.article_number),
    [ITEM_WITH_OPTIONALS.article_number, ITEM_WITHOUT_OPTIONALS.article_number],
  );
});

test("parseLegalActCorpusJsonl does not mutate the input string", () => {
  const jsonl = `${JSONL_TWO_ITEMS}\n`;
  const snapshot = `${JSONL_TWO_ITEMS}\n`;

  parseLegalActCorpusJsonl(jsonl);

  assert.equal(jsonl, snapshot);
});

test("parseLegalActCorpusJsonl round-trips serializeLegalActCorpusToJsonl output", () => {
  const items = [ITEM_WITH_OPTIONALS, ITEM_WITHOUT_OPTIONALS];

  assert.deepEqual(
    parseLegalActCorpusJsonl(serializeLegalActCorpusToJsonl(items)),
    items,
  );
});

test("parseLegalActCorpusJsonl throws on an invalid JSON line", () => {
  const jsonl = [
    JSON.stringify(ITEM_WITH_OPTIONALS),
    "{ not valid json",
  ].join("\n");

  assert.throws(() => parseLegalActCorpusJsonl(jsonl));
});
