import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The embedding artifact is opened at runtime through a path taken from
  // LEGAL_EMBEDDING_ARTIFACT_PATH, so @vercel/nft cannot see it while it
  // statically analyses fs usage. Naming it here puts it into the server
  // trace of /api/analyze, the only route that reads it.
  outputFileTracingIncludes: {
    "/api/analyze": ["./data/rag/core-legal-embeddings-v1.json"],
  },
};

export default nextConfig;
