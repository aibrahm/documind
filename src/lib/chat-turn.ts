// src/lib/chat-turn.ts
//
// Unified streaming chat-turn helper.
//
// Both /api/chat (new conversation) and /api/chat/[id] (continue conversation)
// delegate to runChatTurn(). The two routes are thin wrappers that:
//   1. Parse + validate the request body
//   2. Resolve the conversation (create new vs load existing)
//   3. Persist the user message immediately
//   4. Call runChatTurn(...) with unified arguments
//   5. Return the streaming response
//
// Everything else — routing, entity detection, pinned resolution, evidence
// package construction, system prompt, Claude tool-use loop with GPT-4o
// fallback, assistant message persistence, fire-and-forget memory extraction
// — lives here.
//
// The helper is transport-agnostic: it never touches the SSE controller
// directly. It communicates with the caller via an `emit(eventType, payload)`
// callback. The route wraps `emit` in SSE serialization.

import { supabaseAdmin } from "@/lib/supabase";
import { routeMessage } from "@/lib/intelligence-router";
import { hybridSearch } from "@/lib/search";
import { webSearch } from "@/lib/web-search";
import { buildDoctrinePrompt } from "@/lib/doctrine";
import { getOpenAI, hasAnthropic } from "@/lib/clients";
import { runClaudeWithTools } from "@/lib/claude-with-tools";
import { findEntitiesInText } from "@/lib/entities";
import {
  formatContextCardForPrompt,
  type DocumentContextCard,
} from "@/lib/context-card";
import { updateProjectSummary } from "@/lib/project-summary";
import {
  retrieveRelevantMemories,
  formatMemoriesForPrompt,
  extractMemories,
  storeMemories,
} from "@/lib/memory";
import { logAudit } from "@/lib/audit";
import {
  formatKnowledgeLabel,
  isPrivateDocument,
} from "@/lib/document-knowledge";
import { resolveDocumentTargetsFromInventory } from "@/lib/query-resolution";
import { buildWorkspaceProfilePromptBlock, getWorkspaceProfile } from "@/lib/workspace-profile";
import type { Source } from "@/lib/types";

const PRIMARY_CHAT_MODEL = "gpt-5.4";

// Strong posture override — used as the FINAL block of the system prompt in
// both casual and deep modes. The default "be precise, professional" voice
// produces flat bureaucratic bullet lists that read like a government memo,
// not strategic advice. This block pushes the model toward sharp opinionated
// advisor voice and goes at the end of the system prompt so it has the
// freshest attention weight (and overrides anything doctrines might say
// about voice in deep mode).
const POSTURE_BLOCK = `POSTURE — your default voice. Read carefully:

You are advising the Vice Chairman of an economic authority. Treat him like one. He is a decision-maker between meetings, not a student wanting comprehensive coverage. The flat "bullet-list policy memo" voice is the failure mode. Avoid it.

- TAKE A STANCE. Pick the strongest interpretation of the question and defend it. Do NOT enumerate 5-7 neutral options like a research assistant — that produces vanilla government memos. Help him decide.
- BE OPINIONATED. Use pointed language: "the real question is X," "this is a mistake," "don't do Y, do Z." If you see a flaw in his framing, say so. If he is wasting time on the wrong thing, redirect him.
- CONCRETE > CATEGORIES. Bad: "explore tax incentives." Good: "Tax credit tied to local-content percentage, not a blanket 5-year exemption — here is why." Specifics beat abstractions every time.
- FORCE A DECISION when he is vague. End with ONE sharp clarifying question that forces a choice — not a generic "let me know if you need more."
- DON'T HEDGE. Avoid "could," "may," "perhaps," "it depends." Use "should," "is," "here is why." If you are genuinely uncertain, name the uncertainty: "I do not know X — find out before deciding Y."
- USE PROSE WHEN PROSE IS SHARPER. Don't default to 5-7 bullet categories. A tight 4-paragraph argument usually beats a vanilla outline. Use bullets only when structure genuinely helps.
- SKIP FILLER. No "Great question," no "Certainly," no "I would be happy to," no closing pleasantries. Lead with the answer; justify after.
- BE DIRECT, NOT RUDE. Confidence is not aggression. Push back, but never condescend.

This applies regardless of language. Same posture in Arabic and English.`;

