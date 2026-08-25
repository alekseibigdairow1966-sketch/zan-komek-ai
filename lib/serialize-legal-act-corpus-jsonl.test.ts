import assert from "node:assert/strict";
import { test } from "node:test";
import type { LegalActCorpusItem } from "./build-legal-act-corpus";
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

function jsonlLines(jsonl: string): string[] {
  return jsonl.split("\n").filter((line) => line.length > 0);
}

test("serializeLegalActCorpusToJsonl writes one JSON object per corpus item", () => {
  const items = [ITEM_WITH_OPTIONALS, ITEM_WITHOUT_OPTIONALS];
  const snapshot = structuredClone(items);
  const jsonl = serializeLegalActCorpusToJsonl(items);
  const lines = jsonlLines(jsonl);

  assert.equal(typeof jsonl, "string");
  assert.doesNotMatch(jsonl.trimStart(), /^\[/);
  assert.equal(lines.length, 2);

  const parsed = lines.map((line) => JSON.parse(line) as LegalActCorpusItem);

  assert.equal(parsed[0].act_id, ITEM_WITH_OPTIONALS.act_id);
  assert.equal(parsed[0].act_name, ITEM_WITH_OPTIONALS.act_name);
  assert.equal(parsed[0].source_url, ITEM_WITH_OPTIONALS.source_url);
  assert.equal(parsed[0].article_number, ITEM_WITH_OPTIONALS.article_number);
  assert.equal(parsed[0].article_text, ITEM_WITH_OPTIONALS.article_text);
  assert.equal(parsed[0].article_title, ITEM_WITH_OPTIONALS.article_title);
  assert.equal(parsed[0].anchor, ITEM_WITH_OPTIONALS.anchor);

  assert.equal(parsed[1].act_id, ITEM_WITHOUT_OPTIONALS.act_id);
  assert.equal(parsed[1].act_name, ITEM_WITHOUT_OPTIONALS.act_name);
  assert.equal(parsed[1].source_url, ITEM_WITHOUT_OPTIONALS.source_url);
  assert.equal(parsed[1].article_number, ITEM_WITHOUT_OPTIONALS.article_number);
  assert.equal(parsed[1].article_text, ITEM_WITHOUT_OPTIONALS.article_text);
  assert.equal("article_title" in parsed[1], false);
  assert.equal("anchor" in parsed[1], false);

  assert.deepEqual(items, snapshot);
});

test("serializeLegalActCorpusToJsonl round-trips cyrillic quotes and newlines in article_text", () => {
  const jsonl = serializeLegalActCorpusToJsonl([ITEM_WITH_OPTIONALS]);
  const [line] = jsonlLines(jsonl);
  const parsed = JSON.parse(line) as LegalActCorpusItem;

  assert.equal(parsed.article_text, ITEM_WITH_OPTIONALS.article_text);
  assert.match(parsed.article_text, /персональных данных/);
  assert.match(parsed.article_text, /"письменно"/);
  assert.match(parsed.article_text, /\n/);
});

test("serializeLegalActCorpusToJsonl returns an empty string for an empty corpus", () => {
  assert.equal(serializeLegalActCorpusToJsonl([]), "");
});
