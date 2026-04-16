import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Project-level graph data.
 *
 * Nodes are projects. Edges connect two projects whenever a document
 * appears in both — the edge weight is the count of shared documents.
 *
 * Self-loops (project ↔ same project) are filtered. The shape matches
 * what `react-force-graph-2d` expects (`{ nodes, links }`), with extra
 * fields the UI uses for tooltips and node styling.
 */

export const dynamic = "force-dynamic";

interface GraphNode {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  docCount: number;
}

interface GraphLink {
  source: string;
  target: string;
  weight: number;
  sharedDocIds: string[];
  sharedDocTitles: string[];
}

export async function GET() {
  // Pull projects (filter out archived — the graph is about live work).
  const { data: projects, error: projectsError } = await supabaseAdmin
    .from("projects")
    .select("id, name, slug, color, status")
    .neq("status", "archived");
  if (projectsError) {
    console.error("[graph/projects] failed to load projects:", projectsError);
    return NextResponse.json(
      { error: "Failed to load projects" },
      { status: 500 },
    );
  }

  const projectIds = (projects ?? []).map((p) => p.id);
  if (projectIds.length === 0) {
    return NextResponse.json({ nodes: [], links: [] });
  }

  // Pull every project_documents row for these projects, plus the document
  // titles so the edge tooltip can render them.
  const { data: links, error: linksError } = await supabaseAdmin
    .from("project_documents")
    .select("project_id, document_id, documents(title)")
    .in("project_id", projectIds);
  if (linksError) {
    console.error("[graph/projects] failed to load links:", linksError);
    return NextResponse.json(
      { error: "Failed to load project links" },
      { status: 500 },
    );
  }

  // Group: docId → set of projectIds it belongs to.
  const docToProjects = new Map<
    string,
    { projects: Set<string>; title: string }
  >();
  const projectDocCount = new Map<string, number>();
  for (const link of links ?? []) {
    if (!link.project_id || !link.document_id) continue;
    projectDocCount.set(
      link.project_id,
      (projectDocCount.get(link.project_id) ?? 0) + 1,
    );
    const docTitle =
      link.documents &&
      typeof link.documents === "object" &&
      "title" in link.documents
        ? String((link.documents as { title?: unknown }).title ?? "")
        : "";
    let entry = docToProjects.get(link.document_id);
    if (!entry) {
      entry = { projects: new Set(), title: docTitle };
      docToProjects.set(link.document_id, entry);
    }
    entry.projects.add(link.project_id);
  }

  // Walk every doc that belongs to ≥2 projects → emit one edge per pair
  // of project ids. Aggregate shared docs by sorted-pair key so the same
  // pair only ever shows up once.
  const edgeMap = new Map<string, GraphLink>();
  for (const [docId, entry] of docToProjects) {
    if (entry.projects.size < 2) continue;
    const pids = [...entry.projects].sort();
    for (let i = 0; i < pids.length; i++) {
      for (let j = i + 1; j < pids.length; j++) {
        const key = `${pids[i]}|${pids[j]}`;
        let edge = edgeMap.get(key);
        if (!edge) {
          edge = {
            source: pids[i],
            target: pids[j],
            weight: 0,
            sharedDocIds: [],
            sharedDocTitles: [],
          };
          edgeMap.set(key, edge);
        }
        edge.weight++;
        edge.sharedDocIds.push(docId);
        if (entry.title) edge.sharedDocTitles.push(entry.title);
      }
    }
  }

  const nodes: GraphNode[] = (projects ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    color: p.color,
    docCount: projectDocCount.get(p.id) ?? 0,
  }));

  return NextResponse.json({
    nodes,
    links: [...edgeMap.values()],
  });
}