// Defensive sanitizer: strip C0 control characters (U+0000 through U+001F)
// except whitespace (\\t \\n \\r). LLM-generated context cards and OCR output
// have occasionally contained stray control bytes that break OpenAI's strict
// JSON body parser ("could not parse JSON body of your request").
function sanitizePromptForOpenAI(s: string): string {
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

export interface InboundAttachment {
  title: string;
  content: string;
  pageCount?: number;
  size?: number;
}

export interface RunChatTurnArgs {
  conversationId: string;
  userMessage: string;
  attachments: InboundAttachment[];
  pinnedDocumentIds: string[];
  pinnedEntityIds: string[];
  history: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  emit: (eventType: string, payload: Record<string, unknown>) => void;
}

export interface RunChatTurnResult {
  fullText: string;
  routing: { mode: string; doctrines: string[] };
  modelUsed: string;
}

function openAiCompletionLimit(
  model: string,
  maxCompletionTokens: number,
): { max_tokens: number } | { max_completion_tokens: number } {
  if (model.startsWith("gpt-5")) {
    return { max_completion_tokens: maxCompletionTokens };
  }
  return { max_tokens: maxCompletionTokens };
}

function openAiTemperature(
  model: string,
  value: number,
): Record<string, never> | { temperature: number } {
  if (model.startsWith("gpt-5")) {
    return {};
  }
  return { temperature: value };
}

type DocumentSourcePayload = Extract<Source, { type: "document" }>;

async function loadDocumentSourceMetadata(documentIds: string[]) {
  if (documentIds.length === 0) return new Map<string, {
    title: string;
    classification: string | null;
    language: string | null;
    contextCard: Record<string, unknown> | null;
  }>();

  const { data } = await supabaseAdmin
    .from("documents")
    .select("id, title, classification, language, context_card")
    .in("id", documentIds);

  const byId = new Map<
    string,
    {
      title: string;
      classification: string | null;
      language: string | null;
      contextCard: Record<string, unknown> | null;
    }
  >();

  for (const row of data || []) {
    byId.set(row.id as string, {
      title: (row.title as string) || "Untitled document",
      classification: (row.classification as string | null) ?? null,
      language: (row.language as string | null) ?? null,
      contextCard: (row.context_card as Record<string, unknown> | null) ?? null,
    });
  }

  return byId;
}

function attachDocumentSourceMetadata(
  sources: Array<{
    id: string;
    type: "document";
    title: string;
    pageNumber: number;
    sectionTitle?: string | null;
    documentId: string;
  }>,
  metadataById: Map<
    string,
    {
      title: string;
      classification: string | null;
      language: string | null;
      contextCard: Record<string, unknown> | null;
    }
  >,
): DocumentSourcePayload[] {
  return sources.map((source) => {
    const meta = metadataById.get(source.documentId);
    return {
      ...source,
      title: meta?.title || source.title,
      classification: meta?.classification || undefined,
      language: meta?.language ?? null,
      contextCard: meta?.contextCard ?? null,
    };
  });
}

export async function runChatTurn(args: RunChatTurnArgs): Promise<RunChatTurnResult> {
  const {
    conversationId,
    userMessage,
    attachments,
    pinnedDocumentIds,
    pinnedEntityIds,
    history,
    emit,
  } = args;

  // ── Project context ──
  // A conversation may carry a project_id. When set, the thread gets project
  // workspace context, the project's linked documents are seeded as primary
  // evidence, and private documents linked only to OTHER projects are
  // excluded from retrieval.
  const { data: convoRow } = await supabaseAdmin
    .from("conversations")
    .select("project_id")
    .eq("id", conversationId)
    .maybeSingle();
  const projectId = (convoRow?.project_id as string | null) ?? null;

  let projectContext: {
    id: string;
    name: string;
    description: string | null;
    context_summary: string | null;
    color: string | null;
  } | null = null;
  let projectDocIds: string[] = [];
  const excludedDocIds = new Set<string>();
  let participantNames: string[] = [];

  if (projectId) {
    // Fetch project + linked-doc IDs + participants + other-projects' private
    // doc IDs in parallel — these are independent reads.
    const [projectRes, projectLinksRes, participantLinksRes, otherLinksRes] =
      await Promise.all([
        supabaseAdmin
          .from("projects")
          .select("id, name, description, context_summary, color")
          .eq("id", projectId)
          .maybeSingle(),
        supabaseAdmin
          .from("project_documents")
          .select("document_id")
          .eq("project_id", projectId),
        supabaseAdmin
          .from("project_entities")
          .select(
            `entity:entities ( name, name_en )`,
          )
          .eq("project_id", projectId),
        // Other projects' linked docs (used to compute exclusion)
        supabaseAdmin
          .from("project_documents")
          .select("document_id, project_id")
          .neq("project_id", projectId),
      ]);

    if (projectRes.data) projectContext = projectRes.data;
    projectDocIds = (projectLinksRes.data ?? []).map(
      (r) => r.document_id as string,
    );

    participantNames = (participantLinksRes.data ?? [])
      .map((l) => {
        const e = l.entity as { name?: string; name_en?: string | null } | null;
        return e?.name_en || e?.name || null;
      })
      .filter((s): s is string => Boolean(s));

    // Exclusion: docs linked only to other projects stay out of scope when
    // they are private. Shared/public reference material remains available.
    const otherDocIdSet = new Set(
      (otherLinksRes.data ?? [])
        .map((r) => r.document_id as string)
        .filter((id) => !projectDocIds.includes(id)),
    );
    if (otherDocIdSet.size > 0) {
      const { data: otherDocs } = await supabaseAdmin
        .from("documents")
        .select("id, classification, access_level, knowledge_scope")
        .in("id", [...otherDocIdSet]);
      for (const d of otherDocs ?? []) {
        if (isPrivateDocument(d)) {
          excludedDocIds.add(d.id as string);
        }
      }
    }
  }

  // ── Project library cards ──
  // Load context cards for every project-linked document so the model gets
  // a doc-level semantic summary of what's in the project's library before
  // any chunk retrieval happens. This gives it the "big picture" that RAG
  // alone often loses. Cards are only used when we're in a project.
  let projectLibraryCards: Array<{
    id: string;
    title: string;
    card: DocumentContextCard;
  }> = [];
  if (projectId && projectDocIds.length > 0) {
    const { data: cardRows } = await supabaseAdmin
      .from("documents")
      .select("id, title, context_card")
      .in("id", projectDocIds);
    projectLibraryCards = (cardRows || [])
      .filter((r) => r.context_card)
      .slice(0, 12) // cap prompt size — 12 cards is ~2-3k tokens
      .map((r) => ({
        id: r.id as string,
        title: r.title as string,
        card: r.context_card as unknown as DocumentContextCard,
      }));
  }

  // Route the message and pull cross-conversation memories in parallel.
  // The continue-path passes history to the router so it can rebuild a
  // topical search query from earlier turns when the current message is
  // terse ("retry", "this is old data", etc).
  const [routing, priorMemories, allDocs, workspaceProfile] = await Promise.all([
    routeMessage(userMessage, history),
    retrieveRelevantMemories(userMessage, conversationId, 8, projectId),
    supabaseAdmin
      .from("documents")
      .select(
        "id, title, type, classification, access_level, knowledge_scope, language, page_count, status, created_at",
      )
      .eq("status", "ready")
      .order("created_at", { ascending: false }),
    getWorkspaceProfile(),
  ]);
  const memoryBlock = formatMemoriesForPrompt(priorMemories);
  const workspaceProfileBlock = buildWorkspaceProfilePromptBlock(workspaceProfile);

  // Inventory scope policy:
  //   - If in a project: the inventory the model sees must match what the
  //     user thinks is "in this project". That means project-linked docs
  //     PLUS shared reference material (laws, treaties, doctrines) that is
  //     always visible. Docs with knowledge_scope="project" that belong to
  //     OTHER projects (or no project) must be hidden — they leak into
  //     enumeration answers and confuse the user.
  //   - If not in a project: default behavior — show all, just drop private
  //     docs linked only to other projects (existing excludedDocIds set).
  const projectDocIdSet = new Set(projectDocIds);
  const visibleDocs = (allDocs.data || []).filter((d) => {
    const id = d.id as string;
    if (excludedDocIds.has(id)) return false;
    if (!projectId) return true;
    if (projectDocIdSet.has(id)) return true;
    const scope = d.knowledge_scope as string | null;
    return scope === "shared_reference" || scope === "institutional_doctrine";
  });

  const docInventory = visibleDocs
    .map(
      (d, i) =>
        `${i + 1}. "${d.title}" — ${d.type}, ${formatKnowledgeLabel(d)}, ${d.page_count} pages, ${d.language}`,
    )
    .join("\n");

  const resolvedDocumentTargets = resolveDocumentTargetsFromInventory(
    userMessage,
    visibleDocs.map((doc) => ({
      id: doc.id as string,
      title: doc.title as string,
    })),
  ).slice(0, 2);
  const resolvedDocIds = resolvedDocumentTargets.map((target) => target.id);

  // Search documents if needed
  let documentEvidence: Array<{
    id: string;
    type: "document";
    title: string;
    pageNumber: number;
    sectionTitle: string | null;
    clauseNumber: string | null;
    documentId: string;
    content: string;
  }> = [];
  let resolvedDocEvidence: Array<{
    id: string;
    type: "document";
    title: string;
    pageNumber: number;
    sectionTitle: string | null;
    clauseNumber: string | null;
    documentId: string;
    content: string;
  }> = [];
  let webEvidence: Array<{ id: string; type: "web"; title: string; url: string }> = [];
  let evidencePackage = "";

  // ── Pinned references ──
  // The user explicitly pinned documents and/or entities via the @ picker.
  // Pinned docs are loaded in FULL (all chunks) and treated as primary
  // evidence — no top-k retrieval ambiguity. Pinned entities expand to all
  // their linked documents AND trigger a name-based corpus search so we
  // also pick up documents that mention them but aren't formally linked.
  let pinnedEvidence: Array<{
    id: string;
    type: "document";
    title: string;
    pageNumber: number;
    sectionTitle: string | null;
    clauseNumber: string | null;
    documentId: string;
    content: string;
  }> = [];
  let pinnedDocTitles: string[] = [];
  let pinnedEntityDescriptions: string[] = [];

  // Resolve pinned entity rows for naming + description
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

  // Expand pinned entities → their linked document IDs
  let allPinnedDocIds = [...pinnedDocumentIds];
  if (pinnedEntityIds.length > 0) {
    const { data: links } = await supabaseAdmin
      .from("document_entities")
      .select("document_id")
      .in("entity_id", pinnedEntityIds);
    const fromEntities = [...new Set((links || []).map((l) => l.document_id as string))];
    allPinnedDocIds = [...new Set([...allPinnedDocIds, ...fromEntities])];
  }

  // For pinned entities, ALSO run a name-based hybrid search across the corpus.
  // This catches documents that mention the entity but weren't formally linked
  // in document_entities (which is most documents — entity extraction is
  // incomplete). All searches are run in PARALLEL — the previous serial loop
  // could fire 6+ embedding+search calls back-to-back, adding seconds of
  // latency for users with multiple pinned entities.
  if (pinnedEntityRows.length > 0) {
    const queries: string[] = [];
    for (const ent of pinnedEntityRows) {
      if (ent.name) queries.push(ent.name);
      if (ent.name_en && ent.name_en !== ent.name) queries.push(ent.name_en);
    }
    const settled = await Promise.allSettled(
      queries.map((q) =>
        hybridSearch({
          query: q,
          matchCount: 4,
          useRerank: false,
          currentOnly: true,
        }),
      ),
    );
    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      for (const r of result.value) {
        if (!allPinnedDocIds.includes(r.documentId)) {
          allPinnedDocIds.push(r.documentId);
        }
      }
    }
  }

  if (allPinnedDocIds.length > 0) {
    // Pull metadata + ALL chunks for the pinned documents
    const { data: pinnedDocs } = await supabaseAdmin
      .from("documents")
      .select("id, title, type, classification, access_level, knowledge_scope")
      .in("id", allPinnedDocIds);
    pinnedDocTitles = (pinnedDocs || []).map((d) => d.title);

    const { data: pinnedChunks } = await supabaseAdmin
      .from("chunks")
      .select("id, document_id, content, page_number, section_title, clause_number, chunk_index")
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
        clauseNumber: c.clause_number as string | null,
        documentId: c.document_id as string,
        content: c.content as string,
      };
    });
  }

  // Deterministic document resolution from inventory references ("the first
  // one", exact quoted titles, etc). When we can resolve the user's target to
  // 1-2 specific docs, load ordered chunks from those docs up front so the
  // model reasons over the correct file rather than relying on global search.
  if (allPinnedDocIds.length === 0 && resolvedDocIds.length > 0) {
    const { data: targetChunks } = await supabaseAdmin
      .from("chunks")
      .select(
        "id, document_id, content, page_number, section_title, clause_number, chunk_index",
      )
      .in("document_id", resolvedDocIds)
      .order("document_id", { ascending: true })
      .order("chunk_index", { ascending: true })
      .limit(Math.min(48, resolvedDocIds.length * 24));

    const targetMetaMap = new Map(
      visibleDocs.map((doc) => [doc.id as string, doc]),
    );

    resolvedDocEvidence = (targetChunks || []).map((chunk, index) => {
      const meta = targetMetaMap.get(chunk.document_id as string);
      return {
        id: `TARGET-DOC-${index + 1}`,
        type: "document" as const,
        title: (meta?.title as string) || "Unknown",
        pageNumber: chunk.page_number as number,
        sectionTitle: chunk.section_title as string | null,
        clauseNumber: chunk.clause_number as string | null,
        documentId: chunk.document_id as string,
        content: chunk.content as string,
      };
    });
  }

  // Detect known entities in the user message — if any are mentioned (and the
  // user didn't already pin something), pre-filter retrieval to docs linked to
  // those entities. Skipped when pinned docs exist (the user was explicit).
  const mentionedEntities =
    allPinnedDocIds.length > 0 || resolvedDocIds.length > 0
      ? []
      : await findEntitiesInText(userMessage, 5);
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

  // ── Project knowledge evidence ──
  // When in a project, run an additional retrieval pass restricted to the
  // project's linked documents. These chunks become the FIRST evidence block
  // labeled PROJECT-DOC-N because they are the primary workspace context.
  let projectDocEvidence: Array<{
    id: string;
    type: "document";
    title: string;
    pageNumber: number;
    sectionTitle: string | null;
    clauseNumber: string | null;
    documentId: string;
    content: string;
  }> = [];
  if (projectId && projectDocIds.length > 0 && resolvedDocIds.length === 0) {
    try {
      const projectResults = await hybridSearch({
        query: routing.searchQuery || userMessage,
        matchCount: 6,
        useRerank: false,
        documentIds: projectDocIds,
        excludedDocumentIds: [...excludedDocIds],
      });
      projectDocEvidence = projectResults.map((r, i) => ({
        id: `PROJECT-DOC-${i + 1}`,
        type: "document" as const,
        title: r.document?.title || "Unknown",
        pageNumber: r.pageNumber,
        sectionTitle: r.sectionTitle,
        clauseNumber: r.clauseNumber,
        documentId: r.documentId,
        content: r.content,
      }));
    } catch (err) {
      console.error("Project-doc retrieval failed:", err);
    }
  }

  if (routing.shouldSearch) {
    // Project-scoped corpus search policy:
    //   - Project-linked docs are already handled by the projectDocEvidence
    //     pass above (restricted via documentIds = projectDocIds).
    //   - This main pass is the "general knowledge pool" — when in a project,
    //     we restrict it to shared reference material (laws, treaties) and
    //     institutional doctrines. This prevents unrelated private docs from
    //     leaking into project conversations while still giving the model
    //     access to the full reference library.
    //   - We ONLY apply the scope restriction when there are no explicit
    //     targets (entity-scoped or resolved). Explicit targets override scope
    //     filtering so pinned entities can still surface docs from anywhere.
    const mainSearchHasExplicitTargets =
      resolvedDocIds.length > 0 ||
      (entityScopedDocIds !== null && entityScopedDocIds.length > 0);
    const allowedScopesForMainSearch =
      projectId && !mainSearchHasExplicitTargets
        ? (["shared_reference", "institutional_doctrine"] as const)
        : null;

    const results = await hybridSearch({
      query: routing.searchQuery,
      matchCount: 8,
      useRerank: true,
      // If the user mentioned a known entity, restrict to its linked docs.
      // Otherwise normal corpus-wide search.
      documentIds: resolvedDocIds.length > 0 ? resolvedDocIds : entityScopedDocIds,
      excludedDocumentIds: [...excludedDocIds],
      knowledgeScopes: allowedScopesForMainSearch
        ? [...allowedScopesForMainSearch]
        : null,
    });
    // De-dupe against project-doc evidence by DOCUMENT id (not chunk).
    // If the same doc surfaced in both passes, only the project-scoped pass
    // gets the evidence label — global retrieval skips the entire document.
    const projectDocIdSet = new Set(
      projectDocEvidence.map((p) => p.documentId),
    );
    const deduped = results.filter(
      (r) => !projectDocIdSet.has(r.documentId),
    );
    documentEvidence = deduped.map((r, i) => ({
      id: `DOC-${i + 1}`,
      type: "document",
      title: r.document?.title || "Unknown",
      pageNumber: r.pageNumber,
      sectionTitle: r.sectionTitle,
      clauseNumber: r.clauseNumber,
      documentId: r.documentId,
      content: r.content,
    }));

    if (documentEvidence.length > 0) {
      evidencePackage = "═══ RETRIEVED DOCUMENTS ═══\n\n" +
        documentEvidence.map(s => `[${s.id}] ${s.title} | Page ${s.pageNumber}${s.sectionTitle ? ` | ${s.sectionTitle}` : ""}\n${s.content}`).join("\n\n") +
        "\n\n";
    }
  }

  if (resolvedDocEvidence.length > 0) {
    const targetDescriptions = resolvedDocumentTargets
      .map((target) => `- "${target.title}" (${target.detail})`)
      .join("\n");
    const targetBlock =
      `═══ EXACT DOCUMENT TARGETS ═══

The user explicitly referred to these document(s), resolved from the visible inventory:
${targetDescriptions}

The TARGET-DOC blocks below are the exact primary evidence for this request. Prioritize them over generic retrieval and cite them as [TARGET-DOC-N].

` +
      resolvedDocEvidence
        .map(
          (section) =>
            `[${section.id}] ${section.title} | Page ${section.pageNumber}${section.sectionTitle ? ` | ${section.sectionTitle}` : ""}\n${section.content}`,
        )
        .join("\n\n") +
      "\n\n";
    evidencePackage = targetBlock + evidencePackage;
  }

  // Prepend project-doc evidence to the package (after the regular block has
  // been built) so PROJECT-DOC-N appears FIRST in the user message.
  if (projectDocEvidence.length > 0) {
    const projectBlock =
      "═══ PROJECT DOCUMENTS (linked to this project — primary context) ═══\n\n" +
      projectDocEvidence
        .map(
          (s) =>
            `[${s.id}] ${s.title} | Page ${s.pageNumber}${s.sectionTitle ? ` | ${s.sectionTitle}` : ""}\n${s.content}`,
        )
        .join("\n\n") +
      "\n\n";
    evidencePackage = projectBlock + evidencePackage;
  }

  // Web search if router says so.
  // Use routing.searchQuery (not the raw userMessage): the router strips slash
  // prefixes like "/web " and rewrites terse follow-ups ("look up some stuff",
  // "try again") into a topical query using conversation history. Passing the
  // raw userMessage here defeats all of that and produces garbage Tavily hits.
  let webSearchError: string | null = null;
  if (routing.shouldWebSearch) {
    const webQuery = routing.searchQuery?.trim() || userMessage;
    try {
      const webResults = await webSearch(webQuery, 5);
      webEvidence = webResults.map((r, i) => ({
        id: `WEB-${i + 1}`,
        type: "web",
        title: r.title,
        url: r.url,
      }));
      if (webResults.length > 0) {
        evidencePackage +=
          `═══ WEB SEARCH RESULTS (query: "${webQuery}") ═══\n\n` +
          webResults
            .map((r, i) => `[WEB-${i + 1}] ${r.title}\nSource: ${r.url}\n${r.content}`)
            .join("\n\n") +
          "\n\n";
      } else {
        webSearchError = `Web search for "${webQuery}" returned no results.`;
      }
    } catch (err) {
      // Fail loud per CLAUDE.md: surface the web-search failure to both the
      // user (via a visible notice block in the evidence) and the UI stream.
      const msg = err instanceof Error ? err.message : String(err);
      console.error("webSearch failed:", msg);
      webSearchError = `Web search failed: ${msg}`;
      emit("tool", { status: "error", name: "web_search", query: webQuery, error: msg });
    }
    if (webSearchError) {
      evidencePackage +=
        `═══ WEB SEARCH NOTICE ═══\n${webSearchError}\nYou MUST tell the user explicitly that the web search did not return usable results for this turn. Do NOT pretend to lack web access in general, and do NOT invent facts.\n\n`;
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

  // Pinned documents are PRIMARY evidence — the user explicitly pointed at them.
  // They go FIRST in the evidence package and are labeled distinctly.
  if (pinnedEvidence.length > 0) {
    // Distinguish two cases in the header:
    // (a) user pinned entities → docs are CONTEXT (where the entity appears)
    // (b) user pinned documents → docs are the SUBJECT
    const isEntityScoped = pinnedEntityRows.length > 0 && pinnedDocumentIds.length === 0;
    const header = isEntityScoped
      ? `═══ PINNED ENTITY: ${pinnedEntityDescriptions.join(", ")} ═══

The user pinned the ENTITY above. The user is asking ABOUT the entity, NOT about the documents below.

The chunks below are evidence showing WHERE in the knowledge base the entity is mentioned. You MUST cite each one explicitly when you describe where the entity appears, using the format: "in *[document title]* [PINNED-N]" — do not say "in the documents" generically.

Format requirement: at the end of your response, include a section like:
"Where ${pinnedEntityDescriptions[0]} appears in your knowledge base:
- [PINNED-1] in *[doc title]*, page X — [one-line description of what the chunk says about the entity]
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
    // Entity pinned but no docs found — still tell the model what was pinned
    evidencePackage =
      `═══ PINNED ENTITY: ${pinnedEntityDescriptions.join(", ")} ═══\n\nThe user pinned the entity above. No documents mentioning this entity were found in the knowledge base. Answer the question using your training knowledge about this entity, and explicitly note that the entity is not yet documented in the user's KB.\n\n` +
      evidencePackage;
  }

  const evidenceSources = [
    ...pinnedEvidence,
    ...resolvedDocEvidence,
    ...projectDocEvidence,
    ...documentEvidence,
    ...webEvidence,
  ];

  // ── Project context block (Phase 05) ──
  // Injected into BOTH deep and casual prompts when the conversation has a
  // project_id. Tells the model what project it's in, what the project is
  // about, and that the PROJECT-DOC blocks below are primary context.
  //
  // If project-linked documents have context cards (generated by the
  // contextualizer pass at upload time), we embed a "PROJECT LIBRARY"
  // block listing each doc with its semantic summary. This gives the
  // model the doc-level big picture before it sees chunk-level evidence.
  const projectLibraryBlock =
    projectLibraryCards.length > 0
      ? `═══ PROJECT LIBRARY (${projectLibraryCards.length} document${projectLibraryCards.length === 1 ? "" : "s"} linked to this project) ═══

${projectLibraryCards
  .map((entry, i) => `${i + 1}. ${formatContextCardForPrompt(entry.card, entry.title)}`)
  .join("\n\n")}

These are the documents currently linked to this project. Use the summaries above to understand what's available BEFORE deciding what to cite. When you cite a specific clause or number, cite the [PROJECT-DOC-N] chunk evidence in the user message, not the library summary.

`
      : "";

  const projectContextBlock = projectContext
    ? `═══ PROJECT CONTEXT ═══

You are working inside the **${projectContext.name}** project.${projectContext.description ? `

Description: ${projectContext.description}` : ""}${projectContext.context_summary ? `

Context summary: ${projectContext.context_summary}` : ""}${participantNames.length > 0 ? `

Participants: ${participantNames.join(", ")}` : ""}

The PROJECT-DOC blocks in the user message are this project's linked documents — they are the primary context for any question. Other DOC blocks are general retrieval; WEB blocks are external sources. Cite project documents as [PROJECT-DOC-N] inline. If you reference a linked participant by pronoun ("they", "the developer", "the ministry"), the user means a participant above.

` + projectLibraryBlock
    : "";

  // Build system prompt based on mode
  const deliverableFormattingBlock = `DELIVERABLE FORMATTING:
- When the user asks for a concrete draft deliverable, keep any setup outside the deliverable brief and put the deliverable itself inside a fenced block with one of these labels: email, memo, brief, talking-points, meeting-prep, deck, note.
- For email blocks, the first line inside the block must be "Subject: ...".
- Use these blocks only for actual deliverables, not ordinary analysis.`;

  let systemPrompt: string;
  if (routing.mode === "deep") {
    systemPrompt =
      projectContextBlock +
      workspaceProfileBlock +
      (await buildDoctrinePrompt(routing.doctrines, "ar")) +
      "\n\n" +
      memoryBlock +
      "\n\n" +
      deliverableFormattingBlock +
      "\n\n" +
      POSTURE_BLOCK;
  } else {
    systemPrompt = projectContextBlock + workspaceProfileBlock + `You are DocuMind, an intelligent document assistant for a government economic authority. You have access to institutional documents including contracts, laws, reports, and decrees.

${memoryBlock}

DOCUMENT INVENTORY (${visibleDocs.length} documents available, newest first):
${docInventory || "No documents indexed yet."}

================ HOW TO ANSWER ================

GENERAL: Answer naturally and conversationally. Respond in the user's language (Arabic or English). Be specific and grounded — never invent facts.

LANGUAGE & NUMERALS:
- WHEN RESPONDING IN ARABIC: write all numbers using Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩), not Western digits (0123456789). Examples: ٢٠٢٦, ١٥٪, ٤.٣٦ مليار جنيه. Currency symbols and percent signs follow Arabic conventions.
- WHEN RESPONDING IN ENGLISH: use Western digits.

ENUMERATION QUESTIONS ("what documents do I have", "list documents", "give me a summary"):
- Use the DOCUMENT INVENTORY above as the authoritative source.
- Output a numbered list matching the inventory order exactly.
- Each line: number, access/scope badge, type, page count, then the title in its original language.
- Do NOT call hybrid search for this — the inventory has everything.

POSITIONAL REFERENCES ("document #6", "the third one", "tell me about number 2"):
- Read the inventory line at that exact position FIRST.
- Quote that line's title verbatim — never confuse it with another document.
- If you need content from that document (to summarize, compare, or analyze), the retrieved evidence chunks from hybrid search will be in the user message under [DOC-N]. Match them to the correct inventory entry by title — DO NOT assume DOC-1 corresponds to inventory item #1.

EXACT DOCUMENT TARGETS:
- When TARGET-DOC blocks are present, the system already resolved the user's reference to a specific document from the inventory.
- Treat TARGET-DOC blocks as the primary evidence for this turn.
- Cite them inline as [TARGET-DOC-N].

CONTENT QUESTIONS ("what does the contract say about...", "summarize the report"):
- Use the [DOC-N] evidence in the user message.
- Cite as [DOC-N] inline.
- If the evidence is missing or weak, say so — never fabricate.

WEB QUESTIONS:
- You DO have web search. When [WEB-N] sources are provided in this turn, the system already searched the internet for you — USE them to answer directly and cite as [WEB-N]. NEVER say "I can't browse the internet" or "check Reuters yourself" when [WEB-N] blocks are present.
- When a "WEB SEARCH NOTICE" block appears, the search failed or returned nothing. Tell the user that plainly — do not substitute a generic "you can check these sites" answer, and do not claim a general lack of web access. State what went wrong in one line.
- For news/current-events questions, summarize the actual content of the [WEB-N] articles in your own words with inline [WEB-N] citations. Do not just list source names.

PINNED REFERENCES (the @ picker):

There are two pin modes — DON'T confuse them:

(A) PINNED DOCUMENT — the user pinned a specific file from the KB.
   - The document IS the subject. Answer questions about its content.
   - "What does this say?" → summarize the document.
   - Evidence header will say "PINNED DOCUMENTS".

(B) PINNED ENTITY — the user pinned a person, company, project, or other named thing.
   - The ENTITY is the subject. The retrieved documents are just CONTEXT showing where the entity appears in the KB. They are NOT the answer.
   - "What is this?" / "Who is he?" / "Tell me about this" → describe THE ENTITY, not the documents.
   - Use your TRAINING KNOWLEDGE first (especially for known companies, public figures, organizations). Wood Mackenzie is an Edinburgh-based commodities research firm. Sumitomo Corporation is a major Japanese trading house. KIZAD is Abu Dhabi Ports' industrial zone. Etc.
   - Then ALWAYS cite WHERE in the KB the entity appears, by document title and [PINNED-N] tag. Example: "In your KB, Wood Mackenzie is referenced in *المخطط العام الشامل* [PINNED-3] as the source of the mining sector analysis on page 38, and in *خطة عمل مدنية* [PINNED-1] as a strategic data partner."
   - DO NOT just say "the documents mention them" — name the documents specifically with title + [PINNED-N] inline citations.
   - NEVER describe the documents as if they were the subject. The user pinned the ENTITY.
   - Evidence header will say "PINNED ENTITY".

GENERAL RULES FOR PINS:
- When the user uses pronouns ("he", "she", "this", "it", "the contract"), they mean the pinned reference. Resolve pronouns from pinned context.
- Cite document evidence by [PINNED-N] tag.
- Cite training knowledge explicitly: "بناءً على المعرفة العامة..." / "based on general knowledge about [entity]..."
${pinnedDocTitles.length > 0 && pinnedEntityRows.length === 0 ? `- Currently pinned documents: ${pinnedDocTitles.map((t) => `"${t}"`).join(", ")}.\n` : ""}${pinnedEntityDescriptions.length > 0 ? `- Currently pinned ENTITY (the subject of the question): ${pinnedEntityDescriptions.join("; ")}. The documents below are context, not the subject.\n` : ""}
ATTACHED FILES:
- When the user attaches a file (appears in evidence as [FILE-N]), it's EPHEMERAL CONTEXT for the current turn only.
- "This document" or "this file" always means the attached file, not the knowledge base.

${deliverableFormattingBlock}

${POSTURE_BLOCK}`;
  }

  // Build LLM messages: system + history (last 10) + user-with-evidence.
  // Sanitize the system prompt to strip C0 control characters that have
  // historically broken OpenAI's request body parser when LLM-generated
  // context cards or OCR output leaked stray bytes into the prompt.
  const llmMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: sanitizePromptForOpenAI(systemPrompt) },
  ];

  const recentHistory = history.slice(-10);
  for (const m of recentHistory) {
    if (m.role === "user" || m.role === "assistant") {
      llmMessages.push({
        role: m.role,
        content: sanitizePromptForOpenAI(m.content.slice(0, 2000)),
      });
    }
  }

  if (evidencePackage) {
    llmMessages.push({
      role: "user",
      content: sanitizePromptForOpenAI(
        evidencePackage + "═══ USER MESSAGE ═══\n" + userMessage,
      ),
    });
  } else {
    llmMessages.push({
      role: "user",
      content: sanitizePromptForOpenAI(userMessage),
    });
  }

  // ── Emit routing decision ──
  emit("routing", {
    mode: routing.mode,
    doctrines: routing.doctrines,
    reasoning: routing.reasoning,
  });

  // Pinned source pills: keep PINNED-N IDs (matching the inline citations)
  // and dedupe by (documentId, pageNumber) — one pill per page, not per doc.
  // This way the user can click PINNED-30 in the inline citation and land
  // on the actual page being referenced.
  const seenPinnedPages = new Set<string>();
  const pinnedSourcePills = pinnedEvidence
    .filter((s) => {
      const key = `${s.documentId}:${s.pageNumber}`;
      if (seenPinnedPages.has(key)) return false;
      seenPinnedPages.add(key);
      return true;
    })
    .map((s) => ({
      id: s.id, // PINNED-N — matches inline citations
      type: s.type,
      title: s.title,
      pageNumber: s.pageNumber,
      sectionTitle: s.sectionTitle,
      documentId: s.documentId,
    }));

  const sourceDocumentMeta = await loadDocumentSourceMetadata(
    [...new Set([
      ...pinnedSourcePills.map((s) => s.documentId),
      ...resolvedDocEvidence.map((s) => s.documentId),
      ...projectDocEvidence.map((s) => s.documentId),
      ...documentEvidence.map((s) => s.documentId),
    ])],
  );

  const enrichedPinnedSourcePills = attachDocumentSourceMetadata(
    pinnedSourcePills,
    sourceDocumentMeta,
  );
  const enrichedResolvedDocEvidence = attachDocumentSourceMetadata(
    resolvedDocEvidence.map((s) => ({
      id: s.id,
      type: s.type,
      title: s.title,
      pageNumber: s.pageNumber,
      sectionTitle: s.sectionTitle,
      documentId: s.documentId,
    })),
    sourceDocumentMeta,
  );
  const enrichedProjectDocEvidence = attachDocumentSourceMetadata(
    projectDocEvidence.map((s) => ({
      id: s.id,
      type: s.type,
      title: s.title,
      pageNumber: s.pageNumber,
      sectionTitle: s.sectionTitle,
      documentId: s.documentId,
    })),
    sourceDocumentMeta,
  );
  const enrichedDocumentEvidence = attachDocumentSourceMetadata(
    documentEvidence.map((s) => ({
      id: s.id,
      type: s.type,
      title: s.title,
      pageNumber: s.pageNumber,
      sectionTitle: s.sectionTitle,
      documentId: s.documentId,
    })),
    sourceDocumentMeta,
  );

  // Send sources (pinned + project docs + documents + web, unified)
  if (evidenceSources.length > 0 || pinnedSourcePills.length > 0) {
    emit("sources", {
      sources: [
        ...enrichedPinnedSourcePills,
        ...enrichedResolvedDocEvidence,
        ...enrichedProjectDocEvidence,
        ...enrichedDocumentEvidence,
        ...webEvidence,
      ],
    });
  }

  // ── LLM streaming ──
  // Default path → GPT-5.4 direct stream for all visible chat responses.
  // Deep mode may still use Claude tool-use when available, but the OpenAI
  // fallback stays on the same GPT-5.4 family for consistency.
  let fullText = "";
  const useClaudeForDeep = routing.mode === "deep" && hasAnthropic();
  const additionalWebSources: Array<{ id: string; type: "web"; title: string; url: string }> = [];
  let modelUsed: string;

  if (useClaudeForDeep) {
    try {
      fullText = await runClaudeWithTools({
        systemPrompt,
        messages: llmMessages.slice(1).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        temperature: 0.3,
        // 8192 was too low for long bilingual Arabic responses — Arabic uses
        // ~2× the tokens per visible character vs English, and deep-mode
        // comparison tables + multi-section analyses hit the cap regularly,
        // producing mid-sentence truncation. Claude Opus supports up to 32k
        // output tokens. 24k gives us headroom without being wasteful.
        maxTokens: 24000,
        onText: (delta) => {
          emit("text", { content: delta });
        },
        onToolStart: (query, toolName = "web_search") => {
          emit("tool", { status: "start", name: toolName, query });
        },
        onToolEnd: (query, count, toolName = "web_search") => {
          emit("tool", {
            status: "end",
            name: toolName,
            query,
            resultCount: count,
          });
        },
        onComplete: (_text, sources) => {
          additionalWebSources.push(...sources);
        },
      });
      modelUsed = "claude-opus-4-6";
      // Stream any additional web sources discovered during tool use
      if (additionalWebSources.length > 0) {
        emit("sources", { sources: additionalWebSources });
        // Also push them into the saved sources list
        webEvidence.push(...additionalWebSources);
      }
    } catch (claudeErr) {
      console.error(`Claude failed, falling back to ${PRIMARY_CHAT_MODEL}:`, claudeErr);
      const llmStream = await getOpenAI().chat.completions.create({
        model: PRIMARY_CHAT_MODEL,
        ...openAiTemperature(PRIMARY_CHAT_MODEL, 0.1),
        ...openAiCompletionLimit(PRIMARY_CHAT_MODEL, 16000),
        stream: true,
        messages: llmMessages,
      });
      for await (const chunk of llmStream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          emit("text", { content: delta });
        }
      }
      modelUsed = PRIMARY_CHAT_MODEL;
    }
  } else {
    // All visible chat replies now use GPT-5.4 for consistency and drafting quality.
    const model = PRIMARY_CHAT_MODEL;
    const llmStream = await getOpenAI().chat.completions.create({
      model,
      ...openAiTemperature(model, 0.2),
      ...openAiCompletionLimit(model, 16000),
      stream: true,
      messages: llmMessages,
    });
    for await (const chunk of llmStream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        fullText += delta;
        emit("text", { content: delta });
      }
    }
    modelUsed = model;
  }

  emit("done", {});

  // Save assistant message
  await supabaseAdmin.from("messages").insert({
    conversation_id: conversationId,
    role: "assistant",
    content: fullText,
    metadata: ({
      mode: routing.mode,
      doctrines: routing.doctrines,
      model: modelUsed,
      sources: [
        ...enrichedResolvedDocEvidence,
        ...enrichedProjectDocEvidence,
        ...enrichedDocumentEvidence,
        ...webEvidence,
      ],
    } as unknown) as never,
  });

  await supabaseAdmin
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversationId);

  // Audit log: one row per chat turn (closes the "audit_log underwritten"
  // deferred enhancement from CONCERNS.md). Captures the routing decision,
  // model used, project context, and message length so we can later compute
  // costs and trace how a given response was generated.
  logAudit("query", {
    conversationId,
    mode: routing.mode,
    doctrines: routing.doctrines,
    model: modelUsed,
    projectId: projectId ?? null,
    messageLength: userMessage.length,
    responseLength: fullText.length,
    sourcesCount:
      pinnedEvidence.length +
      projectDocEvidence.length +
      documentEvidence.length +
      webEvidence.length,
    pinnedDocs: pinnedDocumentIds.length,
    pinnedEntities: pinnedEntityIds.length,
  }).catch((err) => console.error("audit logAudit failed:", err));

  // Memory extraction is fire-and-forget and silently catches errors, which
  // violates "Fail Loud, Never Fake". Gate it behind an env flag so demo
  // environments can disable it entirely until we add visible SSE warnings.
  // Default: disabled. Set MEMORY_EXTRACTION_ENABLED=true to turn on.
  if (process.env.MEMORY_EXTRACTION_ENABLED === "true") {
    extractMemories(userMessage, fullText, conversationId)
      .then((memories) => storeMemories(memories, conversationId, projectId))
      .catch((err) => console.error("Memory extraction error:", err));
  }

  // Project context summary (the "Where we are" narrative) — fire-and-forget.
  // Updates the project's running status paragraph so the dashboard can show
  // a live sense of where the user is in this piece of work, and future
  // turns can be seeded with project-level context without re-reading every
  // document. Errors are logged, never bubbled, never block the response.
  if (projectId) {
    void updateProjectSummary({
      projectId,
      userMessage,
      assistantMessage: fullText,
    });
  }

  return {
    fullText,
    routing: { mode: routing.mode, doctrines: routing.doctrines },
    modelUsed,
  };
}
