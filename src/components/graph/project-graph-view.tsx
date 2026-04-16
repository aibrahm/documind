"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ForceGraphCanvas,
  type GraphLinkInput,
  type GraphNodeInput,
} from "@/components/graph/force-graph-canvas";

/**
 * Client wrapper for the project-level graph. Fetches once on mount
 * from `/api/graph/projects` and feeds the canvas. Click on a node →
 * navigate into that project's workspace.
 */

interface ProjectsApiResponse {
  nodes: Array<{
    id: string;
    name: string;
    slug: string;
    color: string | null;
    docCount: number;
  }>;
  links: Array<{
    source: string;
    target: string;
    weight: number;
    sharedDocIds: string[];
    sharedDocTitles: string[];
  }>;
}

export function ProjectGraphView() {
  const router = useRouter();
  const [data, setData] = useState<ProjectsApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slugById, setSlugById] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/graph/projects")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ProjectsApiResponse>;
      })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        const map: Record<string, string> = {};
        for (const n of d.nodes) map[n.id] = n.slug;
        setSlugById(map);
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    label: n.name,
    sublabel:
      n.docCount > 0 ? `${n.docCount} doc${n.docCount === 1 ? "" : "s"}` : null,
    color: n.color,
  }));

  const links: GraphLinkInput[] = data.links.map((l) => ({
    source: l.source,
    target: l.target,
    kind: "shared_doc",
    weight: l.weight,
    detail: l.sharedDocTitles,
  }));

  return (
    <ForceGraphCanvas
      nodes={nodes}
      links={links}
      onNodeClick={(id) => {
        const slug = slugById[id];
        if (slug) router.push(`/projects/${slug}`);
      }}
      emptyState={
        <div className="text-center">
          <p className="text-sm" style={{ color: "var(--ink)" }}>
            No projects yet.
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--ink-muted)" }}>
            Create one and add documents — links appear when projects share
            docs.
          </p>
        </div>
      }
    />
  );
}
