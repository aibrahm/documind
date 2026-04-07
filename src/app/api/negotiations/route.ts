import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import type { Database, Json } from "@/lib/database.types";

type NegotiationInsert = Database["public"]["Tables"]["negotiations"]["Insert"];

const ALLOWED_STATUS = new Set(["open", "active", "stalled", "closed_won", "closed_lost", "withdrawn"]);

// GET /api/negotiations?project_id=<uuid>&status=<status>
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("project_id");
    const status = searchParams.get("status");

    let query = supabaseAdmin
      .from("negotiations")
      .select("id, project_id, name, counterparty_entity_id, status, opened_at, closed_at, key_terms, created_at, updated_at")
      .order("opened_at", { ascending: false });

    if (projectId) query = query.eq("project_id", projectId);
    if (status) {
      if (!ALLOWED_STATUS.has(status)) {
        return NextResponse.json({ error: `Invalid status filter: ${status}` }, { status: 400 });
      }
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      console.error("negotiations GET error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    return NextResponse.json({ negotiations: data || [] });
  } catch (err) {
    console.error("negotiations GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/negotiations
// Body: { project_id, name, counterparty_entity_id?, status?, key_terms? }
export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const projectId = typeof body.project_id === "string" ? body.project_id : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!projectId || !name) {
      return NextResponse.json({ error: "project_id and name are required" }, { status: 400 });
    }

    // Verify project exists
    const { data: projectRow, error: projectErr } = await supabaseAdmin
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .maybeSingle();
    if (projectErr || !projectRow) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const insert: NegotiationInsert = {
      project_id: projectId,
      name,
    };

    if (body.counterparty_entity_id !== undefined) {
      if (typeof body.counterparty_entity_id !== "string") {
        return NextResponse.json({ error: "counterparty_entity_id must be a UUID string" }, { status: 400 });
      }
      insert.counterparty_entity_id = body.counterparty_entity_id;
    }

    if (body.status !== undefined) {
      if (typeof body.status !== "string" || !ALLOWED_STATUS.has(body.status)) {
        return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
      }
      insert.status = body.status;
    }

    if (body.key_terms !== undefined) {
      if (typeof body.key_terms !== "object" || body.key_terms === null) {
        return NextResponse.json({ error: "key_terms must be an object" }, { status: 400 });
      }
      insert.key_terms = body.key_terms as Json;
    }

    const { data, error } = await supabaseAdmin
      .from("negotiations")
      .insert(insert)
      .select("*")
      .single();
    if (error) {
      console.error("negotiation create error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ negotiation: data }, { status: 201 });
  } catch (err) {
    console.error("negotiations POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
