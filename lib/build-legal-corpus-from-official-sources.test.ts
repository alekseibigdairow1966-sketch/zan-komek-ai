import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLegalActCorpusFromHtml } from "./build-legal-act-corpus-from-html";
import type { LegalActCorpusItem } from "./build-legal-act-corpus";
import { buildLegalCorpusFromOfficialSources } from "./build-legal-corpus-from-official-sources";
import type { CoreLegalAct } from "./core-legal-acts";

// Local fixtures only: CORE_LEGAL_ACTS stays untouched and these acts are not
// added to production constants at this stage.
const ACT_PERSONAL_DATA: CoreLegalAct = {
  id: "personal-data-law-kz",
  title: "Закон Республики Казахстан «О персональных данных и их защите»",
  aliases: ["О персональных данных и их защите", "Закон о ПДн"],
  legal_area: ["Персональные данные", "Цифровое право"],
  official_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
  official_domain: "adilet.zan.kz",
  keywords: ["персональные данные", "согласие"],
};

const ACT_LABOUR: CoreLegalAct = {
  id: "labour-code-kz",
  title: "Трудовой кодекс Республики Казахстан",
  aliases: ["Трудовой кодекс", "ТК РК"],
  legal_area: ["Трудовое право"],
  official_url: "https://adilet.zan.kz/rus/docs/K1500000414",
  official_domain: "adilet.zan.kz",
  keywords: ["трудовой договор", "увольнение"],
};

const ACT_CIVIL: CoreLegalAct = {
  id: "civil-code-kz",
  title: "Гражданский кодекс Республики Казахстан",
  aliases: ["Гражданский кодекс", "ГК РК"],
  legal_area: ["Гражданское право", "Договорное право"],
  official_url: "https://adilet.zan.kz/rus/docs/K940001000",
  official_domain: "adilet.zan.kz",
  keywords: ["обычай", "сделка"],
};

// Article 1 deliberately has an empty header title, so article_title must be
// omitted for it by the existing corpus mapper.
const HTML_PERSONAL_DATA = `
<article>
  <h3 id="z1">Глава 1. ОБЩИЕ ПОЛОЖЕНИЯ</h3>
  <p><b><a name="z2"></a>Статья 1. </b></p>
  <p id="z3">1. Настоящий Закон регулирует отношения, связанные с "персональными данными".</p>
  <p><b><a name="z17"></a>Статья 7. Условия сбора и обработки персональных данных</b></p>
  <p class="note">Сноска. Заголовок статьи 7 с изменением, внесенным Законом РК.</p>
  <p id="z18">1. Сбор, обработка персональных данных осуществляются с согласия субъекта.</p>
  <p id="z19">2. Субъект даёт согласие "письменно" либо иным способом.</p>
</article>
`.trim();

const HTML_LABOUR = `
<article>
  <h3 id="z10">Глава 3. ТРУДОВЫЕ ОТНОШЕНИЯ</h3>
  <p><b><a name="z100"></a>Статья 10. Трудовое законодательство Республики Казахстан</b></p>
  <p id="z101">1. Трудовое законодательство основывается на Конституции Республики Казахстан.</p>
  <p><b><a name="z520"></a>Статья 52. Расторжение трудового договора по инициативе работодателя</b></p>
  <p id="z521">1. Работодатель вправе расторгнуть трудовой договор.</p>
  <p id="z522">2. Работнику выплачивается "компенсация" в размере средней заработной платы.</p>
</article>
`.trim();

// No <a name> anchor here, so anchor must be omitted for this article.
const HTML_CIVIL = `
<article>
  <p><b>Статья 5. Применение обычаев</b></p>
  <p id="z50">1. Обычаи, в том числе обычаи делового оборота, применяются к гражданским правоотношениям.</p>
</article>
`.trim();

const HTML_BY_URL: Record<string, string> = {
  [ACT_PERSONAL_DATA.official_url]: HTML_PERSONAL_DATA,
  [ACT_LABOUR.official_url]: HTML_LABOUR,
  [ACT_CIVIL.official_url]: HTML_CIVIL,
};

