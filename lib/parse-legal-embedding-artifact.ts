import type { LegalEmbeddingArtifact } from "./build-legal-embedding-artifact";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseLegalEmbeddingArtifact(
  serialized: string,
): LegalEmbeddingArtifact {
  const artifact: unknown = JSON.parse(serialized);

  if (!isJsonObject(artifact)) {
    throw new Error("Legal embedding artifact root must be an object");
  }

  const manifest = artifact.manifest;

  if (!isJsonObject(manifest)) {
    throw new Error("Legal embedding artifact manifest must be an object");
  }

  const recordCount = manifest.record_count;
  const embeddingModel = manifest.embedding_model;
  const embeddingDimensions = manifest.embedding_dimensions;

  if (typeof recordCount !== "number") {
    throw new Error("manifest.record_count must be a number");
  }

  if (typeof embeddingModel !== "string") {
    throw new Error("manifest.embedding_model must be a string");
  }

  if (typeof embeddingDimensions !== "number") {
    throw new Error("manifest.embedding_dimensions must be a number");
  }

  const records = artifact.records;

  if (!Array.isArray(records)) {
    throw new Error("Legal embedding artifact records must be an array");
  }

  if (records.length !== recordCount) {
    throw new Error(
      `Artifact record_count mismatch: manifest says ${recordCount}, records contain ${records.length}`,
    );
  }

  for (let index = 0; index < records.length; index += 1) {
    const record: unknown = records[index];

    if (!isJsonObject(record)) {
      throw new Error(`records[${index}] must be an object`);
    }

    const embedding = record.embedding;

    if (!Array.isArray(embedding)) {
      throw new Error(`records[${index}].embedding must be an array`);
    }

    if (record.embedding_model !== embeddingModel) {
      throw new Error(
        `records[${index}] embedding_model mismatch: expected ${embeddingModel}, received ${String(record.embedding_model)}`,
      );
    }

    if (record.embedding_dimensions !== embeddingDimensions) {
      throw new Error(
        `records[${index}] embedding_dimensions mismatch: expected ${embeddingDimensions}, received ${String(record.embedding_dimensions)}`,
      );
    }

    // Distinct from the metadata check above: declared dimensions can agree
    // with the manifest while the stored vector has a different length.
    if (embedding.length !== embeddingDimensions) {
      throw new Error(
        `Embedding vector dimension mismatch: expected ${embeddingDimensions}, received ${embedding.length}`,
      );
    }

    for (const value of embedding) {
      if (typeof value !== "number") {
        throw new Error(`records[${index}] embedding values must be numbers`);
      }
    }
  }

  return artifact as unknown as LegalEmbeddingArtifact;
}
