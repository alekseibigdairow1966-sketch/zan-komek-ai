import type {
  LegalChunkEmbedder,
  LegalChunkEmbedding,
} from "./embed-legal-act-chunks";
import {
  embedLegalQuery,
  type LegalQueryEmbedding,
} from "./embed-legal-query";
import {
  searchLegalEmbeddingRecords,
  type LegalEmbeddingSearchFilter,
  type LegalEmbeddingSearchResult,
} from "./search-legal-embedding-records";

export interface LegalSemanticRetrievalResult {
  query: LegalQueryEmbedding;
  results: LegalEmbeddingSearchResult[];
}

export async function runLegalSemanticRetrieval(
  input: {
    queryText: string;
    records: LegalChunkEmbedding[];
    model: string;
    dimensions: number;
    topK: number;
    filter?: LegalEmbeddingSearchFilter;
  },
  embedder: LegalChunkEmbedder,
): Promise<LegalSemanticRetrievalResult> {
  const query = await embedLegalQuery(
    {
      queryText: input.queryText,
      model: input.model,
      dimensions: input.dimensions,
    },
    embedder,
  );

  const results = searchLegalEmbeddingRecords({
    queryEmbedding: query.embedding,
    records: input.records,
    topK: input.topK,
    filter: input.filter,
  });

  return {
    query,
    results,
  };
}
