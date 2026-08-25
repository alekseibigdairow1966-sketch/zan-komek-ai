import { getEncoding } from "js-tiktoken";

/** Encoding of text-embedding-3-small, whose per-input limit is in tokens. */
export const LEGAL_EMBEDDING_ENCODING = "cl100k_base" as const;

// Built once: loading the ranks is the expensive part, counting is not.
const encoding = getEncoding(LEGAL_EMBEDDING_ENCODING);

export function countLegalEmbeddingTokens(text: string): number {
  return encoding.encode(text).length;
}
