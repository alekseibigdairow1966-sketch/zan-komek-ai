import assert from "node:assert/strict";
import { test } from "node:test";
import {
  confirmLegalSourceWithSearch,
  enrichAnalysisWithSearch,
  getApplicableLawRelevanceBadge,
  getSourceDisplayBadge,
  sanitizeUnverifiedConfirmationText,
} from "./confirm-sources-with-search";
import type {
  ApplicableLaw,
  LegalAnalysisResult,
  LegalSearchResult,
  LegalSource,
} from "./types";

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
    matched_act_name: 'Закон "О персональных данных и их защите"',
    content_checked: true,
    source_type: "legal_act",
    ...overrides,
  };
}

function baseSource(overrides: Partial<LegalSource> = {}): LegalSource {
  return {
    title: "Источник",
    act_name: 'Закон "О персональных данных и их защите"',
    article: "ст. 8",
    url: "https://adilet.zan.kz/rus/docs/Z1300000094",
    source_domain: "adilet.zan.kz",
    verification_status: "official",
    search_confirmed: false,
    ...overrides,
  };
}

function baseResult(
  sources: LegalSource[],
  applicableLaws = [{ act_name: 'Закон "О персональных данных и их защите"' }],
): LegalAnalysisResult {
  return {
    legalAssessment: "Оценка",
    applicableLaws,
    analysis: "Анализ",
    riskAnalysis: "Риски",
    recommendedActions: ["Действие"],
    requiredDocuments: ["Документ"],
    sources,
    confidenceLevel: "средний",
    relevanceDate: "12.07.2026",
    generated_at: new Date().toISOString(),
    legal_information_status: "unverified",
    legal_information_notice: "Прямые официальные источники не подтверждены",
    verified_by_search: false,
    search_performed: true,
  };
}

test("fully confirmed direct source gets green badge", () => {
  const confirmed = confirmLegalSourceWithSearch(
    baseSource(),
    [searchResult()],
  );

  assert.equal(confirmed.search_confirmed, true);
  assert.equal(confirmed.url, "https://adilet.zan.kz/rus/docs/Z1300000094");
  assert.equal(
    getSourceDisplayBadge(confirmed),
    "Подтверждённый официальный источник",
  );
});

test("related source does not become fully confirmed", () => {
  const confirmed = confirmLegalSourceWithSearch(
    baseSource({
      url: "https://adilet.zan.kz/rus/docs/amendment",
    }),
    [
      searchResult({
        url: "https://adilet.zan.kz/rus/docs/amendment",
        title: "О внесении изменений и дополнений",
        relevance_status: "related",
        relevance_score: 55,
        matched_act_name: 'Закон "О персональных данных и их защите"',
      }),
    ],
  );

  assert.equal(confirmed.url, null);
  assert.equal(
    getSourceDisplayBadge(confirmed),
    "Связанный официальный материал",
  );
});

test("related source does not raise verified_by_search", () => {
  const enriched = enrichAnalysisWithSearch(
    baseResult([
      confirmLegalSourceWithSearch(
        baseSource({
          url: "https://adilet.zan.kz/rus/docs/amendment",
        }),
        [
          searchResult({
            url: "https://adilet.zan.kz/rus/docs/amendment",
            relevance_status: "related",
            relevance_score: 55,
          }),
        ],
      ),
    ]),
    [
      searchResult({
        url: "https://adilet.zan.kz/rus/docs/amendment",
        relevance_status: "related",
        relevance_score: 55,
      }),
    ],
    true,
  );

  assert.equal(enriched.verified_by_search, false);
  assert.equal(enriched.legal_information_status, "unverified");
});

test("direct confirmed source sets verified_by_search", () => {
  const search = [searchResult()];
  const enriched = enrichAnalysisWithSearch(
    baseResult([baseSource()]),
    search,
    true,
  );

  assert.equal(enriched.verified_by_search, true);
  assert.equal(enriched.applicableLaws[0]?.source_confirmed, true);
});

