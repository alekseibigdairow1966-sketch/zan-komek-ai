import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLegalCorpusFromOfficialSources } from "./build-legal-corpus-from-official-sources";
import { PERSONAL_DATA_LAW_KZ } from "./core-legal-acts";
import {
  MAX_RESPONSE_BYTES,
  fetchOfficialSourceContent,
} from "./fetch-official-source-content";

const OFFICIAL_URL = PERSONAL_DATA_LAW_KZ.official_url;

// A real HTTP body arrives in many small network chunks, so the reader loop
// stops on a chunk boundary and drops the rest of a large document.
const STREAM_CHUNK_BYTES = 64 * 1024;

const HEAD_HTML = `<article>
  <p><b><a name="z1"></a>Статья 1. Общие положения</b></p>
  <p>1. Настоящий Кодекс регулирует общественные отношения.</p>
`;

const TAIL_HTML = `  <p><b><a name="z999"></a>Статья 999. Заключительные положения</b></p>
  <p>1. Эта статья находится за пределами лимита чтения.</p>
</article>`;

const FILLER_PARAGRAPH = `  <p>${"a".repeat(1_000)}</p>\n`;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Adilet-shaped document whose closing article sits past MAX_RESPONSE_BYTES.
 * The reader loop stops only after the chunk that crosses the limit, so the
 * body has to exceed the limit by more than one chunk, as a real large code
 * does, for the tail to actually be dropped.
 */
function createOversizedAdiletHtml(
  targetFillerBytes: number = MAX_RESPONSE_BYTES * 2,
): string {
  const fillerCount = Math.ceil(targetFillerBytes / byteLength(FILLER_PARAGRAPH));

  return HEAD_HTML + FILLER_PARAGRAPH.repeat(fillerCount) + TAIL_HTML;
}

/** ASCII-only document weighing exactly MAX_RESPONSE_BYTES. */
function createExactLimitHtml(): string {
  const prefix = "<article><p><b>Article 1. General provisions</b></p><p>";
  const suffix = "</p></article>";
  const fillerBytes =
    MAX_RESPONSE_BYTES - byteLength(prefix) - byteLength(suffix);

  return prefix + "a".repeat(fillerBytes) + suffix;
}

function createChunkedResponse(html: string): Response {
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

function createChunkedFetch(html: string): {
  fetchImpl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];

  const fetchImpl: typeof fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    calls.push(url);

    return createChunkedResponse(html);
  };

  return { fetchImpl, calls };
}

test("the oversized fixture really exceeds the current read limit", () => {
  const html = createOversizedAdiletHtml();

  assert.ok(byteLength(html) > MAX_RESPONSE_BYTES);
  assert.ok(STREAM_CHUNK_BYTES < MAX_RESPONSE_BYTES);
  assert.match(html, /Статья 1\. Общие положения/);
  assert.match(html, /Статья 999\. Заключительные положения/);
});

test("fetchOfficialSourceContent does not report an oversized official response as checked", async () => {
  const html = createOversizedAdiletHtml();
  const { fetchImpl, calls } = createChunkedFetch(html);

  const result = await fetchOfficialSourceContent(OFFICIAL_URL, fetchImpl);

  assert.deepEqual(calls, [OFFICIAL_URL]);
  assert.equal(result.content_checked, false);
  assert.ok(result.error);
  assert.match(result.error, /too large|truncat|size limit|превыш|обрез|размер/i);
});

test("fetchOfficialSourceContent never marks a truncated document as checked", async () => {
  const html = createOversizedAdiletHtml();
  const { fetchImpl } = createChunkedFetch(html);

  const result = await fetchOfficialSourceContent(OFFICIAL_URL, fetchImpl);

  assert.equal(
    result.content_checked === true && result.html !== html,
    false,
    "truncated official html must never be reported as content_checked: true",
  );
});

test("the closing article beyond the limit is never silently dropped", async () => {
  const html = createOversizedAdiletHtml();
  const { fetchImpl } = createChunkedFetch(html);

  const result = await fetchOfficialSourceContent(OFFICIAL_URL, fetchImpl);
  const exposedHtml = result.html ?? "";

  assert.equal(
    result.content_checked === true &&
      !exposedHtml.includes("Статья 999. Заключительные положения"),
    false,
    "a document missing its closing article must not be reported as checked",
  );
});

test("a response below the limit is still fully read and reported as checked", async () => {
  const html = `<article>
  <p><b><a name="z17"></a>Статья 7. Условия сбора и обработки персональных данных</b></p>
  <p>1. Сбор, обработка персональных данных осуществляются с согласия субъекта.</p>
</article>`;
  const { fetchImpl } = createChunkedFetch(html);

  const result = await fetchOfficialSourceContent(OFFICIAL_URL, fetchImpl);

  assert.equal(result.content_checked, true);
  assert.equal(result.html, html);
  assert.equal(result.error, undefined);
  assert.equal(result.final_url, OFFICIAL_URL);
  assert.ok(result.text);
  assert.match(result.text, /Сбор, обработка персональных данных/);
});

test("a response exactly at the limit is complete and stays checked", async () => {
  const html = createExactLimitHtml();

  assert.equal(byteLength(html), MAX_RESPONSE_BYTES);

  const { fetchImpl } = createChunkedFetch(html);

  const result = await fetchOfficialSourceContent(OFFICIAL_URL, fetchImpl);

  assert.equal(result.content_checked, true);
  assert.equal(result.html, html);
  assert.equal(result.error, undefined);
});

test("buildLegalCorpusFromOfficialSources rejects an oversized official source", async () => {
  // Offline builder limit is 2_500_000; the fetch-layer fixture (~2 MB) is no
  // longer oversized for corpus generation.
  const html = createOversizedAdiletHtml(2_600_000);
  const { fetchImpl } = createChunkedFetch(html);

  await assert.rejects(() =>
    buildLegalCorpusFromOfficialSources(
      { acts: [PERSONAL_DATA_LAW_KZ] },
      fetchImpl,
    ),
  );
});
