import type { LegalActCorpusItem } from "./build-legal-act-corpus";

export function serializeLegalActCorpusToJsonl(
  items: LegalActCorpusItem[],
): string {
  return items.map((item) => JSON.stringify(item)).join("\n");
}
