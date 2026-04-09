import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const VALID_TYPES = new Set([
  "company",
  "organization",
  "authority",
  "ministry",
  "project",
  "person",
  "place",
  "location",
  "law",
  "other",
]);

/**
 * Update an entity's display fields (name, name_en, type).
 * All documents linked to this entity immediately show the updated values.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { name?: string; name_en?: string | null; type?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    const trimmed = body.name.trim();
    if (!trimmed) {
      return NextResponse.json(
        { error: "name cannot be empty" },
        { status: 400 },
      );
    }
    update.name = trimmed;
  }

  if (body.name_en !== undefined) {
    if (body.name_en === null || body.name_en === "") {
      update.name_en = null;
    } else if (typeof body.name_en === "string") {
      update.name_en = body.name_en.trim() || null;
    }
  }

  if (typeof body.type === "string") {
    if (!VALID_TYPES.has(body.type)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${[...VALID_TYPES].join(", ")}` },
        { status: 400 },
      );
    }
    update.type = body.type;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("entities")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || "Failed to update entity" },
      { status: 500 },
    );
  }

  return NextResponse.json({ entity: data });
}

/**
 * Delete an entity entirely. Cascade removes every document_entities link
 * so the entity disappears from all documents. Use this only for junk
 * entities — to just remove from one document, use the document's
 * entities endpoint instead.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Remove all document links first (even though FK may cascade, be explicit)
  await supabaseAdmin.from("document_entities").delete().eq("entity_id", id);

  const { error } = await supabaseAdmin.from("entities").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
