import { writeFile } from "node:fs/promises";
import type { LegalActCorpusItem } from "./build-legal-act-corpus";
import { serializeLegalActCorpusToJsonl } from "./serialize-legal-act-corpus-jsonl";

export async function writeLegalActCorpusJsonl(input: {
  items: LegalActCorpusItem[];
  outputPath: string;
}): Promise<{
  outputPath: string;
  itemCount: number;
}> {
  const contents = serializeLegalActCorpusToJsonl(input.items);

  await writeFile(input.outputPath, contents, "utf8");

  return {
    outputPath: input.outputPath,
    itemCount: input.items.length,
  };
}
