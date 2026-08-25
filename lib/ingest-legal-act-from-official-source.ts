import type { CoreLegalAct } from "./core-legal-acts";
import { fetchOfficialSourceContent } from "./fetch-official-source-content";
import { ingestLegalActFromHtml } from "./ingest-legal-act-from-html";

export async function ingestLegalActFromOfficialSource(
  input: {
    act: CoreLegalAct;
    outputPath: string;
  },
  fetchImpl?: typeof fetch,
): Promise<{
  outputPath: string;
  itemCount: number;
  actId: string;
  sourceUrl: string;
}> {
  const sourceUrl = input.act.official_url;
  const fetched = await fetchOfficialSourceContent(sourceUrl, fetchImpl);

  if (!fetched.content_checked || !fetched.html) {
    throw new Error(fetched.error ?? "Официальный источник не загружен");
  }

  const ingested = await ingestLegalActFromHtml({
    act: input.act,
    sourceUrl,
    html: fetched.html,
    outputPath: input.outputPath,
  });

  return {
    outputPath: ingested.outputPath,
    itemCount: ingested.itemCount,
    actId: ingested.actId,
    sourceUrl,
  };
}
