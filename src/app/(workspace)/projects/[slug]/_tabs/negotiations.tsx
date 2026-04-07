"use client";

import { useEffect, useState, useCallback } from "react";
import { Handshake, Plus } from "lucide-react";
import { Tag } from "@/components/ui-system";
import { Button } from "@/components/ui/button";
import { CreateNegotiationDialog } from "@/components/create-negotiation-dialog";

interface Negotiation {
  id: string;
  name: string;
  status: string;
  key_terms: Record<string, unknown> | null;
  opened_at: string | null;
  closed_at: string | null;
}

const STATUS_VARIANT: Record<
  string,
  "default" | "blue" | "green" | "amber" | "red"
> = {
  open: "blue",
  active: "green",
  stalled: "amber",
  closed_won: "green",
  closed_lost: "red",
  withdrawn: "default",
};

export function NegotiationsTab({ projectId }: { projectId: string }) {
  const [negs, setNegs] = useState<Negotiation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/negotiations?project_id=${projectId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setNegs(data.negotiations || []);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load negotiations");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey]);

  const createButton = (
    <Button
      type="button"
      variant="outline"
      onClick={() => setCreateOpen(true)}
      className="gap-1.5"
    >
      <Plus className="w-3.5 h-3.5" />
      New negotiation
    </Button>
  );

  const dialog = (
    <CreateNegotiationDialog
      projectId={projectId}
      open={createOpen}
      onOpenChange={setCreateOpen}
      onCreated={refetch}
    />
  );

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="max-w-md rounded-lg border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
          Failed to load negotiations: {error}
        </div>
        {dialog}
      </div>
    );
  }
  if (negs === null) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-slate-400">
        Loading negotiations…
        {dialog}
      </div>
    );
  }
  if (negs.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="max-w-md text-center space-y-3 px-6">
          <Handshake className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="text-lg font-semibold text-slate-700">
            No negotiations yet
          </p>
          <p className="text-sm text-slate-400">
            Create a negotiation thread to track a specific deal scenario
            (e.g., &ldquo;Scenario A — Developer + Partnership&rdquo;).
          </p>
          <div className="pt-2">{createButton}</div>
        </div>
        {dialog}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-3">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[11px] font-['JetBrains_Mono'] font-semibold uppercase tracking-wider text-slate-400">
            {negs.length} negotiation{negs.length === 1 ? "" : "s"}
          </p>
          {createButton}
        </div>
        {negs.map((n) => (
          <div
            key={n.id}
            className="rounded-lg border border-slate-200 px-4 py-3 bg-white"
          >
            <div className="flex items-start justify-between gap-2">
              <h3
                className="text-[14px] font-medium text-slate-900 font-['IBM_Plex_Sans_Arabic']"
                dir="auto"
              >
                {n.name}
              </h3>
              <Tag variant={STATUS_VARIANT[n.status] || "default"}>
                {n.status.replace("_", " ")}
              </Tag>
            </div>
            {n.key_terms && Object.keys(n.key_terms).length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                {Object.entries(n.key_terms)
                  .slice(0, 6)
                  .map(([k, v]) => (
                    <div key={k} className="flex items-center gap-1.5">
                      <span className="text-slate-400 font-['JetBrains_Mono'] uppercase tracking-wider">
                        {k.replace(/_/g, " ")}:
                      </span>
                      <span className="text-slate-700 font-['JetBrains_Mono']">
                        {String(v)}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {dialog}
    </div>
  );
}
