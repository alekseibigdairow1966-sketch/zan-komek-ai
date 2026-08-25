import { cosineSimilarity } from "./cosine-similarity";
import type { LegalChunkEmbedding } from "./embed-legal-act-chunks";

export interface LegalEmbeddingSearchFilter {
  actIds?: string[];
  articleNumbers?: string[];
}

export interface LegalEmbeddingSearchResult {
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
  retrieval_score: number;
}

interface ScoredSearchResult {
  result: LegalEmbeddingSearchResult;
  originalIndex: number;
}

export function searchLegalEmbeddingRecords(input: {
  queryEmbedding: number[];
  records: LegalChunkEmbedding[];
  topK: number;
  filter?: LegalEmbeddingSearchFilter;
}): LegalEmbeddingSearchResult[] {
  if (input.topK <= 0) {
    throw new Error(`topK must be greater than 0, received ${input.topK}`);
  }

  const filteredRecords = input.records.filter((record) => {
    const filter = input.filter;

    if (!filter) {
      return true;
    }

    if (filter.actIds !== undefined && !filter.actIds.includes(record.act_id)) {
      return false;
    }

    if (
      filter.articleNumbers !== undefined &&
      !filter.articleNumbers.includes(record.article_number)
    ) {
      return false;
    }

    return true;
  });

  if (filteredRecords.length === 0) {
    return [];
  }

  const scored: ScoredSearchResult[] = filteredRecords.map(
    (record, originalIndex) => {
      const result: LegalEmbeddingSearchResult = {
        chunk_id: record.chunk_id,
        act_id: record.act_id,
        act_name: record.act_name,
        article_number: record.article_number,
        source_url: record.source_url,
        chunk_text: record.chunk_text,
        chunk_index: record.chunk_index,
        chunk_total: record.chunk_total,
        retrieval_score: cosineSimilarity(
          input.queryEmbedding,
          record.embedding,
        ),
      };

      if (record.article_title !== undefined) {
        result.article_title = record.article_title;
      }

      if (record.anchor !== undefined) {
        result.anchor = record.anchor;
      }

      return { result, originalIndex };
    },
  );

  scored.sort((left, right) => {
    if (left.result.retrieval_score !== right.result.retrieval_score) {
      return right.result.retrieval_score - left.result.retrieval_score;
    }

    return left.originalIndex - right.originalIndex;
  });

  return scored
    .slice(0, Math.min(input.topK, filteredRecords.length))
    .map((entry) => entry.result);
}
