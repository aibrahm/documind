import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const ALLOWED_STATUS = new Set(["open", "active", "stalled", "closed_won", "closed_lost", "withdrawn"]);
const UPDATE_FIELDS = ["name", "counterparty_entity_id", "status", "closed_at", "key_terms"] as const;

// GET /api/negotiations/[id]
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { data, error } = await supabaseAdmin
      .from("negotiations")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data) {
      return NextResponse.json({ error: "Negotiation not found" }, { status: 404 });
    }
    return NextResponse.json({ negotiation: data });
  } catch (err) {
    console.error("negotiation GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/negotiations/[id]
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
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
    if (filtered.key_terms !== undefined) {
      if (typeof filtered.key_terms !== "object" || filtered.key_terms === null) {
        return NextResponse.json({ error: "key_terms must be an object" }, { status: 400 });
      }
    }

    const updateRow = { ...filtered, updated_at: new Date().toISOString() };
    const { data, error } = await supabaseAdmin
      .from("negotiations")
      .update(updateRow)
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) {
      console.error("negotiation PATCH error:", error);
      return NextResponse.json({ error: "Negotiation not found" }, { status: 404 });
    }

    return NextResponse.json({ negotiation: data });
  } catch (err) {
    console.error("negotiation PATCH error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/negotiations/[id] — soft-delete via status='withdrawn'
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("negotiations")
      .update({ status: "withdrawn", closed_at: now, updated_at: now })
      .eq("id", id)
      .select("id, status, closed_at")
      .single();
    if (error || !data) {
      return NextResponse.json({ error: "Negotiation not found" }, { status: 404 });
    }
    return NextResponse.json({ negotiation: data });
  } catch (err) {
    console.error("negotiation DELETE error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
