// src/lib/tools/create-presentation.ts
//
// Tool handler for the `create_presentation` Claude tool. Takes a
// structured PresentationContent from the model, runs it through the
// presentation-layout PPTX generator, uploads to Supabase Storage, and
// returns a signed download URL.
//
// Same shape as create-report.ts — see that file for the reasoning on
// signed URL TTL, storage path layout, etc. Kept separate because the
// schema and validation differ.

import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { createLogger } from "@/lib/logger";
import {
  buildPresentationBuffer,
  type PresentationContent,
  type DeckLanguage,
  type SlideContent,
  type SlideLayoutKind,
  type ChartSpec,
  type ChartKind,
  type TableSpec,
} from "@/lib/tools/presentation-layout";

const log = createLogger("tool:create-presentation");

const BUCKET = "documents";
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

const VALID_LAYOUTS: SlideLayoutKind[] = [
  "title",
  "section_header",
  "content",
  "two_column",
  "numbers",
  "conclusion",
  "table",
  "chart",
];

const VALID_CHART_KINDS: ChartKind[] = ["bar", "column", "line", "pie"];

interface CreatePresentationInput {
  title?: unknown;
  subtitle?: unknown;
  language?: unknown;
  slides?: unknown;
}

export async function runCreatePresentation(input: unknown): Promise<string> {
  const raw = (input ?? {}) as CreatePresentationInput;

  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) {
    return JSON.stringify({
      ok: false,
      error: "title is required",
    });
  }

  const language = normalizeLanguage(raw.language);
  const subtitle =
    typeof raw.subtitle === "string" && raw.subtitle.trim().length > 0
      ? raw.subtitle.trim()
      : null;

  const slides = normalizeSlides(raw.slides);
  if (slides.length === 0) {
    return JSON.stringify({
      ok: false,
      error: "slides array is required and must contain at least one slide",
    });
  }
  if (slides.length > 20) {
    // Soft cap — decks longer than 20 slides are almost certainly the
    // model getting carried away. Keeping them tight is part of the
    // product discipline.
    return JSON.stringify({
      ok: false,
      error:
        "slides array is too long (max 20). Shorten the deck and try again.",
    });
  }

  // Decks are unsigned — no operator profile lookup.
  const content: PresentationContent = {
    title,
    subtitle,
    language,
    slides,
  };

  // Render the PPTX buffer
  let buffer: Buffer;
  try {
    buffer = await buildPresentationBuffer(content);
  } catch (err) {
    log.error("Failed to render PPTX", err, { title });
    return JSON.stringify({
      ok: false,
      error: `Failed to render PPTX: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  }

  // Upload
  const safeSlug = slugify(title);
  const storagePath = `generated/${Date.now()}_${safeSlug}_${randomUUID().slice(0, 8)}.pptx`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      upsert: false,
    });

  if (uploadError) {
    log.error("Storage upload failed", uploadError, { storagePath });
    return JSON.stringify({
      ok: false,
      error: `Storage upload failed: ${uploadError.message}`,
    });
  }

  // Signed URL
  const { data: signed, error: signError } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS, {
      download: `${safeSlug || "presentation"}.pptx`,
    });

  if (signError || !signed?.signedUrl) {
    log.error("Failed to create signed URL", signError, { storagePath });
    return JSON.stringify({
      ok: false,
      error: `Failed to create signed URL: ${
        signError?.message || "unknown error"
      }`,
    });
  }

  log.info("Presentation generated", {
    title,
    language,
    slides: slides.length,
    sizeBytes: buffer.length,
    storagePath,
  });

  return JSON.stringify({
    ok: true,
    kind: "presentation",
    format: "pptx",
    title,
    storagePath,
    downloadUrl: signed.signedUrl,
    sizeBytes: buffer.length,
    slides: slides.length,
    language,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Normalization helpers
// ─────────────────────────────────────────────────────────────────────

export function normalizeLanguage(value: unknown): DeckLanguage {
  if (value === "en" || value === "ar" || value === "mixed") return value;
  return "ar";
}

export function normalizeSlides(value: unknown): SlideContent[] {
  if (!Array.isArray(value)) return [];
  const out: SlideContent[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as {
      layout?: unknown;
      title?: unknown;
      subtitle?: unknown;
      bullets?: unknown;
      body?: unknown;
      left?: unknown;
      right?: unknown;
      data?: unknown;
      table?: unknown;
      chart?: unknown;
    };

    const layout: SlideLayoutKind = VALID_LAYOUTS.includes(
      s.layout as SlideLayoutKind,
    )
      ? (s.layout as SlideLayoutKind)
      : "content"; // fall back to plain content on unknown layout names

    const slide: SlideContent = { layout };

    if (typeof s.title === "string") slide.title = s.title.trim();
    if (typeof s.subtitle === "string") slide.subtitle = s.subtitle.trim();
    if (typeof s.body === "string") slide.body = s.body.trim();
    if (typeof s.left === "string") slide.left = s.left.trim();
    if (typeof s.right === "string") slide.right = s.right.trim();

    if (Array.isArray(s.bullets)) {
      slide.bullets = s.bullets
        .filter((b): b is string => typeof b === "string")
        .map((b) => b.trim())
        .filter((b) => b.length > 0);
    }

    if (Array.isArray(s.data)) {
      slide.data = s.data
        .filter(
          (d): d is { label: string; value: string } =>
            Boolean(d) &&
            typeof d === "object" &&
            typeof (d as { label?: unknown }).label === "string" &&
            typeof (d as { value?: unknown }).value === "string",
        )
        .map((d) => ({
          label: d.label.trim(),
          value: d.value.trim(),
        }))
        .slice(0, 4); // max 4 big numbers per slide
    }

    const table = normalizeTable(s.table);
    if (table) slide.table = table;

    const chart = normalizeChart(s.chart);
    if (chart) slide.chart = chart;

    out.push(slide);
  }
  return out;
}

/**
 * Parse a single TableSpec from untrusted input. Same rules as the
 * report normalizer: drop tables with no headers, coerce cells to
 * strings, pad/trim rows to header length. Returns null if the input
 * doesn't parse into anything renderable so the caller can skip
 * attaching a .table field entirely.
 */
export function normalizeTable(value: unknown): TableSpec | null {
  if (!value || typeof value !== "object") return null;
  const t = value as {
    caption?: unknown;
    headers?: unknown;
    rows?: unknown;
  };

  const headers = Array.isArray(t.headers)
    ? t.headers
        .filter((h): h is string => typeof h === "string")
        .map((h) => h.trim())
    : [];
  if (headers.length === 0) return null;

  const rows: string[][] = [];
  if (Array.isArray(t.rows)) {
    for (const row of t.rows) {
      if (!Array.isArray(row)) continue;
      const cells: string[] = row.map((c) =>
        typeof c === "string"
          ? c.trim()
          : c == null
            ? ""
            : String(c).trim(),
      );
      const padded = cells.slice(0, headers.length);
      while (padded.length < headers.length) padded.push("");
      rows.push(padded);
    }
  }
  if (rows.length === 0) return null;

  const caption =
    typeof t.caption === "string" && t.caption.trim().length > 0
      ? t.caption.trim()
      : undefined;

  return { headers, rows, ...(caption ? { caption } : {}) };
}

/**
 * Parse a ChartSpec from untrusted input. Drops series with no
 * numeric values; coerces string numbers via parseFloat because models
 * sometimes emit "12.5" instead of 12.5. Returns null if there's no
 * usable data so the caller can skip attaching it.
 */
export function normalizeChart(value: unknown): ChartSpec | null {
  if (!value || typeof value !== "object") return null;
  const c = value as {
    type?: unknown;
    categories?: unknown;
    series?: unknown;
    caption?: unknown;
  };

  const type: ChartKind = VALID_CHART_KINDS.includes(c.type as ChartKind)
    ? (c.type as ChartKind)
    : "bar";

  const categories = Array.isArray(c.categories)
    ? c.categories
        .map((x) => (typeof x === "string" ? x.trim() : String(x ?? "").trim()))
        .filter((x) => x.length > 0)
    : [];
  if (categories.length === 0) return null;

  if (!Array.isArray(c.series)) return null;
  const series = c.series
    .map((raw) => {
      if (!raw || typeof raw !== "object") return null;
      const srs = raw as { name?: unknown; values?: unknown };
      const name =
        typeof srs.name === "string" && srs.name.trim().length > 0
          ? srs.name.trim()
          : "Series";
      if (!Array.isArray(srs.values)) return null;
      // Pad/trim the values array to match categories so chart rendering
      // never sees jagged data. Missing cells become 0.
      const values: number[] = [];
      for (let i = 0; i < categories.length; i++) {
        const v = srs.values[i];
        let n = 0;
        if (typeof v === "number") n = v;
        else if (typeof v === "string") {
          const parsed = parseFloat(v.replace(/,/g, ""));
          if (!Number.isNaN(parsed)) n = parsed;
        }
        values.push(n);
      }
      return { name, values };
    })
    .filter((s): s is { name: string; values: number[] } => s !== null);

  if (series.length === 0) return null;

  const caption =
    typeof c.caption === "string" && c.caption.trim().length > 0
      ? c.caption.trim()
      : undefined;

  return { type, categories, series, ...(caption ? { caption } : {}) };
}

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .toLowerCase();
}
