import type { LegalActCorpusItem } from "./build-legal-act-corpus";

export type LegalChunkStrategy = "article";

export interface LegalActChunk {
  chunk_id: string;
  act_id: string;
  act_name: string;
  article_number: string;
  article_title?: string;
  source_url: string;
  anchor?: string;
  chunk_text: string;
  chunk_index: number;
  chunk_total: number;
}

/** The token counter is injected; the chunker knows no embedding model. */
export type LegalTokenCounter = (text: string) => number;

function buildChunk(
  item: LegalActCorpusItem,
  chunkText: string,
  chunkIndex: number,
  chunkTotal: number,
): LegalActChunk {
  const chunk: LegalActChunk = {
    chunk_id: `${item.act_id}:${item.article_number}:${chunkIndex}`,
    act_id: item.act_id,
    act_name: item.act_name,
    article_number: item.article_number,
    source_url: item.source_url,
    chunk_text: chunkText,
    chunk_index: chunkIndex,
    chunk_total: chunkTotal,
  };

  if (item.article_title !== undefined) {
    chunk.article_title = item.article_title;
  }

  if (item.anchor !== undefined) {
    chunk.anchor = item.anchor;
  }

  return chunk;
}

/**
 * Splits at whitespace boundaries only, so the parts rejoined with a single
 * space give back the article text. Without both a limit and a counter the
 * article stays one chunk, which keeps the existing caller unchanged.
 */
function splitArticleText(
  articleText: string,
  maxTokens: number | undefined,
  countTokens: LegalTokenCounter | undefined,
): string[] {
  if (!countTokens || maxTokens === undefined || maxTokens <= 0) {
    return [articleText];
  }

  if (countTokens(articleText) <= maxTokens) {
    return [articleText];
  }

  const words = articleText.split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return [articleText];
  }

  const parts: string[] = [];
  let start = 0;

  while (start < words.length) {
    // Largest word count that still fits, found without recounting every
    // intermediate prefix. A single word above the limit is emitted alone
    // rather than cut apart.
    let taken = 1;
    let low = 1;
    let high = words.length - start;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);

      if (countTokens(words.slice(start, start + middle).join(" ")) <= maxTokens) {
        taken = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    parts.push(words.slice(start, start + taken).join(" "));
    start += taken;
  }

  return parts;
}

export function chunkLegalActCorpus(input: {
  items: LegalActCorpusItem[];
  strategy: LegalChunkStrategy;
  maxTokens?: number;
  countTokens?: LegalTokenCounter;
}): LegalActChunk[] {
  const chunks: LegalActChunk[] = [];

  for (const item of input.items) {
    const texts = splitArticleText(
      item.article_text,
      input.maxTokens,
      input.countTokens,
    );

    for (const [index, text] of texts.entries()) {
      chunks.push(buildChunk(item, text, index, texts.length));
    }
  }

  return chunks;
}
