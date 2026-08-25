import assert from "node:assert/strict";
import { test } from "node:test";
import { PERSONAL_DATA_LAW_KZ } from "./core-legal-acts";
import { buildLegalActCorpusItems } from "./build-legal-act-corpus";
import type { ParsedAdiletArticle } from "./parse-adilet-articles";

const SOURCE_URL = PERSONAL_DATA_LAW_KZ.official_url;

const PARSED_ARTICLES: ParsedAdiletArticle[] = [
  {
    number: "7",
    title: "Условия сбора и обработки персональных данных",
    text: "1. Сбор, обработка персональных данных осуществляются с согласия субъекта.",
    anchor: "#z17",
  },
  {
    number: "8",
    title: "Порядок дачи согласия субъекта",
    text: "1. Субъект дает согласие письменно либо иным способом.",
    anchor: "#z18",
  },
  {
    number: "8-1",
    title: "Государственный сервис",
    text: "1. Государственный сервис обеспечивает взаимодействие с субъектом.",
    anchor: "#z371",
  },
  {
    number: "12",
    title: "Без якоря",
    text: "1. Текст статьи без anchor в parser output.",
  },
];

test("buildLegalActCorpusItems maps parsed Adilet articles to act-level corpus items", () => {
  const items = buildLegalActCorpusItems({
    act: PERSONAL_DATA_LAW_KZ,
    sourceUrl: SOURCE_URL,
    articles: PARSED_ARTICLES,
  });

  assert.equal(items.length, PARSED_ARTICLES.length);

  for (const [index, article] of PARSED_ARTICLES.entries()) {
    const item = items[index];

    assert.equal(item.act_id, PERSONAL_DATA_LAW_KZ.id);
    assert.equal(item.act_name, PERSONAL_DATA_LAW_KZ.title);
    assert.equal(item.source_url, SOURCE_URL);
    assert.equal(item.article_number, article.number);
    assert.equal(item.article_text, article.text);

    if (article.title.trim()) {
      assert.equal(item.article_title, article.title);
    }

    if (article.anchor) {
      assert.equal(item.anchor, article.anchor);
    } else {
      assert.equal(item.anchor, undefined);
    }
  }
});

test("buildLegalActCorpusItems omits articles with empty text", () => {
  const items = buildLegalActCorpusItems({
    act: PERSONAL_DATA_LAW_KZ,
    sourceUrl: SOURCE_URL,
    articles: [
      ...PARSED_ARTICLES,
      {
        number: "99",
        title: "Пустая статья",
        text: "   ",
      },
    ],
  });

  assert.equal(items.length, PARSED_ARTICLES.length);
  assert.ok(items.every((item) => item.article_number !== "99"));
});
