import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CORE_LEGAL_ACTS,
  PERSONAL_DATA_LAW_KZ,
  getActById,
  resolvePrimaryAct,
} from "./core-legal-acts";
import type { CoreLegalAct } from "./core-legal-acts";

/**
 * RAG-20D live-verified CORE configuration. These URLs were confirmed against
 * Adilet itself. This suite only asserts production configuration; it does not
 * fetch, ingest, or re-measure documents.
 */
const EXPECTED_CORE_ACTS = [
  {
    id: "personal-data-law-kz",
    title:
      "Закон Республики Казахстан «О персональных данных и их защите»",
    official_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
  },
  {
    id: "consumer-protection-law-kz",
    title: "Закон Республики Казахстан «О защите прав потребителей»",
    official_url: "https://adilet.zan.kz/rus/docs/Z100000274_",
  },
  {
    id: "labour-code-kz",
    title: "Трудовой кодекс Республики Казахстан",
    official_url: "https://adilet.zan.kz/rus/docs/K1500000414",
  },
  {
    id: "civil-code-general-kz",
    title: "Гражданский кодекс Республики Казахстан (Общая часть)",
    official_url: "https://adilet.zan.kz/rus/docs/K940001000_",
  },
  {
    id: "civil-code-special-kz",
    title: "Гражданский кодекс Республики Казахстан (особенная часть)",
    official_url: "https://adilet.zan.kz/rus/docs/K990000409_",
  },
  {
    id: "entrepreneurial-code-kz",
    title: "Предпринимательский кодекс Республики Казахстан",
    official_url: "https://adilet.zan.kz/rus/docs/K1500000375",
  },
  {
    id: "administrative-procedure-code-kz",
    title:
      "Административный процедурно-процессуальный кодекс Республики Казахстан",
    official_url: "https://adilet.zan.kz/rus/docs/K2000000350",
  },
] as const;

const EXPECTED_IDS = EXPECTED_CORE_ACTS.map((act) => act.id);

function actById(id: string): CoreLegalAct | undefined {
  return CORE_LEGAL_ACTS.find((act) => act.id === id);
}

test("CORE_LEGAL_ACTS contains exactly seven production acts", () => {
  assert.equal(CORE_LEGAL_ACTS.length, 7);
});

test("CORE_LEGAL_ACTS has the exact verified act ids and no extras", () => {
  const actualIds = CORE_LEGAL_ACTS.map((act) => act.id);

  assert.deepEqual([...actualIds].sort(), [...EXPECTED_IDS].sort());
  assert.equal(new Set(actualIds).size, actualIds.length);
  assert.equal(actualIds.includes("civil-code-kz"), false);
});

test("each CORE act has its live-verified official_url", () => {
  for (const expected of EXPECTED_CORE_ACTS) {
    const act = actById(expected.id);

    assert.ok(act, `missing production definition: ${expected.id}`);
    assert.equal(act.official_url, expected.official_url);
  }

  const general = actById("civil-code-general-kz");
  assert.ok(general);
  assert.match(general.official_url, /K940001000_$/);
  assert.notEqual(
    general.official_url,
    "https://adilet.zan.kz/rus/docs/K940001000",
  );
});

test("every CORE act uses the official Adilet domain", () => {
  assert.ok(CORE_LEGAL_ACTS.length > 0);

  for (const act of CORE_LEGAL_ACTS) {
    assert.equal(act.official_domain, "adilet.zan.kz");
  }
});

test("each CORE act keeps its production-style title", () => {
  for (const expected of EXPECTED_CORE_ACTS) {
    const act = actById(expected.id);

    assert.ok(act, `missing production definition: ${expected.id}`);
    assert.equal(act.title, expected.title);
  }
});

test("getActById returns each of the seven production definitions", () => {
  for (const expected of EXPECTED_CORE_ACTS) {
    const act = getActById(expected.id);

    assert.ok(act, `getActById(${expected.id}) returned undefined`);
    assert.equal(act.id, expected.id);
    assert.equal(act.title, expected.title);
    assert.equal(act.official_url, expected.official_url);
    assert.equal(act.official_domain, "adilet.zan.kz");
  }

  assert.equal(getActById("civil-code-kz"), undefined);
});

test("PERSONAL_DATA_LAW_KZ remains the primary act for personal-data questions", () => {
  assert.equal(PERSONAL_DATA_LAW_KZ.id, "personal-data-law-kz");
  assert.equal(
    PERSONAL_DATA_LAW_KZ.official_url,
    "https://adilet.zan.kz/rus/docs/Z1300000094",
  );
  assert.equal(getActById("personal-data-law-kz"), PERSONAL_DATA_LAW_KZ);

  const byArea = resolvePrimaryAct({
    legalArea: "Персональные данные",
    description:
      "Проверьте соответствие выбранной области права требованиям законодательства.",
  });
  const byKeywords = resolvePrimaryAct({
    legalArea: "Другое",
    description:
      "Нужно ли получать согласие на обработку персональных данных в форме заявки?",
  });

  assert.equal(byArea?.id, "personal-data-law-kz");
  assert.equal(byKeywords?.id, "personal-data-law-kz");
});

test("each CORE act has a structurally complete CoreLegalAct shape", () => {
  for (const act of CORE_LEGAL_ACTS) {
    assert.equal(typeof act.id, "string");
    assert.ok(act.id.length > 0);
    assert.equal(typeof act.title, "string");
    assert.ok(act.title.length > 0);
    assert.equal(Array.isArray(act.aliases), true);
    assert.ok(act.aliases.every((alias) => typeof alias === "string" && alias.length > 0));
    assert.equal(Array.isArray(act.legal_area), true);
    assert.ok(act.legal_area.length > 0);
    assert.equal(Array.isArray(act.keywords), true);
    assert.ok(act.keywords.every((keyword) => typeof keyword === "string" && keyword.length > 0));
    assert.equal(typeof act.official_url, "string");
    assert.equal(typeof act.official_domain, "string");
  }
});
