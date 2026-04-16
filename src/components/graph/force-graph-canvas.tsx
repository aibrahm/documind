"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Canvas-based force-directed graph wrapper.
 *
 * `react-force-graph-2d` reaches for `window` at import time, so it has
 * to be loaded with `ssr: false`. The dynamic boundary lives in this
 * file so consuming pages can stay server-renderable.
 *
 * Visual language: gridline aesthetic. Nodes are filled ink dots with a
 * label inline below; edges are 1–2px ink-muted (shared entities) or
 * ink (citations). No gradients, no shadows, no rounded shells — the
 * canvas itself draws everything.
 *
 * Sizing: the lib needs explicit width/height props. We watch the
 * container with a ResizeObserver so the graph fills whatever space the
 * page gives it.
 */

// `react-force-graph-2d` imports `force-graph` which touches window at
// module init. ssr:false is the only safe loading mode in App Router.
// Wrapping with `dynamic()` returns a component that resolves on first
// client render — so the page renders the loading state first.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => (
    <div
      className="flex h-full w-full items-center justify-center text-xs"
      style={{ color: "var(--ink-muted)" }}
    >
      Loading graph…
    </div>
  ),
});

export type EdgeKind = "shared_entity" | "citation" | "shared_doc";

export interface GraphNodeInput {
  id: string;
  label: string;
  /** Sublabel rendered under the main label (e.g. doc count, type). */
  sublabel?: string | null;
  /** Custom node fill — defaults to var(--ink). */
  color?: string | null;
}

export interface GraphLinkInput {
  source: string;
  target: string;
  kind: EdgeKind;
  weight: number;
  /** Free-form list shown in the hover tooltip — entity names, citation text, shared doc titles. */
  detail: string[];
}

interface ForceGraphCanvasProps {
  nodes: GraphNodeInput[];
  links: GraphLinkInput[];
  /** Fired when the user clicks a node — pass router.push or similar. */
  onNodeClick?: (nodeId: string) => void;
  /** Optional placeholder rendered when nodes is empty. */
  emptyState?: React.ReactNode;
}

/**
 * Edge colours per kind, sourced from CSS tokens at render time.
 * Centralised so swapping the design system updates the graph too.
 */
function edgeColor(kind: EdgeKind): string {
  if (typeof window === "undefined") return "#9ca3af";
  const styles = window.getComputedStyle(document.documentElement);
  switch (kind) {
    case "shared_entity":
      return styles.getPropertyValue("--ink-muted").trim() || "#52525b";
    case "citation":
      return styles.getPropertyValue("--ink").trim() || "#09090b";
    case "shared_doc":
      return styles.getPropertyValue("--ink-muted").trim() || "#52525b";
  }
}

function tokenColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

export function ForceGraphCanvas({
  nodes,
  links,
  onNodeClick,
  emptyState,
}: ForceGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  // Track container size so the canvas fills its parent. Initial size is
  // measured synchronously after mount; subsequent resizes flow through
  // the observer.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize({
        width: Math.floor(rect.width),
        height: Math.floor(rect.height),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The lib mutates link.source/target into NodeObject references after
  // initial layout — typing them as `string | number | object` so our
  // accessors handle both shapes.
  // Pre-position nodes in a circle when there are no links. Without
  // this, d3-force starts all nodes at (0,0) and the charge repulsion
  // either explodes them off-canvas or leaves them stacked on top of
  // each other as a single invisible dot. With links, the link force
  // converges the layout fine from (0,0).
  const graphData = useMemo(
    () => ({
      nodes: nodes.map((n, i) => {
        const angle = (2 * Math.PI * i) / Math.max(nodes.length, 1);
        const radius = 80;
        return {
          id: n.id,
          label: n.label,
          sublabel: n.sublabel ?? null,
          color: n.color ?? null,
          ...(links.length === 0
            ? { x: radius * Math.cos(angle), y: radius * Math.sin(angle) }
            : {}),
        };
      }),
      links: links.map((l) => ({
        source: l.source,
        target: l.target,
        kind: l.kind,
        weight: l.weight,
        detail: l.detail,
      })),
    }),
    [nodes, links],
  );

  if (nodes.length === 0) {
    return (
      <div
        ref={containerRef}
        className="flex h-full w-full items-center justify-center"
        style={{ background: "var(--surface-raised)" }}
      >
        {emptyState ?? (
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            Nothing to graph yet.
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden"
      style={{ background: "var(--surface-raised)" }}
    >
      {size.width > 0 && size.height > 0 && (
        <ForceGraph2D
          width={size.width}
          height={size.height}
          graphData={graphData}
          // Disable the built-in label tooltip — we render labels inline
          // below each node ourselves so they're always visible.
          nodeLabel={() => ""}
          linkLabel={(link) => {
            const detail = (link as { detail?: string[] }).detail;
            return detail && detail.length > 0
              ? detail.slice(0, 5).join(" · ")
              : "";
          }}
          linkColor={(link) => edgeColor((link as { kind: EdgeKind }).kind)}
          linkWidth={(link) => {
            const weight = (link as { weight?: number }).weight ?? 1;
            return Math.min(4, 0.6 + Math.log2(weight + 1));
          }}
          linkDirectionalParticles={(link) =>
            (link as { kind: EdgeKind }).kind === "citation" ? 2 : 0
          }
          linkDirectionalParticleWidth={1.4}
          linkDirectionalParticleSpeed={0.005}
          // Custom node renderer — filled circle + label below. The
          // canvas API gives us the global scale so labels stay readable
          // when the user zooms.
          nodeCanvasObject={(node, ctx, globalScale) => {
            const n = node as {
              x?: number;
              y?: number;
              label: string;
              sublabel: string | null;
              color: string | null;
            };
            if (n.x === undefined || n.y === undefined) return;

            const radius = 5;
            ctx.beginPath();
            ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI);
            ctx.fillStyle = n.color || tokenColor("--ink", "#09090b");
            ctx.fill();
            ctx.strokeStyle = tokenColor("--surface-raised", "#fdfbf6");
            ctx.lineWidth = 1.5 / globalScale;
            ctx.stroke();

            const fontSize = Math.max(8, 11 / globalScale);
            ctx.font = `${fontSize}px var(--font-sans), Inter, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle = tokenColor("--ink", "#09090b");
            const labelText =
              n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label;
            ctx.fillText(labelText, n.x, n.y + radius + 2);
            if (n.sublabel) {
              ctx.fillStyle = tokenColor("--ink-muted", "#52525b");
              ctx.font = `${Math.max(7, 9 / globalScale)}px var(--font-sans), Inter, sans-serif`;
              ctx.fillText(n.sublabel, n.x, n.y + radius + 2 + fontSize + 1);
            }
          }}
          // Click hit area — wider than the dot so labels are easy to grab.
          nodePointerAreaPaint={(node, color, ctx) => {
            const n = node as { x?: number; y?: number };
            if (n.x === undefined || n.y === undefined) return;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x, n.y, 14, 0, 2 * Math.PI);
            ctx.fill();
          }}
          onNodeClick={(node) => {
            const id = (node as { id?: string }).id;
            if (id && onNodeClick) onNodeClick(id);
          }}
          cooldownTicks={120}
          enableNodeDrag={true}
          backgroundColor="transparent"
        />
      )}
    </div>
  );
}
