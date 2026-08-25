import { isSecondaryAnalysisDomain } from "./core-legal-acts";
import { isOfficialDomain, normalizeHostname } from "./official-domains";
import type { VerificationStatus } from "./types";

export interface HttpsUrlValidationResult {
  isValid: boolean;
  normalizedUrl: string | null;
  hostname: string | null;
}

export function validateHttpsUrl(
  rawUrl: string | null | undefined,
): HttpsUrlValidationResult {
  if (!rawUrl?.trim()) {
    return { isValid: false, normalizedUrl: null, hostname: null };
  }

  const value = rawUrl.trim();

  try {
    const parsed = new URL(value);

    if (parsed.protocol !== "https:") {
      return { isValid: false, normalizedUrl: null, hostname: null };
    }

    if (!parsed.hostname) {
      return { isValid: false, normalizedUrl: null, hostname: null };
    }

    return {
      isValid: true,
      normalizedUrl: parsed.toString(),
      hostname: normalizeHostname(parsed.hostname),
    };
  } catch {
    return { isValid: false, normalizedUrl: null, hostname: null };
  }
}

export interface SourceVerificationInput {
  url?: string | null;
  modelVerificationStatus?: string | null;
}

export interface SourceVerificationResult {
  url: string | null;
  source_domain: string | null;
  verification_status: VerificationStatus;
}

export function verifyLegalSourceUrl(
  input: SourceVerificationInput,
): SourceVerificationResult {
  const modelStatus = input.modelVerificationStatus?.trim();

  if (modelStatus === "not_found" && !input.url?.trim()) {
    return {
      url: null,
      source_domain: null,
      verification_status: "not_found",
    };
  }

  const validation = validateHttpsUrl(input.url);

  if (!validation.isValid || !validation.hostname) {
    if (modelStatus === "not_found") {
      return {
        url: null,
        source_domain: null,
        verification_status: "not_found",
      };
    }

    return {
      url: null,
      source_domain: null,
      verification_status: "unverified",
    };
  }

  if (isOfficialDomain(validation.hostname)) {
    return {
      url: validation.normalizedUrl,
      source_domain: validation.hostname,
      verification_status: "official",
    };
  }

  if (isSecondaryAnalysisDomain(validation.hostname)) {
    return {
      url: null,
      source_domain: validation.hostname,
      verification_status: "unverified",
    };
  }

  return {
    url: null,
    source_domain: validation.hostname,
    verification_status: "unverified",
  };
}
