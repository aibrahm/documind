"use client";

import { useState, useEffect, useCallback, use, memo, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { Tag } from "@/components/ui-system";

interface DocDetail {
  id: string;
  title: string;
  type: string;
  classification: string;
  language: string;
  page_count: number;
  status: string;
  metadata: Record<string, unknown>;
  entities: string[];
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

/**
 * Renders the iframe via a portal to document.body so DOM changes in the
 * left panel can never trigger a repaint of the Chrome PDF plugin.
 * A placeholder div reserves space in the layout; a ResizeObserver keeps
 * the portal positioned over it.
 */
const PdfViewer = memo(function PdfViewer({ url }: { url: string | null }) {
  const placeholderRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
      <div ref={placeholderRef} className="flex-1 bg-slate-100" />
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
                <span className="text-[13px] text-slate-500">Loading preview...</span>
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
  DOCTRINE: "green",
  PUBLIC: "blue",
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
  const [chunksLoading, setChunksLoading] = useState(false);
  const [extractionView, setExtractionView] = useState<ExtractionView>("formatted");
  const [copied, setCopied] = useState(false);

  const loadChunks = useCallback(() => {
    if (chunks !== null || chunksLoading) return;
    setChunksLoading(true);
    fetch(`/api/documents/${id}/extraction`)
      .then((r) => r.json())
      .then((d) => setChunks(d.chunks || []))
      .catch(() => setChunks([]))
      .finally(() => setChunksLoading(false));
  }, [id, chunks, chunksLoading]);

  const handleTabClick = (tab: LeftTab) => {
    setLeftTab(tab);
    if (tab === "extraction") loadChunks();
  };

  const copyJson = () => {
    if (!chunks) return;
    navigator.clipboard.writeText(JSON.stringify(chunks, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const confidenceVariant = (level: string): "green" | "amber" | "red" | "default" => {
    if (level === "high") return "green";
    if (level === "medium") return "amber";
    if (level === "low") return "red";
    return "default";
  };

  useEffect(() => {
    fetch(`/api/documents/${id}`)
      .then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (d?.document) setDoc(d.document);
        else if (d) setNotFound(true);
      })
      .catch(() => setNotFound(true));

    fetch(`/api/documents/${id}/references`)
      .then((r) => r.json())
      .then((d) => setRefs(d.references || []))
      .catch(() => {});

    fetch(`/api/documents/${id}/url`)
      .then((r) => r.json())
      .then((d) => setPdfUrl(d.url))
      .catch(() => {});
  }, [id]);

  /* 404 state */
  if (notFound) {
    return (
      <div className="flex flex-1 flex-col bg-white overflow-hidden">
        <div className="flex-1 flex items-center justify-center flex-col gap-2">
          <div className="w-12 h-12 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center mb-2">
            <FileText className="w-5 h-5 text-slate-300" />
          </div>
          <p className="text-[15px] font-semibold text-slate-900">Document not found</p>
          <p className="text-[13px] text-slate-500">It may have been deleted.</p>
          <button
            type="button"
            onClick={() => router.push("/documents")}
            className="mt-3 text-[12px] font-medium text-white bg-slate-900 hover:bg-slate-800 border-none rounded-md px-3 py-1.5 cursor-pointer"
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
      <div className="flex flex-1 flex-col bg-white overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[13px] text-slate-400">Loading document...</p>
        </div>
      </div>
    );
  }

  const meta = (doc.metadata || {}) as Record<string, unknown>;
  const dates = Array.isArray(meta.dates)
    ? (meta.dates as Array<{ iso?: string }>)
        .map((d) => d.iso || "")
        .filter(Boolean)
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

  return (
    <div className="flex flex-1 flex-col bg-white overflow-hidden">
      <main className="flex overflow-hidden flex-1 min-h-0">
        {/* Left panel — metadata / extraction */}
        <div className="w-[360px] shrink-0 overflow-auto bg-white border-r border-slate-200 flex flex-col">
          {/* Back button + Tab bar */}
          <div className="flex items-center border-b border-slate-200 px-5 pt-3 gap-4">
            <button
              onClick={() => router.push("/documents")}
              className="flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-900 transition-colors mr-2 shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </button>
            <div className="w-px h-4 bg-slate-200" />
            <button
              onClick={() => handleTabClick("details")}
              className={`font-['JetBrains_Mono'] text-[11px] tracking-wider pb-2 ${
                leftTab === "details"
                  ? "border-b-2 border-slate-900 text-slate-900"
                  : "text-slate-400 hover:text-slate-600"
              }`}
            >
              DETAILS
            </button>
            <button
              onClick={() => handleTabClick("extraction")}
              className={`font-['JetBrains_Mono'] text-[11px] tracking-wider pb-2 ${
                leftTab === "extraction"
                  ? "border-b-2 border-slate-900 text-slate-900"
                  : "text-slate-400 hover:text-slate-600"
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
                    {doc.classification}
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
                  className="font-['IBM_Plex_Sans_Arabic'] text-lg font-bold leading-snug text-slate-900 mt-3 mb-6"
                >
                  {doc.title}
                </h1>

                {/* Details section */}
                <div className="mb-6">
                  <p className="font-['JetBrains_Mono'] text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    DETAILS
                  </p>
                  {details.map(([k, v], i) => (
                    <div
                      key={i}
                      className="flex justify-between py-1.5 border-b border-slate-100"
                    >
                      <span className="text-xs text-slate-500">{k}</span>
                      <span className="font-['JetBrains_Mono'] text-xs text-slate-700">
                        {v}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Entities section */}
                {doc.entities.length > 0 && (
                  <div className="mb-6">
                    <p className="font-['JetBrains_Mono'] text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                      ENTITIES
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {doc.entities.map((e, i) => (
                        <span
                          key={i}
                          dir="auto"
                          className="text-xs text-slate-600 bg-slate-100 rounded px-2 py-0.5 font-['IBM_Plex_Sans_Arabic']"
                        >
                          {e}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* References section */}
                {refs.length > 0 && (
                  <div>
                    <p className="font-['JetBrains_Mono'] text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                      REFERENCES &middot; {refs.length}
                    </p>
                    {refs.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center gap-2 py-1.5 border-b border-slate-100"
                      >
                        <span
                          dir="auto"
                          className="font-['IBM_Plex_Sans_Arabic'] text-xs text-slate-700 flex-1"
                        >
                          {r.reference_text}
                        </span>
                        <span className="font-['JetBrains_Mono'] text-[9px] uppercase text-slate-400">
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
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    Formatted
                  </button>
                  <button
                    onClick={() => setExtractionView("raw")}
                    className={`font-['JetBrains_Mono'] text-[11px] tracking-wider px-2 py-1 rounded ${
                      extractionView === "raw"
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    Raw JSON
                  </button>
                  {extractionView === "raw" && (
                    <button
                      onClick={copyJson}
                      className="font-['JetBrains_Mono'] text-[11px] tracking-wider px-2 py-1 rounded bg-slate-100 text-slate-500 hover:text-slate-700 ml-auto"
                    >
                      {copied ? "Copied!" : "Copy JSON"}
                    </button>
                  )}
                </div>

                {/* Loading state */}
                {chunksLoading && (
                  <p className="text-[13px] text-slate-500">
                    Loading extraction data...
                  </p>
                )}

                {/* Empty state */}
                {!chunksLoading && chunks !== null && chunks.length === 0 && (
                  <p className="text-[13px] text-slate-500">
                    No extracted chunks found for this document.
                  </p>
                )}

                {/* Formatted view */}
                {!chunksLoading &&
                  chunks !== null &&
                  chunks.length > 0 &&
                  extractionView === "formatted" && (
                    <div>
                      {chunks.map((chunk) => {
                        const confidence =
                          typeof chunk.metadata?.confidence === "string"
                            ? chunk.metadata.confidence
                            : null;
                        const table =
                          chunk.metadata?.table &&
                          typeof chunk.metadata.table === "object"
                            ? (chunk.metadata.table as {
                                caption?: string;
                                headers?: string[];
                                rows?: string[][];
                              })
                            : null;
                        return (
                          <div
                            key={chunk.id}
                            className="pb-3 mb-3 border-b border-slate-100"
                          >
                            {/* Chunk header */}
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                              <span className="font-['JetBrains_Mono'] text-[10px] font-semibold text-slate-400">
                                P.{chunk.page_number}
                              </span>
                              {chunk.section_title && (
                                <span className="font-['JetBrains_Mono'] text-[10px] text-slate-600">
                                  {chunk.section_title}
                                </span>
                              )}
                              {chunk.clause_number && (
                                <span className="font-['JetBrains_Mono'] text-[10px] text-slate-500">
                                  Cl. {chunk.clause_number}
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
                                  <p className="text-[11px] font-semibold text-slate-700 mb-1">
                                    {table.caption}
                                  </p>
                                )}
                                <table className="w-full text-[11px] border-collapse border border-slate-200">
                                  {table.headers && table.headers.length > 0 && (
                                    <thead>
                                      <tr>
                                        {table.headers.map((h, hi) => (
                                          <th
                                            key={hi}
                                            className="border border-slate-200 bg-slate-50 px-2 py-1 text-left font-semibold text-slate-700"
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
                                            className="border border-slate-200 px-2 py-1 text-slate-700"
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
                                className="font-['IBM_Plex_Sans_Arabic'] text-[13px] leading-relaxed text-slate-700 whitespace-pre-wrap"
                              >
                                {chunk.content}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                {/* Raw JSON view */}
                {!chunksLoading &&
                  chunks !== null &&
                  chunks.length > 0 &&
                  extractionView === "raw" && (
                    <pre className="font-['JetBrains_Mono'] text-[11px] bg-slate-50 p-4 rounded-lg overflow-auto max-h-[calc(100vh-200px)] text-slate-700 whitespace-pre-wrap">
                      {JSON.stringify(chunks, null, 2)}
                    </pre>
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