const ALL_ACTS: CoreLegalAct[] = [ACT_PERSONAL_DATA, ACT_LABOUR, ACT_CIVIL];

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

function createRecordingFetch(
  responses: Record<string, string> = HTML_BY_URL,
): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];

  const fetchImpl: typeof fetch = async (input) => {
    const url = resolveRequestUrl(input);

    calls.push(url);

    const html = responses[url];

    if (html === undefined) {
      throw new Error(`Unexpected fetch: ${url}`);
    }

    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  };

  return { fetchImpl, calls };
}

function createStatusFetch(
  statusByUrl: Record<string, number>,
): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];

  const fetchImpl: typeof fetch = async (input) => {
    const url = resolveRequestUrl(input);

    calls.push(url);

    const status = statusByUrl[url];

    if (status !== undefined && status !== 200) {
      return new Response("Not found", { status });
    }

    return new Response(HTML_BY_URL[url] ?? "", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  };

  return { fetchImpl, calls };
}

/** Composes the existing per-act builder directly, as a reference corpus. */
function referenceCorpus(acts: CoreLegalAct[]): LegalActCorpusItem[] {
  return acts.flatMap((act) =>
    buildLegalActCorpusFromHtml({
      act,
      sourceUrl: act.official_url,
      html: HTML_BY_URL[act.official_url],
    }),
  );
}

test("buildLegalCorpusFromOfficialSources returns the corpus items of a single act", async () => {
  const { fetchImpl } = createRecordingFetch();

  const corpus = await buildLegalCorpusFromOfficialSources(
    { acts: [ACT_PERSONAL_DATA] },
    fetchImpl,
  );

  assert.deepEqual(corpus, referenceCorpus([ACT_PERSONAL_DATA]));
  assert.equal(corpus.length, 2);
  assert.deepEqual(
    corpus.map((item) => item.article_number),
    ["1", "7"],
  );
});

test("buildLegalCorpusFromOfficialSources merges several acts into one array", async () => {
  const { fetchImpl } = createRecordingFetch();

  const corpus = await buildLegalCorpusFromOfficialSources(
    { acts: ALL_ACTS },
    fetchImpl,
  );

  assert.equal(Array.isArray(corpus), true);
  assert.equal(corpus.length, 5);
  assert.deepEqual(corpus, referenceCorpus(ALL_ACTS));
});

test("buildLegalCorpusFromOfficialSources preserves the order of acts", async () => {
  const { fetchImpl } = createRecordingFetch();

  const corpus = await buildLegalCorpusFromOfficialSources(
    { acts: ALL_ACTS },
    fetchImpl,
  );

  assert.deepEqual(
    corpus.map((item) => item.act_id),
    [
      "personal-data-law-kz",
      "personal-data-law-kz",
      "labour-code-kz",
      "labour-code-kz",
      "civil-code-kz",
    ],
  );

  const reordered = await buildLegalCorpusFromOfficialSources(
    { acts: [ACT_CIVIL, ACT_LABOUR, ACT_PERSONAL_DATA] },
    createRecordingFetch().fetchImpl,
  );

  assert.deepEqual(
    reordered.map((item) => item.act_id),
    [
      "civil-code-kz",
      "labour-code-kz",
      "labour-code-kz",
      "personal-data-law-kz",
      "personal-data-law-kz",
    ],
  );
});

test("buildLegalCorpusFromOfficialSources preserves article order inside each act", async () => {
  const { fetchImpl } = createRecordingFetch();

  const corpus = await buildLegalCorpusFromOfficialSources(
    { acts: ALL_ACTS },
    fetchImpl,
  );

  assert.deepEqual(
    corpus.map((item) => `${item.act_id}:${item.article_number}`),
    [
      "personal-data-law-kz:1",
      "personal-data-law-kz:7",
      "labour-code-kz:10",
      "labour-code-kz:52",
      "civil-code-kz:5",
    ],
  );
});

