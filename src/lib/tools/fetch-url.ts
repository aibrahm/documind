// src/lib/tools/fetch-url.ts
//
// Fetch a URL and return its readable text content. Used by Claude when it
// needs full page contents instead of Tavily's short snippet. Pure built-in
// fetch + regex HTML stripping. PDFs are read through the same Azure-backed
// reader used elsewhere in the product so fetched remote PDFs follow the
// same extraction path as uploads and chat attachments.

import { extractPdfTextWithAzure } from "@/lib/intake/read";

const MAX_CONTENT_CHARS = 8000;
const FETCH_TIMEOUT_MS = 15000;

export interface FetchUrlResult {
  ok: boolean;
  url: string;
  title?: string;
  content?: string;
  truncated?: boolean;
  error?: string;
}

export async function fetchUrlContent(url: string): Promise<FetchUrlResult> {
  // Validate URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, url, error: "Invalid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, url, error: "Only http and https URLs are allowed" };
  }

  // Fetch with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/pdf",
      },
    });
    clearTimeout(timeoutId);
  } catch (err) {
    clearTimeout(timeoutId);
    const message =
      (err as Error).name === "AbortError"
        ? "Request timed out"
        : (err as Error).message;
    return { ok: false, url, error: message };
  }

  if (!response.ok) {
    return {
      ok: false,
      url,
      error: `HTTP ${response.status} ${response.statusText}`,
    };
  }

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const isPdf = contentType.includes("application/pdf") || /\.pdf(\?|$)/i.test(url);
  const isText = contentType.includes("html") || contentType.includes("text");

  if (!isPdf && !isText) {
    return {
      ok: false,
      url,
      error: `Unsupported content type: ${contentType}`,
    };
  }

  // ── PDF branch ──
  if (isPdf) {
    try {
      const buf = Buffer.from(await response.arrayBuffer());
      const fileName =
        parsed.pathname.split("/").pop()?.trim() || "remote-document.pdf";
      const { title, content, pageCount, truncated } = await extractPdfTextWithAzure(
        buf,
        fileName,
        MAX_CONTENT_CHARS,
      );
      return {
        ok: true,
        url,
        title: title || `PDF (${pageCount} pages)`,
        content,
        truncated,
      };
    } catch (err) {
      return {
        ok: false,
        url,
        error: `PDF extraction failed: ${(err as Error).message}`,
      };
    }
  }

  // ── HTML/text branch ──
  let html: string;
  try {
    html = await response.text();
  } catch (err) {
    return { ok: false, url, error: (err as Error).message };
  }

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : undefined;

  // Strip script / style / noscript blocks, then all remaining tags, decode
  // common entities, collapse whitespace.
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  const truncated = text.length > MAX_CONTENT_CHARS;
  if (truncated) text = text.slice(0, MAX_CONTENT_CHARS) + "\n\n[truncated]";

  return { ok: true, url, title, content: text, truncated };
}

// ────────────────────────────────────────
// TOOL HANDLER
// ────────────────────────────────────────

export async function runFetchUrl(rawInput: unknown): Promise<string> {
  const input = rawInput as { url?: unknown };
  if (!input || typeof input.url !== "string") {
    return JSON.stringify({ error: "url string required" });
  }
  const result = await fetchUrlContent(input.url);
  return JSON.stringify(result);
}
