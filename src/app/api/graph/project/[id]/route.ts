import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Per-project document graph.
 *
 * Nodes are documents linked to the project. Edges come in two flavours:
 *
 *   - **shared_entity** — both docs link to the same entity (via
 *     `document_entities`). Weight = count of shared entities; tooltip
 *     surfaces the top shared entity names.
 *   - **citation** — `document_references` resolves a citation in doc A
 *     pointing at doc B. Weight = number of citations; tooltip surfaces
 *     the verbatim reference text.
 *
 * Both edge types are returned in the same `links` array; the UI maps
 * `kind` to a colour. With <30 docs in the library this is fast even
 * without an RPC; once it grows past a few hundred we'd push the joins
 * into Postgres via a function.
 */

export const dynamic = "force-dynamic";

interface DocNode {
  id: string;
  title: string;
  type: string;
  status: string;
}

interface DocEdge {
  source: string;
  target: string;
  kind: "shared_entity" | "citation";
  weight: number;
  detail: string[];
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;

  // 1. Project membership → list of doc ids in this project.
  const { data: memberRows, error: memberErr } = await supabaseAdmin
    .from("project_documents")
    .select("document_id")
    .eq("project_id", projectId);
  if (memberErr) {
    console.error("[graph/project] failed to load membership:", memberErr);
    return NextResponse.json(
      { error: "Failed to load project membership" },
      { status: 500 },
    );
  }

  const docIds = (memberRows ?? [])
    .map((r) => r.document_id)
    .filter((id): id is string => Boolean(id));
  if (docIds.length === 0) {
    return NextResponse.json({ nodes: [], links: [] });
  }

  // 2. Doc metadata for the nodes.
  const { data: docs, error: docsErr } = await supabaseAdmin
    .from("documents")
    .select("id, title, type, status")
    .in("id", docIds);
  if (docsErr) {
    console.error("[graph/project] failed to load docs:", docsErr);
    return NextResponse.json(
      { error: "Failed to load documents" },
      { status: 500 },
    );
  }

  // 3. Shared-entity edges — pull every (document_id, entity_id) row for
  //    docs in the project, plus the entity name for tooltips. Then walk
  //    entity → list of docs, emitting one edge per pair.
  const { data: docEntities, error: deErr } = await supabaseAdmin
    .from("document_entities")
    .select("document_id, entity_id, entities(name)")
    .in("document_id", docIds);
  if (deErr) {
    console.error("[graph/project] failed to load doc_entities:", deErr);
  }

  const entityToDocs = new Map<string, { docs: Set<string>; name: string }>();
  for (const row of docEntities ?? []) {
    if (!row.entity_id || !row.document_id) continue;
    const entityName =
      row.entities && typeof row.entities === "object" && "name" in row.entities
        ? String((row.entities as { name?: unknown }).name ?? "")
        : "";
    let entry = entityToDocs.get(row.entity_id);
    if (!entry) {
      entry = { docs: new Set(), name: entityName };
      entityToDocs.set(row.entity_id, entry);
    }
    entry.docs.add(row.document_id);
  }

  // Pair key: `${docA}|${docB}` with docA < docB so the map dedupes.
  const sharedEdges = new Map<string, DocEdge>();
  for (const entry of entityToDocs.values()) {
    if (entry.docs.size < 2) continue;
    const ids = [...entry.docs].sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}|${ids[j]}`;
        let edge = sharedEdges.get(key);
        if (!edge) {
          edge = {
            source: ids[i],
            target: ids[j],
            kind: "shared_entity",
            weight: 0,
            detail: [],
          };
          sharedEdges.set(key, edge);
        }
        edge.weight++;
        if (entry.name) edge.detail.push(entry.name);
      }
    }
  }

  // 4. Citation edges — `document_references` rows where target_id is
  //    inside the project. Source/target intentionally directional but the
  //    force graph doesn't care; the tooltip carries the reference text.
  const { data: refs, error: refErr } = await supabaseAdmin
    .from("document_references")
    .select("source_id, target_id, reference_text")
    .in("source_id", docIds)
    .in("target_id", docIds)
    .eq("resolved", true);
  if (refErr) {
    console.error("[graph/project] failed to load references:", refErr);
  }

  const citationEdges = new Map<string, DocEdge>();
  for (const row of refs ?? []) {
    if (!row.source_id || !row.target_id) continue;
    const a = row.source_id;
    const b = row.target_id;
    if (a === b) continue;
    const key = `${a < b ? a : b}|${a < b ? b : a}`;
    let edge = citationEdges.get(key);
    if (!edge) {
      edge = {
        source: a,
        target: b,
        kind: "citation",
        weight: 0,
        detail: [],
      };
      citationEdges.set(key, edge);
    }
    edge.weight++;
    if (row.reference_text) edge.detail.push(row.reference_text);
  }

  const nodes: DocNode[] = (docs ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    type: d.type,
    status: d.status,
  }));

  return NextResponse.json({
    nodes,
    links: [...sharedEdges.values(), ...citationEdges.values()],
  });
}
