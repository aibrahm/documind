"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Upload as UploadIcon,
  FileText,
  Search,
  AlertCircle,
  Loader2,
  Trash2,
  MoreHorizontal,
} from "lucide-react";

interface Doc {
  id: string;
  title: string;
  type: string;
  classification: string;
  language: string;
  page_count: number | null;
  status: string;
  processing_error: string | null;
  entities: string[];
  created_at: string;
}

type ClassFilter = "ALL" | "PRIVATE" | "PUBLIC";
const CLASSIFICATIONS: ClassFilter[] = ["ALL", "PRIVATE", "PUBLIC"];
const CLASS_LABEL: Record<string, string> = {
  ALL: "All",
  PRIVATE: "Confidential",
  PUBLIC: "Open",
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ClassFilter>("ALL");
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
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

  useEffect(() => {
    const hasProcessing = docs.some((d) => d.status === "processing");
    if (!hasProcessing) return;
    const interval = setInterval(fetchDocs, 5000);
    return () => clearInterval(interval);
  }, [docs, fetchDocs]);

  const filteredDocs = useMemo(() => {
    let result = docs;
    if (filter !== "ALL") {
      result = result.filter((d) => {
        const normalized =
          d.classification === "DOCTRINE" ? "PUBLIC" : d.classification;
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
    const processing = docs.filter((d) => d.status === "processing").length;
    return { total: docs.length, processing };
  }, [docs]);

  const handleDelete = useCallback(
    async (e: React.MouseEvent, docId: string) => {
      e.preventDefault();
      e.stopPropagation();
      if (!window.confirm("Delete this document? This cannot be undone."))
        return;
      setDeleting(docId);
      try {
        const res = await fetch(`/api/documents/${docId}/delete`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("Delete failed");
        setDocs((prev) => prev.filter((d) => d.id !== docId));
      } catch {
        window.alert("Failed to delete document");
      } finally {
        setDeleting(null);
      }
    },
    [],
  );

  return (
    <div className="mx-auto max-w-6xl px-8 py-12">
      {/* Header */}
      <div className="mb-10 flex items-end justify-between">
        <div>
          <div
            className="text-xs font-medium mb-2"
            style={{ color: "var(--ink-faint)", letterSpacing: "0.04em" }}
          >
            LIBRARY
          </div>
          <h1
            className="text-4xl font-semibold tracking-tight"
            style={{ color: "var(--ink)", letterSpacing: "-0.02em" }}
          >
            {stats.total}{" "}
            <span
              className="text-2xl font-normal"
              style={{ color: "var(--ink-muted)" }}
            >
              {stats.total === 1 ? "document" : "documents"}
              {stats.processing > 0 ? ` · ${stats.processing} processing` : ""}
            </span>
          </h1>
        </div>
        <button
          type="button"
          onClick={() => router.push("/upload")}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium cursor-pointer transition-colors"
          style={{
            background: "var(--ink)",
            color: "var(--surface-raised)",
            border: "none",
            borderRadius: "var(--radius-md)",
          }}
        >
          <UploadIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
          Upload
        </button>
      </div>

      {/* Search + filter */}
      <div className="mb-4 flex items-center gap-2">
        <div
          className="flex items-center gap-2 flex-1 max-w-sm px-3 py-2"
          style={{
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <Search
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: "var(--ink-ghost)" }}
            strokeWidth={1.5}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documents..."
            className="flex-1 bg-transparent border-0 outline-none text-sm"
            style={{
              color: "var(--ink)",
              fontFamily: "var(--font-sans)",
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
                  filter === c ? "var(--ink)" : "var(--surface-raised)",
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
        <div
          className="flex items-center gap-2 text-sm px-3 py-2 mb-3"
          style={{
            color: "var(--danger)",
            background: "var(--danger-bg)",
            border: "1px solid var(--danger)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <AlertCircle className="w-4 h-4" />
          Failed to load documents: {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
          style={{ gap: "1px", background: "var(--border)" }}
        >
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="h-32 animate-pulse"
              style={{ background: "var(--surface-raised)" }}
            />
          ))}
        </div>
      )}

      {/* Document grid with gridlines */}
      {!loading && filteredDocs.length > 0 && (
        <div
          className="overflow-hidden"
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-xl)",
            background: "var(--border)",
          }}
        >
          <div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
            style={{ gap: "1px", background: "var(--border)" }}
          >
            {filteredDocs.map((doc) => (
              <Link
                key={doc.id}
                href={`/documents/${doc.id}`}
                className="group flex flex-col gap-3 p-5 transition-colors min-h-[140px] relative"
                style={{ background: "var(--surface-raised)" }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="flex h-9 w-9 items-center justify-center shrink-0"
                    style={{
                      background: "var(--surface-sunken)",
                      borderRadius: "var(--radius-md)",
                    }}
                  >
                    <FileText
                      className="h-4 w-4"
                      style={{ color: "var(--ink-muted)" }}
                      strokeWidth={1.5}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-sm font-medium leading-tight line-clamp-2"
                      dir="auto"
                      style={{ color: "var(--ink)" }}
                    >
                      {doc.title}
                    </div>
                    <div
                      className="text-xs mt-1 capitalize"
                      style={{ color: "var(--ink-faint)" }}
                    >
                      {doc.type}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-auto text-xs" style={{ color: "var(--ink-faint)" }}>
                  {doc.page_count !== null && (
                    <>
                      <span className="tabular-nums">
                        {doc.page_count} {doc.page_count === 1 ? "page" : "pages"}
                      </span>
                      <span
                        className="h-1 w-1 rounded-full"
                        style={{ background: "var(--ink-ghost)" }}
                      />
                    </>
                  )}
                  <span suppressHydrationWarning>
                    {formatDate(doc.created_at)}
                  </span>
                  {doc.status === "processing" && (
                    <>
                      <span
                        className="h-1 w-1 rounded-full ml-auto"
                        style={{ background: "var(--warning)" }}
                      />
                      <span
                        className="flex items-center gap-1"
                        style={{ color: "var(--warning)" }}
                      >
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Processing
                      </span>
                    </>
                  )}
                  {doc.status === "error" && (
                    <span
                      className="flex items-center gap-1 ml-auto"
                      style={{ color: "var(--danger)" }}
                    >
                      <AlertCircle className="h-3 w-3" />
                      Error
                    </span>
                  )}
                </div>

                {/* Delete action - hover reveal */}
                <button
                  type="button"
                  onClick={(e) => handleDelete(e, doc.id)}
                  disabled={deleting === doc.id}
                  className="absolute top-3 right-3 p-1.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  style={{
                    color: "var(--ink-muted)",
                    background: "var(--surface-sunken)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                  }}
                  aria-label="Delete document"
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "var(--danger)";
                    e.currentTarget.style.borderColor = "var(--danger)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "var(--ink-muted)";
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                >
                  <Trash2 className="h-3 w-3" strokeWidth={1.5} />
                </button>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
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
              <p
                className="text-sm font-medium mb-1"
                style={{ color: "var(--ink)" }}
              >
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
              <p
                className="text-sm font-medium mb-1"
                style={{ color: "var(--ink)" }}
              >
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
  );
}
