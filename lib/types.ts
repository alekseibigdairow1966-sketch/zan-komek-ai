import type { LEGAL_AREAS } from "./constants";
import type { ParsedAdiletArticle } from "./parse-adilet-articles";

export type LegalArea = (typeof LEGAL_AREAS)[number];

export type UserType = "individual" | "ip" | "too";

export type VerificationStatus = "official" | "unverified" | "not_found";

export type RelevanceStatus = "direct" | "related" | "irrelevant";

export type SourceType =
  | "legal_act"
  | "official_guidance"
  | "official_authority"
  | "secondary_analysis";

export interface PrimaryLegalAct {
  id: string;
  title: string;
  found: boolean;
  official_url?: string;
}

export interface ApplicableLaw {
  act_name: string;
  article?: string;
  provision?: string;
  explanation?: string;
  verification_status?: VerificationStatus;
  source_url?: string;
  source_relevance_status?: RelevanceStatus;
  source_confirmed?: boolean;
  source_article?: ParsedAdiletArticle;
}

export interface RawApplicableLaw {
  act_name?: string;
  actName?: string;
  name?: string;
  law?: string;
  title?: string;
  article?: string;
  article_number?: string;
  section?: string;
  provision?: string;
  content?: string;
  summary?: string;
  text?: string;
  explanation?: string;
  applicability?: string;
  note?: string;
  verification_status?: string;
}

export type LegalInformationStatus =
  | "official_sources_present"
  | "partially_verified"
  | "unverified";

export interface AnalysisRequest {
  legalArea: LegalArea;
  userType: UserType;
  description: string;
  consent: boolean;
}

export interface LegalSource {
  title: string;
  act_name: string;
  article: string;
  url: string | null;
  source_domain: string | null;
  verification_status: VerificationStatus;
  search_confirmed: boolean;
  relevance_score?: number;
  relevance_status?: RelevanceStatus;
  matched_act_name?: string;
  content_checked?: boolean;
  source_type?: SourceType;
  core_act_id?: string;
  curated_source_id?: string;
}

export type SourceDisplayBadge =
  | "Подтверждённый официальный источник"
  | "Связанный официальный материал"
  | "Найдено через официальный поиск"
  | "Официальный домен"
  | "Не подтверждено поиском"
  | "Источник не найден";

export interface LegalSearchResult {
  title: string;
  url: string;
  content: string;
  source_domain: string;
  search_confirmed: boolean;
  relevance_score: number;
  relevance_status: RelevanceStatus;
  matched_act_name?: string;
  content_checked: boolean;
  source_type?: SourceType;
  core_act_id?: string;
  curated_source_id?: string;
  articles?: ParsedAdiletArticle[];
}

export interface RawLegalSource {
  title?: string;
  act_name?: string;
  article?: string;
  url?: string | null;
  source_domain?: string | null;
  verification_status?: string;
}

export interface RawLegalAnalysisResult {
  legalAssessment?: string;
  applicableLaws?: unknown;
  analysis?: string;
  riskAnalysis?: string;
  recommendedActions?: string[];
  requiredDocuments?: string[];
  sources?: RawLegalSource[];
  confidenceLevel?: string;
  relevanceDate?: string;
}

export interface LegalAnalysisResult {
  legalAssessment: string;
  applicableLaws: ApplicableLaw[];
  analysis: string;
  riskAnalysis: string;
  recommendedActions: string[];
  requiredDocuments: string[];
  sources: LegalSource[];
  confidenceLevel: string;
  relevanceDate: string;
  generated_at: string;
  legal_information_status: LegalInformationStatus;
  legal_information_notice: string;
  verified_by_search: boolean;
  search_performed: boolean;
  search_notice?: string;
  primary_legal_act?: PrimaryLegalAct;
}

export interface AnalysisResponse {
  result: LegalAnalysisResult;
}

export interface AnalysisErrorResponse {
  error: string;
}

export const LEGAL_INFORMATION_NOTICES: Record<LegalInformationStatus, string> = {
  official_sources_present:
    "Найдены прямые официальные источники, соответствующие части правовых выводов",
  partially_verified:
    "Часть правовых выводов подтверждена прямыми официальными источниками. Остальные положения требуют проверки",
  unverified: "Прямые официальные источники не подтверждены",
};

export const VERIFICATION_STATUS_LABELS: Record<VerificationStatus, string> = {
  official: "Официальный источник",
  unverified: "Не проверено",
  not_found: "Источник не найден",
};

export const SOURCE_VERIFICATION_LIMITATION_NOTICE =
  "Сервер проверяет домен, совпадение URL с результатами Tavily и релевантность извлечённого текста страницы. Актуальная редакция нормы, точное соответствие статьи и полнота документа не гарантируются автоматически.";
