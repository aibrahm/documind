"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { FileText, ExternalLink, Plus } from "lucide-react";
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

export function DocumentsTab({ projectSlug }: { projectSlug: string }) {
  const [docs, setDocs] = useState<LinkedDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

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
            No documents linked yet
          </p>
          <p className="text-sm text-slate-400">
            Link existing knowledge-base documents to this project, or upload new
            ones from the Upload page.
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
            {docs.length} linked
          </p>
          {linkButton}
        </div>
        {docs.map((d) => (
          <Link
            key={d.id}
            href={`/documents/${d.id}`}
            className="flex items-start gap-3 rounded-lg border border-slate-200 px-4 py-3 hover:bg-slate-50 hover:border-slate-300 transition-colors no-underline"
          >
            <FileText className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
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
                  <span className="font-['JetBrains_Mono']">{d.page_count} pages</span>
                )}
                {d.link.role && (
                  <span className="text-slate-400">· {d.link.role}</span>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
      {dialog}
    </div>
  );
}
