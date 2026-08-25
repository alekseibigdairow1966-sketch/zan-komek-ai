import assert from "node:assert/strict";
import { test } from "node:test";
import { PERSONAL_DATA_LAW_KZ } from "./core-legal-acts";
import type { FetchedOfficialContent } from "./fetch-official-source-content";
import {
  MAX_RESPONSE_BYTES,
  fetchOfficialSourceContent,
} from "./fetch-official-source-content";

const OFFICIAL_URL = PERSONAL_DATA_LAW_KZ.official_url;

/**
 * Target contract of RAG-20B. The third parameter does not exist yet, so the
 * cast lets this RED test express the future call shape while the assertions
 * fail against the current implementation, which ignores any custom limit.
 */
interface FetchOfficialSourceOptions {
  maxResponseBytes?: number;
}

const fetchWithOptions = fetchOfficialSourceContent as unknown as (
  url: string,
  fetchImpl?: typeof fetch,
  options?: FetchOfficialSourceOptions,
) => Promise<FetchedOfficialContent>;

// A real HTTP body arrives in many small network chunks, so the streaming
// branch has to apply the limit across chunk boundaries.
const STREAM_CHUNK_BYTES = 64 * 1024;

const TAIL_ARTICLE = "Статья 999. Заключительные положения";

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Adilet-shaped ASCII-padded document weighing exactly `totalBytes`. The
 * closing article sits at the very end, so its presence proves the whole body
 * was read within the applicable limit.
 */
function createHtmlOfExactBytes(totalBytes: number): string {
  const prefix = `<article>\n  <p><b><a name="z1"></a>Статья 1. Общие положения</b></p>\n  <p>`;
  const suffix = `</p>\n  <p><b><a name="z999"></a>${TAIL_ARTICLE}</b></p>\n  <p>1. Хвостовая статья.</p>\n</article>`;
  const fillerBytes = totalBytes - byteLength(prefix) - byteLength(suffix);

  assert.ok(
    fillerBytes >= 0,
    `requested size ${totalBytes} is smaller than the fixture frame`,
  );

  return prefix + "a".repeat(fillerBytes) + suffix;
}

/** Response backed by a ReadableStream, like a real fetch response. */
function createStreamingResponse(html: string): Response {
  const bytes = new TextEncoder().encode(html);
  let offset = 0;

  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }

      const end = Math.min(offset + STREAM_CHUNK_BYTES, bytes.byteLength);

      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
  });

  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}

/** Response without a body, forcing the response.text() fallback branch. */
function createBodylessResponse(html: string): Response {
  return {
    ok: true,
    status: 200,
    headers: {
      get: () => null,
    },
    text: async () => html,
  } as unknown as Response;
}

function createFetch(
  createResponse: (html: string) => Response,
  html: string,
): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];

  const fetchImpl: typeof fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    calls.push(url);

    return createResponse(html);
  };

  return { fetchImpl, calls };
}

const createStreamingFetch = (html: string) =>
  createFetch(createStreamingResponse, html);

const createBodylessFetch = (html: string) =>
  createFetch(createBodylessResponse, html);

function assertSizeLimitError(result: FetchedOfficialContent): void {
  assert.equal(result.content_checked, false);
  assert.match(
    result.error ?? "",
    /too large|truncat|size limit|превыш|обрез|размер/i,
  );
}

// ─── Default limit stays the runtime boundary ────────────────────────────────

test("the default read limit is still 1_000_000 bytes", () => {
  assert.equal(MAX_RESPONSE_BYTES, 1_000_000);
});

test("without options an oversized response is still rejected", async () => {
  const html = createHtmlOfExactBytes(1_500_000);
  const { fetchImpl, calls } = createStreamingFetch(html);

  const result = await fetchOfficialSourceContent(OFFICIAL_URL, fetchImpl);

  assert.deepEqual(calls, [OFFICIAL_URL]);
  assertSizeLimitError(result);
});

