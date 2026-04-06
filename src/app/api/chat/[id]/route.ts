import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { routeMessage } from "@/lib/intelligence-router";
import { hybridSearch } from "@/lib/search";
import { webSearch } from "@/lib/web-search";
import { buildDoctrinePrompt } from "@/lib/doctrine";
import { getOpenAI, hasAnthropic } from "@/lib/clients";
import { runClaudeWithTools } from "@/lib/claude-with-tools";
import { findEntitiesInText } from "@/lib/entities";
import {
  retrieveRelevantMemories,
  formatMemoriesForPrompt,
  extractMemories,
  storeMemories,
} from "@/lib/memory";

export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: conversationId } = await params;

  let body: {
    message?: string;
    attachments?: Array<{ title: string; content: string; pageCount?: number; size?: number }>;
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
  const attachments = Array.isArray(rawAttachments)
    ? rawAttachments
        .filter(
          (a) =>
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
    return NextResponse.json({ error: "Message, attachment, or pinned reference required" }, { status: 400 });
  }

  const userMessage = (message || "").trim();

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

  // Save user message (with attachment metadata for re-rendering)
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

  // Update conversation title if first follow-up
  if (messages.length <= 2) {
    await supabaseAdmin.from("conversations").update({
      title: userMessage.length > 60 ? userMessage.slice(0, 60) + "…" : userMessage,
    }).eq("id", conversationId);
  }

  // Route + retrieve cross-conversation memories in parallel
  const [routing, priorMemories] = await Promise.all([
    routeMessage(userMessage, messages),
    retrieveRelevantMemories(userMessage, conversationId, 8),
  ]);
  const memoryBlock = formatMemoriesForPrompt(priorMemories);

  // Search documents and/or web if needed
  let documentEvidence: Array<{ id: string; type: "document"; title: string; pageNumber: number; sectionTitle: string | null; documentId: string; content: string }> = [];
  let webEvidence: Array<{ id: string; type: "web"; title: string; url: string }> = [];
  let evidencePackage = "";

  // ── Pinned references (explicit @ picker selections) ──
  let pinnedEvidence: Array<{
    id: string;
    type: "document";
    title: string;
    pageNumber: number;
    sectionTitle: string | null;
    documentId: string;
    content: string;
  }> = [];
  let pinnedDocTitles: string[] = [];
  let pinnedEntityDescriptions: string[] = [];

  let pinnedEntityRows: Array<{
    id: string;
    name: string;
    name_en: string | null;
    type: string;
  }> = [];
  if (pinnedEntityIds.length > 0) {
    const { data: ents } = await supabaseAdmin
      .from("entities")
      .select("id, name, name_en, type")
      .in("id", pinnedEntityIds);
    pinnedEntityRows = (ents || []) as typeof pinnedEntityRows;
    pinnedEntityDescriptions = pinnedEntityRows.map((e) => {
      const en = e.name_en && e.name_en !== e.name ? ` (${e.name_en})` : "";
      return `${e.name}${en} — ${e.type}`;
    });
  }

  let allPinnedDocIds = [...pinnedDocumentIds];
  if (pinnedEntityIds.length > 0) {
    const { data: links } = await supabaseAdmin
      .from("document_entities")
      .select("document_id")
      .in("entity_id", pinnedEntityIds);
    const fromEntities = [...new Set((links || []).map((l) => l.document_id as string))];
    allPinnedDocIds = [...new Set([...allPinnedDocIds, ...fromEntities])];
  }

  // Name-based corpus search for pinned entities (catches mentions in unlinked docs)
  if (pinnedEntityRows.length > 0) {
    for (const ent of pinnedEntityRows) {
      const queries = [ent.name, ent.name_en].filter(Boolean) as string[];
      for (const q of queries) {
        try {
          const nameResults = await hybridSearch({
            query: q,
            matchCount: 4,
            useRerank: false,
            currentOnly: true,
          });
          for (const r of nameResults) {
            if (!allPinnedDocIds.includes(r.documentId)) {
              allPinnedDocIds.push(r.documentId);
            }
          }
        } catch {
          /* swallow — name search is best-effort */
        }
      }
    }
  }

  if (allPinnedDocIds.length > 0) {
    const { data: pinnedDocs } = await supabaseAdmin
      .from("documents")
      .select("id, title, type, classification")
      .in("id", allPinnedDocIds);
    pinnedDocTitles = (pinnedDocs || []).map((d) => d.title);

    const { data: pinnedChunks } = await supabaseAdmin
      .from("chunks")
      .select("id, document_id, content, page_number, section_title, chunk_index")
      .in("document_id", allPinnedDocIds)
      .order("document_id", { ascending: true })
      .order("chunk_index", { ascending: true });

    const docMetaMap = new Map((pinnedDocs || []).map((d) => [d.id, d]));
    pinnedEvidence = (pinnedChunks || []).map((c, i) => {
      const meta = docMetaMap.get(c.document_id as string);
      return {
        id: `PINNED-${i + 1}`,
        type: "document" as const,
        title: meta?.title || "Unknown",
        pageNumber: c.page_number as number,
        sectionTitle: c.section_title as string | null,
        documentId: c.document_id as string,
        content: c.content as string,
      };
    });
  }

  // Entity scoping: only when nothing was explicitly pinned
  const mentionedEntities =
    allPinnedDocIds.length > 0 ? [] : await findEntitiesInText(userMessage, 5);
  let entityScopedDocIds: string[] | null = null;
  if (mentionedEntities.length > 0) {
    const { data: links } = await supabaseAdmin
      .from("document_entities")
      .select("document_id")
      .in(
        "entity_id",
        mentionedEntities.map((e) => e.id),
      );
    const ids = [...new Set((links || []).map((l) => l.document_id as string))];
    if (ids.length > 0) entityScopedDocIds = ids;
  }

  if (routing.shouldSearch) {
    const results = await hybridSearch({
      query: routing.searchQuery,
      matchCount: 6,
      useRerank: true,
      documentIds: entityScopedDocIds,
    });
    documentEvidence = results.map((r, i) => ({
      id: `DOC-${i + 1}`,
      type: "document",
      title: r.document?.title || "Unknown",
      pageNumber: r.pageNumber,
      sectionTitle: r.sectionTitle,
      documentId: r.documentId,
      content: r.content,
    }));

    if (documentEvidence.length > 0) {
      evidencePackage = "═══ RETRIEVED DOCUMENTS ═══\n\n" +
        documentEvidence.map(s => `[${s.id}] ${s.title} | Page ${s.pageNumber}\n${s.content}`).join("\n\n") + "\n\n";
    }
  }

  if (routing.shouldWebSearch) {
    const webResults = await webSearch(userMessage, 3);
    webEvidence = webResults.map((r, i) => ({
      id: `WEB-${i + 1}`,
      type: "web",
      title: r.title,
      url: r.url,
    }));
    if (webResults.length > 0) {
      evidencePackage += "═══ WEB SEARCH RESULTS ═══\n\n" +
        webResults.map((r, i) => `[WEB-${i + 1}] ${r.title}\nSource: ${r.url}\n${r.content}`).join("\n\n") + "\n\n";
    }
  }

  // Inject ephemeral attachments as context for THIS turn only
  if (attachments.length > 0) {
    evidencePackage += "═══ ATTACHED FILES (current message only) ═══\n\n" +
      attachments
        .map((a, i) => `[FILE-${i + 1}] ${a.title}${a.pageCount ? ` (${a.pageCount} pages)` : ""}\n${a.content}`)
        .join("\n\n") +
      "\n\n";
  }

  // Pinned documents are PRIMARY evidence — distinguish entity vs doc pins
  if (pinnedEvidence.length > 0) {
    const isEntityScoped = pinnedEntityRows.length > 0 && pinnedDocumentIds.length === 0;
    const header = isEntityScoped
      ? `═══ PINNED ENTITY: ${pinnedEntityDescriptions.join(", ")} ═══

The user pinned the ENTITY above. The user is asking ABOUT the entity, NOT about the documents below.

The chunks below are evidence showing WHERE in the knowledge base the entity is mentioned. You MUST cite each one explicitly when you describe where the entity appears, using the format: "in *[document title]* [PINNED-N]" — do not say "in the documents" generically.

Format requirement: at the end of your response, include a section like:
"Where ${pinnedEntityDescriptions[0]} appears in your knowledge base:
- [PINNED-1] in *[doc title]*, page X — [one-line description]
- [PINNED-2] in *[doc title]*, page Y — ..."

Document mentions follow:

`
      : "═══ PINNED DOCUMENTS (the user explicitly pinned these as the primary subject of the question) ═══\n\n";

    evidencePackage =
      header +
      pinnedEvidence
        .map(
          (s) =>
            `[${s.id}] ${s.title} | Page ${s.pageNumber}${s.sectionTitle ? ` | ${s.sectionTitle}` : ""}\n${s.content}`,
        )
        .join("\n\n") +
      "\n\n" +
      evidencePackage;
  } else if (pinnedEntityRows.length > 0) {
    evidencePackage =
      `═══ PINNED ENTITY: ${pinnedEntityDescriptions.join(", ")} ═══\n\nThe user pinned the entity above. No documents mentioning this entity were found in the knowledge base. Answer the question using your training knowledge about this entity, and explicitly note that the entity is not yet documented in the user's KB.\n\n` +
      evidencePackage;
  }

  // Load document inventory (newest first, stable order across turns)
  const { data: allDocs } = await supabaseAdmin
    .from("documents")
    .select("title, type, classification, language, page_count, created_at")
    .eq("status", "ready")
    .order("created_at", { ascending: false });

  const docInventory = (allDocs || [])
    .map(
      (d, i) =>
        `${i + 1}. "${d.title}" — ${d.type}, ${d.classification}, ${d.page_count} pages, ${d.language}`,
    )
    .join("\n");

  // Build system prompt
  let systemPrompt: string;
  if (routing.mode === "deep") {
    systemPrompt = (await buildDoctrinePrompt(routing.doctrines, "ar")) + "\n\n" + memoryBlock;
  } else {
    systemPrompt = `You are DocuMind, an intelligent document assistant for a government economic authority. You have access to institutional documents including contracts, laws, reports, and decrees.

${memoryBlock}

DOCUMENT INVENTORY (${(allDocs || []).length} documents indexed, newest first):
${docInventory || "No documents indexed yet."}

================ HOW TO ANSWER ================

GENERAL: Answer naturally and conversationally. Respond in the user's language (Arabic or English). Be specific and grounded — never invent facts.

LANGUAGE & NUMERALS:
- WHEN RESPONDING IN ARABIC: write all numbers using Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩), not Western digits (0123456789). Examples: ٢٠٢٦, ١٥٪, ٤.٣٦ مليار جنيه. Currency symbols and percent signs follow Arabic conventions.
- WHEN RESPONDING IN ENGLISH: use Western digits.

ENUMERATION QUESTIONS ("what documents do I have", "list documents", "give me a summary"):
- Use the DOCUMENT INVENTORY above as the authoritative source.
- Output a numbered list matching the inventory order exactly.
- Each line: number, classification badge, type, page count, then the title in its original language.
- Do NOT call hybrid search for this — the inventory has everything.

POSITIONAL REFERENCES ("document #6", "the third one", "tell me about number 2"):
- Read the inventory line at that exact position FIRST.
- Quote that line's title verbatim — never confuse it with another document.
- If you need content from that document (to summarize, compare, or analyze), the retrieved evidence chunks from hybrid search will be in the user message under [DOC-N]. Match them to the correct inventory entry by title — DO NOT assume DOC-1 corresponds to inventory item #1.

CONTENT QUESTIONS ("what does the contract say about...", "summarize the report"):
- Use the [DOC-N] evidence in the user message.
- Cite as [DOC-N] inline.
- If the evidence is missing or weak, say so — never fabricate.

WEB QUESTIONS:
- When [WEB-N] sources are provided, use them and cite as [WEB-N].

PINNED REFERENCES (the @ picker):

There are two pin modes — DON'T confuse them:

(A) PINNED DOCUMENT — the user pinned a specific file from the KB.
   - The document IS the subject. Answer questions about its content.
   - Evidence header will say "PINNED DOCUMENTS".

(B) PINNED ENTITY — the user pinned a person, company, project, or other named thing.
   - The ENTITY is the subject. Documents below are CONTEXT showing where it appears, NOT the answer.
   - "What is this?" / "Who is he?" / "Tell me about this" → describe THE ENTITY, not the documents.
   - Use your TRAINING KNOWLEDGE first (Wood Mackenzie = Edinburgh commodities research firm; Sumitomo = Japanese trading house; KIZAD = Abu Dhabi Ports industrial zone; etc).
   - Then ALWAYS cite WHERE in the KB the entity appears, by document title and [PINNED-N] tag. Example: "In your KB, Wood Mackenzie is referenced in *المخطط العام الشامل* [PINNED-3] as the source of the mining sector analysis on page 38."
   - DO NOT just say "the documents mention them" — name the documents specifically with title + [PINNED-N] inline citations.
   - NEVER describe the documents as if they were the subject.
   - Evidence header will say "PINNED ENTITY".

GENERAL RULES FOR PINS:
- When the user uses pronouns ("he", "she", "this", "it"), they mean the pinned reference.
- Cite document evidence by [PINNED-N] tag. Cite training knowledge as "بناءً على المعرفة العامة..." / "based on general knowledge..."
${pinnedDocTitles.length > 0 && pinnedEntityRows.length === 0 ? `- Currently pinned documents: ${pinnedDocTitles.map((t) => `"${t}"`).join(", ")}.\n` : ""}${pinnedEntityDescriptions.length > 0 ? `- Currently pinned ENTITY (the subject): ${pinnedEntityDescriptions.join("; ")}. Documents are context, not the subject.\n` : ""}
ATTACHED FILES:
- When the user attaches a file (appears in evidence as [FILE-N]), it's EPHEMERAL CONTEXT for the current turn only.
- "This document" or "this file" always means the attached file, not the knowledge base.

TONE: You work for senior decision-makers. Be precise, concise, professional. Skip filler. Lead with the answer.`;
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

      // Pinned source pills: PINNED-N IDs match inline citations, deduped by (doc, page)
      const seenPinnedPages = new Set<string>();
      const pinnedSourcePills = pinnedEvidence
        .filter((s) => {
          const key = `${s.documentId}:${s.pageNumber}`;
          if (seenPinnedPages.has(key)) return false;
          seenPinnedPages.add(key);
          return true;
        })
        .map((s) => ({
          id: s.id,
          type: s.type,
          title: s.title,
          pageNumber: s.pageNumber,
          sectionTitle: s.sectionTitle,
          documentId: s.documentId,
        }));

      const evidenceSources = [
        ...pinnedSourcePills,
        ...documentEvidence.map(s => ({ id: s.id, type: s.type, title: s.title, pageNumber: s.pageNumber, sectionTitle: s.sectionTitle, documentId: s.documentId })),
        ...webEvidence,
      ];
      if (evidenceSources.length > 0) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "sources", sources: evidenceSources })}\n\n`));
      }

      try {
        let fullText = "";
        const useClaudeForDeep = routing.mode === "deep" && hasAnthropic();
        const additionalWebSources: Array<{ id: string; type: "web"; title: string; url: string }> = [];

        if (useClaudeForDeep) {
          try {
            fullText = await runClaudeWithTools({
              systemPrompt,
              messages: llmMessages.slice(1).map((m) => ({
                role: m.role as "user" | "assistant",
                content: m.content,
              })),
              temperature: 0.3,
              maxTokens: 8192,
              onText: (delta) => {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: "text", content: delta })}\n\n`),
                );
              },
              onToolStart: (query) => {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "tool", status: "start", name: "web_search", query })}\n\n`,
                  ),
                );
              },
              onToolEnd: (query, count) => {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "tool", status: "end", name: "web_search", query, resultCount: count })}\n\n`,
                  ),
                );
              },
              onComplete: (_text, sources) => {
                additionalWebSources.push(...sources);
              },
            });
            if (additionalWebSources.length > 0) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "sources", sources: additionalWebSources })}\n\n`,
                ),
              );
              webEvidence.push(...additionalWebSources);
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
          metadata: {
            mode: routing.mode,
            doctrines: routing.doctrines,
            sources: [
              ...documentEvidence.map(s => ({ id: s.id, type: s.type, title: s.title, pageNumber: s.pageNumber, documentId: s.documentId })),
              ...webEvidence,
            ],
          },
        });

        // Fire-and-forget memory extraction
        extractMemories(userMessage, fullText, conversationId)
          .then((memories) => storeMemories(memories, conversationId))
          .catch((err) => console.error("Memory extraction error:", err));
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
