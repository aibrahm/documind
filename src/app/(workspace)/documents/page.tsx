"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Upload as UploadIcon,
  Trash2,
  Pencil,
  Check,
  X,
  FileText,
  Search,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { DocumentContextCard } from "@/components/document-context-card";

interface Doc {
  id: string;
  title: string;
  type: string;
  classification: string;
  language: string;
  page_count: number | null;
  status: string;
  processing_error: string | null;
  context_card: Record<string, unknown> | null;
  entities: string[];
  created_at: string;
}

type ClassFilter = "ALL" | "PRIVATE" | "PUBLIC";

const CLASSIFICATIONS: ClassFilter[] = ["ALL", "PRIVATE", "PUBLIC"];

// User-facing label for each classification. We use "Confidential" and
// "Open" in the UI because those are the words the VC uses when talking
// about documents ("is this open or confidential?"). The stored value
// stays PRIVATE/PUBLIC for now — renaming the column isn't in this sprint.
const CLASS_LABEL: Record<string, string> = {
  ALL: "All",
  PRIVATE: "Confidential",
  PUBLIC: "Open",
};

const CLASS_STYLES: Record<string, { dot: string; text: string }> = {
  PRIVATE: { dot: "bg-rose-500", text: "text-rose-600" },
  PUBLIC: { dot: "bg-blue-500", text: "text-blue-600" },
};

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((startOfToday.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ClassFilter>("ALL");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const fetchDocs = useCallback(() => {
    return fetch("/api/documents")
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((d) => {
        setDocs(d.documents || []);
        return d.documents || [];
      })
      .catch((e) => {
        setError(e.message);
        return [];
      });
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchDocs().finally(() => setLoading(false));
  }, [fetchDocs]);

  // Auto-poll while documents are processing
  useEffect(() => {
    const hasProcessing = docs.some((d) => d.status === "processing");
    if (!hasProcessing) return;
    const interval = setInterval(fetchDocs, 5000);
    return () => clearInterval(interval);
  }, [docs, fetchDocs]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const filteredDocs = useMemo(() => {
    let result = docs;
    if (filter !== "ALL") {
      result = result.filter((d) => {
        // Treat legacy DOCTRINE rows as PUBLIC for filter purposes.
        const normalized = d.classification === "DOCTRINE" ? "PUBLIC" : d.classification;
        return normalized === filter;
      });
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      result = result.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.entities.some((e) => e.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [docs, filter, query]);

  const stats = useMemo(() => {
    const ready = docs.filter((d) => d.status === "ready").length;
    const processing = docs.filter((d) => d.status === "processing").length;
    const errored = docs.filter((d) => d.status === "error").length;
    return { ready, processing, errored, total: docs.length };
  }, [docs]);

  const handleDelete = useCallback(async (e: React.MouseEvent, docId: string) => {
    e.stopPropagation();
    if (!window.confirm("Delete this document? This cannot be undone.")) return;
    setDeleting(docId);
    try {
      const res = await fetch(`/api/documents/${docId}/delete`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setDocs((prev) => prev.filter((d) => d.id !== docId));
    } catch {
      window.alert("Failed to delete document");
    } finally {
      setDeleting(null);
    }
  }, []);

  const startRename = useCallback((e: React.MouseEvent, doc: Doc) => {
    e.stopPropagation();
    setEditingId(doc.id);
    setEditTitle(doc.title);
  }, []);

  const saveRename = useCallback(
    async (docId: string) => {
      const trimmed = editTitle.trim();
      if (!trimmed) {
        setEditingId(null);
        return;
      }
      try {
        const res = await fetch(`/api/documents/${docId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: trimmed }),
        });
        if (!res.ok) throw new Error("Rename failed");
        setDocs((prev) => prev.map((d) => (d.id === docId ? { ...d, title: trimmed } : d)));
      } catch {
        window.alert("Failed to rename document");
      } finally {
        setEditingId(null);
      }
    },
    [editTitle],
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden min-h-0" style={{ background: "var(--surface)" }}>
      <main className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-5xl mx-auto px-8 py-12">
          {/* Header */}
          <div className="flex items-end justify-between mb-8">
            <div>
              <h1
                className="text-3xl font-semibold tracking-tight"
                style={{ color: "var(--ink)", letterSpacing: "-0.02em" }}
              >
                Documents
              </h1>
              <p
                className="mt-1.5 text-sm"
                style={{ color: "var(--ink-muted)" }}
              >
                {stats.total === 0
                  ? "No documents yet."
                  : `${stats.total} document${stats.total === 1 ? "" : "s"}${stats.processing > 0 ? ` · ${stats.processing} processing` : ""}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.push("/upload")}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium cursor-pointer transition-all"
              style={{
                background: "var(--ink)",
                color: "var(--surface-raised)",
                border: "none",
                borderRadius: "var(--radius-md)",
              }}
            >
              <UploadIcon className="w-3.5 h-3.5" />
              Upload
            </button>
          </div>

          {/* Search + filter row */}
          <div className="flex items-center gap-3 mb-5">
            <div className="relative flex-1 max-w-md">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
                style={{ color: "var(--ink-ghost)" }}
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search documents..."
                className="w-full pl-9 pr-3 py-2 text-sm outline-none transition-colors"
                style={{
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--ink)",
                }}
              />
            </div>
            <div className="flex items-center gap-1 ml-auto">
              {CLASSIFICATIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setFilter(c)}
                  className="px-2.5 py-1.5 text-xs font-medium cursor-pointer transition-colors"
                  style={{
                    background:
                      filter === c
                        ? "var(--ink)"
                        : "var(--surface-raised)",
                    color:
                      filter === c
                        ? "var(--surface-raised)"
                        : "var(--ink-muted)",
                    border:
                      filter === c
                        ? "1px solid var(--ink)"
                        : "1px solid var(--border)",
                    borderRadius: "var(--radius-md)",
                  }}
                >
                  {CLASS_LABEL[c] ?? c}
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-[13px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">
              <AlertCircle className="w-4 h-4" />
              Failed to load documents: {error}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-[76px] animate-pulse"
                  style={{
                    background: "var(--surface-sunken)",
                    borderRadius: "var(--radius-lg)",
                  }}
                />
              ))}
            </div>
          )}

          {/* Document list */}
          {!loading && filteredDocs.length > 0 && (
            <div className="space-y-2">
              {filteredDocs.map((doc) => {
                const displayClass =
                  doc.classification === "DOCTRINE" ? "PUBLIC" : doc.classification;
                const classLabel = CLASS_LABEL[displayClass] ?? displayClass;
                const classStyle = CLASS_STYLES[displayClass] || {
                  dot: "bg-slate-400",
                  text: "text-slate-500",
                };
                return (
                  <div
                    key={doc.id}
                    onClick={() => editingId !== doc.id && router.push(`/documents/${doc.id}`)}
                    className="group flex items-center gap-4 px-5 py-4 cursor-pointer transition-all"
                    style={{
                      background: "var(--surface-raised)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-lg)",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "var(--border-strong)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "var(--border)";
                    }}
                  >
                    {/* Icon */}
                    <div
                      className="w-10 h-10 flex items-center justify-center shrink-0"
                      style={{
                        background: "var(--surface-sunken)",
                        borderRadius: "var(--radius-md)",
                      }}
                    >
                      <FileText
                        className="w-4 h-4"
                        style={{ color: "var(--ink-muted)" }}
                        strokeWidth={1.5}
                      />
                    </div>

                    {/* Title + meta */}
                    <div className="flex-1 min-w-0">
                      {editingId === doc.id ? (
                        <input
                          ref={editInputRef}
                          dir="auto"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveRename(doc.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          onBlur={() => saveRename(doc.id)}
                          className="w-full font-['IBM_Plex_Sans_Arabic'] text-[14px] font-medium text-slate-900 bg-slate-50 border border-slate-300 rounded px-2 py-0.5 outline-none focus:border-slate-400"
                        />
                      ) : (
                        <p
                          className="font-['IBM_Plex_Sans_Arabic'] text-[14px] font-medium text-slate-900 truncate"
                          dir="auto"
                        >
                          {doc.title}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-400">
                        <span className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${classStyle.dot}`} />
                          <span className={`font-['JetBrains_Mono'] tracking-wider ${classStyle.text}`}>
                            {classLabel.toUpperCase()}
                          </span>
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className="font-['JetBrains_Mono']">{doc.type.toUpperCase()}</span>
                        {doc.page_count !== null && (
                          <>
                            <span className="text-slate-300">·</span>
                            <span className="font-['JetBrains_Mono']">{doc.page_count} pages</span>
                          </>
                        )}
                        <span className="text-slate-300">·</span>
                        <span className="font-['JetBrains_Mono']">{formatRelativeDate(doc.created_at)}</span>
                      </div>
                      <DocumentContextCard
                        card={doc.context_card}
                        preferredLanguage={doc.language}
                        variant="compact"
                        bordered={false}
                        className="mt-2"
                      />
                      {doc.processing_error && (
                        <p className="mt-2 text-[12px] leading-relaxed text-amber-700">
                          Extraction warning: {doc.processing_error}
                        </p>
                      )}
                    </div>

                    {/* Status indicator */}
                    {doc.status === "processing" && (
                      <span className="flex items-center gap-1.5 text-[11px] text-amber-600 font-['JetBrains_Mono'] uppercase tracking-wider shrink-0">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Processing
                      </span>
                    )}
                    {doc.status === "error" && (
                      <span className="flex items-center gap-1.5 text-[11px] text-red-600 font-['JetBrains_Mono'] uppercase tracking-wider shrink-0">
                        <AlertCircle className="w-3 h-3" />
                        Error
                      </span>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      {editingId === doc.id ? (
                        <>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              saveRename(doc.id);
                            }}
                            className="p-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded cursor-pointer bg-transparent border-none"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setEditingId(null);
                            }}
                            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded cursor-pointer bg-transparent border-none"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={(e) => startRename(e, doc)}
                            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded cursor-pointer bg-transparent border-none"
                            title="Rename"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDelete(e, doc.id)}
                            disabled={deleting === doc.id}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded cursor-pointer bg-transparent border-none disabled:opacity-50"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Empty states */}
          {!loading && filteredDocs.length === 0 && !error && (
            <div
              className="p-16 text-center"
              style={{
                background: "var(--surface-raised)",
                border: "1px dashed var(--border)",
                borderRadius: "var(--radius-xl)",
              }}
            >
              <div
                className="w-12 h-12 mx-auto mb-4 flex items-center justify-center"
                style={{
                  background: "var(--surface-sunken)",
                  borderRadius: "var(--radius-md)",
                }}
              >
                <FileText
                  className="w-5 h-5"
                  style={{ color: "var(--ink-ghost)" }}
                  strokeWidth={1.5}
                />
              </div>
              {docs.length === 0 ? (
                <>
                  <p className="text-sm font-medium mb-1" style={{ color: "var(--ink)" }}>
                    Your library is empty
                  </p>
                  <p className="text-sm mb-5" style={{ color: "var(--ink-muted)" }}>
                    Upload your first document to get started.
                  </p>
                  <button
                    type="button"
                    onClick={() => router.push("/upload")}
                    className="text-sm font-medium px-4 py-2 cursor-pointer transition-colors"
                    style={{
                      background: "var(--ink)",
                      color: "var(--surface-raised)",
                      border: "none",
                      borderRadius: "var(--radius-md)",
                    }}
                  >
                    Upload document
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium mb-1" style={{ color: "var(--ink)" }}>
                    No matches
                  </p>
                  <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
                    Try a different search or filter.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
