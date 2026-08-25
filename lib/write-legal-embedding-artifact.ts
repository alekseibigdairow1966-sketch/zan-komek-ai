import { writeFile } from "node:fs/promises";
import type { LegalEmbeddingArtifact } from "./build-legal-embedding-artifact";
import { serializeLegalEmbeddingArtifact } from "./serialize-legal-embedding-artifact";

export async function writeLegalEmbeddingArtifact(input: {
  artifact: LegalEmbeddingArtifact;
  outputPath: string;
}): Promise<{
  outputPath: string;
  recordCount: number;
  artifactVersion: string;
  corpusVersion: string;
}> {
  const contents = serializeLegalEmbeddingArtifact(input.artifact);

  await writeFile(input.outputPath, contents, "utf8");

  return {
    outputPath: input.outputPath,
    recordCount: input.artifact.manifest.record_count,
    artifactVersion: input.artifact.manifest.artifact_version,
    corpusVersion: input.artifact.manifest.corpus_version,
  };
}
