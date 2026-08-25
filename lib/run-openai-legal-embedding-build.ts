import { countLegalEmbeddingTokens } from "./count-legal-embedding-tokens";
import {
  createOpenAiLegalChunkEmbedder,
  type OpenAiEmbeddingsClient,
} from "./openai-legal-chunk-embedder";
import { runLegalEmbeddingBuild } from "./run-legal-embedding-build";

/**
 * Offline entry point for real artifact generation: turns an OpenAI-compatible
 * client into the embedder the runner expects and supplies the cl100k_base
 * counter. The client is injected, so nothing here reads the environment.
 *
 * Model, dimensions and the token limits stay with runLegalEmbeddingBuild.
 */
export async function runOpenAiLegalEmbeddingBuild(
  input: {
    corpusJsonl: string;
    outputPath: string;
    artifactVersion: string;
    corpusVersion: string;
    createdAt: string;
  },
  client: OpenAiEmbeddingsClient,
): Promise<{
  outputPath: string;
  recordCount: number;
  artifactVersion: string;
  corpusVersion: string;
}> {
  return runLegalEmbeddingBuild(
    {
      corpusJsonl: input.corpusJsonl,
      outputPath: input.outputPath,
      artifactVersion: input.artifactVersion,
      corpusVersion: input.corpusVersion,
      createdAt: input.createdAt,
      countTokens: countLegalEmbeddingTokens,
    },
    createOpenAiLegalChunkEmbedder(client),
  );
}
