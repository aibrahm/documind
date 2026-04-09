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

type ClassFilter = "ALL" | "PRIVATE" | "PUBLIC" | "DOCTRINE";

const CLASSIFICATIONS: ClassFilter[] = ["ALL", "PRIVATE", "PUBLIC", "DOCTRINE"];

const CLASS_STYLES: Record<string, { dot: string; text: string }> = {
  PRIVATE: { dot: "bg-rose-500", text: "text-rose-600" },
  PUBLIC: { dot: "bg-blue-500", text: "text-blue-600" },
  DOCTRINE: { dot: "bg-emerald-500", text: "text-emerald-600" },
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
    if (filter !== "ALL") result = result.filter((d) => d.classification === filter);
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
    <div className="flex flex-1 flex-col bg-white overflow-hidden min-h-0">
      <main className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-5xl mx-auto px-6 py-10">
          {/* Header */}
          <div className="flex items-end justify-between mb-2">
            <div>
              <h1 className="text-[28px] font-semibold text-slate-900 tracking-tight">Knowledge base</h1>
              <p className="text-[14px] text-slate-500 mt-1">
                {stats.total === 0
                  ? "No documents yet."
                  : `${stats.ready} ready · ${stats.processing > 0 ? `${stats.processing} processing · ` : ""}${stats.total} total`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.push("/upload")}
              className="flex items-center gap-1.5 text-[13px] font-medium px-4 py-2 bg-slate-900 text-white border-none rounded-lg cursor-pointer hover:bg-slate-800 transition-colors shadow-sm"
            >
              <UploadIcon className="w-3.5 h-3.5" />
              Upload
            </button>
          </div>

          {/* Search + filter row */}
          <div className="flex items-center gap-3 mt-6 mb-5">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by title or entity..."
                className="w-full pl-9 pr-3 py-2 text-[13px] bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-slate-300 focus:outline-none transition-colors placeholder:text-slate-400"
              />
            </div>
            <div className="flex items-center gap-1 ml-auto">
              {CLASSIFICATIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setFilter(c)}
                  className={`font-['JetBrains_Mono'] text-[10px] font-semibold tracking-wider uppercase px-2.5 py-1.5 rounded-md cursor-pointer transition-colors border ${
                    filter === c
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-transparent text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700"
                  }`}
                >
                  {c}
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
                  className="h-[68px] bg-slate-50 border border-slate-100 rounded-lg animate-pulse"
                />
              ))}
            </div>
          )}

          {/* Document list */}
          {!loading && filteredDocs.length > 0 && (
            <div className="space-y-1.5">
              {filteredDocs.map((doc) => {
                const classStyle = CLASS_STYLES[doc.classification] || {
                  dot: "bg-slate-400",
                  text: "text-slate-500",
                };
                return (
                  <div
                    key={doc.id}
                    onClick={() => editingId !== doc.id && router.push(`/documents/${doc.id}`)}
                    className="group flex items-center gap-4 px-4 py-3 bg-white border border-slate-200 hover:border-slate-300 hover:shadow-sm rounded-lg cursor-pointer transition-all"
                  >
                    {/* Icon */}
                    <div className="w-9 h-9 rounded-md bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4 text-slate-400" />
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
                            {doc.classification}
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
            <div className="border border-dashed border-slate-200 rounded-xl p-16 text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-slate-50 flex items-center justify-center">
                <FileText className="w-5 h-5 text-slate-300" />
              </div>
              {docs.length === 0 ? (
                <>
                  <p className="text-[15px] font-medium text-slate-900 mb-1">Your knowledge base is empty</p>
                  <p className="text-[13px] text-slate-500 mb-5">
                    Upload your first document to make it searchable.
                  </p>
                  <button
                    type="button"
                    onClick={() => router.push("/upload")}
                    className="text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 border-none rounded-lg px-4 py-2 cursor-pointer transition-colors"
                  >
                    Upload your first document
                  </button>
                </>
              ) : (
                <>
                  <p className="text-[15px] font-medium text-slate-900 mb-1">No matches</p>
                  <p className="text-[13px] text-slate-500">
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
