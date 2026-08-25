import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCoreLegalSourceResult } from "./build-core-legal-sources";
import { PERSONAL_DATA_LAW_KZ } from "./core-legal-acts";
import type { fetchOfficialSourceContent } from "./fetch-official-source-content";

const ADILET_CORE_HTML = `
<html>
  <head>
    <title>Закон Республики Казахстан «О персональных данных и их защите»</title>
  </head>
  <body>
    <article>
      <p>Настоящий Закон регулирует отношения, связанные с персональными данными.</p>
      <p><b><a name="z17"></a>Статья 7. Условия сбора и обработки персональных данных</b></p>
      <p id="z15">1. Сбор, обработка персональных данных осуществляются с согласия субъекта.</p>
      <p><b><a name="z371"></a>Статья 8-1. Государственный сервис</b></p>
      <p id="z372">1. Государственный сервис обеспечивает взаимодействие с субъектом.</p>
    </article>
  </body>
</html>
`.trim();

test("buildCoreLegalSourceResult attaches parsed Adilet articles without changing confirmation fields", async () => {
  let fetchCalls = 0;
  const mockFetch = async () => {
    fetchCalls += 1;
    return new Response(ADILET_CORE_HTML, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  };

  const result = await buildCoreLegalSourceResult(
    PERSONAL_DATA_LAW_KZ,
    mockFetch as typeof fetch,
  );

  assert.equal(fetchCalls, 1);
  assert.ok(result);
  assert.ok(result.articles);
  assert.equal("html" in result, false);
  assert.equal(result.source_type, "legal_act");
  assert.equal(result.relevance_status, "direct");
  assert.equal(result.content_checked, true);
  assert.equal(result.search_confirmed, true);
  assert.equal(result.relevance_score, 95);
  assert.deepEqual(
    result.articles.map((article) => article.number),
    ["7", "8-1"],
  );
  assert.equal(result.articles[0]?.anchor, "#z17");
  assert.match(result.articles[0]?.text ?? "", /1\.\s*Сбор, обработка/);
  assert.equal(result.articles[1]?.anchor, "#z371");
  assert.match(
    result.articles[1]?.text ?? "",
    /1\.\s*Государственный сервис обеспечивает/,
  );
});

test("buildCoreLegalSourceResult succeeds when fetched content has no html field", async () => {
  const title =
    "Закон Республики Казахстан «О персональных данных и их защите»";
  const text =
    "Настоящий Закон регулирует отношения, связанные с персональными данными, их сбором, обработкой и защитой.";
  let fetchContentCalls = 0;

  const fetchContent: typeof fetchOfficialSourceContent = async () => {
    fetchContentCalls += 1;
    return {
      content_checked: true,
      title,
      text,
      final_url: PERSONAL_DATA_LAW_KZ.official_url,
    };
  };

  const result = await buildCoreLegalSourceResult(
    PERSONAL_DATA_LAW_KZ,
    undefined,
    fetchContent,
  );

  assert.equal(fetchContentCalls, 1);
  assert.ok(result);
  assert.equal(result.content_checked, true);
  assert.equal(result.source_type, "legal_act");
  assert.equal(result.relevance_status, "direct");
  assert.equal(result.search_confirmed, true);
  assert.equal(result.articles, undefined);
  assert.equal("html" in result, false);
});
