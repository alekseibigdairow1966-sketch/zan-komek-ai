import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAdiletArticles } from "./parse-adilet-articles";

/**
 * RAG-20L RED.
 *
 * Живой аудит корпуса (RAG-20K, 1999 статей, 7 НПА) показал, что ровно
 * последняя статья каждого акта содержит служебный хвост страницы Adilet
 * (~316 символов / 418 UTF-8 байт): текст виджета поиска по странице и
 * содержимое <script> в конце документа.
 *
 * Загрязнены: personal-data-law-kz:31, consumer-protection-law-kz:44,
 * labour-code-kz:204, civil-code-general-kz:405, civil-code-special-kz:1124,
 * entrepreneurial-code-kz:324, administrative-procedure-code-kz:175.
 *
 * Причина в parseAdiletArticles: у последней статьи нет следующего заголовка,
 * поэтому её body берётся до конца HTML, а extractArticleBodyText снимает теги,
 * не удаляя содержимое <script>. Наблюдаемый контракт, который здесь
 * фиксируется: служебный текст страницы не должен попадать в article_text.
 *
 * Фикстуры синтетические и минимальные: заголовок статьи в поддерживаемой
 * разметке, юридический body и представительный служебный хвост.
 */

/** Хвост страницы после последней статьи: виджет поиска и скрипты Adilet. */
const PAGE_WIDGET_TRAILER = `
  <div class="page-search">
    <span>поиск по странице</span>
    <span>Введите строку для поиска</span>
    <span>Совет: в браузере есть встроенный поиск по странице, он работает быстрее. Вызывается чаще всего клавишами ctrl-F.</span>
  </div>
  <script type="text/javascript">
    window.localizedStrings = {
      'Искать': 'Искать',
      'Следующее': 'Следующее',
      'Найдено %d': 'Найдено %d',
      'Ничего не найдено': 'Ничего не найдено'
    };
  </script>
  <script type="text/javascript">
    DD_belatedPNG.fix('img, .png_bg, .sidebar, .sidebar ul, .sidebar ul li, .sidebar ul li a'); //fix any <img> or .png_bg background-images
  </script>
`;

/** Последняя статья в legacy-разметке `<p><b><a name="zN"></a>Статья N. ...`. */
const LEGACY_LAST_ARTICLE_HTML = `
<article>
  <p><b><a name="z30"></a>Статья 30. Ответственность за нарушение законодательства</b></p>
  <p id="z300">1. Нарушение законодательства влечет ответственность, установленную законами Республики Казахстан.</p>
  <p><b><a name="z31"></a>Статья 31. Заключительные положения</b></p>
  <p id="z310">1. Настоящий Закон вводится в действие по истечении десяти календарных дней после дня его первого официального опубликования.</p>
  ${PAGE_WIDGET_TRAILER}
</article>
`.trim();

/** Последняя статья в разметке Гражданского кодекса `<h3 id="zN">Статья N. ...`. */
const H3_LAST_ARTICLE_HTML = `
<article>
  <h3 id="z404"> Статья 404. Односторонний отказ от исполнения договора</h3>
  <p id="z4040">      1. Односторонний отказ от исполнения договора допускается в случаях, предусмотренных законодательными актами.</p>
  <h3 id="z405"> Статья 405. Заключительные положения</h3>
  <p id="z4050">      1. Настоящий Кодекс вводится в действие с 1 марта 1995 года.</p>
  ${PAGE_WIDGET_TRAILER}
</article>
`.trim();

/** Последняя статья с несколькими обычными элементами юридического содержания. */
const LEGAL_CONTENT_BEFORE_TRAILER_HTML = `
<article>
  <p><b><a name="z31"></a>Статья 31. Заключительные положения</b></p>
  <p id="z311">1. Пункт первый заключительных положений о введении в действие.</p>
  <p id="z312">2. Пункт второй заключительных положений о признании утратившими силу.</p>
  <div id="z313">Примечание к порядку введения в действие отдельных пунктов.</div>
  ${PAGE_WIDGET_TRAILER}
</article>
`.trim();

/** Две статьи подряд: обычная граница «до следующего заголовка» плюс хвост. */
const TWO_ARTICLES_WITH_TRAILER_HTML = `
<article>
  <p><b><a name="z1"></a>Статья 1. Основные понятия</b></p>
  <p id="z11">1. В настоящем Законе используются основные понятия.</p>
  <p><b><a name="z2"></a>Статья 2. Законодательство Республики Казахстан</b></p>
  <p id="z21">1. Законодательство основывается на Конституции Республики Казахстан.</p>
  ${PAGE_WIDGET_TRAILER}
</article>
`.trim();

function findArticle(html: string, number: string) {
  return parseAdiletArticles(html).articles.find(
    (article) => article.number === number,
  );
}

function assertNoPageWidgetText(text: string): void {
  assert.doesNotMatch(text, /window\.localizedStrings/);
  assert.doesNotMatch(text, /DD_belatedPNG/);
  assert.doesNotMatch(text, /Вызывается чаще всего клавишами ctrl-F/);
}

test("parseAdiletArticles keeps the page-widget trailer out of the last legacy article", () => {
  const article31 = findArticle(LEGACY_LAST_ARTICLE_HTML, "31");

  assert.ok(article31);
  assert.equal(article31.title, "Заключительные положения");
  assert.match(article31.text, /1\.\s*Настоящий Закон вводится в действие/);

  assertNoPageWidgetText(article31.text);
});

test("parseAdiletArticles keeps the page-widget trailer out of the last h3 article", () => {
  const article405 = findArticle(H3_LAST_ARTICLE_HTML, "405");

  assert.ok(article405);
  assert.equal(article405.title, "Заключительные положения");
  assert.match(article405.text, /1\.\s*Настоящий Кодекс вводится в действие/);

  assertNoPageWidgetText(article405.text);
});

test("parseAdiletArticles preserves legal content before the page-widget trailer", () => {
  const article31 = findArticle(LEGAL_CONTENT_BEFORE_TRAILER_HTML, "31");

  assert.ok(article31);
  assert.match(article31.text, /1\.\s*Пункт первый заключительных положений/);
  assert.match(article31.text, /2\.\s*Пункт второй заключительных положений/);
  assert.match(article31.text, /Примечание к порядку введения в действие/);
});

test("parseAdiletArticles still ends a non-final article at the next article header", () => {
  const article1 = findArticle(TWO_ARTICLES_WITH_TRAILER_HTML, "1");
  const article2 = findArticle(TWO_ARTICLES_WITH_TRAILER_HTML, "2");

  assert.ok(article1);
  assert.ok(article2);

  assert.match(article1.text, /1\.\s*В настоящем Законе используются/);
  assert.doesNotMatch(article1.text, /Статья 2/);
  assert.doesNotMatch(article1.text, /Законодательство основывается на Конституции/);

  // Хвост страницы стоит после последней статьи и не должен доходить до статьи 1;
  // загрязнение самой последней статьи закреплено тестами выше.
  assertNoPageWidgetText(article1.text);

  assert.match(article2.text, /1\.\s*Законодательство основывается на Конституции/);
});
