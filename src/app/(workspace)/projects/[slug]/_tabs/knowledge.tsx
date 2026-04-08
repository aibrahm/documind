"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { FileText, ExternalLink, Plus, Loader2, Unlink2 } from "lucide-react";
import { Tag } from "@/components/ui-system";
import { Button } from "@/components/ui/button";
import { LinkDocumentDialog } from "@/components/link-document-dialog";

interface LinkedDocument {
  id: string;
  title: string;
  type: string | null;
  classification: string | null;
  language: string | null;
  page_count: number | null;
  status: string | null;
  is_current: boolean | null;
  created_at: string | null;
  link: { role: string | null; added_by: string | null; added_at: string };
}

export function KnowledgeTab({ projectSlug }: { projectSlug: string }) {
  const [docs, setDocs] = useState<LinkedDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  const handleUnlink = useCallback(
    async (doc: LinkedDocument, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (
        !window.confirm(
          `Unlink "${doc.title}" from this project? The document stays in your knowledge base — only the project link is removed.`,
        )
      ) {
        return;
      }
      setUnlinkingId(doc.id);
      try {
        const res = await fetch(
          `/api/projects/${projectSlug}/documents?document_id=${encodeURIComponent(doc.id)}`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error((j as { error?: string }).error || `HTTP ${res.status}`);
        }
        refetch();
      } catch (err) {
        window.alert(
          `Failed to unlink: ${err instanceof Error ? err.message : "unknown error"}`,
        );
      } finally {
        setUnlinkingId(null);
      }
    },
    [projectSlug, refetch],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectSlug}/documents`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setDocs(data.documents || []);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load documents");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectSlug, refreshKey]);

  const linkButton = (
    <Button
      type="button"
      variant="outline"
      onClick={() => setLinkOpen(true)}
      className="gap-1.5"
    >
      <Plus className="w-3.5 h-3.5" />
      Link document
    </Button>
  );

  const dialog = (
    <LinkDocumentDialog
      projectSlug={projectSlug}
      open={linkOpen}
      onOpenChange={setLinkOpen}
      onLinked={refetch}
    />
  );

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="max-w-md rounded-lg border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
          Failed to load documents: {error}
        </div>
        {dialog}
      </div>
    );
  }
  if (docs === null) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-slate-400">
        Loading documents…
        {dialog}
      </div>
    );
  }
  if (docs.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="max-w-md text-center space-y-3">
          <FileText className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="text-lg font-semibold text-slate-700">
            No knowledge linked yet
          </p>
          <p className="text-sm text-slate-400">
            Link source documents, studies, laws, and notes that should support
            this project.
          </p>
          <div className="pt-2">{linkButton}</div>
        </div>
        {dialog}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-2">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-['JetBrains_Mono'] font-semibold uppercase tracking-wider text-slate-400">
            {docs.length} linked item{docs.length === 1 ? "" : "s"}
          </p>
          {linkButton}
        </div>
        {docs.map((d) => {
          const isUnlinking = unlinkingId === d.id;
          return (
            <div
              key={d.id}
              className="group flex items-start gap-3 rounded-lg border border-slate-200 px-4 py-3 hover:bg-slate-50 hover:border-slate-300 transition-colors"
            >
              <FileText className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
              <Link
                href={`/documents/${d.id}`}
                className="flex-1 min-w-0 no-underline"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3
                    className="text-[14px] font-medium text-slate-900 truncate font-['IBM_Plex_Sans_Arabic']"
                    dir="auto"
                  >
                    {d.title}
                  </h3>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
                </div>
                <div className="flex items-center gap-2 mt-1.5 text-[11px] text-slate-500 flex-wrap">
                  {d.type && <Tag>{d.type.toUpperCase()}</Tag>}
                  {d.classification && <Tag>{d.classification}</Tag>}
                  {d.page_count != null && (
                    <span className="font-['JetBrains_Mono']">
                      {d.page_count} pages
                    </span>
                  )}
                  {d.link.role && (
                    <span className="text-slate-400">· {d.link.role}</span>
                  )}
                </div>
              </Link>
              <button
                type="button"
                onClick={(e) => handleUnlink(d, e)}
                disabled={isUnlinking}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-red-600 hover:bg-red-50 px-2 py-1 rounded-md border-none bg-transparent cursor-pointer opacity-0 group-hover:opacity-100 disabled:opacity-60 transition-opacity shrink-0"
                title="Unlink from project (document remains in your KB)"
              >
                {isUnlinking ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Unlink2 className="w-3 h-3" />
                )}
                Unlink
              </button>
            </div>
          );
        })}
      </div>
      {dialog}
    </div>
  );
}
