import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAdiletArticles } from "./parse-adilet-articles";

/**
 * Минимальная HTML-фикстура, воспроизводящая фактическую разметку Adilet:
 * <article>, заголовки статей с name-якорями, пункты <p id="z...">,
 * сноски class="note", примечания ИЗПИ и заголовки глав <h3>.
 */
const ADILET_ARTICLE_FIXTURE = `
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

function findArticle(html: string, number: string) {
  return parseAdiletArticles(html).articles.find(
    (article) => article.number === number,
  );
}

test("parseAdiletArticles returns articles in document order", () => {
  const { articles } = parseAdiletArticles(ADILET_ARTICLE_FIXTURE);

  assert.deepEqual(
    articles.map((article) => article.number),
    ["7", "8", "8-1", "8-2"],
  );
});

test("parseAdiletArticles extracts article number, title and anchor", () => {
  const article7 = findArticle(ADILET_ARTICLE_FIXTURE, "7");

  assert.ok(article7);
  assert.equal(article7.number, "7");
  assert.equal(
    article7.title,
    "Условия сбора и обработки персональных данных",
  );
  assert.equal(article7.anchor, "#z17");
});

test("parseAdiletArticles keeps paragraph text inside the article body", () => {
  const article7 = findArticle(ADILET_ARTICLE_FIXTURE, "7");

  assert.ok(article7);
  assert.match(article7.text, /1\.\s*Сбор, обработка персональных данных/);
  assert.match(article7.text, /2\.\s*Распространение персональных данных/);
  assert.match(
    article7.text,
    /7\.\s*Особенности сбора в электронных ресурсах/,
  );
});

test("parseAdiletArticles does not attach chapter headings to article text", () => {
  const article7 = findArticle(ADILET_ARTICLE_FIXTURE, "7");

  assert.ok(article7);
  assert.doesNotMatch(article7.text, /Глава 2/);
  assert.doesNotMatch(article7.text, /СБОР И ОБРАБОТКА ПЕРСОНАЛЬНЫХ ДАННЫХ/);
});

test("parseAdiletArticles excludes IzPI red font notes from article text", () => {
  const article7 = findArticle(ADILET_ARTICLE_FIXTURE, "7");
  const article8 = findArticle(ADILET_ARTICLE_FIXTURE, "8");

  assert.ok(article7);
  assert.ok(article8);
  assert.doesNotMatch(article7.text, /Примечание ИЗПИ!/);
  assert.doesNotMatch(article8.text, /Примечание ИЗПИ!/);
});

test("parseAdiletArticles excludes footnote elements with class note from article text", () => {
  const article7 = findArticle(ADILET_ARTICLE_FIXTURE, "7");
  const article8 = findArticle(ADILET_ARTICLE_FIXTURE, "8");

  assert.ok(article7);
  assert.ok(article8);
  assert.doesNotMatch(
    article7.text,
    /Сноска\. Заголовок статьи 7 с изменением/,
  );
  assert.doesNotMatch(
    article8.text,
    /Сноска\. Статья 8 с изменениями/,
  );
});

test("parseAdiletArticles isolates article 8 body from the next article", () => {
  const article8 = findArticle(ADILET_ARTICLE_FIXTURE, "8");

  assert.ok(article8);
  assert.equal(article8.anchor, "#z18");
  assert.match(article8.text, /1\.\s*Субъект дает согласие/);
  assert.doesNotMatch(article8.text, /Статья 8-1/);
  assert.doesNotMatch(article8.text, /Государственный сервис/);
});

test("parseAdiletArticles parses compound article numbers", () => {
  const article81 = findArticle(ADILET_ARTICLE_FIXTURE, "8-1");
  const article82 = findArticle(ADILET_ARTICLE_FIXTURE, "8-2");

  assert.ok(article81);
  assert.ok(article82);
  assert.equal(article81.number, "8-1");
  assert.equal(article81.title, "Государственный сервис");
  assert.equal(article81.anchor, "#z371");
  assert.match(article81.text, /1\.\s*Государственный сервис обеспечивает/);

  assert.equal(article82.number, "8-2");
  assert.equal(article82.title, "Негосударственный сервис");
  assert.equal(article82.anchor, "#z382");
  assert.match(article82.text, /1\.\s*Негосударственный сервис применяется/);
  assert.doesNotMatch(article82.text, /Статья 8\./);
});

test("parseAdiletArticles returns empty articles for HTML without article headers", () => {
  const result = parseAdiletArticles(
    "<article><p>Текст без заголовков статей</p></article>",
  );

  assert.deepEqual(result.articles, []);
});

test("parseAdiletArticles returns empty articles for empty input", () => {
  assert.deepEqual(parseAdiletArticles("").articles, []);
  assert.deepEqual(parseAdiletArticles("   ").articles, []);
});
