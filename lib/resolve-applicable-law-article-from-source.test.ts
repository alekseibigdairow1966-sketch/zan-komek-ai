import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveApplicableLawArticleFromSource } from "./resolve-applicable-law-article-from-source";
import type { ApplicableLaw, LegalSearchResult } from "./types";

const ARTICLE_7 = {
  number: "7",
  title: "Условия сбора и обработки персональных данных",
  text: "1. Сбор, обработка персональных данных осуществляются с согласия субъекта.",
  anchor: "#z17",
};

const ARTICLE_8_1 = {
  number: "8-1",
  title: "Государственный сервис",
  text: "1. Государственный сервис обеспечивает взаимодействие с субъектом.",
  anchor: "#z371",
};

function applicableLaw(article: string): Pick<ApplicableLaw, "article"> {
  return { article };
}

function searchSource(
  articles?: LegalSearchResult["articles"],
): Pick<LegalSearchResult, "articles"> {
  return { articles };
}

test("resolveApplicableLawArticleFromSource finds article 7 when ApplicableLaw references ст. 7", () => {
  const result = resolveApplicableLawArticleFromSource(
    applicableLaw("ст. 7"),
    searchSource([ARTICLE_7, ARTICLE_8_1]),
  );

  assert.ok(result);
  assert.equal(result.number, "7");
  assert.equal(result.anchor, "#z17");
  assert.match(result.text, /согласия субъекта/);
});

test("resolveApplicableLawArticleFromSource does not match ст. 8 when only article 8-1 is present", () => {
  const result = resolveApplicableLawArticleFromSource(
    applicableLaw("ст. 8"),
    searchSource([ARTICLE_8_1]),
  );

  assert.equal(result, undefined);
});

test("resolveApplicableLawArticleFromSource returns undefined when articles are missing or empty", () => {
  const law = applicableLaw("статья 12");

  assert.equal(
    resolveApplicableLawArticleFromSource(law, searchSource(undefined)),
    undefined,
  );
  assert.equal(
    resolveApplicableLawArticleFromSource(law, searchSource([])),
    undefined,
  );
});