test("buildLegalCorpusFromOfficialSources fills every corpus item field", async () => {
  const { fetchImpl } = createRecordingFetch();

  const corpus = await buildLegalCorpusFromOfficialSources(
    { acts: ALL_ACTS },
    fetchImpl,
  );

  for (const item of corpus) {
    assert.equal(typeof item.act_id, "string");
    assert.ok(item.act_id.length > 0);
    assert.equal(typeof item.act_name, "string");
    assert.ok(item.act_name.length > 0);
    assert.equal(typeof item.source_url, "string");
    assert.match(item.source_url, /^https:\/\/adilet\.zan\.kz\//);
    assert.equal(typeof item.article_number, "string");
    assert.ok(item.article_number.length > 0);
    assert.equal(typeof item.article_text, "string");
    assert.ok(item.article_text.trim().length > 0);
  }

  const [firstItem] = corpus;

  assert.equal(firstItem.act_id, ACT_PERSONAL_DATA.id);
  assert.equal(firstItem.act_name, ACT_PERSONAL_DATA.title);
  assert.equal(firstItem.source_url, ACT_PERSONAL_DATA.official_url);
  assert.equal(firstItem.article_number, "1");
  assert.equal(firstItem.anchor, "#z2");
  assert.match(firstItem.article_text, /Настоящий Закон регулирует/);
});

test("buildLegalCorpusFromOfficialSources keeps optional fields only where present", async () => {
  const { fetchImpl } = createRecordingFetch();

  const corpus = await buildLegalCorpusFromOfficialSources(
    { acts: ALL_ACTS },
    fetchImpl,
  );

  // Article 1 has an empty header title, so article_title must be absent.
  assert.deepEqual(Object.keys(corpus[0]).sort(), [
    "act_id",
    "act_name",
    "anchor",
    "article_number",
    "article_text",
    "source_url",
  ]);

  assert.equal(
    corpus[1].article_title,
    "Условия сбора и обработки персональных данных",
  );
  assert.equal(corpus[1].anchor, "#z17");

  // Article 5 has no <a name> anchor, so anchor must be absent.
  assert.deepEqual(Object.keys(corpus[4]).sort(), [
    "act_id",
    "act_name",
    "article_number",
    "article_text",
    "article_title",
    "source_url",
  ]);
  assert.equal(corpus[4].article_title, "Применение обычаев");
});

test("buildLegalCorpusFromOfficialSources uses each act's own official_url as source_url", async () => {
  const { fetchImpl } = createRecordingFetch();

  const corpus = await buildLegalCorpusFromOfficialSources(
    { acts: ALL_ACTS },
    fetchImpl,
  );

  for (const item of corpus) {
    const owningAct = ALL_ACTS.find((act) => act.id === item.act_id);

    assert.ok(owningAct);
    assert.equal(item.source_url, owningAct.official_url);
  }

  assert.deepEqual(
    corpus.map((item) => item.source_url),
    [
      ACT_PERSONAL_DATA.official_url,
      ACT_PERSONAL_DATA.official_url,
      ACT_LABOUR.official_url,
      ACT_LABOUR.official_url,
      ACT_CIVIL.official_url,
    ],
  );
});

test("buildLegalCorpusFromOfficialSources does not mix metadata across acts", async () => {
  const { fetchImpl } = createRecordingFetch();

  const corpus = await buildLegalCorpusFromOfficialSources(
    { acts: ALL_ACTS },
    fetchImpl,
  );

  const labourItems = corpus.filter((item) => item.act_id === "labour-code-kz");
  const civilItems = corpus.filter((item) => item.act_id === "civil-code-kz");

  assert.equal(labourItems.length, 2);
  assert.equal(civilItems.length, 1);

  for (const item of labourItems) {
    assert.equal(item.act_name, ACT_LABOUR.title);
    assert.equal(item.source_url, ACT_LABOUR.official_url);
    assert.doesNotMatch(item.article_text, /персональных данных/);
  }

  for (const item of civilItems) {
    assert.equal(item.act_name, ACT_CIVIL.title);
    assert.equal(item.source_url, ACT_CIVIL.official_url);
    assert.doesNotMatch(item.article_text, /Трудовое законодательство/);
  }

  assert.deepEqual(
    [...new Set(corpus.map((item) => item.act_name))],
    [ACT_PERSONAL_DATA.title, ACT_LABOUR.title, ACT_CIVIL.title],
  );
});

test("buildLegalCorpusFromOfficialSources preserves cyrillic text", async () => {
  const { fetchImpl } = createRecordingFetch();

  const corpus = await buildLegalCorpusFromOfficialSources(
    { acts: ALL_ACTS },
    fetchImpl,
  );

  assert.match(corpus[0].act_name, /«О персональных данных и их защите»/);
  assert.match(corpus[1].article_text, /Субъект даёт согласие/);
  assert.equal(corpus[2].act_name, "Трудовой кодекс Республики Казахстан");
  assert.equal(corpus[4].act_name, "Гражданский кодекс Республики Казахстан");
  assert.match(corpus[4].article_text, /обычаи делового оборота/);
});

test("buildLegalCorpusFromOfficialSources keeps quotes and normalizes HTML whitespace", async () => {
  const { fetchImpl } = createRecordingFetch();

  const corpus = await buildLegalCorpusFromOfficialSources(
    { acts: ALL_ACTS },
    fetchImpl,
  );

  assert.match(corpus[0].article_text, /"персональными данными"/);
  assert.match(corpus[1].article_text, /"письменно"/);
  assert.match(corpus[3].article_text, /"компенсация"/);

  // Existing parser behaviour: HTML newlines collapse into single spaces.
  for (const item of corpus) {
    assert.doesNotMatch(item.article_text, /\n/);
    assert.doesNotMatch(item.article_text, /\s{2,}/);
    assert.doesNotMatch(item.article_text, /<[^>]+>/);
  }
});

test("buildLegalCorpusFromOfficialSources requests exactly each act's official_url once", async () => {
  const { fetchImpl, calls } = createRecordingFetch();

  await buildLegalCorpusFromOfficialSources({ acts: ALL_ACTS }, fetchImpl);

  assert.equal(calls.length, ALL_ACTS.length);
  assert.deepEqual(calls, [
    ACT_PERSONAL_DATA.official_url,
    ACT_LABOUR.official_url,
    ACT_CIVIL.official_url,
  ]);
  assert.deepEqual([...new Set(calls)], calls);
});

test("buildLegalCorpusFromOfficialSources requests no other URL", async () => {
  const { fetchImpl, calls } = createRecordingFetch();

  await buildLegalCorpusFromOfficialSources({ acts: [ACT_LABOUR] }, fetchImpl);

  assert.deepEqual(calls, [ACT_LABOUR.official_url]);
  assert.equal(
    calls.some((url) => url.includes("Z1300000094")),
    false,
  );
  assert.equal(
    calls.every((url) => url.startsWith("https://adilet.zan.kz/")),
    true,
  );
});

test("buildLegalCorpusFromOfficialSources returns an empty corpus for no acts", async () => {
  const { fetchImpl, calls } = createRecordingFetch();

  const corpus = await buildLegalCorpusFromOfficialSources(
    { acts: [] },
    fetchImpl,
  );

  assert.deepEqual(corpus, []);
  assert.equal(calls.length, 0);
});

test("buildLegalCorpusFromOfficialSources rejects when official content is not loaded", async () => {
  const { fetchImpl, calls } = createRecordingFetch({});

  await assert.rejects(
    () =>
      buildLegalCorpusFromOfficialSources(
        { acts: [ACT_PERSONAL_DATA] },
        fetchImpl,
      ),
    /Unexpected fetch/,
  );

  assert.deepEqual(calls, [ACT_PERSONAL_DATA.official_url]);
});

test("buildLegalCorpusFromOfficialSources rejects on a non-OK official response", async () => {
  const { fetchImpl } = createStatusFetch({
    [ACT_PERSONAL_DATA.official_url]: 404,
  });

  await assert.rejects(
    () =>
      buildLegalCorpusFromOfficialSources(
        { acts: [ACT_PERSONAL_DATA] },
        fetchImpl,
      ),
    /HTTP 404/,
  );
});

test("buildLegalCorpusFromOfficialSources rejects when the official HTML is missing", async () => {
  const emptyHtmlFetch: typeof fetch = async () =>
    new Response("", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });

  await assert.rejects(() =>
    buildLegalCorpusFromOfficialSources(
      { acts: [ACT_PERSONAL_DATA] },
      emptyHtmlFetch,
    ),
  );
});

