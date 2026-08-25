import type { CoreLegalAct } from "./core-legal-acts";
import { buildLegalActCorpusFromHtml } from "./build-legal-act-corpus-from-html";
import { writeLegalActCorpusJsonl } from "./write-legal-act-corpus-jsonl";

export async function ingestLegalActFromHtml(input: {
  act: CoreLegalAct;
  sourceUrl: string;
  html: string;
  outputPath: string;
}): Promise<{
  outputPath: string;
  itemCount: number;
  actId: string;
}> {
  const items = buildLegalActCorpusFromHtml({
    act: input.act,
    sourceUrl: input.sourceUrl,
    html: input.html,
  });
  const written = await writeLegalActCorpusJsonl({
    items,
    outputPath: input.outputPath,
  });

  return {
    outputPath: written.outputPath,
    itemCount: written.itemCount,
    actId: input.act.id,
  };
}
