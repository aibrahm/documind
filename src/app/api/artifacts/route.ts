import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveProjectId } from "@/lib/projects";
import type { Database, Json } from "@/lib/database.types";

const VALID_KINDS = new Set([
  "email",
  "memo",
  "brief",
  "deck",
  "note",
  "talking_points",
  "meeting_prep",
]);

const VALID_STATUSES = new Set(["draft", "review", "final", "archived"]);

export async function POST(request: NextRequest) {
  let body: {
    projectId?: string | null;
    conversationId?: string | null;
    entityId?: string | null;
    kind?: string;
    status?: string;
    title?: string;
    content?: string;
    metadata?: Record<string, unknown>;
    citations?: unknown[];
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const kind = typeof body.kind === "string" ? body.kind : "brief";
  const status = typeof body.status === "string" ? body.status : "draft";

  if (!VALID_KINDS.has(kind)) {
    return NextResponse.json({ error: "Invalid artifact kind" }, { status: 400 });
  }
  if (!VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid artifact status" }, { status: 400 });
  }
  if (title.length < 3) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  if (content.length < 20) {
    return NextResponse.json(
      { error: "Artifact content must be at least 20 characters" },
      { status: 400 },
    );
  }

  let projectId =
    typeof body.projectId === "string" && body.projectId.trim().length > 0
      ? body.projectId.trim()
      : null;
  if (projectId) {
    projectId = await resolveProjectId(projectId);
    if (!projectId) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
  }

  const artifactRow: Database["public"]["Tables"]["artifacts"]["Insert"] = {
    project_id: projectId,
    conversation_id:
      typeof body.conversationId === "string" ? body.conversationId : null,
    entity_id: typeof body.entityId === "string" ? body.entityId : null,
    kind,
    status,
    title,
    content,
    metadata:
      body.metadata && typeof body.metadata === "object"
        ? (body.metadata as Json)
        : ({} as Json),
    citations: Array.isArray(body.citations)
      ? (body.citations as Json)
      : ([] as Json),
  };

  const { data, error } = await supabaseAdmin
    .from("artifacts")
    .insert(artifactRow)
    .select("*")
    .single();

  if (error) {
    console.error("artifact POST error:", error);
    return NextResponse.json({ error: "Failed to save output" }, { status: 500 });
  }

  return NextResponse.json({ artifact: data });
}
