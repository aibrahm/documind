"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  type EdgeKind,
  ForceGraphCanvas,
  type GraphLinkInput,
  type GraphNodeInput,
} from "@/components/graph/force-graph-canvas";

/**
 * Client wrapper for the per-project document graph. Fetches from
 * `/api/graph/project/[id]` on mount + when the project id changes.
 * Click → open the document detail page.
 *
 * The graph mixes two edge kinds (shared entities + citations); the
 * legend below the canvas explains the colours.
 */

interface DocsApiResponse {
  nodes: Array<{ id: string; title: string; type: string; status: string }>;
  links: Array<{
    source: string;
    target: string;
    kind: EdgeKind;
    weight: number;
    detail: string[];
  }>;
}

export function DocumentGraphView({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [data, setData] = useState<DocsApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetches once on mount. Caller is expected to remount the component
  // when projectId changes (key={projectId}) so we don't have to clear
  // state synchronously inside the effect — that pattern triggers a
  // cascading render that React (and the linter) discourage.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/graph/project/${projectId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<DocsApiResponse>;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (error) {
    return (
      <div
        className="flex h-full w-full items-center justify-center text-sm"
        style={{ color: "var(--danger)" }}
      >
        Failed to load graph: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div
        className="flex h-full w-full items-center justify-center text-sm"
        style={{ color: "var(--ink-muted)" }}
      >
        Loading graph…
      </div>
    );
  }

  const nodes: GraphNodeInput[] = data.nodes.map((n) => ({
    id: n.id,
    label: n.title,
    sublabel: n.type,
  }));

  const links: GraphLinkInput[] = data.links.map((l) => ({
    source: l.source,
    target: l.target,
    kind: l.kind,
    weight: l.weight,
    detail: l.detail,
  }));

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex-1 min-h-0">
        <ForceGraphCanvas
          nodes={nodes}
          links={links}
          onNodeClick={(id) => router.push(`/documents/${id}`)}
          emptyState={
            <div className="text-center">
              <p className="text-sm" style={{ color: "var(--ink)" }}>
                No linked documents yet.
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--ink-muted)" }}>
                Add documents to this project and the graph fills in.
              </p>
            </div>
          }
        />
      </div>
      <GraphLegend />
    </div>
  );
}

function GraphLegend() {
  return (
    <div
      className="flex items-center gap-4 px-4 py-2 text-xs"
      style={{
        borderTop: "1px solid var(--border)",
        background: "var(--surface-raised)",
        color: "var(--ink-muted)",
      }}
    >
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-0.5 w-6"
          style={{ background: "var(--ink-muted)" }}
        />
        shared entity
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-0.5 w-6"
          style={{ background: "var(--ink)" }}
        />
        citation
      </span>
      <span style={{ color: "var(--ink-faint)" }}>
        Hover an edge for details · Click a node to open the document
      </span>
    </div>
  );
}
