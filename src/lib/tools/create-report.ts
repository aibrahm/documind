// src/lib/tools/create-report.ts
//
// Tool handler for the `create_report` Claude tool. Takes a structured
// ReportContent from the model, runs it through the report-layout DOCX
// generator, uploads the result to Supabase Storage, and returns a
// signed download URL plus a tiny metadata blob.
//
// The handler is kept deliberately small — all the document layout
// lives in report-layout.ts, all the visual constants live in
// style-prompt.ts. This file only coordinates: schema → buffer →
// storage → signed URL.

import { randomUUID } from "node:crypto";
import { Packer } from "docx";
import { supabaseAdmin } from "@/lib/supabase";
import { createLogger } from "@/lib/logger";
import {
  buildReportDocument,
  type ReportContent,
  type ReportLanguage,
  type TableSpec,
} from "@/lib/tools/report-layout";

const log = createLogger("tool:create-report");

const BUCKET = "documents";
/** Signed URLs stay valid for a week — long enough for a demo, short
 *  enough that stale links naturally die. The raw file stays in
 *  storage indefinitely, so a fresh URL can always be generated from
 *  the artifact record later. */
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

interface CreateReportInput {
  title?: unknown;
  subtitle?: unknown;
  language?: unknown;
  executive_summary?: unknown;
  sections?: unknown;
  recommendations?: unknown;
  next_steps?: unknown;
}

/**
 * Run the create_report tool. Called from claude-with-tools.ts inside
 * the tool loop. Returns a JSON string (the format Claude tool_result
 * expects). On success the JSON contains the download URL so the
 * model can echo it back to the user.
 */
export async function runCreateReport(input: unknown): Promise<string> {
  // ── Validate and coerce the LLM's input ──
  const raw = (input ?? {}) as CreateReportInput;

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

  const executive_summary =
    typeof raw.executive_summary === "string"
      ? raw.executive_summary.trim()
      : "";

  const sections = normalizeSections(raw.sections);
  if (sections.length === 0) {
    return JSON.stringify({
      ok: false,
      error:
        "sections array is required and must contain at least one section",
    });
  }

  const recommendations = normalizeStringArray(raw.recommendations);
  const next_steps = normalizeStringArray(raw.next_steps);

  // Reports are unsigned — no operator profile lookup. See the note in
  // report-layout.ts ReportContent.
  const content: ReportContent = {
    title,
    subtitle,
    language,
    executive_summary,
    sections,
    recommendations,
    next_steps,
  };

  // ── Render the DOCX buffer ──
  let buffer: Buffer;
  try {
    const doc = buildReportDocument(content);
    buffer = await Packer.toBuffer(doc);
  } catch (err) {
    log.error("Failed to render DOCX", err, { title });
    return JSON.stringify({
      ok: false,
      error: `Failed to render DOCX: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  }

  // ── Upload to Supabase Storage ──
  const safeSlug = slugify(title);
  const storagePath = `generated/${Date.now()}_${safeSlug}_${randomUUID().slice(0, 8)}.docx`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: false,
    });

  if (uploadError) {
    log.error("Storage upload failed", uploadError, { storagePath });
    return JSON.stringify({
      ok: false,
      error: `Storage upload failed: ${uploadError.message}`,
    });
  }

  // ── Generate a signed download URL ──
  const { data: signed, error: signError } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS, {
      download: `${safeSlug || "report"}.docx`,
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

  log.info("Report generated", {
    title,
    language,
    sections: sections.length,
    sizeBytes: buffer.length,
    storagePath,
  });

  return JSON.stringify({
    ok: true,
    kind: "report",
    format: "docx",
    title,
    storagePath,
    downloadUrl: signed.signedUrl,
    sizeBytes: buffer.length,
    sections: sections.length,
    language,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Normalization helpers — defensive because LLM tool input is untrusted
// ─────────────────────────────────────────────────────────────────────

export function normalizeLanguage(value: unknown): ReportLanguage {
  if (value === "en" || value === "ar" || value === "mixed") return value;
  return "ar"; // default to Arabic because this product is Arabic-first
}

export function normalizeSections(value: unknown): ReportContent["sections"] {
  if (!Array.isArray(value)) return [];
  const out: ReportContent["sections"] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as {
      heading?: unknown;
      paragraphs?: unknown;
      tables?: unknown;
    };
    const heading = typeof s.heading === "string" ? s.heading.trim() : "";
    if (!heading) continue;

    let paragraphs: string[] = [];
    if (Array.isArray(s.paragraphs)) {
      paragraphs = s.paragraphs
        .filter((p): p is string => typeof p === "string")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
    } else if (typeof s.paragraphs === "string") {
      // Defensive: some models return a single string instead of an array.
      paragraphs = [s.paragraphs.trim()].filter((p) => p.length > 0);
    }

    const tables = normalizeTables(s.tables);

    // A section is valid if it has either prose OR tables. Pure data
    // sections (just a table, no prose) are a legitimate pattern in
    // formal memos — think "Attachment 1: key figures".
    if (paragraphs.length === 0 && tables.length === 0) continue;
    out.push({
      heading,
      paragraphs,
      ...(tables.length > 0 ? { tables } : {}),
    });
  }
  return out;
}

/**
 * Parse an array of table specs from untrusted LLM input. Rows are
 * coerced to strings (the renderer only displays strings) and padded /
 * trimmed to match `headers.length` so jagged arrays never crash the
 * document. Tables with no headers are dropped entirely — a table
 * without headers is almost always a hallucinated placeholder.
 */
export function normalizeTables(value: unknown): TableSpec[] {
  if (!Array.isArray(value)) return [];
  const out: TableSpec[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as {
      caption?: unknown;
      headers?: unknown;
      rows?: unknown;
    };

    const headers = Array.isArray(t.headers)
      ? t.headers
          .filter((h): h is string => typeof h === "string")
          .map((h) => h.trim())
      : [];
    if (headers.length === 0) continue;

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
    if (rows.length === 0) continue;

    const caption =
      typeof t.caption === "string" && t.caption.trim().length > 0
        ? t.caption.trim()
        : undefined;

    out.push({ headers, rows, ...(caption ? { caption } : {}) });
  }
  return out;
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .toLowerCase();
}
