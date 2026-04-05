import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { routeMessage } from "@/lib/intelligence-router";
import { hybridSearch } from "@/lib/search";
import { buildDoctrinePrompt } from "@/lib/doctrine";
import { getOpenAI, getAnthropic, hasAnthropic } from "@/lib/clients";

export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: conversationId } = await params;

  let body: { message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { message } = body;
  if (!message || typeof message !== "string" || message.trim().length < 1) {
    return NextResponse.json({ error: "Message required" }, { status: 400 });
  }

  const userMessage = message.trim();

  // Load conversation history
  const { data: history } = await supabaseAdmin
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(20);

  const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = (history || []).map(m => ({
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
  }));

  // Save user message
  await supabaseAdmin.from("messages").insert({
    conversation_id: conversationId,
    role: "user",
    content: userMessage,
  });

  // Update conversation title if first follow-up
  if (messages.length <= 2) {
    await supabaseAdmin.from("conversations").update({
      title: userMessage.length > 60 ? userMessage.slice(0, 60) + "…" : userMessage,
    }).eq("id", conversationId);
  }

  // Route with history context
  const routing = await routeMessage(userMessage, messages);

  // Search if needed
  let sources: Array<{ id: string; title: string; pageNumber: number; sectionTitle: string | null; documentId: string; content: string }> = [];
  let evidencePackage = "";

  if (routing.shouldSearch) {
    const results = await hybridSearch({ query: routing.searchQuery, matchCount: 6, useRerank: true });
    sources = results.map((r, i) => ({
      id: `DOC-${i + 1}`,
      title: r.document?.title || "Unknown",
      pageNumber: r.pageNumber,
      sectionTitle: r.sectionTitle,
      documentId: r.documentId,
      content: r.content,
    }));

    if (sources.length > 0) {
      evidencePackage = "═══ RETRIEVED DOCUMENTS ═══\n\n" +
        sources.map(s => `[${s.id}] ${s.title} | Page ${s.pageNumber}\n${s.content}`).join("\n\n") + "\n\n";
    }
  }

  // Build system prompt
  let systemPrompt: string;
  if (routing.mode === "deep") {
    systemPrompt = await buildDoctrinePrompt(routing.doctrines, "ar");
  } else {
    systemPrompt = `You are DocuMind, an intelligent document assistant. Answer naturally, cite sources as [DOC-N]. Respond in the user's language. Be concise and helpful.`;
  }

  // Build LLM messages with conversation history
  const llmMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
  ];

  // Add last 10 messages as history
  const recentHistory = messages.slice(-10);
  for (const m of recentHistory) {
    if (m.role === "user" || m.role === "assistant") {
      llmMessages.push({ role: m.role, content: m.content.slice(0, 2000) });
    }
  }

  // Add current message with evidence
  if (evidencePackage) {
    llmMessages.push({ role: "user", content: evidencePackage + "═══ USER MESSAGE ═══\n" + userMessage });
  } else {
    llmMessages.push({ role: "user", content: userMessage });
  }

  // Stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "routing", mode: routing.mode, doctrines: routing.doctrines })}\n\n`));

      if (sources.length > 0) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: "sources",
          sources: sources.map(s => ({ id: s.id, title: s.title, pageNumber: s.pageNumber, sectionTitle: s.sectionTitle, documentId: s.documentId })),
        })}\n\n`));
      }

      try {
        let fullText = "";
        const useClaudeForDeep = routing.mode === "deep" && hasAnthropic();

        if (useClaudeForDeep) {
          try {
            const llmStream = getAnthropic().messages.stream({
              model: "claude-sonnet-4-20250514",
              max_tokens: 4096,
              temperature: 0.1,
              system: systemPrompt,
              messages: llmMessages.slice(1).map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
            });
            for await (const event of llmStream) {
              if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
                fullText += event.delta.text;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", content: event.delta.text })}\n\n`));
              }
            }
          } catch {
            const llmStream = await getOpenAI().chat.completions.create({
              model: "gpt-4o", temperature: 0.1, max_tokens: 4096, stream: true, messages: llmMessages,
            });
            for await (const chunk of llmStream) {
              const delta = chunk.choices[0]?.delta?.content;
              if (delta) { fullText += delta; controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", content: delta })}\n\n`)); }
            }
          }
        } else {
          const model = routing.mode === "casual" ? "gpt-4o-mini" : "gpt-4o";
          const llmStream = await getOpenAI().chat.completions.create({
            model, temperature: 0.2, max_tokens: 4096, stream: true, messages: llmMessages,
          });
          for await (const chunk of llmStream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) { fullText += delta; controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", content: delta })}\n\n`)); }
          }
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));

        await supabaseAdmin.from("messages").insert({
          conversation_id: conversationId,
          role: "assistant",
          content: fullText,
          metadata: { mode: routing.mode, doctrines: routing.doctrines, sources: sources.map(s => ({ id: s.id, title: s.title, pageNumber: s.pageNumber, documentId: s.documentId })) },
        });
      } catch (err) {
        console.error("Chat continue error:", err);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: "Failed to generate response" })}\n\n`));
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
