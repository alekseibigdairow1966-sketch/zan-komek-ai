import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAdiletArticles } from "./parse-adilet-articles";

/**
 * RAG-20N RED.
 *
 * RAG-20M (live rebuild всех семи CORE НПА) подтвердил, что после исправления
 * RAG-20L в последней статье каждого акта остаётся ещё одна служебная строка
 * страницы Adilet — 107 символов / 188 UTF-8 байт:
 *
 *   «Если Вы обнаружили на странице ошибку, выделите мышью слово или фразу
 *    и нажмите сочетание клавиш Ctrl+Enter»
 *
 * Она есть ровно в семи items (последняя статья каждого акта) и стоит перед
 * первым служебным блоком, по которому cutTrailingPageChrome() определяет
 * границу, поэтому текущий срез до неё не доходит. Наиболее заметно это в
 * civil-code-general-kz:405, где строка занимает ~42% article_text.
 *
 * Здесь фиксируется наблюдаемый контракт: известное уведомление страницы не
 * должно попадать в article_text, при этом юридический текст сохраняется, а
 * обычное упоминание «Ctrl+Enter» не становится глобальной точкой обрезки.
 */

/** Live-строка уведомления в том виде, в каком она пришла из Adilet. */
const CTRL_ENTER_NOTICE =
  "Если Вы обнаружили на странице ошибку, выделите мышью слово или фразу и нажмите сочетание клавиш Ctrl+Enter";

/**
 * Служебная часть страницы, которую RAG-20L уже отсекает. В живом документе
 * уведомление стоит перед ней, поэтому порядок в фикстурах именно такой:
 * юридический текст → уведомление → page chrome.
 */
const PAGE_CHROME_TRAILER = `
  <div class="page-search">
    <span>поиск по странице</span>
    <span>Совет: в браузере есть встроенный поиск по странице, он работает быстрее. Вызывается чаще всего клавишами ctrl-F.</span>
  </div>
  <script type="text/javascript">
    window.localizedStrings = { 'Искать': 'Искать' };
  </script>
  <script type="text/javascript">
    DD_belatedPNG.fix('img, .png_bg, .sidebar'); //fix any <img> or .png_bg background-images
  </script>
`;

/** Уведомление страницы: в живом документе не помечено служебным class/id. */
const CTRL_ENTER_NOTICE_HTML = `
  <p>${CTRL_ENTER_NOTICE}</p>
`;

const LEGACY_LAST_ARTICLE_HTML = `
<article>
  <p><b><a name="z30"></a>Статья 30. Ответственность за нарушение законодательства</b></p>
  <p id="z300">1. Нарушение законодательства влечет ответственность, установленную законами Республики Казахстан.</p>
  <p><b><a name="z31"></a>Статья 31. Заключительные положения</b></p>
  <p id="z310">1. Настоящий Закон вводится в действие по истечении десяти календарных дней после дня его первого официального опубликования.</p>
  <p id="z311">Президент Республики Казахстан Н. НАЗАРБАЕВ</p>
  ${CTRL_ENTER_NOTICE_HTML}
  ${PAGE_CHROME_TRAILER}
</article>
`.trim();

const H3_LAST_ARTICLE_HTML = `
<article>
  <h3 id="z404"> Статья 404. Односторонний отказ от исполнения договора</h3>
  <p id="z4040">      1. Односторонний отказ от исполнения договора допускается в случаях, предусмотренных законодательными актами.</p>
  <h3 id="z405"> Статья 405. Заключительные положения</h3>
  <p id="z4050">      Продление срока действия договора производится по правилам статьи 397 настоящего Кодекса.</p>
  ${CTRL_ENTER_NOTICE_HTML}
  ${PAGE_CHROME_TRAILER}
</article>
`.trim();

const LEGAL_CONTENT_BEFORE_NOTICE_HTML = `
<article>
  <p><b><a name="z31"></a>Статья 31. Заключительные положения</b></p>
  <p id="z311">Пункт 1. Юридическое содержание о введении в действие.</p>
  <p id="z312">Пункт 2. Заключительное юридическое содержание о признании утратившими силу.</p>
  ${CTRL_ENTER_NOTICE_HTML}
  ${PAGE_CHROME_TRAILER}
</article>
`.trim();

