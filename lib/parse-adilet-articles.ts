export interface ParsedAdiletArticle {
  number: string;
  title: string;
  text: string;
  anchor?: string;
}

export interface ParseAdiletArticlesResult {
  articles: ParsedAdiletArticle[];
}

const LEGACY_ARTICLE_HEADER_PATTERN =
  /<p>\s*<b>(?:<a\s+name="(z\d+)"\s*><\/a>)?\s*Статья\s+(\d+(?:-\d+)?)\.\s*([\s\S]*?)<\/b>\s*<\/p>/gi;

const H3_ARTICLE_HEADER_PATTERN =
  /<h3\b([^>]*)>\s*Статья\s+(\d+(?:-\d+)?)\.\s*([\s\S]*?)<\/h3>/gi;

/**
 * Служебная часть страницы Adilet (виджет «поиск по странице», боковые блоки,
 * подвал, скрипты) идёт после текста последней статьи. У последней статьи нет
 * следующего заголовка, поэтому её граница определяется по началу первого
 * служебного блока: тега <script>/<style> либо контейнера, помеченного
 * class/id страницы, а не документа.
 */
const PAGE_CHROME_BOUNDARY_PATTERN =
  /<(?:script|style)\b|<[a-z][a-z0-9]*\b[^>]*\b(?:class|id)\s*=\s*"[^"]*(?:search|sidebar|footer|nav|menu|toolbar|print)[^"]*"/i;

/**
 * Уведомление шаблона страницы Adilet, которое стоит после юридического текста
 * последней статьи, но перед служебной областью (RAG-20M: ровно семь items,
 * по одному на акт). В разметке это обычный абзац без устойчивого class/id,
 * поэтому структурная граница его не покрывает и он снимается по точному
 * тексту — только как завершение последней статьи.
 */
const PAGE_ERROR_NOTICE =
  "Если Вы обнаружили на странице ошибку, выделите мышью слово или фразу и нажмите сочетание клавиш Ctrl+Enter";

interface ArticleHeader {
  index: number;
  endIndex: number;
  number: string;
  title: string;
  anchor?: string;
}

function collectLegacyHeaders(html: string): ArticleHeader[] {
  const headers: ArticleHeader[] = [];
  const pattern = new RegExp(
    LEGACY_ARTICLE_HEADER_PATTERN.source,
    LEGACY_ARTICLE_HEADER_PATTERN.flags,
  );

  let match: RegExpExecArray | null = pattern.exec(html);

  while (match) {
    headers.push({
      index: match.index,
      endIndex: match.index + match[0].length,
      anchor: match[1],
      number: match[2],
      title: normalizeWhitespace(stripInlineTags(match[3])),
    });
    match = pattern.exec(html);
  }

  return headers;
}

function headerIdFromAttributes(attributes: string): string | undefined {
  const idMatch = attributes.match(/\bid\s*=\s*"([^"]+)"/i);
  return idMatch?.[1];
}

function collectH3ArticleHeaders(html: string): ArticleHeader[] {
  const headers: ArticleHeader[] = [];
  const pattern = new RegExp(
    H3_ARTICLE_HEADER_PATTERN.source,
    H3_ARTICLE_HEADER_PATTERN.flags,
  );

  let match: RegExpExecArray | null = pattern.exec(html);

  while (match) {
    headers.push({
      index: match.index,
      endIndex: match.index + match[0].length,
      anchor: headerIdFromAttributes(match[1] ?? ""),
      number: match[2],
      title: normalizeWhitespace(stripInlineTags(match[3])),
    });
    match = pattern.exec(html);
  }

  return headers;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripInlineTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function cutTrailingPageChrome(bodyHtml: string): string {
  const boundary = bodyHtml.match(PAGE_CHROME_BOUNDARY_PATTERN);

  if (boundary?.index === undefined) {
    return bodyHtml;
  }

  return bodyHtml.slice(0, boundary.index);
}

function cutTrailingPageNotice(bodyText: string): string {
  if (!bodyText.endsWith(PAGE_ERROR_NOTICE)) {
    return bodyText;
  }

  return bodyText.slice(0, bodyText.length - PAGE_ERROR_NOTICE.length).trim();
}

function extractArticleBodyText(html: string): string {
  let body = html;

  body = body.replace(/<h3\b[^>]*>[\s\S]*?<\/h3>/gi, " ");
  body = body.replace(/<p\b[^>]*\bclass="note"[^>]*>[\s\S]*?<\/p>/gi, " ");
  body = body.replace(/<span\b[^>]*\bclass="note"[^>]*>[\s\S]*?<\/span>/gi, " ");
  body = body.replace(
    /<font\b[^>]*\bcolor\s*=\s*(?:"#FF0000"|'#FF0000'|#FF0000)[^>]*>[\s\S]*?<\/font>/gi,
    " ",
  );
  body = body.replace(/<[^>]+>/g, " ");
  body = body.replace(/&nbsp;/gi, " ");
  body = body.replace(/&[a-z]+;/gi, " ");

  return normalizeWhitespace(body);
}

export function parseAdiletArticles(html: string): ParseAdiletArticlesResult {
  const trimmed = html.trim();

  if (!trimmed) {
    return { articles: [] };
  }

  const headers = [
    ...collectLegacyHeaders(trimmed),
    ...collectH3ArticleHeaders(trimmed),
  ].sort((left, right) => left.index - right.index);

  if (headers.length === 0) {
    return { articles: [] };
  }

  const articles: ParsedAdiletArticle[] = headers.map((header, index) => {
    const nextHeader = headers[index + 1];
    const rawBodyHtml = trimmed.slice(
      header.endIndex,
      nextHeader ? nextHeader.index : trimmed.length,
    );
    // Обычная статья ограничена следующим заголовком; у последней статьи
    // граница — начало служебной части страницы, если она есть, а затем
    // снимается уведомление шаблона страницы, стоящее перед этой границей.
    const isFinalArticle = nextHeader === undefined;
    const bodyHtml = isFinalArticle
      ? cutTrailingPageChrome(rawBodyHtml)
      : rawBodyHtml;
    const bodyText = extractArticleBodyText(bodyHtml);

    const article: ParsedAdiletArticle = {
      number: header.number,
      title: header.title,
      text: isFinalArticle ? cutTrailingPageNotice(bodyText) : bodyText,
    };

    if (header.anchor) {
      article.anchor = `#${header.anchor}`;
    }

    return article;
  });

  return { articles };
}
