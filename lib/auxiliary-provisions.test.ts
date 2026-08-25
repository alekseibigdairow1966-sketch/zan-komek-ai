import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BLUESCREEN_PERSONAL_DATA_URL,
  PARAGRAPH_PERSONAL_DATA_URL,
  PERSONAL_DATA_LAW_KZ,
  SERVERCORE_PERSONAL_DATA_URL,
} from "./core-legal-acts";
import {
  AUXILIARY_PROVISIONS,
  classifyAuxiliaryClaim,
  HANDBOOK_RISK_DISCLAIMER,
  PD_REGULATION_HANDBOOK,
  provisionConfirmsNorm,
  REJECTED_RISK_GUARANTEE_PHRASE,
  sanitizeHandbookRiskPhrase,
} from "./auxiliary-provisions";
import type { AuxiliaryProvision } from "./auxiliary-provisions";
import { buildLegalAnalysisPrompt } from "./legal-prompt";
import { verifyLegalSourceUrl } from "./verify-source-url";

const OFFICIAL_URL = PERSONAL_DATA_LAW_KZ.official_url;
const SUBORDINATE_ACT_URL = "https://adilet.zan.kz/rus/docs/K1400001234";

function subordinateProvision(
  overrides: Partial<AuxiliaryProvision> = {},
): AuxiliaryProvision {
  return {
    id: "test-subordinate",
    topic: "Тестовое подзаконное требование",
    summary: "Тест",
    provision_type: "subordinate_rule",
    handbook_id: "pd-regulation-handbook",
    official_source_url: SUBORDINATE_ACT_URL,
    adaptation_required: false,
    verification_required: false,
    content_checked: true,
    relevance_status: "direct",
    source_confirmed: true,
    confirms_norm: true,
    tags: [],
    ...overrides,
  };
}

test("analytical article does not confirm legal norm", () => {
  const bluescreen = classifyAuxiliaryClaim({
    claim: "Требования к архитектуре персональных данных в 2026 году",
    sourceUrl: BLUESCREEN_PERSONAL_DATA_URL,
  });

  assert.equal(bluescreen.provision_type, "secondary_analysis");
  assert.equal(bluescreen.confirms_norm, false);

  const servercore = classifyAuxiliaryClaim({
    claim: "Штрафы по Закону № 94-V",
    sourceUrl: SERVERCORE_PERSONAL_DATA_URL,
  });

  assert.equal(servercore.provision_type, "secondary_analysis");
  assert.equal(servercore.confirms_norm, false);
});

test("document template does not confirm itself", () => {
  const result = classifyAuxiliaryClaim({
    claim: "Шаблон политики конфиденциальности для сайта",
    isTemplate: true,
  });

  assert.equal(result.provision_type, "document_template");
  assert.equal(result.confirms_norm, false);
  assert.equal(result.adaptation_required, true);
});

test("3 year retention is not universal legal term", () => {
  const result = classifyAuxiliaryClaim({
    claim: "Универсальный срок хранения персональных данных — 3 года",
  });

  assert.equal(result.provision_type, "practical_recommendation");
  assert.equal(result.confirms_norm, false);
  assert.equal(result.verification_required, true);
});

test("cookie-banner without direct norm becomes practical_recommendation", () => {
  const result = classifyAuxiliaryClaim({
    claim: "Обязательный cookie-banner для любого сайта",
  });

  assert.equal(result.provision_type, "practical_recommendation");
  assert.equal(result.confirms_norm, false);
});

test("AES-256 and TLS 1.3 without official norm become technical_recommendation", () => {
  const aes = classifyAuxiliaryClaim({
    claim: "Обязательность шифрования AES-256 для всех дисков",
  });
  const tls = classifyAuxiliaryClaim({
    claim: "Обязательность TLS 1.3 для всех каналов связи",
  });

  assert.equal(aes.provision_type, "technical_recommendation");
  assert.equal(tls.provision_type, "technical_recommendation");
  assert.equal(aes.confirms_norm, false);
  assert.equal(tls.confirms_norm, false);
});

test("subordinate_rule with only main law url has confirms_norm false", () => {
  const classified = classifyAuxiliaryClaim({
    claim: "Уведомление об инциденте в течение одного рабочего дня",
    officialSourceUrl: OFFICIAL_URL,
  });

  assert.equal(classified.provision_type, "practical_recommendation");
  assert.equal(classified.confirms_norm, false);
  assert.equal(classified.verification_required, true);

  const catalog = AUXILIARY_PROVISIONS.find(
    (item) => item.id === "rule-incident-one-day",
  );
  assert.ok(catalog);
  assert.equal(provisionConfirmsNorm(catalog!), false);
});

