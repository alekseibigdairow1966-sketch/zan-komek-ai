import { getBestDirectSourceForAct } from "./enrich-search-results";
import { resolveApplicableLawArticleFromSource } from "./resolve-applicable-law-article-from-source";
import { isSecondaryAnalysisDomain } from "./core-legal-acts";
import { normalizeUrlForComparison } from "./normalize-url";
import {
  LEGAL_INFORMATION_NOTICES,
  type ApplicableLaw,
  type LegalAnalysisResult,
  type LegalInformationStatus,
  type LegalSearchResult,
  type LegalSource,
  type PrimaryLegalAct,
  type RelevanceStatus,
  type SourceDisplayBadge,
  type SourceType,
  type VerificationStatus,
} from "./types";
import { verifyLegalSourceUrl } from "./verify-source-url";

function findSearchResultByUrl(
  url: string | null | undefined,
  searchResults: LegalSearchResult[],
): LegalSearchResult | undefined {
  const normalized = normalizeUrlForComparison(url);

  if (!normalized) {
    return undefined;
  }

  return searchResults.find(
    (result) => normalizeUrlForComparison(result.url) === normalized,
  );
}

export function buildSearchUrlIndex(
  searchResults: LegalSearchResult[],
): Set<string> {
  const index = new Set<string>();

  for (const result of searchResults) {
    const normalized = normalizeUrlForComparison(result.url);

    if (normalized) {
      index.add(normalized);
    }
  }

  return index;
}

export function isUrlConfirmedBySearch(
  url: string | null | undefined,
  searchIndex: Set<string>,
): boolean {
  const normalized = normalizeUrlForComparison(url);

  if (!normalized) {
    return false;
  }

  return searchIndex.has(normalized);
}

export function isFullyConfirmedSource(
  source: LegalSource,
  matchedSearch?: LegalSearchResult,
): boolean {
  const sourceType = matchedSearch?.source_type ?? source.source_type;

  if (sourceType === "secondary_analysis") {
    return false;
  }

  if (
    sourceType === "official_guidance" ||
    sourceType === "official_authority"
  ) {
    return false;
  }

  return Boolean(
    source.search_confirmed &&
      source.verification_status === "official" &&
      source.content_checked &&
      (matchedSearch?.relevance_status ?? source.relevance_status) === "direct" &&
      (sourceType === "legal_act" || !sourceType),
  );
}

export function confirmsLegalNorm(
  sourceType: SourceType | undefined,
  relevanceStatus: RelevanceStatus | undefined,
  contentChecked?: boolean,
): boolean {
  return (
    sourceType === "legal_act" &&
    relevanceStatus === "direct" &&
    contentChecked === true
  );
}

export function confirmLegalSourceWithSearch(
  source: LegalSource,
  searchResults: LegalSearchResult[],
): LegalSource {
  const searchIndex = buildSearchUrlIndex(searchResults);
  const domainVerification = verifyLegalSourceUrl({
    url: source.url,
    modelVerificationStatus: source.verification_status,
  });

  const rawUrl = domainVerification.url ?? source.url;
  const search_confirmed = isUrlConfirmedBySearch(rawUrl, searchIndex);
  const matchedSearch = findSearchResultByUrl(rawUrl, searchResults);
  const normalizedUrl = normalizeUrlForComparison(rawUrl);

  const relevance_status =
    matchedSearch?.relevance_status ?? source.relevance_status;
  const source_type = matchedSearch?.source_type ?? source.source_type;
  const fullyConfirmed =
    search_confirmed &&
    domainVerification.verification_status === "official" &&
    (matchedSearch?.content_checked ?? false) &&
    confirmsLegalNorm(source_type, relevance_status, matchedSearch?.content_checked);

  return {
    ...source,
    url: fullyConfirmed ? normalizedUrl : null,
    source_domain: domainVerification.source_domain ?? source.source_domain,
    verification_status: domainVerification.verification_status,
    search_confirmed,
    relevance_score: matchedSearch?.relevance_score ?? source.relevance_score,
    relevance_status,
    matched_act_name: matchedSearch?.matched_act_name ?? source.matched_act_name,
    content_checked: matchedSearch?.content_checked ?? source.content_checked,
    source_type,
  };
}

