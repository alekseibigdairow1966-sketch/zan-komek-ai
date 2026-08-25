import { parseApplicableLaws } from "./parse-applicable-laws";
import {
  LEGAL_INFORMATION_NOTICES,
  type LegalAnalysisResult,
  type LegalInformationStatus,
  type LegalSource,
  type RawLegalAnalysisResult,
  type RawLegalSource,
} from "./types";
import { verifyLegalSourceUrl } from "./verify-source-url";

const REQUIRED_STRING_FIELDS = [
  "legalAssessment",
  "analysis",
  "riskAnalysis",
  "confidenceLevel",
  "relevanceDate",
] as const;

const REQUIRED_ARRAY_FIELDS = [
  "recommendedActions",
  "requiredDocuments",
  "sources",
] as const;

function parseRawSource(raw: RawLegalSource, index: number): LegalSource {
  const title = raw.title?.trim();
  const act_name = raw.act_name?.trim();
  const article = raw.article?.trim();

  if (!title || !act_name || !article) {
    throw new Error(
      `Некорректный ответ AI: источник #${index + 1} не содержит обязательные поля`,
    );
  }

  const verification = verifyLegalSourceUrl({
    url: raw.url,
    modelVerificationStatus: raw.verification_status,
  });

  return {
    title,
    act_name,
    article,
    url: verification.url,
    source_domain: verification.source_domain,
    verification_status: verification.verification_status,
    search_confirmed: false,
  };
}

function pickString(
  obj: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = obj[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function parseRecommendedActionItem(item: unknown): string | undefined {
  if (typeof item === "string") {
    const trimmed = item.trim();
    return trimmed || undefined;
  }

  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return undefined;
  }

  return pickString(item as Record<string, unknown>, [
    "action",
    "text",
    "description",
    "recommendation",
    "title",
  ]);
}

function parseRecommendedActions(items: unknown[]): string[] {
  const result: string[] = [];

  for (const item of items) {
    const normalized = parseRecommendedActionItem(item);

    if (normalized) {
      result.push(normalized);
    }
  }

  return result;
}

function parseRequiredDocumentItem(item: unknown): string | undefined {
  if (typeof item === "string") {
    const trimmed = item.trim();
    return trimmed || undefined;
  }

  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return undefined;
  }

  return pickString(item as Record<string, unknown>, [
    "document",
    "text",
    "title",
    "name",
    "description",
  ]);
}

function parseRequiredDocuments(items: unknown[]): string[] {
  const result: string[] = [];

  for (const item of items) {
    const normalized = parseRequiredDocumentItem(item);

    if (normalized) {
      result.push(normalized);
    }
  }

  return result;
}

export function computeLegalInformationStatus(
  sources: LegalSource[],
): LegalInformationStatus {
  const relevant = sources.filter(
    (source) => source.verification_status !== "not_found",
  );

  if (relevant.length === 0) {
    return "unverified";
  }

  const officialCount = relevant.filter(
    (source) => source.verification_status === "official",
  ).length;

  if (officialCount === relevant.length) {
    return "official_sources_present";
  }

  if (officialCount > 0) {
    return "partially_verified";
  }

  return "unverified";
}

export function parseAnalysisResult(content: string): LegalAnalysisResult {
  let parsed: RawLegalAnalysisResult;

  try {
    parsed = JSON.parse(content) as RawLegalAnalysisResult;
  } catch {
    throw new SyntaxError("Модель вернула некорректный JSON");
  }

  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof parsed[field] !== "string" || !parsed[field]?.trim()) {
      throw new Error(`Некорректный ответ AI: отсутствует поле ${field}`);
    }
  }

  for (const field of REQUIRED_ARRAY_FIELDS) {
    if (!Array.isArray(parsed[field]) || parsed[field].length === 0) {
      throw new Error(`Некорректный ответ AI: отсутствует поле ${field}`);
    }
  }

  const applicableLaws = parseApplicableLaws(parsed.applicableLaws);

  if (applicableLaws.length === 0) {
    throw new Error("Некорректный ответ AI: отсутствует поле applicableLaws");
  }

  const sources = (parsed.sources as RawLegalSource[]).map(parseRawSource);
  const legal_information_status = computeLegalInformationStatus(sources);

  return {
    legalAssessment: parsed.legalAssessment!.trim(),
    applicableLaws,
    analysis: parsed.analysis!.trim(),
    riskAnalysis: parsed.riskAnalysis!.trim(),
    recommendedActions: parseRecommendedActions(parsed.recommendedActions!),
    requiredDocuments: parseRequiredDocuments(parsed.requiredDocuments!),
    sources,
    confidenceLevel: parsed.confidenceLevel!.trim(),
    relevanceDate: parsed.relevanceDate!.trim(),
    generated_at: new Date().toISOString(),
    legal_information_status,
    legal_information_notice:
      LEGAL_INFORMATION_NOTICES[legal_information_status],
    verified_by_search: false,
    search_performed: false,
  };
}
