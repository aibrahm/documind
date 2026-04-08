import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveProjectId, UPDATE_FIELDS } from "@/lib/projects";
import { logAudit } from "@/lib/audit";

const ALLOWED_STATUS = new Set(["active", "on_hold", "closed", "archived"]);

// GET /api/projects/[id-or-slug]
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: idOrSlug } = await params;
    const projectId = await resolveProjectId(idOrSlug);
    if (!projectId) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Pull the project row
    const { data: project, error } = await supabaseAdmin
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();
    if (error || !project) {
      console.error("Project GET error:", error);
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Pull membership counts in parallel
    const [docs, entities, convos] = await Promise.all([
      supabaseAdmin.from("project_documents").select("project_id", { count: "exact", head: true }).eq("project_id", projectId),
      supabaseAdmin.from("project_entities").select("project_id", { count: "exact", head: true }).eq("project_id", projectId),
      supabaseAdmin.from("conversations").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    ]);

    return NextResponse.json({
      project,
      counts: {
        documents: docs.count || 0,
        entities: entities.count || 0,
        threads: convos.count || 0,
      },
    });
  } catch (err) {
    console.error("Project [id] GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/projects/[id-or-slug]
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: idOrSlug } = await params;
    const projectId = await resolveProjectId(idOrSlug);
    if (!projectId) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (!body || Object.keys(body).length === 0) {
      return NextResponse.json({ error: "Request body must contain fields to update" }, { status: 400 });
    }

    const filtered: Record<string, unknown> = {};
    for (const k of UPDATE_FIELDS) {
      if (body[k] !== undefined) filtered[k] = body[k];
    }
    const unknownKeys = Object.keys(body).filter((k) => !(UPDATE_FIELDS as readonly string[]).includes(k));
    if (unknownKeys.length > 0) {
      return NextResponse.json({ error: `Unknown or read-only fields: ${unknownKeys.join(", ")}` }, { status: 400 });
    }

    if (filtered.status !== undefined) {
      if (typeof filtered.status !== "string" || !ALLOWED_STATUS.has(filtered.status)) {
        return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
      }
    }

    // Always bump updated_at
    const updateRow = { ...filtered, updated_at: new Date().toISOString() };

    const { data, error } = await supabaseAdmin
      .from("projects")
      .update(updateRow)
      .eq("id", projectId)
      .select("*")
      .single();
    if (error) {
      console.error("Project PATCH error:", error);
      if (error.code === "23505") {
        return NextResponse.json({ error: "Slug already exists" }, { status: 409 });
      }
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    logAudit("project.update", { projectId, fields: Object.keys(filtered) }).catch(console.error);
    return NextResponse.json({ project: data });
  } catch (err) {
    console.error("Project [id] PATCH error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/projects/[id-or-slug]
// Soft-delete: sets status='archived' and closed_at=now()
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: idOrSlug } = await params;
    const projectId = await resolveProjectId(idOrSlug);
    if (!projectId) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("projects")
      .update({ status: "archived", closed_at: now, updated_at: now })
      .eq("id", projectId)
      .select("id, status, closed_at")
      .single();
    if (error) {
      console.error("Project DELETE error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    logAudit("project.archive", { projectId }).catch(console.error);
    return NextResponse.json({ project: data });
  } catch (err) {
    console.error("Project [id] DELETE error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
