import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { runChatTurn, type InboundAttachment } from "@/lib/chat-turn";
import { logAudit } from "@/lib/audit";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  // ── Parse + validate body ──
  let body: {
    message?: string;
    attachments?: InboundAttachment[];
    pinnedDocumentIds?: string[];
    pinnedEntityIds?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    message,
    attachments: rawAttachments,
    pinnedDocumentIds: rawPinnedDocs,
    pinnedEntityIds: rawPinnedEntities,
  } = body;
  const attachments: InboundAttachment[] = Array.isArray(rawAttachments)
    ? rawAttachments
        .filter(
          (a): a is InboundAttachment =>
            typeof a === "object" &&
            a !== null &&
            typeof a.title === "string" &&
            typeof a.content === "string",
        )
        .slice(0, 5)
    : [];
  const pinnedDocumentIds: string[] = Array.isArray(rawPinnedDocs)
    ? rawPinnedDocs.filter((id): id is string => typeof id === "string").slice(0, 10)
    : [];
  const pinnedEntityIds: string[] = Array.isArray(rawPinnedEntities)
    ? rawPinnedEntities.filter((id): id is string => typeof id === "string").slice(0, 10)
    : [];

  if (
    (!message || typeof message !== "string" || message.trim().length < 1) &&
    attachments.length === 0 &&
    pinnedDocumentIds.length === 0 &&
    pinnedEntityIds.length === 0
  ) {
    return NextResponse.json(
      { error: "Message, attachment, or pinned reference required" },
      { status: 400 },
    );
  }

  const userMessage = (message || "").trim();

  // ── Create conversation row ──
  const title = userMessage.length > 60 ? userMessage.slice(0, 60) + "…" : userMessage;
  const { data: convo, error: convoErr } = await supabaseAdmin
    .from("conversations")
    .insert({ title, mode: "chat", query: userMessage })
    .select("id")
    .single();

  if (convoErr || !convo) {
    console.error("Failed to create conversation:", convoErr);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }

  // ── Save user message immediately (so it persists even if streaming fails) ──
  const attachmentMeta =
    attachments.length > 0
      ? attachments.map((a) => ({
          title: a.title,
          pageCount: a.pageCount ?? 0,
          size: a.size ?? 0,
        }))
      : undefined;

  await supabaseAdmin.from("messages").insert({
    conversation_id: convo.id,
    role: "user",
    content: userMessage,
    metadata: attachmentMeta ? { attachments: attachmentMeta } : {},
  });

  // ── Stream via runChatTurn ──
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (type: string, payload: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type, ...payload })}\n\n`),
        );
      };

      // Always send session id first so the UI can switch from /api/chat to /api/chat/[id]
      emit("session", { id: convo.id });

      let turnResult: Awaited<ReturnType<typeof runChatTurn>> | null = null;
      try {
        turnResult = await runChatTurn({
          conversationId: convo.id,
          userMessage,
          attachments,
          pinnedDocumentIds,
          pinnedEntityIds,
          history: [], // new conversation — no prior messages
          emit,
        });
      } catch (err) {
        console.error("Chat stream error:", err);
        emit("error", { message: "Failed to generate response" });
      }

      logAudit("query", {
        conversationId: convo.id,
        mode: turnResult?.routing.mode,
        doctrines: turnResult?.routing.doctrines,
      }).catch(console.error);

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
