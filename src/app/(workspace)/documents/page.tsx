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
} from "lucide-react";
import { PageHeader } from "@/components/page-header";

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
  is_reference?: boolean;
  project_ids?: string[];
  project_names?: string[];
}

type ScopeFilter = "ALL" | "REFERENCE" | "IN_PROJECT";
const SCOPES: ScopeFilter[] = ["ALL", "IN_PROJECT", "REFERENCE"];
const SCOPE_LABEL: Record<string, string> = {
  ALL: "All",
  REFERENCE: "Reference",
  IN_PROJECT: "In project",
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
  const [scope, setScope] = useState<ScopeFilter>("ALL");
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
    if (scope !== "ALL") {
      result = result.filter((d) => {
        const inProject = (d.project_ids?.length ?? 0) > 0;
        if (scope === "REFERENCE") return !inProject;
        if (scope === "IN_PROJECT") return inProject;
        return true;
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
  }, [docs, scope, query]);

  const scopeCounts = useMemo(() => {
    const inProject = docs.filter((d) => (d.project_ids?.length ?? 0) > 0).length;
    return {
      ALL: docs.length,
      IN_PROJECT: inProject,
      REFERENCE: docs.length - inProject,
    } as Record<ScopeFilter, number>;
  }, [docs]);

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
    <>
      <PageHeader
        eyebrow="LIBRARY"
        title={
          <>
            {stats.total}{" "}
            <span style={{ color: "var(--ink-muted)", fontWeight: 400 }}>
              {stats.total === 1 ? "document" : "documents"}
              {stats.processing > 0 ? ` · ${stats.processing} processing` : ""}
            </span>
          </>
        }
      />
      <div>

      {/* Toolbar — edge-to-edge gridline strip: search cell + filter cells */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: `1fr repeat(${SCOPES.length}, auto)`,
          gap: "1px",
          background: "var(--border)",
          borderTop: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {/* Search cell */}
        <div
          className="flex items-center gap-2 px-5"
          style={{ background: "var(--surface-raised)" }}
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
            className="flex-1 bg-transparent border-0 outline-none text-sm py-3"
            style={{
              color: "var(--ink)",
              fontFamily: "var(--font-sans)",
            }}
          />
        </div>

        {/* Scope filter cells */}
        {SCOPES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            className="flex items-center gap-2 px-5 py-3 text-sm font-medium cursor-pointer transition-colors whitespace-nowrap"
            style={{
              background:
                scope === s ? "var(--ink)" : "var(--surface-raised)",
              color:
                scope === s
                  ? "var(--surface-raised)"
                  : "var(--ink-muted)",
              border: "none",
            }}
            onMouseEnter={(e) => {
              if (scope !== s) {
                e.currentTarget.style.background =
                  "var(--surface-sunken)";
                e.currentTarget.style.color = "var(--ink)";
              }
            }}
            onMouseLeave={(e) => {
              if (scope !== s) {
                e.currentTarget.style.background =
                  "var(--surface-raised)";
                e.currentTarget.style.color = "var(--ink-muted)";
              }
            }}
          >
            {SCOPE_LABEL[s] ?? s}
            <span
              className="tabular-nums text-xs"
              style={{
                color:
                  scope === s
                    ? "color-mix(in srgb, var(--surface-raised) 55%, transparent)"
                    : "var(--ink-faint)",
              }}
            >
              {scopeCounts[s] ?? 0}
            </span>
          </button>
        ))}
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
          className="overflow-hidden"
          style={{
            borderTop: "1px solid var(--border)",
            borderBottom: "1px solid var(--border)",
            background: "var(--border)",
          }}
        >
          <div style={{ display: "grid", gap: "1px", background: "var(--border)" }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-16 animate-pulse"
                style={{ background: "var(--surface-raised)" }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Document list with gridlines */}
      {!loading && filteredDocs.length > 0 && (
        <div
          className="overflow-hidden"
          style={{
            borderTop: "1px solid var(--border)",
            borderBottom: "1px solid var(--border)",
            background: "var(--border)",
          }}
        >
          <div style={{ display: "grid", gap: "1px", background: "var(--border)" }}>
            {filteredDocs.map((doc) => (
              <Link
                key={doc.id}
                href={`/documents/${doc.id}`}
                className="group flex items-center gap-4 px-5 py-4 transition-colors relative"
                style={{ background: "var(--surface-raised)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--surface-sunken)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--surface-raised)";
                }}
              >
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
                    className="text-sm font-medium truncate"
                    dir="auto"
                    style={{ color: "var(--ink)" }}
                  >
                    {doc.title}
                  </div>
                  <div
                    className="flex items-center gap-2 mt-0.5 text-xs"
                    style={{ color: "var(--ink-faint)" }}
                  >
                    <span className="capitalize">{doc.type}</span>
                    {doc.page_count !== null && (
                      <>
                        <span
                          className="h-1 w-1 rounded-full"
                          style={{ background: "var(--ink-ghost)" }}
                        />
                        <span className="tabular-nums">
                          {doc.page_count} {doc.page_count === 1 ? "page" : "pages"}
                        </span>
                      </>
                    )}
                    <span
                      className="h-1 w-1 rounded-full"
                      style={{ background: "var(--ink-ghost)" }}
                    />
                    <span suppressHydrationWarning>
                      {formatDate(doc.created_at)}
                    </span>
                  </div>
                </div>

                {/* Project / reference badge */}
                {doc.project_names && doc.project_names.length > 0 ? (
                  <span
                    className="text-xs shrink-0 px-2 py-0.5"
                    style={{
                      color: "var(--accent)",
                      background: "var(--accent-bg)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  >
                    {doc.project_names[0]}
                    {doc.project_names.length > 1 &&
                      ` +${doc.project_names.length - 1}`}
                  </span>
                ) : (
                  <span
                    className="text-xs shrink-0 px-2 py-0.5"
                    style={{
                      color: "var(--ink-muted)",
                      background: "var(--surface-sunken)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  >
                    Reference
                  </span>
                )}

                {doc.status === "processing" && (
                  <span
                    className="flex items-center gap-1 text-xs shrink-0"
                    style={{ color: "var(--warning)" }}
                  >
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Processing
                  </span>
                )}
                {doc.status === "error" && (
                  <span
                    className="flex items-center gap-1 text-xs shrink-0"
                    style={{ color: "var(--danger)" }}
                  >
                    <AlertCircle className="h-3 w-3" />
                    Error
                  </span>
                )}

                <button
                  type="button"
                  onClick={(e) => handleDelete(e, doc.id)}
                  disabled={deleting === doc.id}
                  className="p-1.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                  style={{
                    color: "var(--ink-muted)",
                    background: "transparent",
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                  }}
                  aria-label="Delete document"
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "var(--danger)";
                    e.currentTarget.style.background = "var(--danger-bg)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "var(--ink-muted)";
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
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
            borderTop: "1px solid var(--border)",
            borderBottom: "1px solid var(--border)",
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
    </>
  );
}