test("an empty options object keeps the default limit", async () => {
  const html = createHtmlOfExactBytes(1_500_000);
  const { fetchImpl } = createStreamingFetch(html);

  const result = await fetchWithOptions(OFFICIAL_URL, fetchImpl, {});

  assertSizeLimitError(result);
});

test("an undefined maxResponseBytes keeps the default limit", async () => {
  const html = createHtmlOfExactBytes(1_500_000);
  const { fetchImpl } = createStreamingFetch(html);

  const result = await fetchWithOptions(OFFICIAL_URL, fetchImpl, {
    maxResponseBytes: undefined,
  });

  assertSizeLimitError(result);
});

test("without options a response below the default limit stays checked", async () => {
  const html = createHtmlOfExactBytes(200_000);
  const { fetchImpl } = createStreamingFetch(html);

  const result = await fetchOfficialSourceContent(OFFICIAL_URL, fetchImpl);

  assert.equal(result.content_checked, true);
  assert.equal(result.html, html);
  assert.equal(result.error, undefined);
});

// ─── Custom limit larger than the default ────────────────────────────────────

test("a custom larger limit accepts a document above the default boundary", async () => {
  const html = createHtmlOfExactBytes(1_500_000);

  assert.ok(byteLength(html) > MAX_RESPONSE_BYTES);

  const { fetchImpl, calls } = createStreamingFetch(html);

  const result = await fetchWithOptions(OFFICIAL_URL, fetchImpl, {
    maxResponseBytes: 2_000_000,
  });

  assert.deepEqual(calls, [OFFICIAL_URL]);
  assert.equal(result.content_checked, true);
  assert.equal(result.html, html);
  assert.equal(result.error, undefined);
  assert.equal(result.final_url, OFFICIAL_URL);
});

test("the closing article past the default limit survives a custom larger limit", async () => {
  const html = createHtmlOfExactBytes(1_500_000);
  const { fetchImpl } = createStreamingFetch(html);

  const result = await fetchWithOptions(OFFICIAL_URL, fetchImpl, {
    maxResponseBytes: 2_000_000,
  });

  assert.equal(result.content_checked, true);
  assert.ok(result.html?.includes(TAIL_ARTICLE));
  assert.match(result.text ?? "", /Статья 1\. Общие положения/);
});

// ─── Custom limit is still a limit ───────────────────────────────────────────

test("a custom larger limit is still enforced", async () => {
  const html = createHtmlOfExactBytes(2_000_000);
  const { fetchImpl } = createStreamingFetch(html);

  const result = await fetchWithOptions(OFFICIAL_URL, fetchImpl, {
    maxResponseBytes: 1_500_000,
  });

  assertSizeLimitError(result);
  assert.equal(result.html, undefined);
});

test("a custom limit smaller than the default rejects a document the default would accept", async () => {
  const html = createHtmlOfExactBytes(150_000);

  assert.ok(byteLength(html) < MAX_RESPONSE_BYTES);

  const { fetchImpl } = createStreamingFetch(html);

  const result = await fetchWithOptions(OFFICIAL_URL, fetchImpl, {
    maxResponseBytes: 100_000,
  });

  assertSizeLimitError(result);
  assert.equal(result.html, undefined);
});

// ─── Exactly at the custom limit ─────────────────────────────────────────────

test("a complete response exactly at a custom larger limit stays checked", async () => {
  const html = createHtmlOfExactBytes(1_200_000);

  assert.equal(byteLength(html), 1_200_000);

  const { fetchImpl } = createStreamingFetch(html);

  const result = await fetchWithOptions(OFFICIAL_URL, fetchImpl, {
    maxResponseBytes: 1_200_000,
  });

  assert.equal(result.content_checked, true);
  assert.equal(result.html, html);
  assert.equal(result.error, undefined);
});

test("a complete response exactly at a custom smaller limit stays checked", async () => {
  const html = createHtmlOfExactBytes(100_000);

  assert.equal(byteLength(html), 100_000);

  const { fetchImpl } = createStreamingFetch(html);

  const result = await fetchWithOptions(OFFICIAL_URL, fetchImpl, {
    maxResponseBytes: 100_000,
  });

  assert.equal(result.content_checked, true);
  assert.equal(result.html, html);
  assert.equal(result.error, undefined);
});

