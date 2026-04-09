// src/lib/tools/fetch-url.ts
//
// Fetch a URL and return its readable text content. Used by Claude when it
// needs full page contents instead of Tavily's short snippet. Pure built-in
// fetch + regex HTML stripping. PDFs are read through the same Azure-backed
// reader used elsewhere in the product so fetched remote PDFs follow the
// same extraction path as uploads and chat attachments.
//
// SSRF hardening: this tool is callable by the LLM with arbitrary URLs, so
// anything the model can be nudged into fetching (via prompt injection in
// a document, a crafted user message, or a malicious web search result)
// could otherwise reach private network ranges — cloud metadata services
// (169.254.169.254), localhost, LAN, etc. We defend in layers:
//
//   1. Scheme allow-list: http(s) only. No file://, no data://, no ftp://.
//   2. Host deny-list: block literal private / loopback / link-local IPs
//      in the URL, plus any hostname that resolves to one of those ranges.
//   3. Size cap: bail out of the fetch once a response has sent more than
//      MAX_RESPONSE_BYTES, regardless of content type.
//   4. Redirect re-check: we follow redirects manually so every hop is
//      re-validated against the deny-list (otherwise a public host could
//      302 to http://169.254.169.254).

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { extractPdfTextWithAzure } from "@/lib/intake/read";

const MAX_CONTENT_CHARS = 8000;
const MAX_RESPONSE_BYTES = 15 * 1024 * 1024; // 15MB hard cap on raw response
const FETCH_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;

/**
 * Return true if the given IP literal falls inside any of the ranges we
 * never want the tool to reach. Covers IPv4 loopback (127/8), private
 * (10/8, 172.16/12, 192.168/16), link-local (169.254/16, carrier-grade
 * NAT 100.64/10), plus IPv6 loopback (::1), link-local (fe80::/10),
 * unique-local (fc00::/7), and IPv4-mapped equivalents.
 */
function isDisallowedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 0) return false;
  if (version === 4) {
    const parts = ip.split(".").map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local, AWS metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  // IPv6
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fe80:")) return true; // link-local
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // ULA
  if (normalized.startsWith("ff")) return true; // multicast
  // IPv4-mapped IPv6 (::ffff:a.b.c.d)
  const mappedMatch = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedMatch) return isDisallowedIp(mappedMatch[1]);
  return false;
}

async function isHostnameAllowed(hostname: string): Promise<{ ok: boolean; reason?: string }> {
  // Block literal blank / localhost spellings before touching DNS.
  if (!hostname) return { ok: false, reason: "Empty hostname" };
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower === "localhost.localdomain") {
    return { ok: false, reason: "localhost is not allowed" };
  }
  // If the hostname is itself an IP literal, just check it directly.
  if (isIP(hostname) !== 0) {
    return isDisallowedIp(hostname)
      ? { ok: false, reason: "IP is in a blocked range" }
      : { ok: true };
  }
  // DNS resolve — any A/AAAA record in a disallowed range fails the whole
  // hostname. We use `all: true` to catch multi-record rebinding tricks.
  try {
    const addresses = await lookup(hostname, { all: true });
    for (const addr of addresses) {
      if (isDisallowedIp(addr.address)) {
        return {
          ok: false,
          reason: `Hostname resolves to a blocked address (${addr.address})`,
        };
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `DNS lookup failed: ${(err as Error).message}` };
  }
}

export interface FetchUrlResult {
  ok: boolean;
  url: string;
  title?: string;
  content?: string;
  truncated?: boolean;
  error?: string;
}

export async function fetchUrlContent(url: string): Promise<FetchUrlResult> {
  // Manual redirect handling so every hop is re-validated against the
  // SSRF deny-list. Without this, a well-meaning public host could 302
  // to http://169.254.169.254 (AWS metadata) or http://localhost and
  // win the bypass.
  const visited = new Set<string>();
  let currentUrl = url;
  let response: Response | null = null;
  let parsed: URL;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    try {
      parsed = new URL(currentUrl);
    } catch {
      return { ok: false, url, error: "Invalid URL" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, url, error: "Only http and https URLs are allowed" };
    }
    if (visited.has(currentUrl)) {
      return { ok: false, url, error: "Redirect loop detected" };
    }
    visited.add(currentUrl);

    const hostCheck = await isHostnameAllowed(parsed.hostname);
    if (!hostCheck.ok) {
      return {
        ok: false,
        url,
        error: `Blocked: ${hostCheck.reason}`,
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let hopResponse: Response;
    try {
      hopResponse = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
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

    // Follow 3xx redirects explicitly instead of letting fetch do it.
    if (hopResponse.status >= 300 && hopResponse.status < 400) {
      const location = hopResponse.headers.get("location");
      if (!location) {
        return {
          ok: false,
          url,
          error: `Redirect without Location header at ${currentUrl}`,
        };
      }
      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch {
        return { ok: false, url, error: "Invalid redirect target" };
      }
      continue;
    }

    response = hopResponse;
    break;
  }

  if (!response) {
    return { ok: false, url, error: "Too many redirects" };
  }

  if (!response.ok) {
    return {
      ok: false,
      url,
      error: `HTTP ${response.status} ${response.statusText}`,
    };
  }

  // Enforce a response size cap so a hostile server can't stream GBs.
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader) {
    const cl = parseInt(contentLengthHeader, 10);
    if (!Number.isNaN(cl) && cl > MAX_RESPONSE_BYTES) {
      return {
        ok: false,
        url,
        error: `Response too large (${cl} bytes, max ${MAX_RESPONSE_BYTES})`,
      };
    }
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
      // Post-read cap: servers can omit content-length or lie, so we check
      // the actual buffer size too.
      if (buf.length > MAX_RESPONSE_BYTES) {
        return {
          ok: false,
          url,
          error: `Response too large (${buf.length} bytes, max ${MAX_RESPONSE_BYTES})`,
        };
      }
      const fileName =
        parsed!.pathname.split("/").pop()?.trim() || "remote-document.pdf";
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
    // Read as arrayBuffer first so we can enforce the size cap before
    // we spend CPU decoding a huge response.
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > MAX_RESPONSE_BYTES) {
      return {
        ok: false,
        url,
        error: `Response too large (${buf.length} bytes, max ${MAX_RESPONSE_BYTES})`,
      };
    }
    html = buf.toString("utf8");
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
