import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizeName, similarity } from "@/lib/entities";

/**
 * List entities linked to a document, with enough metadata for the
 * entity-editor UI to display + edit + flag duplicates.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: documentId } = await params;

  const { data: links, error: linksError } = await supabaseAdmin
    .from("document_entities")
    .select("entity_id, role, entity:entities ( id, name, name_en, type, metadata )")
    .eq("document_id", documentId);

  if (linksError) {
    return NextResponse.json(
      { error: linksError.message },
      { status: 500 },
    );
  }

  const entities = (links || [])
    .map((link) => {
      const e = link.entity as unknown as {
        id: string;
        name: string;
        name_en: string | null;
        type: string;
        metadata: Record<string, unknown> | null;
      } | null;
      if (!e) return null;
      return {
        id: e.id,
        name: e.name,
        name_en: e.name_en,
        type: e.type,
        role: (link as { role: string | null }).role ?? null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Duplicate detection — use the same similarity function the canonicalizer
  // uses, so the UI flags the same duplicates the extraction pipeline would
  // have merged automatically if the threshold were looser.
  const duplicates: Array<{ aId: string; bId: string; score: number }> = [];
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i];
      const b = entities[j];
      // Require same type OR either unknown, to avoid cross-type false positives
      if (a.type !== b.type) continue;
      const score = Math.max(
        similarity(normalizeName(a.name), normalizeName(b.name)),
        similarity(
          normalizeName(a.name_en || ""),
          normalizeName(b.name_en || ""),
        ),
      );
      if (score >= 0.82) {
        duplicates.push({ aId: a.id, bId: b.id, score });
      }
    }
  }

  return NextResponse.json({ entities, duplicates });
}

/**
 * Unlink an entity from this document (but keep the entity row alive for
 * other documents that reference it). Use DELETE /api/entities/[id] to
 * remove the entity entirely.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: documentId } = await params;
  const { searchParams } = new URL(request.url);
  const entityId = searchParams.get("entityId");

  if (!entityId) {
    return NextResponse.json(
      { error: "entityId query parameter is required" },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin
    .from("document_entities")
    .delete()
    .eq("document_id", documentId)
    .eq("entity_id", entityId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
