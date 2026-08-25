import type { LegalChunkEmbedder } from "./embed-legal-act-chunks";

export interface LegalQueryEmbedding {
  query_text: string;
  embedding_model: string;
  embedding_dimensions: number;
  embedding: number[];
}

export async function embedLegalQuery(
  input: {
    queryText: string;
    model: string;
    dimensions: number;
  },
  embedder: LegalChunkEmbedder,
): Promise<LegalQueryEmbedding> {
  if (input.queryText.trim().length === 0) {
    throw new Error("Legal query cannot be empty");
  }

  const vectors = await embedder([input.queryText], {
    model: input.model,
    dimensions: input.dimensions,
  });

  if (vectors.length !== 1) {
    throw new Error(
      `Expected exactly one query embedding, received ${vectors.length}`,
    );
  }

  return {
    query_text: input.queryText,
    embedding_model: input.model,
    embedding_dimensions: input.dimensions,
    embedding: vectors[0],
  };
}
