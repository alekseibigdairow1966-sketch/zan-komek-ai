import { isOfficialDomain, normalizeHostname } from "./official-domains";
import { normalizeUrlForComparison } from "./normalize-url";

export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_RESPONSE_BYTES = 1_000_000;
export const MAX_REDIRECTS = 5;

export interface FetchedOfficialContent {
  content_checked: boolean;
  title?: string;
  text?: string;
  html?: string;
  final_url?: string;
  error?: string;
}

export interface FetchOfficialSourceOptions {
  /** Overrides MAX_RESPONSE_BYTES for a single call, e.g. offline ingestion. */
  maxResponseBytes?: number;
}

export function extractTextFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractTitleFromHtml(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.replace(/\s+/g, " ").trim();
}

export function isOfficialFetchUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && isOfficialDomain(parsed.hostname);
  } catch {
    return false;
  }
}

export function resolveRedirectUrl(
  currentUrl: string,
  location: string | null,
): string | null {
  if (!location) {
    return null;
  }

  try {
    return new URL(location, currentUrl).toString();
  } catch {
    return null;
  }
}

export function isRedirectToUnofficialDomain(
  currentUrl: string,
  location: string | null,
): boolean {
  const nextUrl = resolveRedirectUrl(currentUrl, location);

  if (!nextUrl) {
    return false;
  }

  return !isOfficialFetchUrl(nextUrl);
}

interface LimitedTextReadResult {
  text: string;
  truncated: boolean;
}

async function readLimitedText(
  response: Response,
  maxResponseBytes: number,
): Promise<LimitedTextReadResult> {
  const reader = response.body?.getReader();

  if (!reader) {
    const text = await response.text();
    const bytes = new TextEncoder().encode(text);

    if (bytes.byteLength <= maxResponseBytes) {
      return { text, truncated: false };
    }

    return {
      text: new TextDecoder("utf-8").decode(bytes.slice(0, maxResponseBytes)),
      truncated: true,
    };
  }

  const decoder = new TextDecoder("utf-8");
  let received = 0;
  let result = "";

  while (received < maxResponseBytes) {
    const { done, value } = await reader.read();

    if (done || !value) {
      return { text: result + decoder.decode(), truncated: false };
    }

    const remaining = maxResponseBytes - received;

    if (value.byteLength > remaining) {
      result += decoder.decode(value.slice(0, remaining), { stream: true });
      reader.cancel().catch(() => undefined);
      return { text: result + decoder.decode(), truncated: true };
    }

    received += value.byteLength;
    result += decoder.decode(value, { stream: true });
  }

  // The limit is reached exactly; only one more read tells apart a document
  // that ends here from one whose remainder would be dropped.
  const { done, value } = await reader.read();

  if (done || !value || value.byteLength === 0) {
    return { text: result + decoder.decode(), truncated: false };
  }

  reader.cancel().catch(() => undefined);
  return { text: result + decoder.decode(), truncated: true };
}

export async function fetchOfficialSourceContent(
  url: string,
  fetchImpl: typeof fetch = fetch,
  options?: FetchOfficialSourceOptions,
): Promise<FetchedOfficialContent> {
  const requestedMaxResponseBytes = options?.maxResponseBytes;

  if (
    requestedMaxResponseBytes !== undefined &&
    !(Number.isInteger(requestedMaxResponseBytes) && requestedMaxResponseBytes > 0)
  ) {
    return {
      content_checked: false,
      error: `Некорректное значение maxResponseBytes: ${requestedMaxResponseBytes}`,
    };
  }

  const maxResponseBytes = requestedMaxResponseBytes ?? MAX_RESPONSE_BYTES;
  const normalizedStart = normalizeUrlForComparison(url);

  if (!normalizedStart || !isOfficialFetchUrl(normalizedStart)) {
    return {
      content_checked: false,
      error: "URL не принадлежит разрешённому официальному домену",
    };
  }

  let currentUrl = normalizedStart;

  try {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      let response: Response;

      try {
        response = await fetchImpl(currentUrl, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            Accept: "text/html,application/xhtml+xml",
            "User-Agent": "ZanKomekAI/1.0 (+legal-source-check)",
          },
        });
      } finally {
        clearTimeout(timeout);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");

        if (isRedirectToUnofficialDomain(currentUrl, location)) {
          return {
            content_checked: false,
            error: "Редирект на неофициальный домен",
          };
        }

        const nextUrl = resolveRedirectUrl(currentUrl, location);

        if (!nextUrl) {
          return {
            content_checked: false,
            error: "Некорректный редирект",
          };
        }

        currentUrl = normalizeUrlForComparison(nextUrl) ?? nextUrl;
        continue;
      }

      if (!response.ok) {
        return {
          content_checked: false,
          error: `HTTP ${response.status}`,
        };
      }

      const read = await readLimitedText(response, maxResponseBytes);

      if (read.truncated) {
        return {
          content_checked: false,
          error: `Ответ официального источника превышает лимит размера ${maxResponseBytes} байт`,
        };
      }

      const html = read.text;
      const final_url = normalizeUrlForComparison(currentUrl) ?? currentUrl;

      return {
        content_checked: true,
        title: extractTitleFromHtml(html),
        text: extractTextFromHtml(html).slice(0, 20_000),
        html,
        final_url,
      };
    }

    return {
      content_checked: false,
      error: "Превышено число редиректов",
    };
  } catch (error) {
    return {
      content_checked: false,
      error: error instanceof Error ? error.message : "Ошибка загрузки страницы",
    };
  }
}

export function getHostnameFromUrl(url: string): string | null {
  try {
    return normalizeHostname(new URL(url).hostname);
  } catch {
    return null;
  }
}
