import { buildCoreLegalSources } from "./build-core-legal-sources";
import { buildLegalSearchQueries } from "./build-legal-search-queries";
import { getCoreActNames } from "./core-legal-acts";
import {
  buildInitialSearchContext,
  buildRetryQueriesForActs,
  enrichSearchResultsWithRelevance,
  extractQueryKeywords,
  findActsMissingDirectSource,
} from "./enrich-search-results";
import {
  dedupeLegalSearchResults,
  searchLegalSources,
  type SearchLegalSourcesOutcome,
} from "./search-legal-sources";
import type { LegalSearchResult, PrimaryLegalAct } from "./types";

export interface RunLegalSourceSearchOutcome extends SearchLegalSourcesOutcome {
  contextActNames: string[];
  primary_legal_act?: PrimaryLegalAct;
}

export async function runLegalSourceSearch(input: {
  legalArea: string;
  userType: string;
  description: string;
}, fetchImpl?: typeof fetch): Promise<RunLegalSourceSearchOutcome> {
  const coreSources = await buildCoreLegalSources(input, fetchImpl);
  const context = buildInitialSearchContext({
    ...input,
    extraActNames: getCoreActNames(input),
  });
  const searchTopic =
    extractQueryKeywords(input.description).join(" ") ||
    input.description.slice(0, 80);
  const actQueries = context.actNames.flatMap((actName) =>
    buildRetryQueriesForActs([actName], searchTopic).slice(0, 3),
  );

  const initialQueries = [
    ...buildLegalSearchQueries(input),
    ...actQueries,
  ];

  const initialOutcome = await searchLegalSources(initialQueries);

  if (!initialOutcome.performed) {
    return {
      ...initialOutcome,
      results: coreSources.results,
      performed: coreSources.results.length > 0,
      contextActNames: context.actNames,
      primary_legal_act: coreSources.primary_legal_act,
    };
  }

  let results = dedupeLegalSearchResults([
    ...coreSources.results,
    ...initialOutcome.results,
  ]);

  results = await enrichSearchResultsWithRelevance(
    results,
    context,
    fetchImpl,
  );

  const missingActs = findActsMissingDirectSource(context.actNames, results);

  if (missingActs.length > 0) {
    const retryQueries = buildRetryQueriesForActs(
      missingActs,
      extractQueryKeywords(input.description).join(" "),
    );
    const retryOutcome = await searchLegalSources(retryQueries);

    if (retryOutcome.performed && retryOutcome.results.length > 0) {
      const enrichedRetry = await enrichSearchResultsWithRelevance(
        retryOutcome.results,
        {
          ...context,
          actNames: [...new Set([...context.actNames, ...missingActs])],
        },
        fetchImpl,
      );

      results = dedupeLegalSearchResults([...results, ...enrichedRetry]);
      results = await enrichSearchResultsWithRelevance(results, context, fetchImpl);
    }
  }

  return {
    results,
    performed: true,
    contextActNames: context.actNames,
    primary_legal_act: coreSources.primary_legal_act,
  };
}

export async function retrySearchForModelActs(input: {
  actNames: string[];
  description: string;
  legalArea: string;
  existingResults: LegalSearchResult[];
}, fetchImpl?: typeof fetch): Promise<LegalSearchResult[]> {
  const context = buildInitialSearchContext({
    legalArea: input.legalArea,
    description: input.description,
  });

  const allActNames = [...new Set([...context.actNames, ...input.actNames])];
  const missingActs = findActsMissingDirectSource(allActNames, input.existingResults);

  if (missingActs.length === 0) {
    return input.existingResults;
  }

  const retryQueries = buildRetryQueriesForActs(
    missingActs,
    extractQueryKeywords(input.description).join(" "),
  );
  const retryOutcome = await searchLegalSources(retryQueries);

  if (!retryOutcome.performed || retryOutcome.results.length === 0) {
    return input.existingResults;
  }

  const enrichedRetry = await enrichSearchResultsWithRelevance(
    retryOutcome.results,
    {
      ...context,
      actNames: allActNames,
    },
    fetchImpl,
  );

  const merged = dedupeLegalSearchResults([
    ...input.existingResults,
    ...enrichedRetry,
  ]);

  return enrichSearchResultsWithRelevance(
    merged,
    { ...context, actNames: allActNames },
    fetchImpl,
  );
}
