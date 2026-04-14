import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const classification = searchParams.get("classification");
  const type = searchParams.get("type");
  const includeVersions = searchParams.get("include_versions") === "true";

  let query = supabase
    .from("documents")
    .select(
      "id, title, type, classification, language, page_count, status, processing_error, context_card, metadata, entities, created_at, is_current, version_number, version_of, is_reference",
    )
    .order("created_at", { ascending: false });

  if (!includeVersions) {
    query = query.eq("is_current", true);
  }

  if (classification) query = query.eq("classification", classification);
  if (type) query = query.eq("type", type);

  const { data, error } = await query;

  if (error) {
    console.error("Documents list error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Enrich with project membership so the UI can show which project(s)
  // each document belongs to (or mark as Reference / Unassigned).
  const docIds = (data ?? []).map((d) => d.id);
  const projectLinks: Record<string, { ids: string[]; names: string[] }> = {};
  if (docIds.length > 0) {
    const { data: links } = await supabase
      .from("project_documents")
      .select("document_id, project_id, project:projects(name)")
      .in("document_id", docIds);
    for (const link of links ?? []) {
      const pname =
        (link.project as { name?: string } | null)?.name ?? "Project";
      if (!projectLinks[link.document_id]) {
        projectLinks[link.document_id] = { ids: [], names: [] };
      }
      projectLinks[link.document_id].ids.push(link.project_id);
      projectLinks[link.document_id].names.push(pname);
    }
  }

  const enriched = (data ?? []).map((d) => ({
    ...d,
    project_ids: projectLinks[d.id]?.ids ?? [],
    project_names: projectLinks[d.id]?.names ?? [],
  }));

  return NextResponse.json({ documents: enriched });
}
