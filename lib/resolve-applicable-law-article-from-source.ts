import { findAdiletArticle } from "./find-adilet-article";
import type { ParsedAdiletArticle } from "./parse-adilet-articles";
import type { ApplicableLaw, LegalSearchResult } from "./types";

export function resolveApplicableLawArticleFromSource(
  law: Pick<ApplicableLaw, "article">,
  source: Pick<LegalSearchResult, "articles">,
): ParsedAdiletArticle | undefined {
  return findAdiletArticle(law.article, source.articles ?? []);
}
