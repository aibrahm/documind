"use client";

import { useCallback, useEffect, useState } from "react";
import { FileOutput, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Database } from "@/lib/database.types";

type Artifact = Database["public"]["Tables"]["artifacts"]["Row"];

export function OutputsTab({ projectId }: { projectId: string }) {
  const [artifacts, setArtifacts] = useState<Artifact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadArtifacts = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch(`/api/projects/${projectId}/artifacts`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      const data = await response.json();
      setArtifacts(data.artifacts || []);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load outputs",
      );
    }
  }, [projectId]);

  useEffect(() => {
    void loadArtifacts();
  }, [loadArtifacts]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (detail?.projectId === projectId) {
        void loadArtifacts();
      }
    };
    window.addEventListener("workspace-artifacts-updated", handler);
    return () => window.removeEventListener("workspace-artifacts-updated", handler);
  }, [loadArtifacts, projectId]);

  const handleDelete = async (artifactId: string) => {
    setDeletingId(artifactId);
    try {
      const response = await fetch(`/api/artifacts/${artifactId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete output");
      }
      setArtifacts((current) =>
        (current || []).filter((artifact) => artifact.id !== artifactId),
      );
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Failed to delete output",
      );
    } finally {
      setDeletingId(null);
    }
  };

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (artifacts === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Loading outputs…
      </div>
    );
  }

  if (artifacts.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-lg space-y-3 px-6 text-center">
          <FileOutput className="mx-auto h-10 w-10 text-slate-300" />
          <p className="text-lg font-semibold text-slate-700">No saved outputs yet</p>
          <p className="text-sm leading-relaxed text-slate-500">
            Save strong assistant replies from Threads as briefs, memos, emails,
            or meeting notes. They will show up here as reusable deliverables for
            this project.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-4 px-6 py-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-slate-400">
              Saved outputs
            </p>
            <h2 className="mt-1 text-[24px] font-semibold tracking-tight text-slate-900">
              Reusable deliverables
            </h2>
          </div>
          <span className="font-['JetBrains_Mono'] text-[11px] uppercase tracking-wider text-slate-400">
            {artifacts.length} item{artifacts.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="grid gap-4">
          {artifacts.map((artifact) => (
            <article
              key={artifact.id}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-100/60"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-slate-500">
                      {artifact.kind.replace("_", " ")}
                    </span>
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-emerald-700">
                      {artifact.status}
                    </span>
                  </div>
                  <h3 className="mt-3 text-[18px] font-semibold text-slate-900" dir="auto">
                    {artifact.title}
                  </h3>
                  <p className="mt-1 font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-slate-400">
                    {artifact.created_at
                      ? new Date(artifact.created_at).toLocaleString()
                      : "Saved output"}
                  </p>
                  <p className="mt-3 whitespace-pre-wrap text-[14px] leading-7 text-slate-600" dir="auto">
                    {artifact.content.length > 900
                      ? `${artifact.content.slice(0, 900)}…`
                      : artifact.content}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void handleDelete(artifact.id)}
                  disabled={deletingId === artifact.id}
                  title="Delete output"
                >
                  <Trash2 className="h-4 w-4 text-slate-400" />
                </Button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
