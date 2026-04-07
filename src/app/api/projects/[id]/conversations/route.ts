import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveProjectId } from "@/lib/projects";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: idOrSlug } = await params;
    const projectId = await resolveProjectId(idOrSlug);
    if (!projectId) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const { searchParams } = new URL(request.url);
    const rawLimit = parseInt(searchParams.get("limit") || "50", 10);
    const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 200);

    const { data, error } = await supabaseAdmin
      .from("conversations")
      .select("id, title, mode, query, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.error("project_conversations GET error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ conversations: data || [] });
  } catch (err) {
    console.error("project_conversations GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
