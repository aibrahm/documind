"use client";

import { useState, useEffect, useCallback, use, memo, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import type {
  ExtractedTable,
  NormalizedExtractionPayload,
} from "@/lib/extraction-schema";
import { DocumentContextCard } from "@/components/document-context-card";
import { Tag } from "@/components/ui-system";
import { EntityEditor } from "@/components/entity-editor";
import { sanitizeDateString } from "@/lib/date-sanitize";
import { ChevronDown, ChevronUp } from "lucide-react";

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
  if (!metadata || typeof metadata.table !== "object" || !metadata.table) return null;

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
    headers = [...headers, ...Array.from({ length: maxColumns - headers.length }, () => "")];
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

function confidenceLabel(confidence: number | null): "high" | "medium" | "low" | null {
  if (confidence === null || !Number.isFinite(confidence)) return null;
  if (confidence >= 0.9) return "high";
  if (confidence >= 0.7) return "medium";
  return "low";
}

function buildDisplayBlocks(
  payload: NormalizedExtractionPayload | null,
  chunks: ChunkData[] | null,
): DisplayBlock[] {
  if (payload) {
    return payload.pages.flatMap((page) =>
      page.sections.map((section, index) => ({
        key: `${page.pageNumber}-${index}-${section.type}`,
        pageNumber: page.pageNumber,
        sectionTitle: section.title,
        clauseNumber: section.clauseNumber,
        content: section.content,
        confidence:
          typeof section.confidence === "number" && Number.isFinite(section.confidence)
            ? section.confidence
            : null,
        table: section.table || null,
      })),
    );
  }

  if (!chunks) return [];

  return chunks.map((chunk) => ({
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
  }));
}

/**
 * Renders the iframe via a portal to document.body so DOM changes in the
 * left panel can never trigger a repaint of the Chrome PDF plugin.
 * A placeholder div reserves space in the layout; a ResizeObserver keeps
 * the portal positioned over it.
 */
const PdfViewer = memo(function PdfViewer({ url }: { url: string | null }) {
  const placeholderRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const mounted = typeof window !== "undefined";

  useEffect(() => {
    const el = placeholderRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
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
      <div ref={placeholderRef} className="flex-1 bg-[color:var(--surface-sunken)]" />
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
              background: "#f1f5f9",
              zIndex: 1,
            }}
          >
            {!url && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[13px] text-[color:var(--ink-muted)]">Loading preview...</span>
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
  const [payload, setPayload] = useState<NormalizedExtractionPayload | null>(null);
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
  const [extractionView, setExtractionView] = useState<ExtractionView>("formatted");
  const [copied, setCopied] = useState(false);
  // Entities collapsed by default on the details panel. The old page
  // rendered the full EntityEditor inline which was a wall of 15-20 items
  // with duplicated OCR spellings — overwhelming on open. Collapsed means
  // the user sees a small "N entities" chip and can expand if they care.
  const [entitiesExpanded, setEntitiesExpanded] = useState(false);

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
  const loadChunks = useCallback((force = false) => {
    if (chunksLoadingRef.current) return;
    if (!force && (chunksRef.current !== null || docStatusRef.current === "processing")) return;
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
  }, [id]);

  const handleTabClick = (tab: LeftTab) => {
    setLeftTab(tab);
    if (tab === "extraction") loadChunks();
  };

  const copyJson = () => {
    const jsonPayload =
      extractionView === "raw"
        ? payload ?? { error: "No extraction payload is available for this document." }
        : chunks;
    if (!jsonPayload) return;
    navigator.clipboard.writeText(JSON.stringify(jsonPayload, null, 2)).then(() => {
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
      <div className="flex flex-1 flex-col bg-[color:var(--surface-raised)] overflow-hidden min-h-0">
        <div className="flex-1 flex items-center justify-center flex-col gap-2">
          <div className="w-12 h-12 rounded-md bg-[color:var(--surface-sunken)] border border-[color:var(--border-light)] flex items-center justify-center mb-2">
            <FileText className="w-5 h-5 text-[color:var(--ink-ghost)]" />
          </div>
          <p className="text-[15px] font-semibold text-[color:var(--ink)]">Document not found</p>
          <p className="text-[13px] text-[color:var(--ink-muted)]">It may have been deleted.</p>
          <button
            type="button"
            onClick={() => router.push("/documents")}
            className="mt-3 text-[12px] font-medium text-white bg-[color:var(--ink)] hover:bg-[color:var(--ink-strong)] border-none rounded-md px-3 py-1.5 cursor-pointer"
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
      <div className="flex flex-1 flex-col bg-[color:var(--surface-raised)] overflow-hidden min-h-0">
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[13px] text-[color:var(--ink-ghost)]">Loading document...</p>
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
    [
      "Version",
      `${doc.version_number}${doc.is_current ? " (current)" : ""}`,
    ],
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

  return (
    <div className="flex flex-1 flex-col bg-[color:var(--surface-raised)] overflow-hidden min-h-0">
      <main className="flex overflow-hidden flex-1 min-h-0">
        {/* Left panel — metadata / extraction */}
        <div className="w-[360px] shrink-0 overflow-auto bg-[color:var(--surface-raised)] border-r border-[color:var(--border)] flex flex-col">
          {/* Back button + Tab bar */}
          <div className="flex items-center border-b border-[color:var(--border)] px-5 pt-3 gap-4">
            <button
              onClick={() => router.push("/documents")}
              className="flex items-center gap-1 text-[12px] text-[color:var(--ink-muted)] hover:text-[color:var(--ink)] transition-colors mr-2 shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </button>
            <div className="w-px h-4 bg-[color:var(--border)]" />
            <button
              onClick={() => handleTabClick("details")}
              className={`font-['JetBrains_Mono'] text-[11px] tracking-wider pb-2 ${
                leftTab === "details"
                  ? "border-b-2 border-slate-900 text-[color:var(--ink)]"
                  : "text-[color:var(--ink-ghost)] hover:text-[color:var(--ink-muted)]"
              }`}
            >
              DETAILS
            </button>
            <button
              onClick={() => handleTabClick("extraction")}
              className={`font-['JetBrains_Mono'] text-[11px] tracking-wider pb-2 ${
                leftTab === "extraction"
                  ? "border-b-2 border-slate-900 text-[color:var(--ink)]"
                  : "text-[color:var(--ink-ghost)] hover:text-[color:var(--ink-muted)]"
              }`}
            >
              EXTRACTION
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-auto p-5">
            {leftTab === "details" && (
              <>
                {/* Tags row */}
                <div className="flex items-center gap-2 mb-3">
                  <Tag variant={TYPE_VARIANT[doc.type] || "default"}>
                    {doc.type.toUpperCase()}
                  </Tag>
                  <Tag variant={CLASS_VARIANT[doc.classification] || "default"}>
                    {CLASS_DISPLAY[doc.classification] || doc.classification}
                  </Tag>
                  <span
                    className={`font-['JetBrains_Mono'] text-[10px] font-semibold ${
                      doc.status === "ready"
                        ? "text-green-600"
                        : doc.status === "error"
                          ? "text-red-600"
                          : "text-amber-600"
                    }`}
                  >
                    {doc.status.toUpperCase()}
                  </span>
                </div>

                {/* Title */}
                <h1
                  dir="auto"
                  className="font-['IBM_Plex_Sans_Arabic'] text-lg font-bold leading-snug text-[color:var(--ink)] mt-3 mb-6"
                >
                  {doc.title}
                </h1>

                <DocumentContextCard
                  card={doc.context_card}
                  preferredLanguage={doc.language}
                  className="mb-6"
                />

                {/*
                  Primary action: go talk to the assistant about this
                  document. The old detail page was a forensic dump with
                  no way to act on it; this one button is the whole point.
                  Sends the user to chat with the document pre-pinned.
                */}
                <button
                  type="button"
                  onClick={() =>
                    router.push(`/?pinned_document=${doc.id}`)
                  }
                  className="mb-6 w-full flex items-center justify-center gap-2 bg-[color:var(--ink)] hover:bg-[color:var(--ink-strong)] text-white font-semibold text-[13px] rounded-md py-3 border-none cursor-pointer transition-colors"
                >
                  Ask about this document →
                </button>

                {/* Extraction warnings surface quietly only if present. */}
                {doc.processing_error && (
                  <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                    <p className="text-[12px] font-semibold uppercase tracking-wider text-amber-900">
                      Extraction warning
                    </p>
                    <p className="mt-1 text-[12px] leading-snug text-amber-800">
                      {doc.processing_error}
                    </p>
                  </div>
                )}

                {/* Details section */}
                <div className="mb-6">
                  <p className="font-['JetBrains_Mono'] text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ink-ghost)] mb-2">
                    DETAILS
                  </p>
                  {details.map(([k, v], i) => (
                    <div
                      key={i}
                      className="flex justify-between py-1.5 border-b border-[color:var(--border-light)]"
                    >
                      <span className="text-xs text-[color:var(--ink-muted)]">{k}</span>
                      <span className="font-['JetBrains_Mono'] text-xs text-[color:var(--ink)]">
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
                    <span className="font-['JetBrains_Mono'] text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ink-ghost)]">
                      Entities{doc.entities?.length ? ` · ${doc.entities.length}` : ""}
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
                    <p className="font-['JetBrains_Mono'] text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ink-ghost)] mb-2">
                      REFERENCES &middot; {refs.length}
                    </p>
                    {refs.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center gap-2 py-1.5 border-b border-[color:var(--border-light)]"
                      >
                        <span
                          dir="auto"
                          className="font-['IBM_Plex_Sans_Arabic'] text-xs text-[color:var(--ink)] flex-1"
                        >
                          {r.reference_text}
                        </span>
                        <span className="font-['JetBrains_Mono'] text-[9px] uppercase text-[color:var(--ink-ghost)]">
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
                    className={`font-['JetBrains_Mono'] text-[11px] tracking-wider px-2 py-1 rounded ${
                      extractionView === "formatted"
                        ? "bg-[color:var(--ink)] text-white"
                        : "bg-[color:var(--surface-sunken)] text-[color:var(--ink-muted)] hover:text-[color:var(--ink)]"
                    }`}
                  >
                    Formatted
                  </button>
                  <button
                    onClick={() => setExtractionView("raw")}
                    className={`font-['JetBrains_Mono'] text-[11px] tracking-wider px-2 py-1 rounded ${
                      extractionView === "raw"
                        ? "bg-[color:var(--ink)] text-white"
                        : "bg-[color:var(--surface-sunken)] text-[color:var(--ink-muted)] hover:text-[color:var(--ink)]"
                    }`}
                  >
                    Raw JSON
                  </button>
                  {extractionView === "raw" && (
                    <button
                      onClick={copyJson}
                      className="font-['JetBrains_Mono'] text-[11px] tracking-wider px-2 py-1 rounded bg-[color:var(--surface-sunken)] text-[color:var(--ink-muted)] hover:text-[color:var(--ink)] ml-auto"
                    >
                      {copied ? "Copied!" : "Copy JSON"}
                    </button>
                  )}
                </div>

                {payload && (
                  <p className="font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-[color:var(--ink-ghost)] mb-4">
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
                      This document is still processing. Extraction will appear automatically when it is ready.
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

                {/* Formatted view */}
                {!chunksLoading &&
                  chunks !== null &&
                  displayBlocks.length > 0 &&
                  extractionView === "formatted" && (
                    <div>
                      {displayBlocks.map((block) => {
                        const confidence = confidenceLabel(block.confidence);
                        const table = block.table ? normalizeTableForRender(block.table) : null;
                        return (
                          <div
                            key={block.key}
                            className="pb-3 mb-3 border-b border-[color:var(--border-light)]"
                          >
                            {/* Chunk header */}
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                              <span className="font-['JetBrains_Mono'] text-[10px] font-semibold text-[color:var(--ink-ghost)]">
                                P.{block.pageNumber}
                              </span>
                              {block.sectionTitle && (
                                <span className="font-['JetBrains_Mono'] text-[10px] text-[color:var(--ink-muted)]">
                                  {block.sectionTitle}
                                </span>
                              )}
                              {block.clauseNumber && (
                                <span className="font-['JetBrains_Mono'] text-[10px] text-[color:var(--ink-muted)]">
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
                            {table && table.rows && table.rows.length > 0 ? (
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
                                className="font-['IBM_Plex_Sans_Arabic'] text-[13px] leading-relaxed text-[color:var(--ink)] whitespace-pre-wrap"
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
                    <pre className="font-['JetBrains_Mono'] text-[11px] bg-[color:var(--surface-sunken)] p-4 rounded-lg overflow-auto max-h-[calc(100vh-200px)] text-[color:var(--ink)] whitespace-pre-wrap">
                      {JSON.stringify(payload, null, 2)}
                    </pre>
                  )}

                {!chunksLoading &&
                  doc.status !== "processing" &&
                  payload === null &&
                  extractionView === "raw" && (
                    <p className="text-[13px] text-[color:var(--ink-muted)]">
                      No extraction payload is available for this document yet.
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
  );
}
