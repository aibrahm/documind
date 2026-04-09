import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveProjectId } from "@/lib/projects";

const ALLOWED_ROLES = new Set(["primary", "reference", "supporting"]);

// GET /api/projects/[id]/documents
// Lists current documents linked to the project, joined to documents table.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: idOrSlug } = await params;
    const projectId = await resolveProjectId(idOrSlug);
    if (!projectId) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    // Pull link rows + joined doc fields. Filter to is_current=true at the doc layer.
    const { data: links, error } = await supabaseAdmin
      .from("project_documents")
      .select(`
        role,
        added_by,
        added_at,
        document:documents (
          id, title, type, classification, language, page_count, status, processing_error, context_card, is_current, created_at
        )
      `)
      .eq("project_id", projectId)
      .order("added_at", { ascending: false });

    if (error) {
      console.error("project_documents list error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    // Filter out non-current documents in JS (the join doesn't easily filter)
    const documents = (links || [])
      .filter((l) => {
        const doc = l.document as { is_current?: boolean } | null;
        return doc && doc.is_current !== false;
      })
      .map((l) => ({
        ...(l.document as object),
        link: { role: l.role, added_by: l.added_by, added_at: l.added_at },
      }));

    return NextResponse.json({ documents });
  } catch (err) {
    console.error("project_documents GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/projects/[id]/documents
// Body: { document_ids: string[], role?: string }
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: idOrSlug } = await params;
    const projectId = await resolveProjectId(idOrSlug);
    if (!projectId) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    let body: { document_ids?: unknown; role?: unknown };
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const documentIds = Array.isArray(body.document_ids)
      ? body.document_ids.filter((id): id is string => typeof id === "string")
      : [];
    if (documentIds.length === 0) {
      return NextResponse.json({ error: "document_ids must be a non-empty string array" }, { status: 400 });
    }

    const role = typeof body.role === "string" ? body.role : null;
    if (role && !ALLOWED_ROLES.has(role)) {
      return NextResponse.json({ error: `Invalid role: ${role}` }, { status: 400 });
    }

    // Verify all docs exist (defensive — Postgres will fail otherwise but the error is uglier)
    const { data: docs, error: docsErr } = await supabaseAdmin
      .from("documents")
      .select("id")
      .in("id", documentIds);
    if (docsErr) {
      console.error("documents check error:", docsErr);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    const foundIds = new Set((docs || []).map((d) => d.id));
    const missing = documentIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      return NextResponse.json({ error: `Documents not found: ${missing.join(", ")}` }, { status: 404 });
    }

    // Upsert links
    const rows = documentIds.map((docId) => ({
      project_id: projectId,
      document_id: docId,
      role,
      added_by: "user" as const,
    }));
    const { error: upsertErr } = await supabaseAdmin
      .from("project_documents")
      .upsert(rows, { onConflict: "project_id,document_id" });
    if (upsertErr) {
      console.error("project_documents upsert error:", upsertErr);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ added: documentIds.length }, { status: 201 });
  } catch (err) {
    console.error("project_documents POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/projects/[id]/documents?document_id=<uuid>
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: idOrSlug } = await params;
    const projectId = await resolveProjectId(idOrSlug);
    if (!projectId) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const { searchParams } = new URL(request.url);
    const documentId = searchParams.get("document_id");
    if (!documentId) {
      return NextResponse.json({ error: "document_id query param required" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("project_documents")
      .delete()
      .eq("project_id", projectId)
      .eq("document_id", documentId);
    if (error) {
      console.error("project_documents delete error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ removed: true });
  } catch (err) {
    console.error("project_documents DELETE error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
