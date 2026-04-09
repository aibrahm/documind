import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Merge two entities into one. The `source` entity is absorbed into the
 * `target`:
 *   - Every document linked to `source` is re-linked to `target` (keeping
 *     the role if set; skipping if target is already linked).
 *   - The source entity row is deleted.
 *
 * Use this for deduplication: "Elsewedy Electric" + "السويدي إلكتريك" →
 * one canonical row.
 */
export async function POST(request: NextRequest) {
  let body: { sourceId?: string; targetId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sourceId, targetId } = body;
  if (!sourceId || !targetId) {
    return NextResponse.json(
      { error: "sourceId and targetId are both required" },
      { status: 400 },
    );
  }
  if (sourceId === targetId) {
    return NextResponse.json(
      { error: "sourceId and targetId must be different" },
      { status: 400 },
    );
  }

  // 1. Find all documents linked to the source entity.
  const { data: sourceLinks, error: sourceLinksError } = await supabaseAdmin
    .from("document_entities")
    .select("document_id, role")
    .eq("entity_id", sourceId);

  if (sourceLinksError) {
    return NextResponse.json(
      { error: sourceLinksError.message },
      { status: 500 },
    );
  }

  // 2. Find existing target links to avoid duplicate-key violations.
  const sourceDocIds = (sourceLinks || []).map((l) => l.document_id as string);
  const { data: existingTargetLinks } = sourceDocIds.length
    ? await supabaseAdmin
        .from("document_entities")
        .select("document_id")
        .eq("entity_id", targetId)
        .in("document_id", sourceDocIds)
    : { data: [] as Array<{ document_id: string }> };

  const alreadyLinked = new Set(
    (existingTargetLinks || []).map((l) => l.document_id),
  );

  // 3. Create new links to target for documents that don't already have one.
  const newLinks = (sourceLinks || [])
    .filter((l) => !alreadyLinked.has(l.document_id))
    .map((l) => ({
      document_id: l.document_id,
      entity_id: targetId,
      role: l.role,
    }));

  if (newLinks.length > 0) {
    const { error: insertError } = await supabaseAdmin
      .from("document_entities")
      .insert(newLinks);
    if (insertError) {
      return NextResponse.json(
        { error: `Failed to relink documents: ${insertError.message}` },
        { status: 500 },
      );
    }
  }

  // 4. Remove the source entity's remaining links.
  const { error: unlinkError } = await supabaseAdmin
    .from("document_entities")
    .delete()
    .eq("entity_id", sourceId);
  if (unlinkError) {
    return NextResponse.json(
      { error: `Failed to unlink source: ${unlinkError.message}` },
      { status: 500 },
    );
  }

  // 5. Delete the source entity row.
  const { error: deleteError } = await supabaseAdmin
    .from("entities")
    .delete()
    .eq("id", sourceId);
  if (deleteError) {
    return NextResponse.json(
      { error: `Failed to delete source entity: ${deleteError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    relinked: newLinks.length,
    skipped: alreadyLinked.size,
  });
}
