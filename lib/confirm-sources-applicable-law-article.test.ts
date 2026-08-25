import assert from "node:assert/strict";
import { test } from "node:test";
import { enrichAnalysisWithSearch } from "./confirm-sources-with-search";
import type { ParsedAdiletArticle } from "./parse-adilet-articles";
import type {
  ApplicableLaw,
  LegalAnalysisResult,
  LegalSearchResult,
  LegalSource,
} from "./types";

const ACT_NAME = 'Закон "О персональных данных и их защите"';

const ARTICLE_7: ParsedAdiletArticle = {
  number: "7",
  title: "Условия сбора и обработки персональных данных",
  text: "1. Сбор, обработка персональных данных осуществляются с согласия субъекта.",
  anchor: "#z17",
};

const ARTICLE_8_1: ParsedAdiletArticle = {
  number: "8-1",
  title: "Государственный сервис",
  text: "1. Государственный сервис обеспечивает взаимодействие с субъектом.",
  anchor: "#z371",
};

const STALE_ARTICLE_8: ParsedAdiletArticle = {
  number: "8",
  title: "Порядок дачи согласия субъекта",
  text: "1. Устаревший текст статьи 8 из предыдущего прогона.",
  anchor: "#z18",
};

type ApplicableLawWithSourceArticle = ApplicableLaw & {
  source_article?: ParsedAdiletArticle;
};

function getSourceArticle(
  law: ApplicableLaw | undefined,
): ParsedAdiletArticle | undefined {
  return (law as ApplicableLawWithSourceArticle | undefined)?.source_article;
}

function searchResult(
  overrides: Partial<LegalSearchResult> = {},
): LegalSearchResult {
  return {
    title: "Закон",
    url: "https://adilet.zan.kz/rus/docs/Z1300000094",
    content: "текст",
    source_domain: "adilet.zan.kz",
    search_confirmed: true,
    relevance_score: 85,
    relevance_status: "direct",
    matched_act_name: ACT_NAME,
    content_checked: true,
    source_type: "legal_act",
    ...overrides,
  };
}

function baseSource(overrides: Partial<LegalSource> = {}): LegalSource {
  return {
    title: "Источник",
    act_name: ACT_NAME,
    article: "ст. 8",
    url: "https://adilet.zan.kz/rus/docs/Z1300000094",
    source_domain: "adilet.zan.kz",
    verification_status: "official",
    search_confirmed: false,
    ...overrides,
  };
}

function baseResult(
  applicableLaws: ApplicableLaw[],
): LegalAnalysisResult {
  return {
    legalAssessment: "Оценка",
    applicableLaws,
    analysis: "Анализ",
    riskAnalysis: "Риски",
    recommendedActions: ["Действие"],
    requiredDocuments: ["Документ"],
    sources: [baseSource()],
    confidenceLevel: "средний",
    relevanceDate: "12.07.2026",
    generated_at: new Date().toISOString(),
    legal_information_status: "unverified",
    legal_information_notice: "Прямые официальные источники не подтверждены",
    verified_by_search: false,
    search_performed: true,
  };
}

test("enrichAnalysisWithSearch attaches source_article when ApplicableLaw references ст. 7 and source has article 7", () => {
  const enriched = enrichAnalysisWithSearch(
    baseResult([
      {
        act_name: ACT_NAME,
        article: "ст. 7",
      },
    ]),
    [
      searchResult({
        articles: [ARTICLE_7, ARTICLE_8_1],
      }),
    ],
    true,
  );

  const law = enriched.applicableLaws[0];
  const sourceArticle = getSourceArticle(law);

  assert.equal(law?.source_confirmed, true);
  assert.ok(sourceArticle);
  assert.equal(sourceArticle.number, "7");
  assert.equal(sourceArticle.anchor, "#z17");
  assert.match(sourceArticle.text, /согласия субъекта/);
});

test("enrichAnalysisWithSearch keeps source_confirmed true but omits source_article when only article 8-1 is present for ст. 8", () => {
  const enriched = enrichAnalysisWithSearch(
    baseResult([
      {
        act_name: ACT_NAME,
        article: "ст. 8",
      },
    ]),
    [
      searchResult({
        articles: [ARTICLE_8_1],
      }),
    ],
    true,
  );

  const law = enriched.applicableLaws[0];

  assert.equal(law?.source_confirmed, true);
  assert.equal(getSourceArticle(law), undefined);
});

test("enrichAnalysisWithSearch keeps act confirmation rules when articles are missing or empty for статья 12", () => {
  const lawInput: ApplicableLaw = {
    act_name: ACT_NAME,
    article: "статья 12",
  };

  const enrichedWithoutArticles = enrichAnalysisWithSearch(
    baseResult([lawInput]),
    [searchResult({ articles: undefined })],
    true,
  );

  const enrichedWithEmptyArticles = enrichAnalysisWithSearch(
    baseResult([lawInput]),
    [searchResult({ articles: [] })],
    true,
  );

  for (const enriched of [enrichedWithoutArticles, enrichedWithEmptyArticles]) {
    const law = enriched.applicableLaws[0];

    assert.equal(law?.source_confirmed, true);
    assert.equal(getSourceArticle(law), undefined);
  }
});

test("enrichAnalysisWithSearch drops stale source_article when current source no longer confirms ст. 8", () => {
  const enriched = enrichAnalysisWithSearch(
    baseResult([
      {
        act_name: ACT_NAME,
        article: "ст. 8",
        source_article: STALE_ARTICLE_8,
      },
    ]),
    [
      searchResult({
        articles: [ARTICLE_8_1],
      }),
    ],
    true,
  );

  const law = enriched.applicableLaws[0];
  const sourceArticle = getSourceArticle(law);

  assert.equal(law?.source_confirmed, true);
  assert.equal(sourceArticle, undefined);
});

test("enrichAnalysisWithSearch drops stale source_article when directSource is not found", () => {
  const enriched = enrichAnalysisWithSearch(
    baseResult([
      {
        act_name: ACT_NAME,
        article: "ст. 7",
        source_article: ARTICLE_7,
      },
    ]),
    [],
    true,
  );

  const law = enriched.applicableLaws[0];
  const sourceArticle = getSourceArticle(law);

  assert.equal(law?.source_confirmed, false);
  assert.equal(sourceArticle, undefined);
});

test("enrichAnalysisWithSearch omits source_article when direct source is not search_confirmed", () => {
  const enriched = enrichAnalysisWithSearch(
    baseResult([
      {
        act_name: ACT_NAME,
        article: "ст. 7",
        source_article: ARTICLE_7,
      },
    ]),
    [
      searchResult({
        search_confirmed: false,
        articles: [ARTICLE_7],
      }),
    ],
    true,
  );

  const law = enriched.applicableLaws[0];

  assert.equal(law?.source_confirmed, false);
  assert.equal(getSourceArticle(law), undefined);
});
