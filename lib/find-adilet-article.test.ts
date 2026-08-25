import assert from "node:assert/strict";
import { test } from "node:test";
import { findAdiletArticle } from "./find-adilet-article";
import type { ParsedAdiletArticle } from "./parse-adilet-articles";

const SAMPLE_ARTICLES: ParsedAdiletArticle[] = [
  {
    number: "7",
    title: "Условия сбора и обработки персональных данных",
    text: "1. Сбор, обработка персональных данных осуществляются с согласия субъекта.",
    anchor: "#z17",
  },
  {
    number: "8-1",
    title: "Государственный сервис",
    text: "1. Государственный сервис обеспечивает взаимодействие с субъектом.",
    anchor: "#z371",
  },
];

test("findAdiletArticle returns matching article for normalized reference ст. 7", () => {
  const result = findAdiletArticle("ст. 7", SAMPLE_ARTICLES);

  assert.ok(result);
  assert.equal(result.number, "7");
  assert.equal(result.anchor, "#z17");
  assert.match(result.text, /согласия субъекта/);
});

test("findAdiletArticle returns matching compound article for reference 8-1", () => {
  const result = findAdiletArticle("статья 8-1", SAMPLE_ARTICLES);

  assert.ok(result);
  assert.equal(result.number, "8-1");
  assert.equal(result.title, "Государственный сервис");
  assert.equal(result.anchor, "#z371");
});

test("findAdiletArticle returns undefined when article number is absent from parsed list", () => {
  const result = findAdiletArticle("ст. 12", SAMPLE_ARTICLES);

  assert.equal(result, undefined);
});

test("findAdiletArticle does not treat article 8 as a match for compound article 8-1", () => {
  const articles: ParsedAdiletArticle[] = [
    {
      number: "8-1",
      title: "Государственный сервис",
      text: "1. Государственный сервис обеспечивает взаимодействие с субъектом.",
      anchor: "#z371",
    },
  ];

  assert.equal(findAdiletArticle("ст. 8", articles), undefined);
  assert.equal(findAdiletArticle("8", articles), undefined);
});

test("findAdiletArticle returns undefined for empty parsed article list", () => {
  assert.equal(findAdiletArticle("ст. 7", []), undefined);
});

test("findAdiletArticle returns undefined for missing or blank article reference", () => {
  assert.equal(findAdiletArticle(undefined, SAMPLE_ARTICLES), undefined);
  assert.equal(findAdiletArticle("", SAMPLE_ARTICLES), undefined);
  assert.equal(findAdiletArticle("   ", SAMPLE_ARTICLES), undefined);
});

test("findAdiletArticle matches by exact article number only, not by keyword in text", () => {
  const articles: ParsedAdiletArticle[] = [
    {
      number: "7",
      title: "Условия сбора и обработки персональных данных",
      text: "Трансграничная передача допускается при условии согласия субъекта.",
      anchor: "#z17",
    },
  ];

  assert.equal(findAdiletArticle("ст. 16", articles), undefined);
});
