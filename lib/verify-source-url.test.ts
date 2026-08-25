import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyLegalSourceUrl, validateHttpsUrl } from "./verify-source-url";

test("official URL on adilet.zan.kz is marked official", () => {
  const result = verifyLegalSourceUrl({
    url: "https://adilet.zan.kz/rus/docs/Z1300000094",
    modelVerificationStatus: "unverified",
  });

  assert.equal(result.verification_status, "official");
  assert.equal(result.source_domain, "adilet.zan.kz");
  assert.equal(
    result.url,
    "https://adilet.zan.kz/rus/docs/Z1300000094",
  );
});

test("official URL on gov.kz subdomain is marked official", () => {
  const result = verifyLegalSourceUrl({
    url: "https://www.gov.kz/memleket/entities/example",
    modelVerificationStatus: "official",
  });

  assert.equal(result.verification_status, "official");
  assert.equal(result.source_domain, "gov.kz");
});

test("commercial domain is marked unverified and URL is not exposed", () => {
  const result = verifyLegalSourceUrl({
    url: "https://example.com/law",
    modelVerificationStatus: "official",
  });

  assert.equal(result.verification_status, "unverified");
  assert.equal(result.source_domain, "example.com");
  assert.equal(result.url, null);
});

test("law blog domain is marked unverified", () => {
  const result = verifyLegalSourceUrl({
    url: "https://some-law-blog.kz/article",
    modelVerificationStatus: "official",
  });

  assert.equal(result.verification_status, "unverified");
  assert.equal(result.source_domain, "some-law-blog.kz");
  assert.equal(result.url, null);
});

test("javascript URL is invalid and treated as unverified", () => {
  const validation = validateHttpsUrl("javascript:alert(1)");
  assert.equal(validation.isValid, false);

  const result = verifyLegalSourceUrl({
    url: "javascript:alert(1)",
    modelVerificationStatus: "official",
  });

  assert.equal(result.verification_status, "unverified");
  assert.equal(result.url, null);
});

test("non-url text is invalid", () => {
  const validation = validateHttpsUrl("не ссылка");
  assert.equal(validation.isValid, false);

  const result = verifyLegalSourceUrl({
    url: "не ссылка",
    modelVerificationStatus: "official",
  });

  assert.equal(result.verification_status, "unverified");
  assert.equal(result.url, null);
});

test("model not_found without URL stays not_found", () => {
  const result = verifyLegalSourceUrl({
    url: null,
    modelVerificationStatus: "not_found",
  });

  assert.equal(result.verification_status, "not_found");
  assert.equal(result.url, null);
  assert.equal(result.source_domain, null);
});

test("missing URL without not_found is unverified", () => {
  const result = verifyLegalSourceUrl({
    url: null,
    modelVerificationStatus: "official",
  });

  assert.equal(result.verification_status, "unverified");
});
