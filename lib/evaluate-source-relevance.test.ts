import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateSourceRelevance } from "./evaluate-source-relevance";

const PERSONAL_DATA_ACT =
  'Закон Республики Казахстан "О персональных данных и их защите"';

const KEYWORDS = ["персональн", "данн", "согласие", "обработк"];

test("exact law page is direct", () => {
  const result = evaluateSourceRelevance({
    actNames: [PERSONAL_DATA_ACT],
    queryKeywords: KEYWORDS,
    title: 'Закон Республики Казахстан "О персональных данных и их защите"',
    text: "Настоящий Закон регулирует отношения, связанные с персональными данными.",
  });

  assert.equal(result.relevance_status, "direct");
  assert.ok(result.relevance_score >= 70);
});

test("amendment law is related", () => {
  const result = evaluateSourceRelevance({
    actNames: [PERSONAL_DATA_ACT],
    queryKeywords: KEYWORDS,
    title: "О внесении изменений и дополнений в некоторые законодательные акты",
    text: "Внести изменения в Закон о персональных данных и их защите.",
  });

  assert.equal(result.relevance_status, "related");
  assert.ok(result.relevance_score >= 40 && result.relevance_score < 70);
});

test("gov.kz news is related", () => {
  const result = evaluateSourceRelevance({
    actNames: [PERSONAL_DATA_ACT],
    queryKeywords: KEYWORDS,
    title: "Новость на портале gov.kz",
    text: "Информационный материал о цифровизации и персональных данных.",
  });

  assert.equal(result.relevance_status, "related");
});

test("single word overlap is irrelevant", () => {
  const result = evaluateSourceRelevance({
    actNames: [PERSONAL_DATA_ACT],
    queryKeywords: KEYWORDS,
    title: "Справочная страница",
    text: "Общая информация о государственных услугах.",
  });

  assert.equal(result.relevance_status, "irrelevant");
  assert.ok(result.relevance_score < 40);
});

test("act name matches title", () => {
  const result = evaluateSourceRelevance({
    actNames: [PERSONAL_DATA_ACT],
    queryKeywords: KEYWORDS,
    title: PERSONAL_DATA_ACT,
    text: "Статья 1. Основные понятия",
  });

  assert.equal(result.matched_act_name, PERSONAL_DATA_ACT);
  assert.equal(result.relevance_status, "direct");
});

test("act name found only in text", () => {
  const result = evaluateSourceRelevance({
    actNames: [PERSONAL_DATA_ACT],
    queryKeywords: KEYWORDS,
    title: "Нормативный правовой акт",
    text: `Документ ссылается на ${PERSONAL_DATA_ACT} и регулирует обработку персональных данных.`,
  });

  assert.equal(result.matched_act_name, PERSONAL_DATA_ACT);
  assert.ok(result.relevance_score >= 40);
});

test("related source does not become direct without title match", () => {
  const result = evaluateSourceRelevance({
    actNames: [PERSONAL_DATA_ACT],
    queryKeywords: KEYWORDS,
    title: "О внесении изменений и дополнений в некоторые законодательные акты",
    text: "Изменения касаются персональных данных, но это не прямой текст закона.",
  });

  assert.notEqual(result.relevance_status, "direct");
});

const CIVIL_CODE_ACT = "Гражданский кодекс Республики Казахстан";

const PRIVATE_RENTAL_KEYWORDS = [
  "арендодатель",
  "требует",
  "немедленно",
  "освободить",
  "квартиру",
  "угрожает",
  "заменить",
  "замки",
];

test("municipal communal property rental rules are irrelevant for private apartment lease dispute", () => {
  const result = evaluateSourceRelevance({
    actNames: [CIVIL_CODE_ACT],
    queryKeywords: PRIVATE_RENTAL_KEYWORDS,
    title:
      "Правила предоставления в аренду государственного коммунального имущества города Алматы",
    text: "Настоящие Правила являются нормативным правовым актом и регулируют порядок предоставления в аренду объектов государственной коммунальной собственности города Алматы. В соответствии с Гражданским кодексом Республики Казахстан договор аренды государственного имущества оформляется уполномоченным органом.",
  });

  assert.equal(result.relevance_status, "irrelevant");
});
