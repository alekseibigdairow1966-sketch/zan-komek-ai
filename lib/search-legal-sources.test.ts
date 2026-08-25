import assert from "node:assert/strict";
import { test } from "node:test";
import { searchLegalSources } from "./search-legal-sources";

test("missing Tavily API key does not throw and marks search as not performed", async () => {
  const original = process.env.TAVILY_API_KEY;
  delete process.env.TAVILY_API_KEY;

  try {
    const outcome = await searchLegalSources(["Гражданское право Казахстан"]);

    assert.equal(outcome.performed, false);
    assert.deepEqual(outcome.results, []);
    assert.match(outcome.error ?? "", /TAVILY_API_KEY/i);
  } finally {
    if (original) {
      process.env.TAVILY_API_KEY = original;
    }
  }
});

test("searchLegalSources returns readable error when Tavily body.error is an object", async () => {
  const originalKey = process.env.TAVILY_API_KEY;
  const originalFetch = globalThis.fetch;

  process.env.TAVILY_API_KEY = "test-key";
  globalThis.fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (!url.includes("api.tavily.com/search")) {
      throw new Error(`Unexpected fetch: ${url}`);
    }

    return new Response(
      JSON.stringify({
        error: {
          message: "Invalid API key",
          code: "invalid_api_key",
        },
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  try {
    const result = await searchLegalSources(["Гражданское право Казахстан"]);

    assert.equal(result.performed, false);
    assert.deepEqual(result.results, []);
    assert.equal(result.error, "Invalid API key");
    assert.doesNotMatch(result.error ?? "", /\[object Object\]/);
  } finally {
    if (originalKey) {
      process.env.TAVILY_API_KEY = originalKey;
    } else {
      delete process.env.TAVILY_API_KEY;
    }

    globalThis.fetch = originalFetch;
  }
});
