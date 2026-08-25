import { normalizeHostname } from "./official-domains";

export function normalizeUrlForComparison(
  rawUrl: string | null | undefined,
): string | null {
  if (!rawUrl?.trim()) {
    return null;
  }

  try {
    const parsed = new URL(rawUrl.trim());

    if (parsed.protocol !== "https:") {
      return null;
    }

    let pathname = parsed.pathname;

    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }

    const hostname = normalizeHostname(parsed.hostname);
    const search = parsed.search;

    return `https://${hostname}${pathname}${search}`;
  } catch {
    return null;
  }
}