test("direct source without full confirmation does not confirm applicable law", () => {
  const search = [
    searchResult({
      content_checked: false,
      search_confirmed: false,
    }),
  ];
  const enriched = enrichAnalysisWithSearch(
    baseResult([baseSource()]),
    search,
    true,
  );

  const law = enriched.applicableLaws[0];
  assert.equal(law?.source_confirmed, false);
  assert.equal(
    getApplicableLawRelevanceBadge(
      law?.source_relevance_status,
      law?.source_confirmed,
    ),
    "Не подтверждено",
  );
});

test("fully confirmed direct source confirms applicable law badge", () => {
  const search = [
    searchResult({
      content_checked: true,
      search_confirmed: true,
    }),
  ];
  const enriched = enrichAnalysisWithSearch(
    baseResult([baseSource()]),
    search,
    true,
  );

  const law = enriched.applicableLaws[0];
  assert.equal(law?.source_confirmed, true);
  assert.equal(
    getApplicableLawRelevanceBadge(
      law?.source_relevance_status,
      law?.source_confirmed,
    ),
    "Прямой официальный источник",
  );
});

test("unverified status sanitizes false confirmation phrase in analysis", () => {
  const relatedSearch = [
    searchResult({
      url: "https://adilet.zan.kz/rus/docs/amendment",
      relevance_status: "related",
      relevance_score: 55,
    }),
  ];
  const analysisText =
    "Согласие на рассылку — категория 1 (подтверждено официальным источником).";

  const enriched = enrichAnalysisWithSearch(
    {
      ...baseResult([
        confirmLegalSourceWithSearch(
          baseSource({
            url: "https://adilet.zan.kz/rus/docs/amendment",
          }),
          relatedSearch,
        ),
      ]),
      analysis: analysisText,
    },
    relatedSearch,
    true,
  );

  assert.equal(enriched.legal_information_status, "unverified");
  assert.doesNotMatch(
    enriched.analysis,
    /подтверждено официальным источником/i,
  );
  assert.match(
    enriched.analysis,
    /не подтверждено найденным официальным источником и требует ручной проверки/,
  );
});

test("unverified status sanitizes confirmation phrase regardless of case", () => {
  const sanitized = sanitizeUnverifiedConfirmationText(
    "ПОДТВЕРЖДЕНО ОФИЦИАЛЬНЫМ ИСТОЧНИКОМ",
    "unverified",
  );

  assert.doesNotMatch(sanitized, /подтверждено официальным источником/i);
  assert.match(
    sanitized,
    /не подтверждено найденным официальным источником и требует ручной проверки/,
  );
});

test("partially_verified status leaves confirmation phrase unchanged", () => {
  const directSearch = [searchResult()];
  const relatedSearch = [
    searchResult(),
    searchResult({
      url: "https://adilet.zan.kz/rus/docs/amendment",
      relevance_status: "related",
      relevance_score: 55,
    }),
  ];
  const analysisText =
    "Согласие на рассылку — категория 1 (подтверждено официальным источником).";

  const enriched = enrichAnalysisWithSearch(
    {
      ...baseResult([
        confirmLegalSourceWithSearch(baseSource(), directSearch),
        confirmLegalSourceWithSearch(
          baseSource({
            url: "https://adilet.zan.kz/rus/docs/amendment",
          }),
          [
            searchResult({
              url: "https://adilet.zan.kz/rus/docs/amendment",
              relevance_status: "related",
              relevance_score: 55,
            }),
          ],
        ),
      ]),
      analysis: analysisText,
    },
    relatedSearch,
    true,
  );

  assert.equal(enriched.legal_information_status, "partially_verified");
  assert.equal(enriched.analysis, analysisText);
});

test("model-emitted official verification status is downgraded when source is not confirmed", () => {
  // Модель заявила официальный статус нормы. Серверная проверка его не
  // подтверждает: direct-источник найден, но не подтверждён поиском.
  const applicableLaws: ApplicableLaw[] = [
    {
      act_name: 'Закон "О персональных данных и их защите"',
      article: "ст. 7",
      verification_status: "official",
    },
  ];

  const enriched = enrichAnalysisWithSearch(
    baseResult([baseSource()], applicableLaws),
    [searchResult({ search_confirmed: false })],
    true,
  );

  const law = enriched.applicableLaws[0];

  assert.equal(law?.source_confirmed, false);
  assert.equal(law?.verification_status, "unverified");
});
