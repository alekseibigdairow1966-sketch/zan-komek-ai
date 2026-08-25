import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLegalCorpusFromOfficialSources } from "./build-legal-corpus-from-official-sources";
import { PERSONAL_DATA_LAW_KZ } from "./core-legal-acts";
import {
  MAX_RESPONSE_BYTES,
  fetchOfficialSourceContent,
} from "./fetch-official-source-content";

/**
 * Future offline corpus-generation limit chosen from RAG-20D measurements.
 * Largest live CORE document was entrepreneurial-code-kz at 1_766_612 bytes.
 * 2_500_000 leaves 733_388 bytes (~41.5%) of headroom.
 *
 * This constant lives only in the test. GREEN must wire the same value into
 * the offline builder call, not into the global runtime default.
 */
const OFFLINE_CORPUS_MAX_RESPONSE_BYTES = 2_500_000;

const INSIDE_OFFLINE_LIMIT_BYTES = 1_500_000;
const ABOVE_OFFLINE_LIMIT_BYTES = 2_600_000;

const STREAM_CHUNK_BYTES = 64 * 1024;

const TAIL_ARTICLE_TITLE = "Условия сбора и обработки персональных данных";
const TAIL_ARTICLE_TEXT =
  "Сбор, обработка персональных данных осуществляются с согласия субъекта.";

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Adilet-shaped ASCII-padded HTML of an exact UTF-8 byte length.
 * Article 7 sits after the filler so its presence in the corpus proves the
 * whole body was read, not silently truncated at the runtime 1 MB default.
 */
function createAdiletHtmlOfExactBytes(totalBytes: number): string {
  const prefix = `<article>
  <p><b><a name="z1"></a>Статья 1. Общие положения</b></p>
  <p>`;
  const suffix = `</p>
  <p><b><a name="z7"></a>Статья 7. ${TAIL_ARTICLE_TITLE}</b></p>
  <p>1. ${TAIL_ARTICLE_TEXT}</p>
</article>`;
  const fillerBytes = totalBytes - byteLength(prefix) - byteLength(suffix);

  assert.ok(
    fillerBytes >= 0,
    `requested size ${totalBytes} is smaller than the fixture frame`,
  );

  return prefix + "a".repeat(fillerBytes) + suffix;
}

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

function createStreamingFetch(html: string): {
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
    return createStreamingResponse(html);
  };

  return { fetchImpl, calls };
}

test("the runtime default size limit remains 1_000_000 bytes", () => {
  assert.equal(MAX_RESPONSE_BYTES, 1_000_000);
  assert.equal(OFFLINE_CORPUS_MAX_RESPONSE_BYTES, 2_500_000);
  assert.ok(OFFLINE_CORPUS_MAX_RESPONSE_BYTES > MAX_RESPONSE_BYTES);
});

test("the synthetic fixtures sit on the intended side of each limit", () => {
  const insideOffline = createAdiletHtmlOfExactBytes(INSIDE_OFFLINE_LIMIT_BYTES);
  const exactOffline = createAdiletHtmlOfExactBytes(
    OFFLINE_CORPUS_MAX_RESPONSE_BYTES,
  );
  const aboveOffline = createAdiletHtmlOfExactBytes(ABOVE_OFFLINE_LIMIT_BYTES);

  assert.equal(byteLength(insideOffline), INSIDE_OFFLINE_LIMIT_BYTES);
  assert.equal(byteLength(exactOffline), OFFLINE_CORPUS_MAX_RESPONSE_BYTES);
  assert.equal(byteLength(aboveOffline), ABOVE_OFFLINE_LIMIT_BYTES);

  assert.ok(byteLength(insideOffline) > MAX_RESPONSE_BYTES);
  assert.ok(byteLength(insideOffline) < OFFLINE_CORPUS_MAX_RESPONSE_BYTES);
  assert.ok(byteLength(aboveOffline) > OFFLINE_CORPUS_MAX_RESPONSE_BYTES);
});

test("the default fetch path still rejects a 1.5 MB official response", async () => {
  const html = createAdiletHtmlOfExactBytes(INSIDE_OFFLINE_LIMIT_BYTES);
  const { fetchImpl } = createStreamingFetch(html);

  const result = await fetchOfficialSourceContent(
    PERSONAL_DATA_LAW_KZ.official_url,
    fetchImpl,
  );

  assert.equal(result.content_checked, false);
  assert.match(
    result.error ?? "",
    /too large|truncat|size limit|превыш|обрез|размер/i,
  );
});

test("buildLegalCorpusFromOfficialSources accepts a document above the runtime default", async () => {
  const html = createAdiletHtmlOfExactBytes(INSIDE_OFFLINE_LIMIT_BYTES);
  const { fetchImpl, calls } = createStreamingFetch(html);

  const corpus = await buildLegalCorpusFromOfficialSources(
    { acts: [PERSONAL_DATA_LAW_KZ] },
    fetchImpl,
  );

  assert.deepEqual(calls, [PERSONAL_DATA_LAW_KZ.official_url]);
  assert.ok(corpus.length >= 2);

  const article7 = corpus.find((item) => item.article_number === "7");

  assert.ok(article7);
  assert.equal(article7.act_id, PERSONAL_DATA_LAW_KZ.id);
  assert.equal(article7.act_name, PERSONAL_DATA_LAW_KZ.title);
  assert.equal(article7.source_url, PERSONAL_DATA_LAW_KZ.official_url);
  assert.equal(article7.article_title, TAIL_ARTICLE_TITLE);
  assert.match(article7.article_text, /согласия субъекта/);
  assert.equal(
    "source_confirmed" in article7 ||
      "search_confirmed" in article7 ||
      "content_checked" in article7 ||
      "verification_status" in article7 ||
      "retrieval_score" in article7,
    false,
  );
});

test("buildLegalCorpusFromOfficialSources rejects a document above the offline limit", async () => {
  const html = createAdiletHtmlOfExactBytes(ABOVE_OFFLINE_LIMIT_BYTES);
  const { fetchImpl } = createStreamingFetch(html);

  await assert.rejects(
    () =>
      buildLegalCorpusFromOfficialSources(
        { acts: [PERSONAL_DATA_LAW_KZ] },
        fetchImpl,
      ),
    /too large|truncat|size limit|превыш|обрез|размер/i,
  );
});

test("buildLegalCorpusFromOfficialSources accepts a complete response exactly at the offline limit", async () => {
  const html = createAdiletHtmlOfExactBytes(OFFLINE_CORPUS_MAX_RESPONSE_BYTES);

  assert.equal(byteLength(html), OFFLINE_CORPUS_MAX_RESPONSE_BYTES);

  const { fetchImpl } = createStreamingFetch(html);

  const corpus = await buildLegalCorpusFromOfficialSources(
    { acts: [PERSONAL_DATA_LAW_KZ] },
    fetchImpl,
  );

  const article7 = corpus.find((item) => item.article_number === "7");

  assert.ok(article7);
  assert.equal(article7.article_title, TAIL_ARTICLE_TITLE);
  assert.match(article7.article_text, /согласия субъекта/);
});
