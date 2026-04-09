import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { runChatTurn, type InboundAttachment } from "@/lib/chat-turn";
import { isChatModelChoice, type ChatModelChoice } from "@/lib/chat-models";

export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: conversationId } = await params;

  // ── Parse + validate body ──
  let body: {
    message?: string;
    attachments?: InboundAttachment[];
    pinnedDocumentIds?: string[];
    pinnedEntityIds?: string[];
    model?: ChatModelChoice;
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
  const modelPreference = isChatModelChoice(body.model) ? body.model : "auto";

  // ── Load conversation history (last 20) ──
  const { data: history } = await supabaseAdmin
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(20);

  const historyMessages: Array<{ role: "user" | "assistant" | "system"; content: string }> =
    (history || []).map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    }));

  // ── Save user message immediately ──
  const attachmentMeta =
    attachments.length > 0
      ? attachments.map((a) => ({
          title: a.title,
          pageCount: a.pageCount ?? 0,
          size: a.size ?? 0,
        }))
      : undefined;

  await supabaseAdmin.from("messages").insert({
    conversation_id: conversationId,
    role: "user",
    content: userMessage,
    metadata: attachmentMeta ? { attachments: attachmentMeta } : {},
  });

  // Update conversation title if first follow-up (still on default title)
  if (historyMessages.length <= 2) {
    await supabaseAdmin
      .from("conversations")
      .update({
        title: userMessage.length > 60 ? userMessage.slice(0, 60) + "…" : userMessage,
      })
      .eq("id", conversationId);
  }

  // ── Stream via runChatTurn (no `session` event on continue path) ──
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (type: string, payload: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type, ...payload })}\n\n`),
        );
      };

      try {
        await runChatTurn({
          conversationId,
          userMessage,
          attachments,
          pinnedDocumentIds,
          pinnedEntityIds,
          modelPreference,
          history: historyMessages,
          emit,
        });
      } catch (err) {
        console.error("Chat continue error:", err);
        emit("error", { message: "Failed to generate response" });
      }

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
