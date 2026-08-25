import { readFile } from "node:fs/promises";
import type { LegalEmbeddingArtifact } from "./build-legal-embedding-artifact";
import { parseLegalEmbeddingArtifact } from "./parse-legal-embedding-artifact";

export async function readLegalEmbeddingArtifact(input: {
  inputPath: string;
}): Promise<LegalEmbeddingArtifact> {
  const contents = await readFile(input.inputPath, "utf8");

  return parseLegalEmbeddingArtifact(contents);
}