test("buildLegalCorpusFromOfficialSources rejects a non-official act URL without fetching", async () => {
  const { fetchImpl, calls } = createRecordingFetch();
  const unofficialAct: CoreLegalAct = {
    ...ACT_CIVIL,
    official_url: "https://bluescreen.kz/civil-code",
  };

  await assert.rejects(() =>
    buildLegalCorpusFromOfficialSources({ acts: [unofficialAct] }, fetchImpl),
  );

  assert.deepEqual(calls, []);
});

test("buildLegalCorpusFromOfficialSources returns no partial corpus when a later act fails", async () => {
  const { fetchImpl, calls } = createStatusFetch({
    [ACT_LABOUR.official_url]: 500,
  });

  await assert.rejects(
    () =>
      buildLegalCorpusFromOfficialSources(
        { acts: [ACT_PERSONAL_DATA, ACT_LABOUR, ACT_CIVIL] },
        fetchImpl,
      ),
    /HTTP 500/,
  );

  // The first act was loaded successfully, yet nothing is returned.
  assert.ok(calls.includes(ACT_PERSONAL_DATA.official_url));
  assert.ok(calls.includes(ACT_LABOUR.official_url));
});

test("buildLegalCorpusFromOfficialSources surfaces a fetch failure through the existing guard", async () => {
  const failingFetch: typeof fetch = async () => {
    throw new Error("Network down");
  };

  // fetchOfficialSourceContent turns a thrown fetch error into
  // content_checked: false plus the message, which then becomes the rejection.
  await assert.rejects(
    () =>
      buildLegalCorpusFromOfficialSources(
        { acts: [ACT_PERSONAL_DATA] },
        failingFetch,
      ),
    /Network down/,
  );
});