export function computeVerifiedBySearch(sources: LegalSource[]): boolean {
  return sources.some((source) => isFullyConfirmedSource(source));
}

export function computeLegalInformationStatusFromSearch(
  sources: LegalSource[],
  applicableLaws: ApplicableLaw[],
): LegalInformationStatus {
  const directSources = sources.filter(
    (source) =>
      source.relevance_status === "direct" &&
      source.search_confirmed &&
      source.content_checked,
  );

  if (directSources.length === 0) {
    return "unverified";
  }

  const allLawsConfirmed = applicableLaws.every((law) => law.source_confirmed);
  const hasRelatedOrUnconfirmed = sources.some(
    (source) =>
      source.relevance_status === "related" ||
      (source.search_confirmed && source.relevance_status !== "direct"),
  );

  if (allLawsConfirmed && !hasRelatedOrUnconfirmed) {
    return "official_sources_present";
  }

  return "partially_verified";
}

/**
 * The model emits verification_status for an applicable law without ever
 * seeing a URL, so it is a hint, not a verification. Only source_confirmed is
 * authoritative: an unconfirmed "official" is downgraded to "unverified".
 * The downgrade is one-way — "not_found" is never raised to "unverified".
 */
function normalizeApplicableLawVerificationStatus(
  verificationStatus: VerificationStatus | undefined,
  sourceConfirmed: boolean,
): VerificationStatus | undefined {
  if (sourceConfirmed) {
    return verificationStatus;
  }

  if (verificationStatus === "official") {
    return "unverified";
  }

  return verificationStatus;
}

function linkApplicableLawsToSources(
  laws: ApplicableLaw[],
  searchResults: LegalSearchResult[],
): ApplicableLaw[] {
  return laws.map((law) => {
    const directSource = getBestDirectSourceForAct(searchResults, law.act_name);

    if (!directSource) {
      const { source_article: _staleSourceArticle, ...lawWithoutSourceArticle } =
        law;
      const verification_status = normalizeApplicableLawVerificationStatus(
        law.verification_status,
        false,
      );

      return {
        ...lawWithoutSourceArticle,
        source_confirmed: false,
        ...(verification_status ? { verification_status } : {}),
      };
    }

    const { source_article: _staleSourceArticle, ...lawWithoutSourceArticle } =
      law;
    const sourceConfirmed =
      confirmsLegalNorm(
        directSource.source_type,
        directSource.relevance_status,
        directSource.content_checked,
      ) && directSource.search_confirmed;
    const sourceArticle = sourceConfirmed
      ? resolveApplicableLawArticleFromSource(law, directSource)
      : undefined;
    const verification_status = normalizeApplicableLawVerificationStatus(
      law.verification_status,
      sourceConfirmed,
    );

    return {
      ...lawWithoutSourceArticle,
      source_url: directSource.url,
      source_relevance_status: directSource.relevance_status,
      source_confirmed: sourceConfirmed,
      ...(sourceArticle ? { source_article: sourceArticle } : {}),
      ...(verification_status ? { verification_status } : {}),
    };
  });
}

const UNVERIFIED_CONFIRMATION_PHRASE =
  /подтверждено официальным источником/gi;

const UNVERIFIED_CONFIRMATION_REPLACEMENT =
  "не подтверждено найденным официальным источником и требует ручной проверки";

export function sanitizeUnverifiedConfirmationText(
  text: string,
  status: LegalInformationStatus,
): string {
  if (status !== "unverified") {
    return text;
  }

  return text.replace(
    UNVERIFIED_CONFIRMATION_PHRASE,
    UNVERIFIED_CONFIRMATION_REPLACEMENT,
  );
}

