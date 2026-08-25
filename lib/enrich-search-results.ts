import {
  buildActSearchQueries,
  extractProbableActNames,
} from "./extract-probable-act-names";
import { evaluateSourceRelevance } from "./evaluate-source-relevance";
import { fetchOfficialSourceContent } from "./fetch-official-source-content";
import type { LegalSearchResult, RelevanceStatus } from "./types";

export interface SearchContext {
  legalArea: string;
  description: string;
  actNames: string[];
  queryKeywords: string[];
}

export function createDefaultSearchResultFields(): Pick<
  LegalSearchResult,
  | "search_confirmed"
  | "relevance_score"
  | "relevance_status"
  | "content_checked"
> {
  return {
    search_confirmed: true,
    relevance_score: 0,
    relevance_status: "irrelevant",
    content_checked: false,
  };
}

export async function enrichSearchResultWithRelevance(
  result: LegalSearchResult,
  context: SearchContext,
  fetchImpl?: typeof fetch,
): Promise<LegalSearchResult> {
  if (
    result.source_type === "legal_act" &&
    result.relevance_status === "direct" &&
    result.content_checked &&
    result.core_act_id
  ) {
    return result;
  }

  if (
    result.source_type === "official_guidance" ||
    result.source_type === "official_authority"
  ) {
    const fetched = await fetchOfficialSourceContent(result.url, fetchImpl);
    const title = fetched.title ?? result.title;
    const text = [fetched.text, result.content].filter(Boolean).join(" ");

    return {
      ...result,
      title,
      content: text.slice(0, 2000),
      content_checked: fetched.content_checked || result.content_checked,
      search_confirmed: true,
      relevance_status: result.relevance_status,
      source_type: result.source_type,
    };
  }

  const fetched = await fetchOfficialSourceContent(result.url, fetchImpl);

  const title = fetched.title ?? result.title;
  const text = [fetched.text, result.content].filter(Boolean).join(" ");

  const evaluation = evaluateSourceRelevance({
    actNames: context.actNames,
    queryKeywords: context.queryKeywords,
    title,
    text,
    tavilyContent: result.content,
  });

  return {
    ...result,
    title,
    content: text.slice(0, 2000),
    search_confirmed: true,
    relevance_score: evaluation.relevance_score,
    relevance_status: evaluation.relevance_status,
    matched_act_name: evaluation.matched_act_name,
    content_checked: fetched.content_checked,
  };
}

export async function enrichSearchResultsWithRelevance(
  results: LegalSearchResult[],
  context: SearchContext,
  fetchImpl?: typeof fetch,
): Promise<LegalSearchResult[]> {
  const enriched = await Promise.all(
    results.map((result) =>
      enrichSearchResultWithRelevance(result, context, fetchImpl),
    ),
  );

  return enriched.sort((a, b) => b.relevance_score - a.relevance_score);
}

export function filterPromptSearchResults(
  results: LegalSearchResult[],
): LegalSearchResult[] {
  return results.filter((result) => result.relevance_status !== "irrelevant");
}

export function hasDirectSourceForAct(
  results: LegalSearchResult[],
  actName: string,
): boolean {
  return results.some(
    (result) =>
      result.relevance_status === "direct" &&
      (result.source_type === "legal_act" || !result.source_type) &&
      result.matched_act_name &&
      normalizeActMatch(result.matched_act_name, actName),
  );
}

function normalizeActMatch(a: string, b: string): boolean {
  const left = a.toLowerCase().replace(/["«»]/g, "").trim();
  const right = b.toLowerCase().replace(/["«»]/g, "").trim();
  return left.includes(right) || right.includes(left);
}

export function findActsMissingDirectSource(
  actNames: string[],
  results: LegalSearchResult[],
): string[] {
  return actNames.filter((actName) => !hasDirectSourceForAct(results, actName));
}

export function extractQueryKeywords(description: string): string[] {
  return description
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 5)
    .slice(0, 8);
}

export function buildInitialSearchContext(input: {
  legalArea: string;
  description: string;
  extraActNames?: string[];
}): SearchContext {
  const actNames = extractProbableActNames(input);

  for (const actName of input.extraActNames ?? []) {
    if (!actNames.includes(actName)) {
      actNames.unshift(actName);
    }
  }

  return {
    legalArea: input.legalArea,
    description: input.description,
    actNames,
    queryKeywords: extractQueryKeywords(input.description),
  };
}

export function buildRetryQueriesForActs(
  actNames: string[],
  topic: string,
): string[] {
  const queries: string[] = [];

  for (const actName of actNames) {
    queries.push(...buildActSearchQueries({ actName, topic }));
  }

  return queries;
}

export function getBestDirectSourceForAct(
  results: LegalSearchResult[],
  actName: string,
): LegalSearchResult | undefined {
  return results
    .filter(
      (result) =>
        result.relevance_status === "direct" &&
        (result.source_type === "legal_act" || !result.source_type) &&
        result.matched_act_name &&
        normalizeActMatch(result.matched_act_name, actName),
    )
    .sort((a, b) => b.relevance_score - a.relevance_score)[0];
}

export function getRelevanceBadgeForStatus(
  status: RelevanceStatus | undefined,
): string {
  switch (status) {
    case "direct":
      return "Прямой официальный источник";
    case "related":
      return "Связанный официальный материал";
    default:
      return "Не подтверждено";
  }
}
