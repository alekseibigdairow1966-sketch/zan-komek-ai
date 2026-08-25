import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AnalysisResult,
  resolveApplicableLawArticleVerificationBadge,
  resolveApplicableLawVerificationBadge,
} from "./analysis-result";
import type { ApplicableLaw, LegalAnalysisResult } from "@/lib/types";

const ACT_NAME = 'Закон "О персональных данных и их защите"';

const SOURCE_ARTICLE_7 = {
  number: "7",
  title: "Условия сбора и обработки персональных данных",
  text: "1. Сбор, обработка персональных данных осуществляются с согласия субъекта.",
  anchor: "#z17",
};

function renderAnalysisResultHtml(applicableLaws: ApplicableLaw[]): string {
  const result: LegalAnalysisResult = {
    legalAssessment: "Оценка",
    applicableLaws,
    analysis: "Анализ",
    riskAnalysis: "Риски",
    recommendedActions: ["Действие"],
    requiredDocuments: ["Документ"],
    sources: [],
    confidenceLevel: "средний",
    relevanceDate: "12.07.2026",
    generated_at: "2026-07-13T10:00:00.000Z",
    legal_information_status: "partially_verified",
    legal_information_notice:
      "Часть правовых выводов подтверждена прямыми официальными источниками. Остальные положения требуют проверки",
    verified_by_search: true,
    search_performed: true,
  };

  return renderToStaticMarkup(
    React.createElement(AnalysisResult, { result }),
  );
}

test("official without source_confirmed shows official domain badge", () => {
  const badge = resolveApplicableLawVerificationBadge("official", false);

  assert.equal(badge.label, "Официальный домен");
  assert.match(badge.style, /border-blue-200/);
  assert.doesNotMatch(badge.style, /border-emerald-200/);
});

test("official with source_confirmed keeps official source badge", () => {
  const badge = resolveApplicableLawVerificationBadge("official", true);

  assert.equal(badge.label, "Официальный источник");
  assert.match(badge.style, /border-emerald-200/);
});

test("resolveApplicableLawArticleVerificationBadge returns confirmed status when source_article matches article 7", () => {
  const law: ApplicableLaw = {
    act_name: 'Закон "О персональных данных и их защите"',
    article: "ст. 7",
    source_confirmed: true,
    source_article: SOURCE_ARTICLE_7,
  };

  assert.deepEqual(resolveApplicableLawArticleVerificationBadge(law), {
    label: "Статья 7 подтверждена",
    tone: "confirmed",
  });
});

test("resolveApplicableLawArticleVerificationBadge returns warning when act is confirmed but article is not found", () => {
  const law: ApplicableLaw = {
    act_name: 'Закон "О персональных данных и их защите"',
    article: "ст. 8",
    source_confirmed: true,
  };

  assert.deepEqual(resolveApplicableLawArticleVerificationBadge(law), {
    label: "Конкретная статья не подтверждена",
    tone: "warning",
  });
});

test("resolveApplicableLawArticleVerificationBadge returns null when article is not declared", () => {
  const lawWithoutArticle: ApplicableLaw = {
    act_name: 'Закон "О персональных данных и их защите"',
    source_confirmed: true,
  };

  const lawWithBlankArticle: ApplicableLaw = {
    act_name: 'Закон "О персональных данных и их защите"',
    article: "   ",
    source_confirmed: true,
  };

  assert.equal(
    resolveApplicableLawArticleVerificationBadge(lawWithoutArticle),
    null,
  );
  assert.equal(
    resolveApplicableLawArticleVerificationBadge(lawWithBlankArticle),
    null,
  );
});

test("resolveApplicableLawArticleVerificationBadge returns null when act is not confirmed", () => {
  const law: ApplicableLaw = {
    act_name: 'Закон "О персональных данных и их защите"',
    article: "ст. 7",
    source_confirmed: false,
  };

  assert.equal(resolveApplicableLawArticleVerificationBadge(law), null);
});

