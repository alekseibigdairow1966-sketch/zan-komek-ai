import type { CoreLegalAct } from "./core-legal-acts";
import type { ParsedAdiletArticle } from "./parse-adilet-articles";

export interface LegalActCorpusItem {
  act_id: string;
  act_name: string;
  source_url: string;
  article_number: string;
  article_title?: string;
  article_text: string;
  anchor?: string;
}

export function buildLegalActCorpusItems(input: {
  act: CoreLegalAct;
  sourceUrl: string;
  articles: ParsedAdiletArticle[];
}): LegalActCorpusItem[] {
  const items: LegalActCorpusItem[] = [];

  for (const article of input.articles) {
    if (!article.text.trim()) {
      continue;
    }

    const item: LegalActCorpusItem = {
      act_id: input.act.id,
      act_name: input.act.title,
      source_url: input.sourceUrl,
      article_number: article.number,
      article_text: article.text,
    };

    if (article.title.trim()) {
      item.article_title = article.title;
    }

    if (article.anchor) {
      item.anchor = article.anchor;
    }

    items.push(item);
  }

  return items;
}
