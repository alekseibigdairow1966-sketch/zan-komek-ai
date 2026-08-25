import type { ApplicableLaw, RawApplicableLaw, VerificationStatus } from "./types";

function pickString(
  obj: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = obj[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return undefined;
}

function parseVerificationStatus(
  value: unknown,
): VerificationStatus | undefined {
  if (value === "official" || value === "unverified" || value === "not_found") {
    return value;
  }

  return undefined;
}

function parseApplicableLawItem(item: unknown): ApplicableLaw | null {
  if (item === null || item === undefined) {
    return null;
  }

  if (typeof item === "string") {
    const act_name = item.trim();
    return act_name ? { act_name } : null;
  }

  if (typeof item === "number") {
    return { act_name: String(item) };
  }

  if (Array.isArray(item)) {
    return null;
  }

  if (typeof item !== "object") {
    return null;
  }

  const obj = item as RawApplicableLaw & Record<string, unknown>;
  const act_name = pickString(obj, [
    "act_name",
    "actName",
    "name",
    "law",
    "title",
  ]);

  if (!act_name) {
    return null;
  }

  const article = pickString(obj, ["article", "article_number", "section"]);
  const provision = pickString(obj, ["provision", "content", "summary", "text"]);
  const explanation = pickString(obj, ["explanation", "applicability", "note"]);

  const law: ApplicableLaw = { act_name };

  if (article) law.article = article;
  if (provision) law.provision = provision;
  if (explanation) law.explanation = explanation;

  const verification_status = parseVerificationStatus(obj.verification_status);
  if (verification_status) {
    law.verification_status = verification_status;
  }

  return law;
}

function collectApplicableLawItems(input: unknown): unknown[] {
  if (Array.isArray(input)) {
    return input.flatMap(collectApplicableLawItems);
  }

  return [input];
}

export function parseApplicableLaws(input: unknown): ApplicableLaw[] {
  if (input === null || input === undefined) {
    return [];
  }

  const items = Array.isArray(input)
    ? collectApplicableLawItems(input)
    : [input];

  const result: ApplicableLaw[] = [];

  for (const item of items) {
    const parsed = parseApplicableLawItem(item);
    if (parsed) {
      result.push(parsed);
    }
  }

  return result;
}

export function resolveApplicableLawArticle(
  law: ApplicableLaw,
): string | null {
  const article = law.article?.trim();

  if (article) {
    return article;
  }

  if (law.verification_status === "official") {
    return null;
  }

  return "Точная статья требует проверки в официальной базе";
}
