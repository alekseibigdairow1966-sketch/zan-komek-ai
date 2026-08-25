export const OFFICIAL_SOURCE_DOMAINS = [
  "adilet.zan.kz",
  "zan.gov.kz",
  "gov.kz",
  "sud.gov.kz",
  "office.sud.kz",
  "kgd.gov.kz",
  "nationalbank.kz",
] as const;

export type OfficialSourceDomain = (typeof OFFICIAL_SOURCE_DOMAINS)[number];

export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^www\./, "");
}

export function isOfficialDomain(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);

  return OFFICIAL_SOURCE_DOMAINS.some(
    (domain) =>
      normalized === domain || normalized.endsWith(`.${domain}`),
  );
}
