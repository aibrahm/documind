import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveProjectId } from "@/lib/projects";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idOrSlug } = await params;
  const projectId = await resolveProjectId(idOrSlug);
  if (!projectId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const rawLimit = Number.parseInt(searchParams.get("limit") || "20", 10);
  const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? 20 : rawLimit, 1), 100);

  const { data, error } = await supabaseAdmin
    .from("memory_items")
    .select("*")
    .eq("scope_type", "project")
    .eq("scope_id", projectId)
    .order("importance", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("project memory GET error:", error);
    return NextResponse.json({ error: "Failed to load project memory" }, { status: 500 });
  }

  return NextResponse.json({ memories: data || [] });
}
