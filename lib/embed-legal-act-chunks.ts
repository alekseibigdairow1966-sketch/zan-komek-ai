import type { LegalActChunk } from "./chunk-legal-act-corpus";

export type LegalChunkEmbedder = (
  texts: string[],
  config: {
    model: string;
    dimensions: number;
  },
) => Promise<number[][]>;

export interface LegalChunkEmbedding {
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
  embedding_model: string;
  embedding_dimensions: number;
  embedding: number[];
}

/** The token counter is injected; this module knows no embedding model. */
export type LegalTokenCounter = (text: string) => number;

/**
 * Groups chunks in their original order so that no request exceeds the batch
 * limit. Runs before the first embedder call, so an impossible chunk is
 * refused instead of being sent: per-input sizing belongs to
 * chunkLegalActCorpus, this layer only sizes the request.
 */
function planBatches(
  chunks: LegalActChunk[],
  maxBatchTokens: number,
  countTokens: LegalTokenCounter,
): LegalActChunk[][] {
  const batches: LegalActChunk[][] = [];
  let batch: LegalActChunk[] = [];
  let batchTokens = 0;

  for (const chunk of chunks) {
    const tokens = countTokens(chunk.chunk_text);

    if (tokens > maxBatchTokens) {
      throw new Error(
        `Chunk ${chunk.chunk_id} needs ${tokens} tokens, above the batch limit of ${maxBatchTokens}`,
      );
    }

    if (batch.length > 0 && batchTokens + tokens > maxBatchTokens) {
      batches.push(batch);
      batch = [];
      batchTokens = 0;
    }

    batch.push(chunk);
    batchTokens += tokens;
  }

  if (batch.length > 0) {
    batches.push(batch);
  }

  return batches;
}

export async function embedLegalActChunks(
  input: {
    chunks: LegalActChunk[];
    model: string;
    dimensions: number;
    maxBatchTokens?: number;
    countTokens?: LegalTokenCounter;
  },
  embedder: LegalChunkEmbedder,
): Promise<LegalChunkEmbedding[]> {
  if (input.chunks.length === 0) {
    return [];
  }

  // Batching needs both the limit and the counter; otherwise the whole array
  // goes in one request, as before.
  const batches =
    input.countTokens && input.maxBatchTokens !== undefined
      ? planBatches(input.chunks, input.maxBatchTokens, input.countTokens)
      : [input.chunks];

  const vectors: number[][] = [];

  for (const batch of batches) {
    const batchVectors = await embedder(
      batch.map((chunk) => chunk.chunk_text),
      {
        model: input.model,
        dimensions: input.dimensions,
      },
    );

    if (batchVectors.length !== batch.length) {
      throw new Error(
        `Embedding count mismatch: expected ${batch.length}, received ${batchVectors.length}`,
      );
    }

    for (const vector of batchVectors) {
      vectors.push(vector);
    }
  }

  return input.chunks.map((chunk, index) => {
    const record: LegalChunkEmbedding = {
      chunk_id: chunk.chunk_id,
      act_id: chunk.act_id,
      act_name: chunk.act_name,
      article_number: chunk.article_number,
      source_url: chunk.source_url,
      chunk_text: chunk.chunk_text,
      chunk_index: chunk.chunk_index,
      chunk_total: chunk.chunk_total,
      embedding_model: input.model,
      embedding_dimensions: input.dimensions,
      embedding: vectors[index],
    };

    if (chunk.article_title !== undefined) {
      record.article_title = chunk.article_title;
    }

    if (chunk.anchor !== undefined) {
      record.anchor = chunk.anchor;
    }

    return record;
  });
}
