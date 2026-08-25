import type { CoreLegalAct } from "./core-legal-acts";
import {
  buildLegalActCorpusItems,
  type LegalActCorpusItem,
} from "./build-legal-act-corpus";
import { parseAdiletArticles } from "./parse-adilet-articles";

export function buildLegalActCorpusFromHtml(input: {
  act: CoreLegalAct;
  sourceUrl: string;
  html: string;
}): LegalActCorpusItem[] {
  return buildLegalActCorpusItems({
    act: input.act,
    sourceUrl: input.sourceUrl,
    articles: parseAdiletArticles(input.html).articles,
  });
}
