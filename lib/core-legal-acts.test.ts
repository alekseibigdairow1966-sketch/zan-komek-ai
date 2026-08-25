import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCoreLegalSourceResult, buildCoreLegalSources } from "./build-core-legal-sources";
import {
  confirmLegalSourceWithSearch,
  getSourceDisplayBadge,
} from "./confirm-sources-with-search";
import {
  BLUESCREEN_PERSONAL_DATA_URL,
  CURATED_OFFICIAL_SOURCES,
  PERSONAL_DATA_LAW_KZ,
  resolvePrimaryAct,
} from "./core-legal-acts";
import { buildLegalAnalysisPrompt } from "./legal-prompt";
import type { LegalSearchResult, LegalSource } from "./types";
import { verifyLegalSourceUrl } from "./verify-source-url";

const APPLICATION_FORM_QUESTION =
  "Нужно ли получать согласие на обработку персональных данных в форме заявки на сайте частной компании?";

function mockLawFetchResponse() {
  return async (url: string) => {
    if (url.includes("Z1300000094")) {
      return new Response(
        `<html><head><title>Закон Республики Казахстан «О персональных данных и их защите»</title></head><body><p>Настоящий Закон регулирует отношения, связанные с персональными данными, их сбором, обработкой и защитой.</p></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }

    if (url.includes("130936")) {
      return new Response(
        `<html><head><title>Государственный сервис контроля доступа к персональным данным</title></head><body><p>Информационный материал о порядке применения КДП.</p></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }

    if (url.includes("maidd")) {
      return new Response(
        `<html><head><title>Министерство искусственного интеллекта и цифрового развития РК</title></head><body><p>Официальная страница государственного органа.</p></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };
}

test("application form question selects personal data law as primary_act", () => {
  const primaryAct = resolvePrimaryAct({
    legalArea: "Персональные данные",
    description: APPLICATION_FORM_QUESTION,
  });

  assert.equal(primaryAct?.id, "personal-data-law-kz");
  assert.match(primaryAct?.title ?? "", /персональных данных/i);
});

test("personal data legal area selects primary act without description keywords", () => {
  const primaryAct = resolvePrimaryAct({
    legalArea: "Персональные данные",
    description:
      "Проверьте соответствие выбранной области права требованиям законодательства.",
  });

  assert.equal(primaryAct?.id, "personal-data-law-kz");
});

test("known law URL is used before Tavily via core legal source builder", async () => {
  let tavilyCalled = false;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url.includes("api.tavily.com")) {
      tavilyCalled = true;
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return mockLawFetchResponse()(url);
  };

  try {
    const result = await buildCoreLegalSourceResult(
      PERSONAL_DATA_LAW_KZ,
      globalThis.fetch,
    );

    assert.equal(tavilyCalled, false);
    assert.equal(result?.source_type, "legal_act");
    assert.equal(result?.relevance_status, "direct");
    assert.equal(result?.content_checked, true);
    assert.equal(result?.url, PERSONAL_DATA_LAW_KZ.official_url);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gov.kz KDP material gets related official_guidance", async () => {
  const outcome = await buildCoreLegalSources(
    {
      legalArea: "Персональные данные",
      description:
        "Нужна ли интеграция с государственным сервисом контроля доступа к персональным данным для CRM?",
    },
    mockLawFetchResponse() as typeof fetch,
  );

  const kdpSource = outcome.results.find(
    (item) => item.curated_source_id === "kdp-access-control-guidance",
  );

  assert.ok(kdpSource);
  assert.equal(kdpSource.source_type, "official_guidance");
  assert.equal(kdpSource.relevance_status, "related");
});

test("legal prompt discourages mandatory KDP for ordinary private sites", () => {
  const prompt = buildLegalAnalysisPrompt(
    {
      legalArea: "Персональные данные",
      userType: "too",
      description: APPLICATION_FORM_QUESTION,
      consent: true,
    },
    [],
    {
      id: "personal-data-law-kz",
      title: PERSONAL_DATA_LAW_KZ.title,
      found: true,
      official_url: PERSONAL_DATA_LAW_KZ.official_url,
    },
  );

  assert.match(
    prompt,
    /Интеграция с государственным сервисом контроля доступа к персональным данным не должна рекомендоваться как обязательная для обычного частного сайта/,
  );
});

test("ministry authority page does not confirm law article", () => {
  const authoritySource: LegalSearchResult = {
    title: CURATED_OFFICIAL_SOURCES[1]?.title ?? "Министерство",
    url: CURATED_OFFICIAL_SOURCES[1]?.url ?? "https://www.gov.kz/memleket/entities/maidd",
    content: "Компетенция государственного органа",
    source_domain: "gov.kz",
    search_confirmed: true,
    relevance_score: 55,
    relevance_status: "related",
    matched_act_name: PERSONAL_DATA_LAW_KZ.title,
    content_checked: true,
    source_type: "official_authority",
  };

  const modelSource: LegalSource = {
    title: authoritySource.title,
    act_name: PERSONAL_DATA_LAW_KZ.title,
    article: "ст. 8",
    url: authoritySource.url,
    source_domain: "gov.kz",
    verification_status: "official",
    search_confirmed: false,
    source_type: "official_authority",
    relevance_status: "related",
    content_checked: true,
  };

  const confirmed = confirmLegalSourceWithSearch(modelSource, [authoritySource]);

  assert.equal(confirmed.url, null);
  assert.equal(
    getSourceDisplayBadge(confirmed),
    "Связанный официальный материал",
  );
});

test("bluescreen does not get official status", () => {
  const verification = verifyLegalSourceUrl({
    url: BLUESCREEN_PERSONAL_DATA_URL,
    modelVerificationStatus: "official",
  });

  assert.equal(verification.verification_status, "unverified");
  assert.equal(verification.url, null);
  assert.equal(verification.source_domain, "bluescreen.kz");
});

test("primary legal act found when official page matches act title", async () => {
  const outcome = await buildCoreLegalSources(
    {
      legalArea: "Персональные данные",
      description: APPLICATION_FORM_QUESTION,
    },
    mockLawFetchResponse() as typeof fetch,
  );

  assert.equal(outcome.primary_legal_act?.id, "personal-data-law-kz");
  assert.equal(outcome.primary_legal_act?.found, true);

  const directSource = outcome.results.find(
    (item) => item.source_type === "legal_act",
  );

  assert.equal(directSource?.relevance_status, "direct");
  assert.equal(directSource?.search_confirmed, true);
});