test("resolveApplicableLawArticleVerificationBadge uses source_article number for confirmed label", () => {
  const law: ApplicableLaw = {
    act_name: 'Закон "О персональных данных и их защите"',
    article: "ст. 7 с дополнительным текстом",
    source_confirmed: true,
    source_article: SOURCE_ARTICLE_7,
  };

  assert.deepEqual(resolveApplicableLawArticleVerificationBadge(law), {
    label: "Статья 7 подтверждена",
    tone: "confirmed",
  });
});

test("AnalysisResult shows confirmed article verification status for source_article 7", () => {
  const html = renderAnalysisResultHtml([
    {
      act_name: ACT_NAME,
      article: "ст. 7",
      source_confirmed: true,
      verification_status: "official",
      source_relevance_status: "direct",
      source_article: SOURCE_ARTICLE_7,
    },
  ]);

  assert.match(html, /Статья 7 подтверждена/);
  assert.doesNotMatch(html, /Конкретная статья не подтверждена/);
});

test("AnalysisResult shows warning article verification status when article is not found", () => {
  const html = renderAnalysisResultHtml([
    {
      act_name: ACT_NAME,
      article: "ст. 8",
      source_confirmed: true,
      verification_status: "official",
      source_relevance_status: "direct",
    },
  ]);

  assert.match(html, /Конкретная статья не подтверждена/);
  assert.doesNotMatch(html, /Статья 8 подтверждена/);
});

test("AnalysisResult omits article verification status when article is not declared", () => {
  const html = renderAnalysisResultHtml([
    {
      act_name: ACT_NAME,
      source_confirmed: true,
      verification_status: "official",
      source_relevance_status: "direct",
    },
  ]);

  assert.doesNotMatch(html, /Статья \d+ подтверждена/);
  assert.doesNotMatch(html, /Конкретная статья не подтверждена/);
});

test("AnalysisResult links confirmed article status to source_url with source_article anchor", () => {
  const html = renderAnalysisResultHtml([
    {
      act_name: ACT_NAME,
      article: "ст. 7",
      source_confirmed: true,
      verification_status: "official",
      source_relevance_status: "direct",
      source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
      source_article: {
        ...SOURCE_ARTICLE_7,
        anchor: "#z17",
      },
    },
  ]);

  assert.match(
    html,
    /<a[^>]*href="https:\/\/adilet\.zan\.kz\/rus\/docs\/Z1300000094#z17"[^>]*>[\s\S]*?Статья 7 подтверждена/,
  );
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test("AnalysisResult keeps confirmed article status as plain text when anchor is missing", () => {
  const html = renderAnalysisResultHtml([
    {
      act_name: ACT_NAME,
      article: "ст. 7",
      source_confirmed: true,
      verification_status: "official",
      source_relevance_status: "direct",
      source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
      source_article: {
        number: SOURCE_ARTICLE_7.number,
        title: SOURCE_ARTICLE_7.title,
        text: SOURCE_ARTICLE_7.text,
      },
    },
  ]);

  assert.match(html, /Статья 7 подтверждена/);
  assert.doesNotMatch(
    html,
    /href="https:\/\/adilet\.zan\.kz\/rus\/docs\/Z1300000094#/,
  );
  assert.doesNotMatch(html, /#z17/);
});

test("AnalysisResult keeps confirmed article status without article link when source_url is missing", () => {
  const html = renderAnalysisResultHtml([
    {
      act_name: ACT_NAME,
      article: "ст. 7",
      source_confirmed: true,
      verification_status: "official",
      source_relevance_status: "direct",
      source_article: {
        ...SOURCE_ARTICLE_7,
        anchor: "#z17",
      },
    },
  ]);

  assert.match(html, /Статья 7 подтверждена/);
  assert.doesNotMatch(html, /href="[^"]*#z17"/);
});
