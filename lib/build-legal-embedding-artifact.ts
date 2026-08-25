import type { LegalChunkStrategy } from "./chunk-legal-act-corpus";
import type { LegalChunkEmbedding } from "./embed-legal-act-chunks";

export interface LegalEmbeddingManifest {
  artifact_version: string;
  corpus_version: string;
  created_at: string;
  embedding_model: string;
  embedding_dimensions: number;
  chunk_strategy: LegalChunkStrategy;
  chunk_size?: number;
  chunk_overlap?: number;
  record_count: number;
  source_acts: Array<{
    act_id: string;
    act_name: string;
    source_url: string;
    article_count: number;
  }>;
}

export interface LegalEmbeddingArtifact {
  manifest: LegalEmbeddingManifest;
  records: LegalChunkEmbedding[];
}

interface SourceActAccumulator {
  act_id: string;
  act_name: string;
  source_url: string;
  articleNumbers: Set<string>;
}

export function buildLegalEmbeddingArtifact(input: {
  records: LegalChunkEmbedding[];
  artifactVersion: string;
  corpusVersion: string;
  createdAt: string;
  chunkStrategy: LegalChunkStrategy;
  chunkSize?: number;
  chunkOverlap?: number;
}): LegalEmbeddingArtifact {
  const [firstRecord] = input.records;

  if (!firstRecord) {
    throw new Error("Cannot build embedding artifact from empty records");
  }

  const embeddingModel = firstRecord.embedding_model;
  const embeddingDimensions = firstRecord.embedding_dimensions;
  const actsById = new Map<string, SourceActAccumulator>();

  for (const record of input.records) {
    if (record.embedding_model !== embeddingModel) {
      throw new Error(
        `Embedding model mismatch in artifact records: expected ${embeddingModel}, found ${record.embedding_model}`,
      );
    }

    if (record.embedding_dimensions !== embeddingDimensions) {
      throw new Error(
        `Embedding dimensions mismatch in artifact records: expected ${embeddingDimensions}, found ${record.embedding_dimensions}`,
      );
    }

    const act = actsById.get(record.act_id);

    if (act) {
      act.articleNumbers.add(record.article_number);
      continue;
    }

    actsById.set(record.act_id, {
      act_id: record.act_id,
      act_name: record.act_name,
      source_url: record.source_url,
      articleNumbers: new Set([record.article_number]),
    });
  }

  const manifest: LegalEmbeddingManifest = {
    artifact_version: input.artifactVersion,
    corpus_version: input.corpusVersion,
    created_at: input.createdAt,
    embedding_model: embeddingModel,
    embedding_dimensions: embeddingDimensions,
    chunk_strategy: input.chunkStrategy,
    record_count: input.records.length,
    source_acts: [...actsById.values()].map((act) => ({
      act_id: act.act_id,
      act_name: act.act_name,
      source_url: act.source_url,
      article_count: act.articleNumbers.size,
    })),
  };

  if (input.chunkSize !== undefined) {
    manifest.chunk_size = input.chunkSize;
  }

  if (input.chunkOverlap !== undefined) {
    manifest.chunk_overlap = input.chunkOverlap;
  }

  return {
    manifest,
    records: input.records,
  };
}
