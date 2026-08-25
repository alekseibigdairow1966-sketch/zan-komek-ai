import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAdiletArticles } from "./parse-adilet-articles";

/**
 * Representative ordinary-article markup taken from live Adilet HTML
 * (RAG-20H fragment extraction, 23 Aug 2026):
 *
 *   https://adilet.zan.kz/rus/docs/K940001000_
 *   https://adilet.zan.kz/rus/docs/K990000409_
 *
 * Ordinary Civil Code articles use <h3>, not the personal-data-law shape
 * `<p><b><a name="zN"></a>Статья N. ...</b></p>`.
 */

const GENERAL_ORDINARY_HTML = `
<article>
  <h3 id="z5962"> Раздел 1. Общие положения</h3>
  <h3 id="z8250"> Статья 1. Отношения, регулируемые гражданским законодательством</h3>
  <p id="z61">      1. Гражданским законодательством регулируются товарно-денежные и иные основанные на равенстве участников имущественные отношения, а также связанные с имущественными личные неимущественные отношения.</p>
</article>
`.trim();

const SPECIAL_ORDINARY_HTML = `
<article>
  <h3 id="z1"> Глава 25. Купля-продажа</h3>
  <h3 id="z3"> Статья 406. Договор купли-продажи </h3>
  <p id="z1542">      1. По договору купли-продажи одна сторона (продавец) обязуется передать имущество (товар) в собственность другой стороне (покупателю), а покупатель обязуется принять это имущество и уплатить за него определенную денежную сумму (цену).</p>
</article>
`.trim();

const GENERAL_BOUNDARY_HTML = `
<article>
  <h3 id="z8250"> Статья 1. Отношения, регулируемые гражданским законодательством</h3>
  <p id="z61">      1. Гражданским законодательством регулируются товарно-денежные отношения.</p>
  <h3 id="z855"> Статья 2. Основные начала гражданского законодательства</h3>
  <p id="z71">      1. Гражданское законодательство основывается на признании равенства участников.</p>
</article>
`.trim();

const SUPPORTED_PERSONAL_DATA_SHAPE = `
<article>
  <p><b><a name="z17"></a>Статья 7. Условия сбора и обработки персональных данных</b></p>
  <p id="z15">1. Сбор, обработка персональных данных осуществляются с согласия субъекта.</p>
</article>
`.trim();

const SUPPORTED_HYPHENATED_SHAPE = `
<article>
  <p><b><a name="z8371"></a>Статья 20-1. Восстановление платежеспособности</b></p>
  <p id="z8372">1. Особенности восстановления платежеспособности гражданина.</p>
</article>
`.trim();

function findArticle(html: string, number: string) {
  return parseAdiletArticles(html).articles.find(
    (article) => article.number === number,
  );
}

test("parseAdiletArticles extracts an ordinary Civil Code general-part article from h3 markup", () => {
  const article = findArticle(GENERAL_ORDINARY_HTML, "1");

  assert.ok(
    article,
    "ordinary general-part Статья 1 must be parsed from <h3> markup",
  );
  assert.equal(article.number, "1");
  assert.match(
    article.title,
    /Отношения, регулируемые гражданским законодательством/,
  );
  assert.ok(article.text.trim().length > 0);
  assert.match(article.text, /товарно-денежные/);
});

test("parseAdiletArticles extracts an ordinary Civil Code special-part article from h3 markup", () => {
  const article = findArticle(SPECIAL_ORDINARY_HTML, "406");

  assert.ok(
    article,
    "ordinary special-part Статья 406 must be parsed from <h3> markup",
  );
  assert.equal(article.number, "406");
  assert.match(article.title, /Договор купли-продажи/);
  assert.ok(article.text.trim().length > 0);
  assert.match(article.text, /договору купли-продажи/);
});

test("parseAdiletArticles still parses the existing personal-data <p><b><a name> markup", () => {
  const article = findArticle(SUPPORTED_PERSONAL_DATA_SHAPE, "7");

  assert.ok(article);
  assert.equal(article.number, "7");
  assert.equal(
    article.title,
    "Условия сбора и обработки персональных данных",
  );
  assert.equal(article.anchor, "#z17");
  assert.match(article.text, /с согласия субъекта/);
});

test("parseAdiletArticles keeps Civil Code h3 article bodies on their own side of the next heading", () => {
  const first = findArticle(GENERAL_BOUNDARY_HTML, "1");
  const second = findArticle(GENERAL_BOUNDARY_HTML, "2");

  assert.ok(first, "Статья 1 must be parsed");
  assert.ok(second, "Статья 2 must be parsed");
  assert.match(first.text, /товарно-денежные отношения/);
  assert.doesNotMatch(first.text, /Основные начала/);
  assert.doesNotMatch(first.text, /равенства участников/);
  assert.match(second.text, /равенства участников/);
  assert.doesNotMatch(second.text, /товарно-денежные/);
});

test("parseAdiletArticles still parses hyphenated article numbers in the existing markup", () => {
  const article = findArticle(SUPPORTED_HYPHENATED_SHAPE, "20-1");

  assert.ok(article);
  assert.equal(article.number, "20-1");
  assert.match(article.title, /Восстановление платежеспособности/);
  assert.match(article.text, /Особенности восстановления платежеспособности/);
});
