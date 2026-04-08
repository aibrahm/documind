import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveProjectId } from "@/lib/projects";

const VALID_SCOPES = new Set(["thread", "project", "shared", "institution"]);
const VALID_KINDS = new Set([
  "decision",
  "fact",
  "instruction",
  "preference",
  "risk",
  "question",
]);

export async function POST(request: NextRequest) {
  let body: {
    scopeType?: string;
    scopeId?: string | null;
    kind?: string;
    text?: string;
    entities?: string[];
    importance?: number;
    sourceConversationId?: string | null;
    sourceDocumentId?: string | null;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const scopeType = typeof body.scopeType === "string" ? body.scopeType : null;
  const kind = typeof body.kind === "string" ? body.kind : "fact";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const rawScopeId =
    typeof body.scopeId === "string" && body.scopeId.trim().length > 0
      ? body.scopeId.trim()
      : null;
  const entities = Array.isArray(body.entities)
    ? body.entities.filter((entity): entity is string => typeof entity === "string").slice(0, 12)
    : [];
  const importance =
    typeof body.importance === "number" && Number.isFinite(body.importance)
      ? Math.max(0, Math.min(body.importance, 1))
      : 0.7;

  if (!scopeType || !VALID_SCOPES.has(scopeType)) {
    return NextResponse.json({ error: "Invalid scopeType" }, { status: 400 });
  }
  if (!VALID_KINDS.has(kind)) {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }
  if (text.length < 8) {
    return NextResponse.json(
      { error: "Memory text must be at least 8 characters" },
      { status: 400 },
    );
  }

  let scopeId: string | null = rawScopeId;
  if (scopeType === "project") {
    if (!rawScopeId) {
      return NextResponse.json({ error: "Project scope requires scopeId" }, { status: 400 });
    }
    scopeId = await resolveProjectId(rawScopeId);
    if (!scopeId) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
  } else if (scopeType === "shared" || scopeType === "institution") {
    scopeId = null;
  }

  const { data, error } = await supabaseAdmin
    .from("memory_items")
    .insert({
      scope_type: scopeType,
      scope_id: scopeId,
      kind,
      text,
      entities,
      importance,
      source_conversation_id:
        typeof body.sourceConversationId === "string" ? body.sourceConversationId : null,
      source_document_id:
        typeof body.sourceDocumentId === "string" ? body.sourceDocumentId : null,
    })
    .select("*")
    .single();

  if (error) {
    console.error("memory POST error:", error);
    return NextResponse.json({ error: "Failed to save memory" }, { status: 500 });
  }

  return NextResponse.json({ memory: data });
}
