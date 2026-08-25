import type { RelevanceStatus } from "./types";

export interface RelevanceEvaluationInput {
  actNames: string[];
  queryKeywords: string[];
  title: string;
  text: string;
  tavilyContent?: string;
}

export interface RelevanceEvaluation {
  relevance_score: number;
  relevance_status: RelevanceStatus;
  matched_act_name?: string;
}

const AMENDMENT_PATTERN =
  /о\s+внесении\s+изменений|вносит\s+изменения\s+и\s+дополнения|вносятся\s+изменения/i;
const NEWS_PATTERN =
  /новост|пресс[-\s]?релиз|анонс|объявлен|информационн(ый|ая|ое)\s+материал/i;
const LAW_DOCUMENT_PATTERN =
  /кодекс|закон\s+республики\s+казахстан|закон\s+рк|постановлен|приказ|нормативн/i;

export function normalizeActName(value: string): string {
  return value
    .toLowerCase()
    .replace(/закон\s+республики\s+казахстан/gi, "")
    .replace(/["«»]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getSignificantActTokens(actName: string): string[] {
  return normalizeActName(actName)
    .split(/\s+/)
    .filter((token) => token.length >= 4)
    .slice(0, 8);
}

export function actNameMatchesText(text: string, actName: string): boolean {
  const normalizedText = text.toLowerCase();
  const normalizedAct = normalizeActName(actName);

  if (!normalizedAct) {
    return false;
  }

  if (normalizedText.includes(normalizedAct)) {
    return true;
  }

  const tokens = getSignificantActTokens(actName);
  if (tokens.length === 0) {
    return false;
  }

  const matchedTokens = tokens.filter((token) => normalizedText.includes(token));
  return matchedTokens.length >= Math.max(2, Math.ceil(tokens.length * 0.6));
}

export function actNameMatchesTitle(title: string, actName: string): boolean {
  return actNameMatchesText(title, actName);
}

function countKeywordMatches(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.filter((keyword) => lower.includes(keyword.toLowerCase())).length;
}

function findMatchedActName(
  actNames: string[],
  title: string,
  text: string,
): string | undefined {
  for (const actName of actNames) {
    if (actNameMatchesTitle(title, actName) || actNameMatchesText(text, actName)) {
      return actName;
    }
  }

  return undefined;
}

function hasPrivateHousingVsMunicipalPropertyMismatch(
  queryKeywords: string[],
  title: string,
  text: string,
): boolean {
  const normalizedKeywords = queryKeywords.map((keyword) =>
    keyword.toLowerCase(),
  );
  const hasPrivateRentalContext =
    normalizedKeywords.some((keyword) => keyword.includes("арендодатель")) &&
    normalizedKeywords.some(
      (keyword) => keyword.includes("квартир") || keyword.includes("жил"),
    );
  const normalizedSource = `${title} ${text}`.toLowerCase();
  const hasMunicipalCommunalPropertyContext =
    normalizedSource.includes("государствен") &&
    normalizedSource.includes("коммунальн") &&
    normalizedSource.includes("имуществ");

  return hasPrivateRentalContext && hasMunicipalCommunalPropertyContext;
}

function scoreToStatus(score: number): RelevanceStatus {
  if (score >= 70) {
    return "direct";
  }

  if (score >= 40) {
    return "related";
  }

  return "irrelevant";
}

export function evaluateSourceRelevance(
  input: RelevanceEvaluationInput,
): RelevanceEvaluation {
  const combinedText = [input.title, input.text, input.tavilyContent ?? ""]
    .join(" ")
    .trim();

  const matched_act_name = findMatchedActName(
    input.actNames,
    input.title,
    combinedText,
  );

  if (
    hasPrivateHousingVsMunicipalPropertyMismatch(
      input.queryKeywords,
      input.title,
      combinedText,
    )
  ) {
    return {
      relevance_score: 0,
      relevance_status: "irrelevant",
      matched_act_name,
    };
  }

  let score = 0;

  if (matched_act_name && actNameMatchesTitle(input.title, matched_act_name)) {
    score += 35;
  }

  if (matched_act_name && actNameMatchesText(combinedText, matched_act_name)) {
    score += 30;
  }

  const keywordMatches = countKeywordMatches(combinedText, input.queryKeywords);
  score += Math.min(keywordMatches * 8, 24);

  if (LAW_DOCUMENT_PATTERN.test(combinedText)) {
    score += 10;
  }

  if (AMENDMENT_PATTERN.test(combinedText)) {
    score -= 28;

    if (!matched_act_name || !actNameMatchesText(combinedText, matched_act_name)) {
      score = Math.min(score, 62);
    }
  }

  if (NEWS_PATTERN.test(combinedText)) {
    score -= 22;
    score = Math.min(score, 60);
  }

  if (!matched_act_name && keywordMatches <= 1) {
    score = Math.min(score, 25);
  }

  if (matched_act_name && actNameMatchesTitle(input.title, matched_act_name)) {
    score = Math.max(score, 72);
  }

  const relevance_score = Math.max(0, Math.min(100, score));
  let relevance_status = scoreToStatus(relevance_score);

  if (
    AMENDMENT_PATTERN.test(input.title) &&
    matched_act_name &&
    !actNameMatchesTitle(input.title, matched_act_name)
  ) {
    relevance_status = "related";
    return {
      relevance_score: Math.max(40, Math.min(relevance_score, 69)),
      relevance_status,
      matched_act_name,
    };
  }

  if (
    NEWS_PATTERN.test(combinedText) &&
    !actNameMatchesTitle(input.title, matched_act_name ?? "")
  ) {
    relevance_status = "related";
    return {
      relevance_score: Math.max(40, Math.min(relevance_score, 69)),
      relevance_status,
      matched_act_name,
    };
  }

  if (relevance_status === "direct" && !matched_act_name) {
    relevance_status = "related";
    return {
      relevance_score: Math.min(relevance_score, 65),
      relevance_status,
    };
  }

  return {
    relevance_score,
    relevance_status,
    matched_act_name,
  };
}
