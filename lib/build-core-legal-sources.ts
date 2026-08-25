import {
  actContentMatchesAct,
  getCuratedSourcesForAct,
  resolvePrimaryAct,
  type CoreLegalAct,
  type CuratedOfficialSource,
} from "./core-legal-acts";
import { fetchOfficialSourceContent } from "./fetch-official-source-content";
import { parseAdiletArticles } from "./parse-adilet-articles";
import type { LegalSearchResult, PrimaryLegalAct } from "./types";

export interface BuildCoreLegalSourcesOutcome {
  primary_legal_act?: PrimaryLegalAct;
  results: LegalSearchResult[];
}

function createCuratedSearchResult(
  source: CuratedOfficialSource,
  act: CoreLegalAct,
  fetched?: Awaited<ReturnType<typeof fetchOfficialSourceContent>>,
): LegalSearchResult {
  const content = [fetched?.text, source.title].filter(Boolean).join(" ");

  return {
    title: fetched?.title ?? source.title,
    url: fetched?.final_url ?? source.url,
    content: content.slice(0, 2000),
    source_domain: source.official_domain,
    search_confirmed: true,
    relevance_score: 55,
    relevance_status: source.relevance_status,
    matched_act_name: act.title,
    content_checked: fetched?.content_checked ?? false,
    source_type: source.source_type,
    core_act_id: act.id,
    curated_source_id: source.id,
  };
}

async function buildCuratedSourceResult(
  source: CuratedOfficialSource,
  act: CoreLegalAct,
  fetchImpl?: typeof fetch,
): Promise<LegalSearchResult> {
  const fetched = await fetchOfficialSourceContent(source.url, fetchImpl);
  return createCuratedSearchResult(source, act, fetched);
}

export async function buildCoreLegalSourceResult(
  act: CoreLegalAct,
  fetchImpl?: typeof fetch,
  fetchContent: typeof fetchOfficialSourceContent = fetchOfficialSourceContent,
): Promise<LegalSearchResult | null> {
  const fetched = await fetchContent(act.official_url, fetchImpl);

  if (!fetched.content_checked) {
    return null;
  }

  const title = fetched.title ?? act.title;
  const text = fetched.text ?? "";

  if (!actContentMatchesAct(act, title, text)) {
    return null;
  }

  const articles =
    act.official_domain === "adilet.zan.kz" && fetched.html
      ? parseAdiletArticles(fetched.html).articles
      : undefined;

  return {
    title,
    url: fetched.final_url ?? act.official_url,
    content: text.slice(0, 2000),
    source_domain: act.official_domain,
    search_confirmed: true,
    relevance_score: 95,
    relevance_status: "direct",
    matched_act_name: act.title,
    content_checked: true,
    source_type: "legal_act",
    core_act_id: act.id,
    ...(articles && articles.length > 0 ? { articles } : {}),
  };
}

export async function buildCoreLegalSources(
  input: {
    legalArea: string;
    description: string;
  },
  fetchImpl?: typeof fetch,
): Promise<BuildCoreLegalSourcesOutcome> {
  const primaryAct = resolvePrimaryAct(input);

  if (!primaryAct) {
    return { results: [] };
  }

  const primary_legal_act: PrimaryLegalAct = {
    id: primaryAct.id,
    title: primaryAct.title,
    found: false,
    official_url: primaryAct.official_url,
  };

  const results: LegalSearchResult[] = [];

  const coreActResult = await buildCoreLegalSourceResult(primaryAct, fetchImpl);

  if (coreActResult) {
    results.push(coreActResult);
    primary_legal_act.found = true;
  }

  const curatedSources = getCuratedSourcesForAct(primaryAct, input.description);

  for (const curatedSource of curatedSources) {
    results.push(
      await buildCuratedSourceResult(curatedSource, primaryAct, fetchImpl),
    );
  }

  return {
    primary_legal_act,
    results,
  };
}
