import type { LegalActCorpusItem } from "./build-legal-act-corpus";
import { buildLegalActCorpusFromHtml } from "./build-legal-act-corpus-from-html";
import type { CoreLegalAct } from "./core-legal-acts";
import { fetchOfficialSourceContent } from "./fetch-official-source-content";

/** Offline corpus generation only. Runtime fetch keeps MAX_RESPONSE_BYTES. */
const OFFLINE_CORPUS_MAX_RESPONSE_BYTES = 2_500_000;

export async function buildLegalCorpusFromOfficialSources(
  input: {
    acts: CoreLegalAct[];
  },
  fetchImpl?: typeof fetch,
): Promise<LegalActCorpusItem[]> {
  const items: LegalActCorpusItem[] = [];

  for (const act of input.acts) {
    const fetched = await fetchOfficialSourceContent(
      act.official_url,
      fetchImpl,
      { maxResponseBytes: OFFLINE_CORPUS_MAX_RESPONSE_BYTES },
    );

    if (!fetched.content_checked) {
      throw new Error(
        fetched.error ??
          `Failed to load official source HTML: ${act.official_url}`,
      );
    }

    const html = fetched.html;

    if (!html) {
      throw new Error(
        `Official source returned empty HTML: ${act.official_url}`,
      );
    }

    items.push(
      ...buildLegalActCorpusFromHtml({
        act,
        sourceUrl: act.official_url,
        html,
      }),
    );
  }

  return items;
}
