"use client";

import { ArrowLeft, ChevronDown, ChevronUp, FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { memo, use, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DocumentContextCard } from "@/components/document-context-card";
import { EntityEditor } from "@/components/entity-editor";
import { PageHeader } from "@/components/page-header";
import { Tag } from "@/components/ui-system";
import { sanitizeDateString } from "@/lib/date-sanitize";
import type {
  ExtractedTable,
  NormalizedExtractionPayload,
} from "@/lib/extraction-schema";
import { looksLikeOcrNoise } from "@/lib/ocr-noise";

interface DocDetail {
  id: string;
  title: string;
  type: string;
  classification: string;
  language: string;
  page_count: number;
  status: string;
  processing_error: string | null;
  metadata: Record<string, unknown>;
  entities: string[];
  context_card: Record<string, unknown> | null;
  created_at: string;
  version_number: number;
  is_current: boolean;
}

interface Ref {
  id: string;
  reference_text: string;
  reference_type: string;
  resolved: boolean;
}

interface ChunkData {
  id: string;
  content: string;
  page_number: number;
  section_title: string | null;
  clause_number: string | null;
  chunk_index: number;
  metadata: Record<string, unknown>;
}

type LeftTab = "details" | "extraction";
type ExtractionView = "formatted" | "raw";

interface DisplayBlock {
  key: string;
  pageNumber: number;
  sectionTitle: string | null;
  clauseNumber: string | null;
  content: string;
  confidence: number | null;
  table: ExtractedTable | null;
}

function extractChunkTable(
  metadata: Record<string, unknown> | null | undefined,
): ExtractedTable | null {
  if (!metadata || typeof metadata.table !== "object" || !metadata.table)
    return null;

  const table = metadata.table as {
    caption?: unknown;
    headers?: unknown;
    rows?: unknown;
  };

  if (!Array.isArray(table.rows) || table.rows.length === 0) return null;

  const rows = table.rows
    .map((row) =>
      Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : null,
    )
    .filter((row): row is string[] => Array.isArray(row) && row.length > 0);

  if (rows.length === 0) return null;

  const headers = Array.isArray(table.headers)
    ? table.headers.map((header) => String(header ?? ""))
    : undefined;
  const caption =
    typeof table.caption === "string" && table.caption.trim()
      ? table.caption.trim()
      : undefined;

  return {
    ...(caption ? { caption } : {}),
    ...(headers && headers.length > 0 ? { headers } : {}),
    rows,
  };
}

function normalizeTableForRender(table: ExtractedTable): {
  caption?: string;
  headers: string[];
  rows: string[][];
} {
  const rowWidths = table.rows.map((row) => row.length);
  const maxColumns = Math.max(table.headers?.length || 0, ...rowWidths);
  if (maxColumns <= 0) {
    return { headers: [], rows: [] };
  }

  let headers = [...(table.headers || [])];
  if (headers.length === maxColumns - 1) {
    headers = ["", ...headers];
  } else if (headers.length > 0 && headers.length < maxColumns) {
    headers = [
      ...headers,
      ...Array.from({ length: maxColumns - headers.length }, () => ""),
    ];
  }

  const rows = table.rows.map((row) =>
    row.length >= maxColumns
      ? row.slice(0, maxColumns)
      : [...row, ...Array.from({ length: maxColumns - row.length }, () => "")],
  );

  return {
    ...(table.caption ? { caption: table.caption } : {}),
    headers,
    rows,
  };
}

function confidenceLabel(
  confidence: number | null,
): "high" | "medium" | "low" | null {
  if (confidence === null || !Number.isFinite(confidence)) return null;
  if (confidence >= 0.9) return "high";
  if (confidence >= 0.7) return "medium";
  return "low";
}

/**
 * Build the rows the EXTRACTION tab renders.
 *
 * We PREFER chunks over `payload.pages.sections` because chunks have
 * already been merged via `mergeTinyTails` — one row per ~paragraph,
 * not one row per OCR'd line. Sections (raw Azure paragraphs) are kept
 * as the fallback when chunks aren't available, since the artifact path
 * is more likely to survive partial pipeline failures.
 *
 * Post-filter:
 *   - OCR-noise blocks (icon character soup) are dropped via
 *     `looksLikeOcrNoise`.
 *   - Adjacent identical blocks on the same page are deduped (handles
 *     repeated page headers like "HAMZA FUELS وقود حمزة" appearing as
 *     separate chunks per slide).
 *   - When the chunk's `sectionTitle` equals its `content`, the title
 *     is suppressed at render time (handled in the row component).
 */
function buildDisplayBlocks(
  payload: NormalizedExtractionPayload | null,
  chunks: ChunkData[] | null,
): DisplayBlock[] {
  const blocks: DisplayBlock[] = [];

  if (chunks && chunks.length > 0) {
    for (const chunk of chunks) {
      blocks.push({
        key: chunk.id,
        pageNumber: chunk.page_number,
        sectionTitle: chunk.section_title,
        clauseNumber: chunk.clause_number,
        content: chunk.content,
        confidence:
          typeof chunk.metadata?.confidence === "number"
            ? chunk.metadata.confidence
            : typeof chunk.metadata?.confidence === "string"
              ? Number(chunk.metadata.confidence)
              : null,
        table: extractChunkTable(chunk.metadata),
      });
    }
  } else if (payload) {
    payload.pages.forEach((page) => {
      page.sections.forEach((section, index) => {
        blocks.push({
          key: `${page.pageNumber}-${index}-${section.type}`,
          pageNumber: page.pageNumber,
          sectionTitle: section.title,
          clauseNumber: section.clauseNumber,
          content: section.content,
          confidence:
            typeof section.confidence === "number" &&
            Number.isFinite(section.confidence)
              ? section.confidence
              : null,
          table: section.table || null,
        });
      });
    });
  }

  // Pass 1: drop OCR noise (preserve tables — their content can be empty
  // but the rows are real data).
  const filtered = blocks.filter((b) => {
    if (b.table?.rows && b.table.rows.length > 0) return true;
    return !looksLikeOcrNoise(b.content);
  });

  // Pass 2: dedupe adjacent identical blocks on the same page. Handles
  // the "HAMZA FUELS وقود حمزة" header repeated as a separate chunk per
  // slide, and "Introduction"-as-content-and-section-title duplicates.
  const deduped: DisplayBlock[] = [];
  for (const b of filtered) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      prev.pageNumber === b.pageNumber &&
      prev.content.trim() === b.content.trim() &&
      !b.table
    ) {
      continue;
    }
    deduped.push(b);
  }

  return deduped;
}