export function enrichAnalysisWithSearch(
  result: LegalAnalysisResult,
  searchResults: LegalSearchResult[],
  searchPerformed: boolean,
  primaryLegalAct?: PrimaryLegalAct,
): LegalAnalysisResult {
  const promptRelevantResults = searchResults.filter(
    (item) => item.relevance_status !== "irrelevant",
  );

  const sources = result.sources
    .map((source) => confirmLegalSourceWithSearch(source, promptRelevantResults))
    .filter(
      (source) =>
        source.source_type !== "secondary_analysis" &&
        !isSecondaryAnalysisDomain(source.source_domain) &&
        (source.relevance_status !== "irrelevant" ||
          source.verification_status === "not_found"),
    );

  const applicableLaws = linkApplicableLawsToSources(
    result.applicableLaws,
    promptRelevantResults,
  );

  const verified_by_search = searchPerformed && computeVerifiedBySearch(sources);

  const legal_information_status = searchPerformed
    ? computeLegalInformationStatusFromSearch(sources, applicableLaws)
    : "unverified";

  const legal_information_notice =
    LEGAL_INFORMATION_NOTICES[legal_information_status];
  let search_notice: string | undefined;

  if (!searchPerformed) {
    search_notice =
      "Официальный поиск не выполнен. Ответ сформирован без подтверждения источников через Tavily.";
  } else if (promptRelevantResults.length === 0) {
    search_notice =
      "Официальный поиск выполнен, но прямые релевантные источники не найдены.";
  } else if (!verified_by_search) {
    search_notice =
      "Прямой текст нормативного акта не найден в официальных источниках для всех ключевых выводов.";
  }

  return {
    ...result,
    legalAssessment: sanitizeUnverifiedConfirmationText(
      result.legalAssessment,
      legal_information_status,
    ),
    analysis: sanitizeUnverifiedConfirmationText(
      result.analysis,
      legal_information_status,
    ),
    riskAnalysis: sanitizeUnverifiedConfirmationText(
      result.riskAnalysis,
      legal_information_status,
    ),
    recommendedActions: result.recommendedActions.map((action) =>
      sanitizeUnverifiedConfirmationText(action, legal_information_status),
    ),
    applicableLaws,
    sources,
    verified_by_search,
    search_performed: searchPerformed,
    search_notice,
    legal_information_status,
    legal_information_notice,
    primary_legal_act: primaryLegalAct,
  };
}

export function getSourceDisplayBadge(source: LegalSource): SourceDisplayBadge {
  if (
    source.source_type === "secondary_analysis" ||
    isSecondaryAnalysisDomain(source.source_domain)
  ) {
    return "Не подтверждено поиском";
  }

  if (source.verification_status === "not_found") {
    return "Источник не найден";
  }

  if (
    source.search_confirmed &&
    source.verification_status === "official" &&
    confirmsLegalNorm(
      source.source_type,
      source.relevance_status,
      source.content_checked,
    ) &&
    source.url
  ) {
    return "Подтверждённый официальный источник";
  }

  if (
    source.relevance_status === "related" ||
    source.source_type === "official_guidance" ||
    source.source_type === "official_authority"
  ) {
    return "Связанный официальный материал";
  }

  if (!source.url) {
    if (source.source_domain && source.verification_status === "official") {
      return "Официальный домен";
    }

    return "Источник не найден";
  }

  if (source.search_confirmed) {
    return "Найдено через официальный поиск";
  }

  if (source.verification_status === "official") {
    return "Официальный домен";
  }

  return "Не подтверждено поиском";
}

export function getApplicableLawRelevanceBadge(
  status: RelevanceStatus | undefined,
  confirmed?: boolean,
): string {
  if (confirmed && status === "direct") {
    return "Прямой официальный источник";
  }

  if (status === "related") {
    return "Связанный официальный материал";
  }

  return "Не подтверждено";
}
