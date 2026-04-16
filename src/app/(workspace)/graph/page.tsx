import { ProjectGraphView } from "@/components/graph/project-graph-view";
import { PageHeader } from "@/components/page-header";

/**
 * Project-level knowledge graph.
 *
 * Each node is a project; edges connect projects that share documents.
 * The page is sized to fill the workspace viewport so the canvas can
 * claim the available space — overflow-hidden + min-h-0 stops the
 * graph from dragging out of view.
 */
export default function GraphPage() {
  // h-full claims the workspace main's full height regardless of whether
  // the parent is a flex container (it isn't — workspace main is
  // overflow-auto block). Without h-full, flex-1 is a no-op and the
  // canvas would size to 0.
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader eyebrow="GRAPH" title="Project network" />
      <div className="flex-1 min-h-0">
        <ProjectGraphView />
      </div>
    </div>
  );
}
