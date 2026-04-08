import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveProjectId } from "@/lib/projects";

const ROLE_ALIASES: Record<string, string> = {
  consultant: "advisor",
  investor: "stakeholder",
};

const ALLOWED_ROLES = new Set([
  "counterparty",
  "regulator",
  "partner",
  "advisor",
  "internal_owner",
  "stakeholder",
  "asset_owner",
  "other",
]);

function normalizeRole(rawRole: unknown): string | null {
  if (typeof rawRole !== "string") return null;
  const normalized = ROLE_ALIASES[rawRole] ?? rawRole;
  return ALLOWED_ROLES.has(normalized) ? normalized : null;
}

// GET /api/projects/[id]/entities
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: idOrSlug } = await params;
    const projectId = await resolveProjectId(idOrSlug);
    if (!projectId) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const { data: links, error } = await supabaseAdmin
      .from("project_entities")
      .select(`
        role,
        importance,
        why_linked,
        added_at,
        entity:entities (
          id, name, name_en, type
        )
      `)
      .eq("project_id", projectId)
      .order("added_at", { ascending: false });

    if (error) {
      console.error("project_entities list error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const entities = (links || [])
      .filter((link) => link.entity)
      .map((link) => ({
        ...(link.entity as object),
        link: {
          role: link.role,
          importance: link.importance,
          why_linked: link.why_linked,
          added_at: link.added_at,
        },
      }));

    return NextResponse.json({ entities });
  } catch (err) {
    console.error("project_entities GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/projects/[id]/entities
// Body: { entity_ids: string[], role?: string, why_linked?: string, importance?: number }
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: idOrSlug } = await params;
    const projectId = await resolveProjectId(idOrSlug);
    if (!projectId) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    let body: {
      entity_ids?: unknown;
      role?: unknown;
      why_linked?: unknown;
      importance?: unknown;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const entityIds = Array.isArray(body.entity_ids)
      ? body.entity_ids.filter((id): id is string => typeof id === "string")
      : [];
    if (entityIds.length === 0) {
      return NextResponse.json({ error: "entity_ids must be a non-empty string array" }, { status: 400 });
    }

    const role = normalizeRole(body.role ?? "counterparty");
    if (!role) {
      return NextResponse.json({ error: `Invalid role: ${String(body.role)}` }, { status: 400 });
    }

    const whyLinked =
      typeof body.why_linked === "string" && body.why_linked.trim().length > 0
        ? body.why_linked.trim()
        : null;
    const importance =
      typeof body.importance === "number" && Number.isFinite(body.importance)
        ? Math.max(0, Math.min(1, body.importance))
        : null;

    const { data: ents, error: entsErr } = await supabaseAdmin
      .from("entities")
      .select("id")
      .in("id", entityIds);
    if (entsErr) {
      console.error("project_entities entity check error:", entsErr);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const foundIds = new Set((ents || []).map((entity) => entity.id));
    const missing = entityIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      return NextResponse.json({ error: `Entities not found: ${missing.join(", ")}` }, { status: 404 });
    }

    const rows = entityIds.map((entityId) => ({
      project_id: projectId,
      entity_id: entityId,
      role,
      why_linked: whyLinked,
      importance,
    }));

    const { error } = await supabaseAdmin
      .from("project_entities")
      .upsert(rows, { onConflict: "project_id,entity_id,role" });
    if (error) {
      console.error("project_entities upsert error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ added: entityIds.length }, { status: 201 });
  } catch (err) {
    console.error("project_entities POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/projects/[id]/entities?entity_id=<uuid>&role=<role>
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: idOrSlug } = await params;
    const projectId = await resolveProjectId(idOrSlug);
    if (!projectId) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const entityId = searchParams.get("entity_id");
    const role = normalizeRole(searchParams.get("role"));
    if (!entityId || !role) {
      return NextResponse.json({ error: "entity_id and valid role query params required" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("project_entities")
      .delete()
      .eq("project_id", projectId)
      .eq("entity_id", entityId)
      .eq("role", role);
    if (error) {
      console.error("project_entities delete error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ removed: true });
  } catch (err) {
    console.error("project_entities DELETE error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