/**
 * Detect when an extraction came back almost entirely as image-only
 * scraps — most chunks shorter than ~30 chars, no real prose. Used to
 * surface a banner instead of pretending the wall of single-character
 * blocks is useful information.
 *
 * Threshold: half-or-more of the rendered blocks have <30 chars AND we
 * have at least 5 blocks. Below 5 blocks the heuristic is too noisy.
 */
function isLimitedExtraction(blocks: DisplayBlock[]): boolean {
  if (blocks.length < 5) return false;
  const tinyCount = blocks.filter(
    (b) => !b.table && b.content.trim().length < 30,
  ).length;
  return tinyCount / blocks.length >= 0.5;
}

/**
 * Renders the iframe via a portal to document.body so DOM changes in the
 * left panel can never trigger a repaint of the Chrome PDF plugin.
 * A placeholder div reserves space in the layout; a ResizeObserver keeps
 * the portal positioned over it.
 */
const PdfViewer = memo(function PdfViewer({ url }: { url: string | null }) {
  const placeholderRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const mounted = typeof window !== "undefined";

  useEffect(() => {
    const el = placeholderRef.current;
    if (!el) return;
    // Only update the stored rect when it ACTUALLY changed. The capture-
    // phase scroll listener fires on any scroll in the tree (including
    // the left pane's internal scroll), and `setRect` with a fresh
    // object every time would trigger a re-render on every scroll tick
    // — visible as the iframe "syncing" with the left pane's scroll.
    // Stable-equality check short-circuits the re-render when the
    // placeholder didn't actually move.
    const update = () => {
      const r = el.getBoundingClientRect();
      setRect((prev) => {
        if (
          prev &&
          prev.top === r.top &&
          prev.left === r.left &&
          prev.width === r.width &&
          prev.height === r.height
        ) {
          return prev;
        }
        return { top: r.top, left: r.left, width: r.width, height: r.height };
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, []);

  return (
    <>
      <div
        ref={placeholderRef}
        className="flex-1 bg-[color:var(--surface-sunken)]"
      />
      {mounted &&
        rect &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
              background: "var(--surface-sunken)",
              zIndex: 1,
            }}
          >
            {!url && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[13px] text-[color:var(--ink-muted)]">
                  Loading preview...
                </span>
              </div>
            )}
            <iframe
              src={url || "about:blank"}
              className={`w-full h-full border-0 ${url ? "opacity-100" : "opacity-0"}`}
              title="Document preview"
            />
          </div>,
          document.body,
        )}
    </>
  );
});

