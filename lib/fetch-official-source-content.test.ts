import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractTextFromHtml,
  fetchOfficialSourceContent,
  isOfficialFetchUrl,
  isRedirectToUnofficialDomain,
} from "./fetch-official-source-content";

test("extractTextFromHtml removes scripts and tags", () => {
  const text = extractTextFromHtml(
    "<html><head><title>Закон</title></head><body><script>alert(1)</script><p>Статья 1</p></body></html>",
  );

  assert.match(text, /Статья 1/);
  assert.doesNotMatch(text, /alert/);
});

test("official fetch url passes domain check", () => {
  assert.equal(
    isOfficialFetchUrl("https://adilet.zan.kz/rus/docs/Z1300000094"),
    true,
  );
  assert.equal(isOfficialFetchUrl("https://example.com/law"), false);
});

test("redirect to unofficial domain is blocked", () => {
  assert.equal(
    isRedirectToUnofficialDomain(
      "https://adilet.zan.kz/rus/docs/test",
      "https://example.com/phishing",
    ),
    true,
  );
});

test("redirect within official domain is allowed", () => {
  assert.equal(
    isRedirectToUnofficialDomain(
      "https://adilet.zan.kz/rus/docs/test",
      "https://adilet.zan.kz/rus/docs/final",
    ),
    false,
  );
});

test("failed page fetch returns content_checked false", async () => {
  const mockFetch = async () => {
    throw new Error("Network error");
  };

  const result = await fetchOfficialSourceContent(
    "https://adilet.zan.kz/rus/docs/test",
    mockFetch as typeof fetch,
  );

  assert.equal(result.content_checked, false);
  assert.ok(result.error);
});

test("successful fetch returns full html and truncated cleaned text", async () => {
  const longBody = "слово ".repeat(5_000);
  const sourceHtml = `<html><head><title>Закон РК</title></head><body><script>ignore()</script><p>Статья 1</p><p>${longBody}</p></body></html>`;

  const mockFetch = async () =>
    ({
      ok: true,
      status: 200,
      headers: {
        get: () => null,
      },
      text: async () => sourceHtml,
    }) as unknown as Response;

  const result = await fetchOfficialSourceContent(
    "https://adilet.zan.kz/rus/docs/Z1300000094",
    mockFetch as typeof fetch,
  );

  assert.equal(result.content_checked, true);
  assert.equal(result.html, sourceHtml);
  assert.equal(result.title, "Закон РК");
  assert.ok(result.text);
  assert.equal(result.text.length, 20_000);
  assert.match(result.text, /Статья 1/);
  assert.doesNotMatch(result.text, /ignore/);
  assert.ok(extractTextFromHtml(sourceHtml).length > 20_000);
});
