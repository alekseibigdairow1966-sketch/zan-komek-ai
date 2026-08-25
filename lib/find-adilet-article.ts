import type { ParsedAdiletArticle } from "./parse-adilet-articles";

const LABELED_ARTICLE_PATTERN = /(?:ст\.?|статья)\s*(\d+(?:-\d+)?)/i;
const BARE_ARTICLE_NUMBER_PATTERN = /^(\d+(?:-\d+)?)$/;

function extractArticleNumber(reference: string): string | undefined {
  const trimmed = reference.trim();

  if (!trimmed) {
    return undefined;
  }

  const labeledMatch = trimmed.match(LABELED_ARTICLE_PATTERN);
  if (labeledMatch) {
    return labeledMatch[1];
  }

  const bareMatch = trimmed.match(BARE_ARTICLE_NUMBER_PATTERN);
  if (bareMatch) {
    return bareMatch[1];
  }

  return undefined;
}

export function findAdiletArticle(
  articleReference: string | undefined,
  articles: ParsedAdiletArticle[],
): ParsedAdiletArticle | undefined {
  if (articleReference === undefined) {
    return undefined;
  }

  const articleNumber = extractArticleNumber(articleReference);

  if (!articleNumber || articles.length === 0) {
    return undefined;
  }

  return articles.find((article) => article.number === articleNumber);
}
