import type { LegalChunkEmbedder } from "./embed-legal-act-chunks";

export interface OpenAiEmbeddingsClient {
  embeddings: {
    create(params: {
      model: string;
      input: string[];
      dimensions?: number;
    }): Promise<{
      data: Array<{
        index: number;
        embedding: number[];
      }>;
    }>;
  };
}

export function createOpenAiLegalChunkEmbedder(
  client: OpenAiEmbeddingsClient,
): LegalChunkEmbedder {
  return async (texts, config) => {
    const response = await client.embeddings.create({
      model: config.model,
      dimensions: config.dimensions,
      input: texts,
    });

    const vectors: number[][] = [];

    for (const item of response.data) {
      vectors[item.index] = item.embedding;
    }

    return vectors;
  };
}