const TYPE_VARIANT: Record<string, "blue" | "green" | "amber" | "default"> = {
  report: "blue",
  law: "green",
  presentation: "amber",
};

const CLASS_VARIANT: Record<string, "red" | "green" | "blue" | "default"> = {
  PRIVATE: "red",
  PUBLIC: "blue",
  // Legacy DOCTRINE rows render as PUBLIC style so migrated-but-not-yet-
  // renamed rows don't look weird. The display label in CLASS_DISPLAY
  // below also remaps them.
  DOCTRINE: "blue",
};

// Display labels shown on the chip. We switched from PRIVATE/PUBLIC to
// Confidential/Open in the UI without renaming the stored column — the
// VC's mental model is "is this private or can I quote it," and
// "Confidential/Open" reads more naturally than "PRIVATE/PUBLIC".
const CLASS_DISPLAY: Record<string, string> = {
  PRIVATE: "CONFIDENTIAL",
  PUBLIC: "OPEN",
  DOCTRINE: "OPEN",
};

export default function DocPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [refs, setRefs] = useState<Ref[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [leftTab, setLeftTab] = useState<LeftTab>("details");
  const [chunks, setChunks] = useState<ChunkData[] | null>(null);
  const [payload, setPayload] = useState<NormalizedExtractionPayload | null>(
    null,
  );
  const [chunksLoading, setChunksLoading] = useState(false);
  // Refs mirror the latest state so loadChunks() can guard against
  // concurrent/duplicate fetches WITHOUT depending on chunks/chunksLoading in
  // its useCallback dep array. Without this, every successful fetch flipped
  // chunks → loadChunks identity changed → effect at line 356 re-ran with
  // force=true → infinite refetch loop and visible flicker on the EXTRACTION tab.
  const chunksRef = useRef<ChunkData[] | null>(null);
  const chunksLoadingRef = useRef(false);
  useEffect(() => {
    chunksRef.current = chunks;
  }, [chunks]);
  useEffect(() => {
    chunksLoadingRef.current = chunksLoading;
  }, [chunksLoading]);
  const [extractionView, setExtractionView] =
    useState<ExtractionView>("formatted");
  const [copied, setCopied] = useState(false);
  // Entities collapsed by default on the details panel. The old page
  // rendered the full EntityEditor inline which was a wall of 15-20 items
  // with duplicated OCR spellings — overwhelming on open. Collapsed means
  // the user sees a small "N entities" chip and can expand if they care.
  const [entitiesExpanded, setEntitiesExpanded] = useState(false);
  // Context card expands a full summary + parties/dates/obligations/topics
  // that eats the whole left column on a 300px viewport. Default to
  // collapsed (summary + top topics only); user clicks "Show full context"
  // to see the rest. Matches the same pattern the entities section uses
  // so the two feel consistent.
  const [contextExpanded, setContextExpanded] = useState(false);

  const fetchDoc = useCallback(() => {
    return fetch(`/api/documents/${id}`)
      .then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (d?.document) {
          setNotFound(false);
          setDoc(d.document);
        } else if (d) {
          setNotFound(true);
        }
        return d?.document || null;
      });
  }, [id]);

  const fetchRefs = useCallback(() => {
    return fetch(`/api/documents/${id}/references`)
      .then((r) => r.json())
      .then((d) => setRefs(d.references || []))
      .catch(() => {});
  }, [id]);

  const fetchPdfUrl = useCallback(() => {
    return fetch(`/api/documents/${id}/url`)
      .then((r) => r.json())
      .then((d) => setPdfUrl(d.url || null))
      .catch(() => {});
  }, [id]);

  // Stable callback — only re-creates when `id` changes. Reads mutable guard
  // state via refs so successful fetches don't churn the callback identity.
  const docStatusRef = useRef(doc?.status);
  useEffect(() => {
    docStatusRef.current = doc?.status;
  }, [doc?.status]);
  const loadChunks = useCallback(
    (force = false) => {
      if (chunksLoadingRef.current) return;
      if (
        !force &&
        (chunksRef.current !== null || docStatusRef.current === "processing")
      )
        return;
      setChunksLoading(true);
      fetch(`/api/documents/${id}/extraction`)
        .then((r) => r.json())
        .then((d) => {
          setChunks(d.chunks || []);
          setPayload(d.payload || null);
        })
        .catch(() => {
          setChunks([]);
          setPayload(null);
        })
        .finally(() => setChunksLoading(false));
    },
    [id],
  );

  const handleTabClick = (tab: LeftTab) => {
    setLeftTab(tab);
    if (tab === "extraction") loadChunks();
  };

  const copyJson = () => {
    const jsonPayload =
      extractionView === "raw"
        ? (payload ?? {
            error: "No extraction payload is available for this document.",
          })
        : chunks;
    if (!jsonPayload) return;
    navigator.clipboard
      .writeText(JSON.stringify(jsonPayload, null, 2))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
  };

  const confidenceVariant = (
    level: "high" | "medium" | "low" | null,
  ): "green" | "amber" | "red" | "default" => {
    if (level === "high") return "green";
    if (level === "medium") return "amber";
    if (level === "low") return "red";
    return "default";
  };

  useEffect(() => {
    fetchDoc().catch(() => setNotFound(true));
    fetchRefs();
    fetchPdfUrl();
  }, [id, fetchDoc, fetchRefs, fetchPdfUrl]);

  useEffect(() => {
    if (doc?.status !== "processing") return;
    const interval = setInterval(() => {
      fetchDoc().catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [doc?.status, fetchDoc]);

  // When the document becomes ready, pull fresh references and — if the user
  // is already sitting on the EXTRACTION tab — kick off a chunk load. We
  // intentionally exclude `loadChunks` and `fetchRefs` from the dep array
  // because they're stable per-id; including them caused an infinite refetch
  // loop and visible flicker on the EXTRACTION tab.
  useEffect(() => {
    if (doc?.status !== "ready") return;
    fetchRefs();
    if (leftTab === "extraction") {
      const timeout = window.setTimeout(() => {
        loadChunks(true);
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.status, leftTab, id]);

  /* 404 state */
  if (notFound) {
    return (
      <div className="flex h-full flex-col bg-[color:var(--surface-raised)] overflow-hidden min-h-0">
        <div className="flex-1 flex items-center justify-center flex-col gap-2">
          <div className="w-12 h-12 rounded-md bg-[color:var(--surface-sunken)] border border-[color:var(--border-light)] flex items-center justify-center mb-2">
            <FileText className="w-5 h-5 text-[color:var(--ink-ghost)]" />
          </div>
          <p className="text-[15px] font-semibold text-[color:var(--ink)]">
            Document not found
          </p>
          <p className="text-[13px] text-[color:var(--ink-muted)]">
            It may have been deleted.
          </p>
          <button
            type="button"
            onClick={() => router.push("/documents")}
            className="mt-3 text-[12px] font-medium text-[color:var(--surface-raised)] bg-[color:var(--ink)] hover:bg-[color:var(--ink-strong)] border-none rounded-md px-3 py-1.5 cursor-pointer"
          >
            Back to documents
          </button>
        </div>
      </div>
    );
  }

  /* Loading state */
  if (!doc) {
    return (
      <div className="flex h-full flex-col bg-[color:var(--surface-raised)] overflow-hidden min-h-0">
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[13px] text-[color:var(--ink-ghost)]">
            Loading document...
          </p>
        </div>
      </div>
    );
  }

  const meta = (doc.metadata || {}) as Record<string, unknown>;
  // Nonsense dates filtered out so the details panel doesn't leak OCR
  // garbage like "لسنة 7025" into the UI.
  const dates = Array.isArray(meta.dates)
    ? (meta.dates as Array<string | { iso?: string }>)
        .map((d) => (typeof d === "string" ? d : d.iso || ""))
        .map(sanitizeDateString)
        .filter((d): d is string => d !== null)
        .join(", ")
    : null;

  const details: [string, string][] = [
    [
      "Language",
      doc.language === "ar"
        ? "Arabic"
        : doc.language === "en"
          ? "English"
          : "Mixed",
    ],
    ["Pages", String(doc.page_count)],
    ["Version", `${doc.version_number}${doc.is_current ? " (current)" : ""}`],
    [
      "Created",
      new Date(doc.created_at).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      }),
    ],
    ...(dates ? ([["Key Dates", dates]] as [string, string][]) : []),
  ];
  const displayBlocks = buildDisplayBlocks(payload, chunks);

  // Outer wrapper claims the full workspace-main height (h-full) and is a
  // flex column so PageHeader takes its natural height and the inner
  // wrapper takes the rest with min-h-0. Without h-full, flex-1 doesn't
  // apply (workspace main is overflow-auto block, not flex), so the page
  // would grow to fit its content — which on the EXTRACTION tab with many
  // chunks meant the WHOLE PAGE scrolled and the PDF (a fixed-position
  // iframe portaled to body, anchored to a placeholder via getBounding
  // ClientRect) scrolled out of view. With h-full the left pane scrolls
  // internally and the PDF stays put.
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        eyebrow="DOCUMENT"
        title={
          <span dir="auto" style={{ fontFamily: "var(--font-arabic)" }}>
            {doc.title}
          </span>
        }
        rightExtra={
          <button
            type="button"
            onClick={() => router.push("/documents")}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium cursor-pointer transition-colors"
            style={{
              background: "var(--surface-raised)",
              color: "var(--ink-muted)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
            }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
        }
      />
      <div className="flex flex-1 min-h-0 flex-col bg-[color:var(--surface-raised)] overflow-hidden">
        <main className="flex overflow-hidden flex-1 min-h-0">
          {/* Left panel — metadata / extraction */}
          {/*
            Left pane scales with the viewport: clamp(280, 33%, 360) keeps
            it readable on narrow windows (PDF would be unusable below
            ~280) and stops eating PDF real-estate on wide windows. The
            previous fixed w-[360px] crushed the PDF column on a 600px
            viewport into a 240px sliver.
          */}
          <div className="w-[clamp(280px,33%,360px)] shrink-0 overflow-auto bg-[color:var(--surface-raised)] border-r border-[color:var(--border)] flex flex-col">
            {/* Tab bar */}
            <div className="flex items-center border-b border-[color:var(--border)] px-5 pt-3 gap-4">
              <button
                onClick={() => handleTabClick("details")}
                className="text-[11px] tracking-wider pb-2 transition-colors"
                style={{
                  fontFamily: "var(--font-mono)",
                  borderBottom:
                    leftTab === "details"
                      ? "2px solid var(--ink)"
                      : "2px solid transparent",
                  color:
                    leftTab === "details" ? "var(--ink)" : "var(--ink-ghost)",
                }}
              >
                DETAILS
              </button>
              <button
                onClick={() => handleTabClick("extraction")}
                className="text-[11px] tracking-wider pb-2 transition-colors"
                style={{
                  fontFamily: "var(--font-mono)",
                  borderBottom:
                    leftTab === "extraction"
                      ? "2px solid var(--ink)"
                      : "2px solid transparent",
                  color:
                    leftTab === "extraction"
                      ? "var(--ink)"
                      : "var(--ink-ghost)",
                }}
              >
                EXTRACTION
              </button>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-auto p-5">
              {leftTab === "details" && (
                <>
                  {/* Tags row */}
                  <div className="flex items-center gap-2 mb-6">
                    <Tag variant={TYPE_VARIANT[doc.type] || "default"}>
                      {doc.type.toUpperCase()}
                    </Tag>
                    <Tag
                      variant={CLASS_VARIANT[doc.classification] || "default"}
                    >
                      {CLASS_DISPLAY[doc.classification] || doc.classification}
                    </Tag>
                    <span
                      className="text-[10px] font-semibold"
                      style={{
                        fontFamily: "var(--font-mono)",
                        color:
                          doc.status === "ready"
                            ? "var(--success)"
                            : doc.status === "error"
                              ? "var(--danger)"
                              : "var(--warning)",
                      }}
                    >
                      {doc.status.toUpperCase()}
                    </span>
                  </div>

                  <div className="mb-6">
                    <DocumentContextCard
                      card={doc.context_card}
                      preferredLanguage={doc.language}
                      variant={contextExpanded ? "full" : "compact"}
                      bordered={contextExpanded}
                    />
                    <button
                      type="button"
                      onClick={() => setContextExpanded((v) => !v)}
                      className="mt-2 flex items-center gap-1 bg-transparent border-none cursor-pointer p-0 text-[11px]"
                      style={{
                        color: "var(--ink-muted)",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {contextExpanded ? (
                        <>
                          <ChevronUp className="h-3 w-3" />
                          Hide context details
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-3 w-3" />
                          Show full context
                        </>
                      )}
                    </button>
                  </div>

                  {/*
                  Primary action: go talk to the assistant about this
                  document. The old detail page was a forensic dump with
                  no way to act on it; this one button is the whole point.
                  Sends the user to chat with the document pre-pinned.
                */}
                  <button
                    type="button"
                    onClick={() => router.push(`/?pinned_document=${doc.id}`)}
                    className="mb-6 w-full flex items-center justify-center gap-2 font-semibold text-[13px] py-3 cursor-pointer transition-colors"
                    style={{
                      background: "var(--ink)",
                      color: "var(--surface-raised)",
                      border: "none",
                      borderRadius: "var(--radius-md)",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--ink-strong)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "var(--ink)";
                    }}
                  >
                    Ask about this document →
                  </button>

                  {/* Extraction warnings surface quietly only if present. */}
                  {doc.processing_error && (
                    <div
                      className="mb-6 rounded-md border px-3 py-2"
                      style={{
                        borderColor: "var(--warning)",
                        background: "var(--warning-bg)",
                      }}
                    >
                      <p
                        className="text-[12px] font-semibold uppercase tracking-wider"
                        style={{ color: "var(--ink)" }}
                      >
                        Extraction warning
                      </p>
                      <p
                        className="mt-1 text-[12px] leading-snug"
                        style={{ color: "var(--ink-muted)" }}
                      >
                        {doc.processing_error}
                      </p>
                    </div>
                  )}

                  {/* Details section */}
                  <div className="mb-6">
                    <p
                      className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ink-ghost)] mb-2"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      DETAILS
                    </p>
                    {details.map(([k, v], i) => (
                      <div
                        key={i}
                        className="flex justify-between py-1.5 border-b border-[color:var(--border-light)]"
                      >
                        <span className="text-xs text-[color:var(--ink-muted)]">
                          {k}
                        </span>
                        <span
                          className="text-xs text-[color:var(--ink)]"
                          style={{ fontFamily: "var(--font-mono)" }}
                        >
                          {v}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Entities section — collapsed by default */}
                  <div className="mb-6">
                    <button
                      type="button"
                      onClick={() => setEntitiesExpanded((v) => !v)}
                      className="flex w-full items-center justify-between gap-2 bg-transparent border-none cursor-pointer p-0 mb-2"
                    >
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ink-ghost)]"
                        style={{ fontFamily: "var(--font-mono)" }}
                      >
                        Entities
                        {doc.entities?.length
                          ? ` · ${doc.entities.length}`
                          : ""}
                      </span>
                      {entitiesExpanded ? (
                        <ChevronUp className="h-3 w-3 text-[color:var(--ink-ghost)]" />
                      ) : (
                        <ChevronDown className="h-3 w-3 text-[color:var(--ink-ghost)]" />
                      )}
                    </button>
                    {entitiesExpanded && <EntityEditor documentId={doc.id} />}
                  </div>

                  {/* References section */}
                  {refs.length > 0 && (
                    <div>
                      <p
                        className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ink-ghost)] mb-2"
                        style={{ fontFamily: "var(--font-mono)" }}
                      >
                        REFERENCES &middot; {refs.length}
                      </p>
                      {refs.map((r) => (
                        <div
                          key={r.id}
                          className="flex items-center gap-2 py-1.5 border-b border-[color:var(--border-light)]"
                        >
                          <span
                            dir="auto"
                            className="text-xs text-[color:var(--ink)] flex-1"
                            style={{ fontFamily: "var(--font-arabic)" }}
                          >
                            {r.reference_text}
                          </span>
                          <span
                            className="text-[9px] uppercase text-[color:var(--ink-ghost)]"
                            style={{ fontFamily: "var(--font-mono)" }}
                          >
                            {r.reference_type}
                          </span>
                          {r.resolved && <Tag variant="green">LINKED</Tag>}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {leftTab === "extraction" && (
                <>
                  {/* View toggle + Copy button */}
                  <div className="flex items-center gap-2 mb-4">
                    <button
                      onClick={() => setExtractionView("formatted")}
                      className="text-[11px] tracking-wider px-2 py-1 transition-colors"
                      style={{
                        fontFamily: "var(--font-mono)",
                        borderRadius: "var(--radius-sm)",
                        background:
                          extractionView === "formatted"
                            ? "var(--ink)"
                            : "var(--surface-sunken)",
                        color:
                          extractionView === "formatted"
                            ? "var(--surface-raised)"
                            : "var(--ink-muted)",
                      }}
                    >
                      Formatted
                    </button>
                    <button
                      onClick={() => setExtractionView("raw")}
                      className="text-[11px] tracking-wider px-2 py-1 transition-colors"
                      style={{
                        fontFamily: "var(--font-mono)",
                        borderRadius: "var(--radius-sm)",
                        background:
                          extractionView === "raw"
                            ? "var(--ink)"
                            : "var(--surface-sunken)",
                        color:
                          extractionView === "raw"
                            ? "var(--surface-raised)"
                            : "var(--ink-muted)",
                      }}
                    >
                      Raw JSON
                    </button>
                    {extractionView === "raw" && (
                      <button
                        onClick={copyJson}
                        className="text-[11px] tracking-wider px-2 py-1 ml-auto transition-colors"
                        style={{
                          fontFamily: "var(--font-mono)",
                          borderRadius: "var(--radius-sm)",
                          background: "var(--surface-sunken)",
                          color: "var(--ink-muted)",
                        }}
                      >
                        {copied ? "Copied!" : "Copy JSON"}
                      </button>
                    )}
                  </div>

                  {payload && (
                    <p
                      className="text-[10px] uppercase tracking-wider text-[color:var(--ink-ghost)] mb-4"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {payload.source === "artifact"
                        ? "Source: stored extraction artifact"
                        : "Source: reconstructed from stored chunks"}
                    </p>
                  )}

                  {/* Loading state */}
                  {chunksLoading && (
                    <p className="text-[13px] text-[color:var(--ink-muted)]">
                      Loading extraction data...
                    </p>
                  )}

                  {!chunksLoading &&
                    doc.status === "processing" &&
                    chunks === null && (
                      <p className="text-[13px] text-[color:var(--ink-muted)]">
                        This document is still processing. Extraction will
                        appear automatically when it is ready.
                      </p>
                    )}

                  {/* Empty state */}
                  {!chunksLoading &&
                    doc.status !== "processing" &&
                    chunks !== null &&
                    displayBlocks.length === 0 && (
                      <p className="text-[13px] text-[color:var(--ink-muted)]">
                        No extraction content is available for this document.
                      </p>
                    )}

                  {/* Limited-extraction banner — fires when most blocks are
                       sub-30-char scraps, which usually means an image-heavy
                       presentation that Azure layout couldn't read. Honest
                       degradation per the fail-loud rule. */}
                  {!chunksLoading &&
                    chunks !== null &&
                    displayBlocks.length > 0 &&
                    extractionView === "formatted" &&
                    isLimitedExtraction(displayBlocks) && (
                      <div
                        className="mb-4 rounded-md border px-3 py-2 text-[12px] leading-snug"
                        style={{
                          borderColor: "var(--warning)",
                          background: "var(--warning-bg)",
                          color: "var(--ink-muted)",
                        }}
                      >
                        <p
                          className="font-semibold mb-0.5"
                          style={{ color: "var(--ink)" }}
                        >
                          Limited extraction
                        </p>
                        Most blocks below are very short — this is usually an
                        image-heavy document (slides, scans of diagrams) that
                        the layout extractor couldn&apos;t read as text. Open
                        the PDF on the right to see the original.
                      </div>
                    )}

                  {/* Formatted view */}
                  {!chunksLoading &&
                    chunks !== null &&
                    displayBlocks.length > 0 &&
                    extractionView === "formatted" && (
                      <div>
                        {displayBlocks.map((block) => {
                          const confidence = confidenceLabel(block.confidence);
                          const table = block.table
                            ? normalizeTableForRender(block.table)
                            : null;
                          return (
                            <div
                              key={block.key}
                              className="pb-3 mb-3 border-b border-[color:var(--border-light)]"
                            >
                              {/* Chunk header */}
                              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                <span
                                  className="text-[10px] font-semibold text-[color:var(--ink-ghost)]"
                                  style={{ fontFamily: "var(--font-mono)" }}
                                >
                                  P.{block.pageNumber}
                                </span>
                                {block.sectionTitle &&
                                  block.sectionTitle.trim() !==
                                    block.content.trim() && (
                                    <span
                                      className="text-[10px] text-[color:var(--ink-muted)]"
                                      style={{ fontFamily: "var(--font-mono)" }}
                                    >
                                      {block.sectionTitle}
                                    </span>
                                  )}
                                {block.clauseNumber && (
                                  <span
                                    className="text-[10px] text-[color:var(--ink-muted)]"
                                    style={{ fontFamily: "var(--font-mono)" }}
                                  >
                                    Cl. {block.clauseNumber}
                                  </span>
                                )}
                                {confidence && (
                                  <Tag variant={confidenceVariant(confidence)}>
                                    {confidence.toUpperCase()}
                                  </Tag>
                                )}
                                {table && <Tag variant="blue">TABLE</Tag>}
                              </div>
                              {/* Structured table render (if present) */}
                              {table?.rows && table.rows.length > 0 ? (
                                <div className="overflow-x-auto">
                                  {table.caption && (
                                    <p className="text-[11px] font-semibold text-[color:var(--ink)] mb-1">
                                      {table.caption}
                                    </p>
                                  )}
                                  <table className="w-full text-[11px] border-collapse border border-[color:var(--border)]">
                                    {table.headers.length > 0 && (
                                      <thead>
                                        <tr>
                                          {table.headers.map((h, hi) => (
                                            <th
                                              key={hi}
                                              className="border border-[color:var(--border)] bg-[color:var(--surface-sunken)] px-2 py-1 text-left font-semibold text-[color:var(--ink)]"
                                            >
                                              {h}
                                            </th>
                                          ))}
                                        </tr>
                                      </thead>
                                    )}
                                    <tbody>
                                      {table.rows.map((row, ri) => (
                                        <tr key={ri}>
                                          {row.map((cell, ci) => (
                                            <td
                                              key={ci}
                                              className="border border-[color:var(--border)] px-2 py-1 text-[color:var(--ink)]"
                                              dir="auto"
                                            >
                                              {cell}
                                            </td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <p
                                  dir="auto"
                                  className="text-[13px] leading-relaxed text-[color:var(--ink)] whitespace-pre-wrap"
                                  style={{ fontFamily: "var(--font-arabic)" }}
                                >
                                  {block.content}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                  {/* Raw JSON view */}
                  {!chunksLoading &&
                    payload !== null &&
                    extractionView === "raw" && (
                      <pre
                        className="text-[11px] bg-[color:var(--surface-sunken)] p-4 overflow-auto max-h-[calc(100vh-200px)] text-[color:var(--ink)] whitespace-pre-wrap"
                        style={{
                          fontFamily: "var(--font-mono)",
                          borderRadius: "var(--radius-md)",
                        }}
                      >
                        {JSON.stringify(payload, null, 2)}
                      </pre>
                    )}

                  {!chunksLoading &&
                    doc.status !== "processing" &&
                    payload === null &&
                    extractionView === "raw" && (
                      <p className="text-[13px] text-[color:var(--ink-muted)]">
                        No extraction payload is available for this document
                        yet.
                      </p>
                    )}
                </>
              )}
            </div>
          </div>

          {/* Right panel — PDF viewer (memoized so tab switches don't re-render it) */}
          <PdfViewer url={pdfUrl} />
        </main>
      </div>
    </div>
  );
}
