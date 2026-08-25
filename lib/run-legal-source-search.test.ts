import assert from "node:assert/strict";
import { test } from "node:test";
import { runLegalSourceSearch } from "./run-legal-source-search";

const DOC_FRAGMENT =
  "Претензия продавцу о возврате некачественного товара и расторжении договора купли-продажи. ";

const LONG_DOCX_DESCRIPTION = [
  "Проведите юридический анализ претензии продавцу.",
  "ТЕКСТ ЗАГРУЖЕННОГО ДОКУМЕНТА:",
  DOC_FRAGMENT.repeat(40),
].join("\n\n");

test("runLegalSourceSearch keeps Tavily queries within 400 characters for DOCX-like descriptions", async () => {
  const originalKey = process.env.TAVILY_API_KEY;
  const originalFetch = globalThis.fetch;
  const capturedQueries: string[] = [];

  process.env.TAVILY_API_KEY = "test-key";
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.includes("api.tavily.com/search")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string };

      if (body.query) {
        capturedQueries.push(body.query);
      }

      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const outcome = await runLegalSourceSearch(
      {
        legalArea: "Защита прав потребителей",
        userType: "individual",
        description: LONG_DOCX_DESCRIPTION,
      },
      globalThis.fetch,
    );

    assert.ok(capturedQueries.length > 0);
    assert.ok(
      outcome.contextActNames.some((actName) =>
        actName.includes("О защите прав потребителей"),
      ),
    );

    for (const query of capturedQueries) {
      assert.ok(
        query.length <= 400,
        `expected query length <= 400, got ${query.length}`,
      );
    }

    const longestQuery = capturedQueries.reduce((longest, query) =>
      query.length > longest.length ? query : longest,
    );

    assert.doesNotMatch(longestQuery, /ТЕКСТ ЗАГРУЖЕННОГО ДОКУМЕНТА:/);
    assert.doesNotMatch(
      longestQuery,
      /Претензия продавцу о возврате некачественного товара/,
    );
  } finally {
    if (originalKey) {
      process.env.TAVILY_API_KEY = originalKey;
    } else {
      delete process.env.TAVILY_API_KEY;
    }

    globalThis.fetch = originalFetch;
  }
});