/** Обычное упоминание сочетания клавиш внутри непоследней статьи. */
const BARE_CTRL_ENTER_IN_NON_FINAL_HTML = `
<article>
  <p><b><a name="z1"></a>Статья 1. Электронное обращение</b></p>
  <p id="z11">1. Обращение направляется нажатием сочетания клавиш Ctrl+Enter в информационной системе.</p>
  <p id="z12">2. Обращение считается поданным со дня его регистрации в информационной системе.</p>
  <p><b><a name="z2"></a>Статья 2. Порядок рассмотрения обращения</b></p>
  <p id="z21">1. Обращение рассматривается в сроки, установленные законом.</p>
  ${PAGE_CHROME_TRAILER}
</article>
`.trim();

/** Последняя статья без уведомления, но с обычными словами из его формулировки. */
const LEGAL_WORDS_WITHOUT_NOTICE_HTML = `
<article>
  <p><b><a name="z50"></a>Статья 50. Исправление ошибок</b></p>
  <p id="z501">1. Ошибка, допущенная на странице официального документа, исправляется уполномоченным органом.</p>
  <p id="z502">2. Заявитель вправе выделить спорное слово или фразу и направить замечание.</p>
</article>
`.trim();

function findArticle(html: string, number: string) {
  return parseAdiletArticles(html).articles.find(
    (article) => article.number === number,
  );
}

function assertNoPageChromeText(text: string): void {
  assert.doesNotMatch(text, /window\.localizedStrings/);
  assert.doesNotMatch(text, /DD_belatedPNG/);
  assert.doesNotMatch(text, /Вызывается чаще всего клавишами ctrl-F/);
}

test("parseAdiletArticles keeps the Ctrl+Enter page notice out of the last legacy article", () => {
  const article31 = findArticle(LEGACY_LAST_ARTICLE_HTML, "31");

  assert.ok(article31);
  assert.match(article31.text, /1\.\s*Настоящий Закон вводится в действие/);
  assert.match(article31.text, /Президент Республики Казахстан Н\. НАЗАРБАЕВ/);

  assert.doesNotMatch(article31.text, /Если Вы обнаружили на странице ошибку/);
  assertNoPageChromeText(article31.text);
});

test("parseAdiletArticles keeps the Ctrl+Enter page notice out of the last h3 article", () => {
  const article405 = findArticle(H3_LAST_ARTICLE_HTML, "405");

  assert.ok(article405);
  assert.match(
    article405.text,
    /Продление срока действия договора производится по правилам статьи 397/,
  );

  assert.doesNotMatch(article405.text, /Если Вы обнаружили на странице ошибку/);
  assertNoPageChromeText(article405.text);
});

test("parseAdiletArticles preserves legal content standing before the Ctrl+Enter notice", () => {
  const article31 = findArticle(LEGAL_CONTENT_BEFORE_NOTICE_HTML, "31");

  assert.ok(article31);
  assert.match(article31.text, /Пункт 1\.\s*Юридическое содержание/);
  assert.match(article31.text, /Пункт 2\.\s*Заключительное юридическое содержание/);
});

test("parseAdiletArticles does not treat a bare Ctrl+Enter mention as a cut-off", () => {
  const article1 = findArticle(BARE_CTRL_ENTER_IN_NON_FINAL_HTML, "1");
  const article2 = findArticle(BARE_CTRL_ENTER_IN_NON_FINAL_HTML, "2");

  assert.ok(article1);
  assert.ok(article2);

  // Обычное упоминание сочетания клавиш остаётся частью юридического текста,
  // и текст статьи после него не обрезается.
  assert.match(article1.text, /нажатием сочетания клавиш Ctrl\+Enter/);
  assert.match(article1.text, /2\.\s*Обращение считается поданным/);
  assert.doesNotMatch(article1.text, /Статья 2/);

  assert.match(article2.text, /1\.\s*Обращение рассматривается в сроки/);
});

test("parseAdiletArticles keeps legal wording that only shares words with the page notice", () => {
  const article50 = findArticle(LEGAL_WORDS_WITHOUT_NOTICE_HTML, "50");

  assert.ok(article50);
  assert.match(article50.text, /1\.\s*Ошибка, допущенная на странице официального документа/);
  assert.match(article50.text, /2\.\s*Заявитель вправе выделить спорное слово или фразу/);
});