test("buildLegalCorpusFromOfficialSources does not mutate the input object", async () => {
  const { fetchImpl } = createRecordingFetch();
  const input = { acts: structuredClone(ALL_ACTS) };
  const snapshot = structuredClone(input);

  await buildLegalCorpusFromOfficialSources(input, fetchImpl);

  assert.deepEqual(input, snapshot);
  assert.deepEqual(Object.keys(input), ["acts"]);
  assert.equal(input.acts.length, 3);
});

test("buildLegalCorpusFromOfficialSources does not mutate the act objects", async () => {
  const { fetchImpl } = createRecordingFetch();
  const acts = structuredClone(ALL_ACTS);
  const snapshot = structuredClone(acts);

  await buildLegalCorpusFromOfficialSources({ acts }, fetchImpl);

  assert.deepEqual(acts, snapshot);
  assert.deepEqual(
    acts.map((act) => act.official_url),
    [
      ACT_PERSONAL_DATA.official_url,
      ACT_LABOUR.official_url,
      ACT_CIVIL.official_url,
    ],
  );
  assert.deepEqual(acts[0].legal_area, ["Персональные данные", "Цифровое право"]);
  assert.deepEqual(acts[0].aliases, ACT_PERSONAL_DATA.aliases);
});

test("buildLegalCorpusFromOfficialSources puts no verification fields on corpus items", async () => {
  const { fetchImpl } = createRecordingFetch();

  const corpus = await buildLegalCorpusFromOfficialSources(
    { acts: ALL_ACTS },
    fetchImpl,
  );

  for (const item of corpus) {
    for (const key of [
      "content_checked",
      "source_confirmed",
      "search_confirmed",
      "verification_status",
      "retrieval_score",
      "html",
      "text",
      "final_url",
    ]) {
      assert.equal(key in item, false);
    }
  }
});
