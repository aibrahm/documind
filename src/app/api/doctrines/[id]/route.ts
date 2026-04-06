import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data, error } = await supabaseAdmin
    .from("doctrines")
    .select("id, name, title, content_ar, content_en, version, is_active")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Doctrine not found" }, { status: 404 });
  }

  return NextResponse.json({ doctrine: data });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Whitelist allowed fields
  const updates: Record<string, unknown> = {};
  if (typeof body.content_ar === "string") updates.content_ar = body.content_ar;
  if (typeof body.content_en === "string") updates.content_en = body.content_en;
  if (typeof body.title === "string") updates.title = body.title;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  // Fetch current version to increment
  const { data: current } = await supabaseAdmin
    .from("doctrines")
    .select("version")
    .eq("id", id)
    .single();

  if (!current) {
    return NextResponse.json({ error: "Doctrine not found" }, { status: 404 });
  }

  updates.version = (current.version || 1) + 1;

  const { data, error } = await supabaseAdmin
    .from("doctrines")
    .update(updates)
    .eq("id", id)
    .select("id, name, title, content_ar, content_en, version, is_active")
    .single();

  if (error) {
    console.error("Failed to update doctrine:", error);
    return NextResponse.json({ error: "Failed to update doctrine" }, { status: 500 });
  }

  return NextResponse.json({ doctrine: data });
}
