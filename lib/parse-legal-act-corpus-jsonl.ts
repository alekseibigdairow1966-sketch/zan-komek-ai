import type { LegalActCorpusItem } from "./build-legal-act-corpus";

export function parseLegalActCorpusJsonl(jsonl: string): LegalActCorpusItem[] {
  const items: LegalActCorpusItem[] = [];

  for (const line of jsonl.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    items.push(JSON.parse(line) as LegalActCorpusItem);
  }

  return items;
}
