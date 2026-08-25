import assert from "node:assert/strict";
import { test } from "node:test";
import { PERSONAL_DATA_LAW_KZ } from "./core-legal-acts";
import { buildLegalActCorpusFromHtml } from "./build-legal-act-corpus-from-html";
import { buildLegalActCorpusItems } from "./build-legal-act-corpus";
import { parseAdiletArticles } from "./parse-adilet-articles";

const SOURCE_URL = PERSONAL_DATA_LAW_KZ.official_url;

const ADILET_HTML_FIXTURE = `
<article>
  <h3 id="z12"> Глава 2. СБОР И ОБРАБОТКА ПЕРСОНАЛЬНЫХ ДАННЫХ</h3>
  <p><b><a name="z17"></a>Статья 7. Условия сбора и обработки персональных данных</b></p>
  <p class="note">Сноска. Заголовок статьи 7 с изменением, внесенным Законом РК.</p>
  <p id="z15">1. Сбор, обработка персональных данных осуществляются с согласия субъекта.</p>
  <p id="z16">2. Распространение персональных данных допускается при наличии согласия.</p>
  <font color="#FF0000">Примечание ИЗПИ! В пункт 7 предусматривается изменение.</font>
  <p id="z90">7. Особенности сбора в электронных ресурсах устанавливаются законодательством.</p>
  <p><b><a name="z18"></a>Статья 8. Порядок дачи согласия субъекта</b></p>
  <p id="z19">1. Субъект дает согласие письменно либо иным способом.</p>
  <p id="z20">2. Согласие может быть отозвано субъектом.</p>
  <span class="note">Сноска. Статья 8 с изменениями, внесенными законами РК.</span>
  <p><b><a name="z371"></a>Статья 8-1. Государственный сервис</b></p>
  <p id="z372">1. Государственный сервис обеспечивает взаимодействие с субъектом.</p>
  <p><b><a name="z382"></a>Статья 8-2. Негосударственный сервис</b></p>
  <p id="z383">1. Негосударственный сервис применяется в негосударственных объектах.</p>
</article>
`.trim();

const ADILET_HTML_WITH_EMPTY_ARTICLE = `
<article>
  <p><b><a name="z17"></a>Статья 7. Условия сбора и обработки персональных данных</b></p>
  <p id="z15">1. Сбор, обработка персональных данных осуществляются с согласия субъекта.</p>
  <p><b><a name="z99"></a>Статья 99. Пустая статья</b></p>
  <p class="note">Сноска. Только сноска без текста нормы.</p>
</article>
`.trim();

function expectedCorpusFromHtml(html: string) {
  return buildLegalActCorpusItems({
    act: PERSONAL_DATA_LAW_KZ,
    sourceUrl: SOURCE_URL,
    articles: parseAdiletArticles(html).articles,
  });
}

test("buildLegalActCorpusFromHtml maps Adilet HTML through parseAdiletArticles and buildLegalActCorpusItems", () => {
  const items = buildLegalActCorpusFromHtml({
    act: PERSONAL_DATA_LAW_KZ,
    sourceUrl: SOURCE_URL,
    html: ADILET_HTML_FIXTURE,
  });
  const expected = expectedCorpusFromHtml(ADILET_HTML_FIXTURE);
  const parsedArticles = parseAdiletArticles(ADILET_HTML_FIXTURE).articles;

  assert.ok(parsedArticles.length > 1);
  assert.equal(items.length, expected.length);
  assert.equal(items.length, parsedArticles.length);
  assert.deepEqual(items, expected);

  for (const [index, article] of parsedArticles.entries()) {
    const item = items[index];

    assert.equal(item.act_id, PERSONAL_DATA_LAW_KZ.id);
    assert.equal(item.act_name, PERSONAL_DATA_LAW_KZ.title);
    assert.equal(item.source_url, SOURCE_URL);
    assert.equal(item.article_number, article.number);
    assert.equal(item.article_text, article.text);
    assert.equal(item.article_text.length, article.text.length);

    if (article.anchor) {
      assert.equal(item.anchor, article.anchor);
    }
  }
});

test("buildLegalActCorpusFromHtml omits empty parsed articles", () => {
  const items = buildLegalActCorpusFromHtml({
    act: PERSONAL_DATA_LAW_KZ,
    sourceUrl: SOURCE_URL,
    html: ADILET_HTML_WITH_EMPTY_ARTICLE,
  });
  const expected = expectedCorpusFromHtml(ADILET_HTML_WITH_EMPTY_ARTICLE);
  const parsedArticles = parseAdiletArticles(ADILET_HTML_WITH_EMPTY_ARTICLE)
    .articles;

  assert.ok(parsedArticles.some((article) => article.number === "99"));
  assert.ok(
    parsedArticles.some((article) => article.number === "99" && !article.text.trim()),
  );
  assert.deepEqual(items, expected);
  assert.ok(items.every((item) => item.article_number !== "99"));
  assert.equal(items.length, parsedArticles.filter((article) => article.text.trim()).length);
});
