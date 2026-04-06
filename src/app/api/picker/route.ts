import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizeName } from "@/lib/entities";

/**
 * Unified picker endpoint for the @ mention picker.
 *
 * Returns documents and entities in one response, optionally filtered by query.
 * Documents include their is_current flag so the UI can mark old versions.
 *
 * Response shape:
 * {
 *   recent: [{ kind: "document", id, title, type, classification, created_at }],
 *   companies: [{ kind: "entity", id, name, name_en, type, doc_count }],
 *   projects:  [{ kind: "entity", ... }],
 *   people:    [{ kind: "entity", ... }],
 *   documents: [{ kind: "document", ... }]   // matches by title when query is set
 * }
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() || "";
  const normalizedQ = normalizeName(q);

  // Recent uploads (always include — the "the file I just uploaded" affordance)
  const { data: recentDocs } = await supabaseAdmin
    .from("documents")
    .select("id, title, type, classification, created_at, is_current")
    .eq("status", "ready")
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(8);

  // All entities (small table — we filter in JS)
  const { data: entitiesRaw } = await supabaseAdmin
    .from("entities")
    .select("id, name, type, name_en");

  // Document-entity link counts so we can rank entities by activity
  const { data: linksRaw } = await supabaseAdmin
    .from("document_entities")
    .select("entity_id");

  const docCountByEntity = new Map<string, number>();
  for (const link of linksRaw || []) {
    const eid = link.entity_id as string;
    docCountByEntity.set(eid, (docCountByEntity.get(eid) || 0) + 1);
  }

  // Filter entities by query (substring on normalized name or name_en)
  const matchesQuery = (name: string | null) => {
    if (!q) return true;
    if (!name) return false;
    return normalizeName(name).includes(normalizedQ);
  };

  type EntityRow = {
    id: string;
    name: string;
    type: string;
    name_en: string | null;
  };
  const entities = (entitiesRaw || []) as EntityRow[];

  const filterAndRank = (predicate: (e: EntityRow) => boolean) =>
    entities
      .filter(predicate)
      .filter((e) => matchesQuery(e.name) || matchesQuery(e.name_en))
      .map((e) => ({
        kind: "entity" as const,
        id: e.id,
        name: e.name,
        name_en: e.name_en,
        type: e.type,
        doc_count: docCountByEntity.get(e.id) || 0,
      }))
      .sort((a, b) => b.doc_count - a.doc_count)
      .slice(0, 8);

  const companies = filterAndRank((e) => e.type === "company" || e.type === "organization");
  const projects = filterAndRank((e) => e.type === "project");
  const people = filterAndRank((e) => e.type === "person");
  const places = filterAndRank((e) => e.type === "place" || e.type === "location");
  const authorities = filterAndRank((e) => e.type === "authority" || e.type === "ministry");

  // If a query is set, also fuzzy-match documents by title
  let documentMatches: Array<{
    kind: "document";
    id: string;
    title: string;
    type: string;
    classification: string;
    created_at: string;
  }> = [];
  if (q) {
    const { data: allDocs } = await supabaseAdmin
      .from("documents")
      .select("id, title, type, classification, created_at, is_current")
      .eq("status", "ready")
      .eq("is_current", true);
    documentMatches = (allDocs || [])
      .filter((d) => normalizeName(d.title).includes(normalizedQ))
      .slice(0, 8)
      .map((d) => ({
        kind: "document" as const,
        id: d.id,
        title: d.title,
        type: d.type,
        classification: d.classification,
        created_at: d.created_at || "",
      }));
  }

  const recent = (recentDocs || []).map((d) => ({
    kind: "document" as const,
    id: d.id,
    title: d.title,
    type: d.type,
    classification: d.classification,
    created_at: d.created_at || "",
  }));

  return NextResponse.json({
    recent,
    companies,
    projects,
    authorities,
    people,
    places,
    documents: documentMatches,
  });
}
