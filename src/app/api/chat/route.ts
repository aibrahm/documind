import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { routeMessage } from "@/lib/intelligence-router";
import { hybridSearch } from "@/lib/search";
import { buildDoctrinePrompt } from "@/lib/doctrine";
import { getOpenAI, getAnthropic, hasAnthropic } from "@/lib/clients";
import { logAudit } from "@/lib/audit";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let body: { message?: string; attachments?: unknown[] };
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

  // Create conversation
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

  // Save user message
  await supabaseAdmin.from("messages").insert({
    conversation_id: convo.id,
    role: "user",
    content: userMessage,
  });

  // Route the message
  const routing = await routeMessage(userMessage);

  // Search documents if needed
  let sources: Array<{ id: string; type: string; title: string; pageNumber: number; sectionTitle: string | null; clauseNumber: string | null; documentId: string; content: string }> = [];
  let evidencePackage = "";

  if (routing.shouldSearch) {
    const results = await hybridSearch({ query: routing.searchQuery, matchCount: 8, useRerank: true });
    sources = results.map((r, i) => ({
      id: `DOC-${i + 1}`,
      type: "document",
      title: r.document?.title || "Unknown",
      pageNumber: r.pageNumber,
      sectionTitle: r.sectionTitle,
      clauseNumber: r.clauseNumber,
      documentId: r.documentId,
      content: r.content,
    }));

    if (sources.length > 0) {
      evidencePackage = "═══ RETRIEVED DOCUMENTS ═══\n\n" +
        sources.map(s => `[${s.id}] ${s.title} | Page ${s.pageNumber}${s.sectionTitle ? ` | ${s.sectionTitle}` : ""}\n${s.content}`).join("\n\n") +
        "\n\n";
    }
  }

  // Build system prompt based on mode
  let systemPrompt: string;
  if (routing.mode === "deep") {
    systemPrompt = await buildDoctrinePrompt(routing.doctrines, "ar");
  } else {
    systemPrompt = `You are DocuMind, an intelligent document assistant for a government economic authority. You have access to institutional documents including contracts, laws, reports, and decrees.

Answer naturally and conversationally. Be helpful, specific, and cite sources as [DOC-N] when referencing document content. Support both Arabic and English — respond in the language the user writes in.

If the user asks a simple question, give a direct answer. If they ask for details, provide them. Don't force structured formats unless the question calls for it.

You are knowledgeable, professional, and concise. You work for senior decision-makers who value clarity over verbosity.`;
  }

  const llmMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
  ];

  if (evidencePackage) {
    llmMessages.push({ role: "user", content: evidencePackage + "═══ USER MESSAGE ═══\n" + userMessage });
  } else {
    llmMessages.push({ role: "user", content: userMessage });
  }

  // Stream response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Send session info
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "session", id: convo.id })}\n\n`));

      // Send routing decision
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
        type: "routing",
        mode: routing.mode,
        doctrines: routing.doctrines,
        reasoning: routing.reasoning,
      })}\n\n`));

      // Send sources
      if (sources.length > 0) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: "sources",
          sources: sources.map(s => ({ id: s.id, type: s.type, title: s.title, pageNumber: s.pageNumber, sectionTitle: s.sectionTitle, documentId: s.documentId })),
        })}\n\n`));
      }

      // Search mode: just send formatted results, no LLM needed
      if (routing.mode === "search") {
        const searchSummary = sources.length > 0
          ? `Found ${sources.length} relevant sections:\n\n` + sources.map(s => `**[${s.id}]** ${s.title} — Page ${s.pageNumber}${s.sectionTitle ? ` — ${s.sectionTitle}` : ""}\n${s.content.slice(0, 200)}…`).join("\n\n")
          : "No matching documents found. Try different keywords.";

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", content: searchSummary })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));

        // Save assistant message
        await supabaseAdmin.from("messages").insert({
          conversation_id: convo.id,
          role: "assistant",
          content: searchSummary,
          metadata: { mode: "search", sources: sources.map(s => ({ id: s.id, title: s.title, pageNumber: s.pageNumber, documentId: s.documentId })) },
        });

        controller.close();
        return;
      }

      // LLM streaming (casual or deep)
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
          } catch (claudeErr) {
            console.error("Claude failed, falling back to GPT-4o:", claudeErr);
            // Fallback to GPT-4o
            const llmStream = await getOpenAI().chat.completions.create({
              model: "gpt-4o", temperature: 0.1, max_tokens: 4096, stream: true,
              messages: llmMessages,
            });
            for await (const chunk of llmStream) {
              const delta = chunk.choices[0]?.delta?.content;
              if (delta) { fullText += delta; controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", content: delta })}\n\n`)); }
            }
          }
        } else {
          // GPT-4o-mini for casual, GPT-4o for deep without Anthropic
          const model = routing.mode === "casual" ? "gpt-4o-mini" : "gpt-4o";
          const llmStream = await getOpenAI().chat.completions.create({
            model, temperature: 0.2, max_tokens: 4096, stream: true,
            messages: llmMessages,
          });
          for await (const chunk of llmStream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) { fullText += delta; controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", content: delta })}\n\n`)); }
          }
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));

        // Save assistant message
        await supabaseAdmin.from("messages").insert({
          conversation_id: convo.id,
          role: "assistant",
          content: fullText,
          metadata: {
            mode: routing.mode,
            doctrines: routing.doctrines,
            model: useClaudeForDeep ? "claude-sonnet" : routing.mode === "casual" ? "gpt-4o-mini" : "gpt-4o",
            sources: sources.map(s => ({ id: s.id, title: s.title, pageNumber: s.pageNumber, documentId: s.documentId })),
          },
        });
      } catch (err) {
        console.error("Chat stream error:", err);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: "Failed to generate response" })}\n\n`));
      }

      logAudit("query", { conversationId: convo.id, mode: routing.mode, doctrines: routing.doctrines }).catch(console.error);
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
