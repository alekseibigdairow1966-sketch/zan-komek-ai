import type { LegalEmbeddingArtifact } from "./build-legal-embedding-artifact";

export function serializeLegalEmbeddingArtifact(
  artifact: LegalEmbeddingArtifact,
): string {
  return JSON.stringify(artifact);
}