// ─── Fallback branch without response.body ───────────────────────────────────

test("the bodyless fallback branch honours a custom larger limit", async () => {
  const html = createHtmlOfExactBytes(1_500_000);
  const { fetchImpl } = createBodylessFetch(html);

  const result = await fetchWithOptions(OFFICIAL_URL, fetchImpl, {
    maxResponseBytes: 2_000_000,
  });

  assert.equal(result.content_checked, true);
  assert.equal(result.html, html);
  assert.ok(result.html?.includes(TAIL_ARTICLE));
});

test("the bodyless fallback branch enforces a custom smaller limit", async () => {
  const html = createHtmlOfExactBytes(150_000);
  const { fetchImpl } = createBodylessFetch(html);

  const result = await fetchWithOptions(OFFICIAL_URL, fetchImpl, {
    maxResponseBytes: 100_000,
  });

  assertSizeLimitError(result);
  assert.equal(result.html, undefined);
});

test("the bodyless fallback branch keeps the default limit without options", async () => {
  const html = createHtmlOfExactBytes(1_500_000);
  const { fetchImpl } = createBodylessFetch(html);

  const result = await fetchOfficialSourceContent(OFFICIAL_URL, fetchImpl);

  assertSizeLimitError(result);
});

// ─── Invalid maxResponseBytes ────────────────────────────────────────────────

interface InvalidLimitOutcome {
  fetchCalled: boolean;
  message: string;
  contentChecked?: boolean;
}

/**
 * An invalid limit must fail before any request is issued. Whether that failure
 * surfaces as a rejection or as a failed FetchedOfficialContent is left to
 * GREEN, so both shapes are collected and asserted on the same invariants.
 */
async function runWithInvalidLimit(
  maxResponseBytes: number,
): Promise<InvalidLimitOutcome> {
  let fetchCalled = false;

  const fetchImpl: typeof fetch = async () => {
    fetchCalled = true;
    return createStreamingResponse(createHtmlOfExactBytes(10_000));
  };

  try {
    const result = await fetchWithOptions(OFFICIAL_URL, fetchImpl, {
      maxResponseBytes,
    });

    return {
      fetchCalled,
      message: result.error ?? "",
      contentChecked: result.content_checked,
    };
  } catch (error) {
    return {
      fetchCalled,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

const INVALID_LIMITS: Array<{ label: string; value: number }> = [
  { label: "zero", value: 0 },
  { label: "negative", value: -1 },
  { label: "NaN", value: Number.NaN },
  { label: "Infinity", value: Number.POSITIVE_INFINITY },
  { label: "fractional", value: 1.5 },
];

for (const { label, value } of INVALID_LIMITS) {
  test(`a ${label} maxResponseBytes fails before any network call`, async () => {
    const outcome = await runWithInvalidLimit(value);

    assert.equal(
      outcome.fetchCalled,
      false,
      "an invalid maxResponseBytes must be rejected before fetching",
    );
    assert.notEqual(
      outcome.contentChecked,
      true,
      "an invalid maxResponseBytes must never produce a checked result",
    );
    assert.match(outcome.message, /maxResponseBytes/);
  });
}

test("an invalid maxResponseBytes does not silently fall back to the default", async () => {
  let fetchCalled = false;

  const fetchImpl: typeof fetch = async () => {
    fetchCalled = true;
    return createStreamingResponse(createHtmlOfExactBytes(10_000));
  };

  const outcome = await fetchWithOptions(OFFICIAL_URL, fetchImpl, {
    maxResponseBytes: 0,
  }).catch((error: unknown) => error as FetchedOfficialContent | Error);

  assert.equal(fetchCalled, false);
  assert.equal(
    outcome instanceof Error ? false : outcome.content_checked,
    false,
  );
});
