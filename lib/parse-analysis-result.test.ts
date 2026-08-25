import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAnalysisResult } from "./parse-analysis-result";

const MINIMAL_VALID_AI_RESPONSE = {
  legalAssessment: "Краткая правовая оценка ситуации.",
  applicableLaws: [
    {
      act_name: "Закон РК «О защите прав потребителей»",
      article: "ст. 14",
      provision: "Права потребителя при обнаружении недостатков товара",
      explanation: "Применимо к претензии покупателя продавцу.",
      verification_status: "unverified",
    },
  ],
  analysis: "Развёрнутый правовой анализ ситуации.",
  riskAnalysis: "Анализ правовых рисков.",
  recommendedActions: [
    {
      action: "Направить продавцу письменную претензию",
      basis: "Практическая рекомендация",
    },
  ],
  requiredDocuments: ["Копия договора купли-продажи"],
  sources: [
    {
      title: "Закон о защите прав потребителей",
      act_name: "Закон РК «О защите прав потребителей»",
      article: "ст. 14",
      url: null,
      source_domain: null,
      verification_status: "unverified",
    },
  ],
  confidenceLevel: "средний",
  relevanceDate: "13.07.2026",
};

test("parseAnalysisResult normalizes object recommendedActions via action field", () => {
  const result = parseAnalysisResult(JSON.stringify(MINIMAL_VALID_AI_RESPONSE));

  assert.equal(result.recommendedActions.length, 1);
  assert.equal(
    result.recommendedActions[0],
    "Направить продавцу письменную претензию",
  );
  assert.doesNotMatch(result.recommendedActions[0] ?? "", /\[object Object\]/);
});

test("parseAnalysisResult normalizes object requiredDocuments via document field", () => {
  const result = parseAnalysisResult(
    JSON.stringify({
      ...MINIMAL_VALID_AI_RESPONSE,
      requiredDocuments: [
        {
          document: "Копия чека или иного подтверждения покупки",
          purpose: "Подтверждение факта приобретения товара",
        },
      ],
    }),
  );

  assert.equal(result.requiredDocuments.length, 1);
  assert.equal(
    result.requiredDocuments[0],
    "Копия чека или иного подтверждения покупки",
  );
  assert.doesNotMatch(result.requiredDocuments[0] ?? "", /\[object Object\]/);
});
