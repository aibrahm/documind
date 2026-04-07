import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveProjectId } from "@/lib/projects";

const ALLOWED_ROLES = new Set(["counterparty", "consultant", "partner", "investor", "regulator"]);

// GET /api/projects/[id]/companies
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: idOrSlug } = await params;
    const projectId = await resolveProjectId(idOrSlug);
    if (!projectId) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const { data: links, error } = await supabaseAdmin
      .from("project_companies")
      .select(`
        role,
        added_at,
        entity:entities (
          id, name, name_en, type
        )
      `)
      .eq("project_id", projectId)
      .order("added_at", { ascending: false });

    if (error) {
      console.error("project_companies list error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const companies = (links || []).map((l) => ({
      ...(l.entity as object),
      link: { role: l.role, added_at: l.added_at },
    }));

    return NextResponse.json({ companies });
  } catch (err) {
    console.error("project_companies GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/projects/[id]/companies
// Body: { entity_ids: string[], role?: string }
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: idOrSlug } = await params;
    const projectId = await resolveProjectId(idOrSlug);
    if (!projectId) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    let body: { entity_ids?: unknown; role?: unknown };
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const entityIds = Array.isArray(body.entity_ids)
      ? body.entity_ids.filter((id): id is string => typeof id === "string")
      : [];
    if (entityIds.length === 0) {
      return NextResponse.json({ error: "entity_ids must be a non-empty string array" }, { status: 400 });
    }

    const role = typeof body.role === "string" ? body.role : "counterparty";
    if (!ALLOWED_ROLES.has(role)) {
      return NextResponse.json({ error: `Invalid role: ${role}` }, { status: 400 });
    }

    // Verify all entities exist
    const { data: ents, error: entsErr } = await supabaseAdmin
      .from("entities")
      .select("id")
      .in("id", entityIds);
    if (entsErr) {
      console.error("entities check error:", entsErr);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    const foundIds = new Set((ents || []).map((e) => e.id));
    const missing = entityIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      return NextResponse.json({ error: `Entities not found: ${missing.join(", ")}` }, { status: 404 });
    }

    const rows = entityIds.map((entityId) => ({
      project_id: projectId,
      entity_id: entityId,
      role,
    }));
    const { error: upsertErr } = await supabaseAdmin
      .from("project_companies")
      .upsert(rows, { onConflict: "project_id,entity_id,role" });
    if (upsertErr) {
      console.error("project_companies upsert error:", upsertErr);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ added: entityIds.length }, { status: 201 });
  } catch (err) {
    console.error("project_companies POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/projects/[id]/companies?entity_id=<uuid>&role=<role>
// role is required because the PRIMARY KEY is (project_id, entity_id, role)
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: idOrSlug } = await params;
    const projectId = await resolveProjectId(idOrSlug);
    if (!projectId) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const { searchParams } = new URL(request.url);
    const entityId = searchParams.get("entity_id");
    const role = searchParams.get("role");
    if (!entityId || !role) {
      return NextResponse.json({ error: "entity_id and role query params required" }, { status: 400 });
    }
    if (!ALLOWED_ROLES.has(role)) {
      return NextResponse.json({ error: `Invalid role: ${role}` }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("project_companies")
      .delete()
      .eq("project_id", projectId)
      .eq("entity_id", entityId)
      .eq("role", role);
    if (error) {
      console.error("project_companies delete error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ removed: true });
  } catch (err) {
    console.error("project_companies DELETE error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
