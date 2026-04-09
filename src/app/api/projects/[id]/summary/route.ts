import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveProjectId } from "@/lib/projects";
import { updateProjectSummary } from "@/lib/project-summary";

/**
 * POST /api/projects/[id]/summary
 *
 * Manually regenerates the project's "Where we are" narrative. Used by
 * the dashboard's [regenerate] button so the user can force a refresh
 * if the auto-update missed something or drifted.
 *
 * Body is optional. If absent, we regenerate from the most recent
 * conversation's last turn. If present with { text }, we use that as
 * the event detail.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idOrSlug } = await params;
  const projectId = await resolveProjectId(idOrSlug);
  if (!projectId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let body: { text?: string } = {};
  try {
    body = await request.json();
  } catch {
    // No body is fine — we'll regenerate from the latest turn instead.
  }

  // If the caller passed explicit text (e.g. user typed into an override
  // field), use that directly. Otherwise pull the most recent assistant
  // message from any conversation in this project as the "event".
  let userMessage: string | undefined;
  let assistantMessage: string | undefined;

  if (body.text && body.text.trim().length > 0) {
    assistantMessage = body.text.trim();
  } else {
    const { data: convos } = await supabaseAdmin
      .from("conversations")
      .select("id")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1);
    const latestConvoId = convos?.[0]?.id;
    if (latestConvoId) {
      const { data: messages } = await supabaseAdmin
        .from("messages")
        .select("role, content")
        .eq("conversation_id", latestConvoId)
        .order("created_at", { ascending: false })
        .limit(2);
      const sorted = (messages || []).slice().reverse();
      userMessage = sorted.find((m) => m.role === "user")?.content as
        | string
        | undefined;
      assistantMessage = sorted.find((m) => m.role === "assistant")
        ?.content as string | undefined;
    }
  }

  await updateProjectSummary({
    projectId,
    userMessage,
    assistantMessage,
    event: body.text ? "manual update" : "manual regenerate",
  });

  const { data: updated } = await supabaseAdmin
    .from("projects")
    .select("context_summary")
    .eq("id", projectId)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    summary: updated?.context_summary || null,
  });
}
