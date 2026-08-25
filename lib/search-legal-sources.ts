import { OFFICIAL_SOURCE_DOMAINS, normalizeHostname } from "./official-domains";
import { createDefaultSearchResultFields } from "./enrich-search-results";
import { isSecondaryAnalysisUrl } from "./core-legal-acts";
import { normalizeUrlForComparison } from "./normalize-url";
import type { LegalSearchResult } from "./types";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const MAX_UNIQUE_RESULTS = 8;

export class TavilySearchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TavilySearchError";
  }
}

export interface SearchLegalSourcesOutcome {
  results: LegalSearchResult[];
  performed: boolean;
  error?: string;
}

interface TavilySearchResponse {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
  }>;
  detail?: string;
  error?: string;
}

function normalizeTavilyErrorMessage(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = normalizeTavilyErrorMessage(item);

      if (normalized) {
        return normalized;
      }
    }

    return undefined;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;

  for (const key of ["message", "detail", "error", "msg", "title"]) {
    const field = record[key];

    if (typeof field === "string") {
      const trimmed = field.trim();

      if (trimmed) {
        return trimmed;
      }
    }
  }

  return undefined;
}

function mapTavilyError(status: number, body?: TavilySearchResponse): TavilySearchError {
  const message =
    normalizeTavilyErrorMessage(body?.detail) ??
    normalizeTavilyErrorMessage(body?.error);

  switch (status) {
    case 401:
      return new TavilySearchError(
        "Неверный API-ключ Tavily. Проверьте TAVILY_API_KEY в .env.local",
        401,
      );
    case 429:
      return new TavilySearchError(
        "Превышен лимит запросов Tavily. Попробуйте позже",
        429,
      );
    default:
      if (status >= 500) {
        return new TavilySearchError(
          "Сервис Tavily временно недоступен",
          502,
        );
      }

      return new TavilySearchError(
        message ?? "Не удалось выполнить поиск официальных источников",
        status || 502,
      );
  }
}

function toLegalSearchResult(item: {
  title?: string;
  url?: string;
  content?: string;
}): LegalSearchResult | null {
  const normalizedUrl = normalizeUrlForComparison(item.url);

  if (!normalizedUrl || isSecondaryAnalysisUrl(normalizedUrl)) {
    return null;
  }

  try {
    const hostname = normalizeHostname(new URL(normalizedUrl).hostname);

    return {
      title: item.title?.trim() || "Официальный источник",
      url: normalizedUrl,
      content: item.content?.trim() || "",
      source_domain: hostname,
      ...createDefaultSearchResultFields(),
    };
  } catch {
    return null;
  }
}

async function searchTavilyQuery(
  apiKey: string,
  query: string,
): Promise<LegalSearchResult[]> {
  const response = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      include_domains: [...OFFICIAL_SOURCE_DOMAINS],
      max_results: 5,
    }),
  });

  let body: TavilySearchResponse | undefined;

  try {
    body = (await response.json()) as TavilySearchResponse;
  } catch {
    if (!response.ok) {
      throw mapTavilyError(response.status);
    }

    throw new TavilySearchError("Tavily вернул некорректный ответ", 502);
  }

  if (!response.ok) {
    throw mapTavilyError(response.status, body);
  }

  return (body.results ?? [])
    .map(toLegalSearchResult)
    .filter((item): item is LegalSearchResult => item !== null);
}

export function dedupeLegalSearchResults(
  results: LegalSearchResult[],
): LegalSearchResult[] {
  const seen = new Set<string>();
  const unique: LegalSearchResult[] = [];

  for (const result of results) {
    const key = normalizeUrlForComparison(result.url);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(result);

    if (unique.length >= MAX_UNIQUE_RESULTS) {
      break;
    }
  }

  return unique;
}

export async function searchLegalSources(
  queries: string[],
): Promise<SearchLegalSourcesOutcome> {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    return {
      results: [],
      performed: false,
      error: "Поиск официальных источников не настроен (TAVILY_API_KEY)",
    };
  }

  if (queries.length === 0) {
    return {
      results: [],
      performed: true,
    };
  }

  try {
    const batches = await Promise.all(
      queries.map((query) => searchTavilyQuery(apiKey, query)),
    );

    const results = dedupeLegalSearchResults(batches.flat());

    return {
      results,
      performed: true,
    };
  } catch (error) {
    const message =
      error instanceof TavilySearchError
        ? error.message
        : "Не удалось выполнить поиск официальных источников";

    console.error("Tavily search error:", message);

    return {
      results: [],
      performed: false,
      error: message,
    };
  }
}
