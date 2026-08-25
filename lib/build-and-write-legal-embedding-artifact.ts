import type { LegalActCorpusItem } from "./build-legal-act-corpus";
import {
  buildLegalEmbeddingArtifact,
  type LegalEmbeddingArtifact,
} from "./build-legal-embedding-artifact";
import {
  chunkLegalActCorpus,
  type LegalChunkStrategy,
  type LegalTokenCounter,
} from "./chunk-legal-act-corpus";
import {
  embedLegalActChunks,
  type LegalChunkEmbedder,
} from "./embed-legal-act-chunks";
import { writeLegalEmbeddingArtifact } from "./write-legal-embedding-artifact";

export async function buildAndWriteLegalEmbeddingArtifact(
  input: {
    items: LegalActCorpusItem[];
    outputPath: string;
    artifactVersion: string;
    corpusVersion: string;
    createdAt: string;
    chunkStrategy: LegalChunkStrategy;
    chunkSize?: number;
    chunkOverlap?: number;
    /** Per-input limit for splitting; needs countTokens to take effect. */
    chunkMaxTokens?: number;
    /** Aggregate limit for one embedding request; needs countTokens too. */
    batchMaxTokens?: number;
    countTokens?: LegalTokenCounter;
    embeddingModel: string;
    embeddingDimensions: number;
  },
  embedder: LegalChunkEmbedder,
): Promise<{
  artifact: LegalEmbeddingArtifact;
  outputPath: string;
  recordCount: number;
  artifactVersion: string;
  corpusVersion: string;
}> {
  const chunks = chunkLegalActCorpus({
    items: input.items,
    strategy: input.chunkStrategy,
    maxTokens: input.chunkMaxTokens,
    countTokens: input.countTokens,
  });

  const records = await embedLegalActChunks(
    {
      chunks,
      model: input.embeddingModel,
      dimensions: input.embeddingDimensions,
      maxBatchTokens: input.batchMaxTokens,
      countTokens: input.countTokens,
    },
    embedder,
  );

  const artifact = buildLegalEmbeddingArtifact({
    records,
    artifactVersion: input.artifactVersion,
    corpusVersion: input.corpusVersion,
    createdAt: input.createdAt,
    chunkStrategy: input.chunkStrategy,
    chunkSize: input.chunkSize,
    chunkOverlap: input.chunkOverlap,
  });

  const writeResult = await writeLegalEmbeddingArtifact({
    artifact,
    outputPath: input.outputPath,
  });

  return {
    artifact,
    outputPath: writeResult.outputPath,
    recordCount: writeResult.recordCount,
    artifactVersion: writeResult.artifactVersion,
    corpusVersion: writeResult.corpusVersion,
  };
}