test("subordinate_rule with direct subordinate act url confirms_norm true", () => {
  const provision = subordinateProvision();
  assert.equal(provisionConfirmsNorm(provision), true);
});

test("verification_required true makes confirms_norm false", () => {
  const provision = subordinateProvision({ verification_required: true });
  assert.equal(provisionConfirmsNorm(provision), false);
});

test("related source makes confirms_norm false", () => {
  const provision = subordinateProvision({ relevance_status: "related" });
  assert.equal(provisionConfirmsNorm(provision), false);
});

test("missing separate subordinate url becomes practical recommendation", () => {
  const result = classifyAuxiliaryClaim({
    claim: "База ограниченного доступа более 100 000 записей",
  });

  assert.equal(result.provision_type, "unverified_claim");
  assert.equal(result.confirms_norm, false);
});

test("main law does not automatically confirm subordinate norm in catalog", () => {
  for (const id of [
    "rule-incident-one-day",
    "rule-database-100k",
    "rule-collection-processing",
    "rule-protection-measures",
  ]) {
    const provision = AUXILIARY_PROVISIONS.find((item) => item.id === id);
    assert.ok(provision, id);
    assert.equal(provision!.provision_type, "practical_recommendation");
    assert.equal(provision!.confirms_norm, false);
    assert.equal(provision!.verification_required, true);
    assert.equal(provisionConfirmsNorm(provision!), false);
    assert.equal(provision!.official_source_url, undefined);
  }
});

test("database over 100000 with main law only is not confirmed", () => {
  const result = classifyAuxiliaryClaim({
    claim: "База ограниченного доступа более 100 000 записей требует биометрии",
    officialSourceUrl: OFFICIAL_URL,
  });

  assert.equal(result.provision_type, "practical_recommendation");
  assert.equal(result.confirms_norm, false);
});

test("unconfirmed parsing ban becomes unverified_claim", () => {
  const result = classifyAuxiliaryClaim({
    claim: "Полный запрет парсинга данных с 18 января 2026 года",
  });

  assert.equal(result.provision_type, "unverified_claim");
  assert.equal(result.confirms_norm, false);
  assert.equal(result.verification_required, true);
});

test("handbook is auxiliary source and not added to normative acts registry", () => {
  assert.equal(PD_REGULATION_HANDBOOK.nature, "auxiliary_source");
  assert.ok(
    AUXILIARY_PROVISIONS.every(
      (provision) => provision.handbook_id === "pd-regulation-handbook",
    ),
  );
  assert.ok(
    AUXILIARY_PROVISIONS.every(
      (provision) =>
        provision.provision_type !== "legal_requirement" ||
        Boolean(provision.official_source_url),
    ),
  );
  assert.ok(
    AUXILIARY_PROVISIONS.every(
      (provision) => provision.content_checked !== undefined,
    ),
  );
});

test("risk guarantee phrase is replaced with handbook disclaimer", () => {
  const sanitized = sanitizeHandbookRiskPhrase(
    `Контрольный список ${REJECTED_RISK_GUARANTEE_PHRASE} и полную готовность проекта.`,
  );

  assert.doesNotMatch(sanitized, /гарантирует устранение всех юридических рисков/);
  assert.match(sanitized, new RegExp(HANDBOOK_RISK_DISCLAIMER));
});

test("paragraph article is secondary analysis and unverified officially", () => {
  const classified = classifyAuxiliaryClaim({
    claim: "Комментарий Параграф к закону о персональных данных",
    sourceUrl: PARAGRAPH_PERSONAL_DATA_URL,
  });
  const verified = verifyLegalSourceUrl({
    url: PARAGRAPH_PERSONAL_DATA_URL,
    modelVerificationStatus: "official",
  });

  assert.equal(classified.provision_type, "secondary_analysis");
  assert.equal(verified.verification_status, "unverified");
});

test("legal prompt includes auxiliary handbook for personal data questions", () => {
  const prompt = buildLegalAnalysisPrompt(
    {
      legalArea: "Персональные данные",
      userType: "too",
      description: "Нужен шаблон политики и форма заявки на сайте",
      consent: true,
    },
    [],
  );

  assert.match(prompt, /ВСПОМОГАТЕЛЬНЫЙ РЕГЛАМЕНТ/);
  assert.match(prompt, /pd-regulation-handbook/);
  assert.match(prompt, /document_template/);
  assert.ok(prompt.includes(HANDBOOK_RISK_DISCLAIMER));
});
