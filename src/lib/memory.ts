import { supabaseAdmin } from "./supabase";
import { getOpenAI } from "./clients";
import { UTILITY_MODEL } from "./models";

export type MemoryKind =
  | "decision"
  | "fact"
  | "recommendation"
  | "concern"
  | "preference";

type MemoryItemKind =
  | "decision"
  | "fact"
  | "instruction"
  | "preference"
  | "risk"
  | "question";

type MemoryScope = "thread" | "project" | "shared" | "institution";

export interface RelevantMemory {
  id: string;
  text: string;
  kind: MemoryKind | MemoryItemKind;
  entities: string[];
  importance: number;
  created_at: string;
  scope_type: MemoryScope;
  scope_id: string | null;
  source_conversation_id: string | null;
  source_document_id: string | null;
}

interface ExtractedMemory {
  text: string;
  kind: MemoryKind;
  entities: string[];
  importance: number;
}

export async function extractMemories(
  userMessage: string,
  assistantMessage: string,
  conversationId: string,
): Promise<ExtractedMemory[]> {
  if (assistantMessage.length < 200) return [];

  try {
    const openai = getOpenAI();
    const res = await openai.chat.completions.create({
      model: UTILITY_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You distill durable workspace memory from conversation turns. The result will be reused later across project threads, so only keep durable context.

EXTRACT 0-3 memories per turn. Return JSON: {"memories": [{"text": "...", "kind": "...", "entities": [...], "importance": 0.0-1.0}]}.

KIND must be one of:
- "decision": user made a choice or commitment
- "fact": factual information about the org, projects, documents, people
- "recommendation": advisor recommended a specific action
- "concern": user flagged a risk, blocker, or issue
- "preference": user expressed a working style or format preference

ENTITIES: real-world named entities mentioned (companies, people, projects, documents, places, laws). Use the language they appeared in.

IMPORTANCE 0.0-1.0:
- 1.0: critical decisions, major findings
- 0.7-0.9: substantive recommendations or facts
- 0.4-0.6: useful context
- 0.0-0.3: trivial — do not return these

GOOD MEMORIES:
- "Vice Chairman is reviewing two scenarios from El Sewedy Electric for Safaga industrial zone"
- "GTEZ master plan exists as an 88-page document covering mining, infrastructure, and sector priorities"
- "Recommended renegotiating land price from $1/m² to $3/m² and tying utilities cost to phases"

BAD MEMORIES:
- "User asked about documents"
- "Assistant explained the UI"
- Anything that just paraphrases the turn without future value

If nothing durable was discussed, return {"memories": []}.`,
        },
        {
          role: "user",
          content: `CONVERSATION ID:\n${conversationId}\n\nUSER MESSAGE:\n${userMessage.slice(0, 2000)}\n\nASSISTANT RESPONSE:\n${assistantMessage.slice(0, 4000)}`,
        },
      ],
    });

    const parsed = JSON.parse(res.choices[0].message.content || "{}");
    const memories: ExtractedMemory[] = Array.isArray(parsed.memories)
      ? parsed.memories
      : [];
    return memories
      .filter((m) => m && typeof m.text === "string" && m.text.length > 10)
      .filter((m) => m.importance >= 0.4)
      .slice(0, 3);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      "memory: extractMemories FAILED — this turn's context will NOT be persisted:",
      message,
    );
    return [];
  }
}

export async function storeMemories(
  memories: ExtractedMemory[],
  conversationId: string,
  projectId?: string | null,
): Promise<void> {
  if (memories.length === 0) return;

  const threadRows = memories.map((m) => ({
    scope_type: "thread" as const,
    scope_id: conversationId,
    kind: mapLegacyKindToMemoryItemKind(m.kind),
    text: m.text,
    entities: m.entities || [],
    importance: m.importance,
    source_conversation_id: conversationId,
  }));

  const workspaceRows = memories
    .filter((m) => m.importance >= 0.6)
    .map((m) => ({
      scope_type: (projectId ? "project" : "shared") as MemoryScope,
      scope_id: projectId ?? null,
      kind: mapLegacyKindToMemoryItemKind(m.kind),
      text: m.text,
      entities: m.entities || [],
      importance: m.importance,
      source_conversation_id: conversationId,
    }));

  const { error: memoryItemsError } = await supabaseAdmin
    .from("memory_items")
    .insert([...threadRows, ...workspaceRows]);
  if (memoryItemsError) {
    console.error("Memory store failed (memory_items):", memoryItemsError);
  }
}

export async function retrieveRelevantMemories(
  userMessage: string,
  excludeConversationId?: string | null,
  maxResults = 8,
  projectId?: string | null,
): Promise<RelevantMemory[]> {
  const candidateEntities = extractCandidateEntities(userMessage);

  const { data: scopedRows, error } = await supabaseAdmin
    .from("memory_items")
    .select("*")
    .order("importance", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(120);

  if (error || !scopedRows || scopedRows.length === 0) return [];

  const filtered = (scopedRows as Array<Record<string, unknown>>)
    .filter((row) =>
      isRelevantScope(
        row.scope_type as string,
        row.scope_id as string | null | undefined,
        excludeConversationId ?? null,
        projectId ?? null,
      ),
    )
    .map((row) => ({
      id: row.id as string,
      text: row.text as string,
      kind: row.kind as RelevantMemory["kind"],
      entities: (row.entities as string[] | null) ?? [],
      importance: typeof row.importance === "number" ? row.importance : 0.5,
      created_at: row.created_at as string,
      scope_type: row.scope_type as MemoryScope,
      scope_id: (row.scope_id as string | null | undefined) ?? null,
      source_conversation_id:
        (row.source_conversation_id as string | null | undefined) ?? null,
      source_document_id:
        (row.source_document_id as string | null | undefined) ?? null,
    }));

  return rankMemories(filtered, candidateEntities, excludeConversationId ?? null, projectId ?? null)
    .slice(0, maxResults);
}

export function formatMemoriesForPrompt(memories: RelevantMemory[]): string {
  if (memories.length === 0) return "";

  const scopeOrder: MemoryScope[] = ["project", "thread", "shared", "institution"];
  const scopeLabels: Record<MemoryScope, string> = {
    project: "PROJECT MEMORY",
    thread: "THREAD MEMORY",
    shared: "SHARED WORKSPACE MEMORY",
    institution: "INSTITUTIONAL MEMORY",
  };

  const sections = scopeOrder
    .map((scope) => {
      const scoped = memories.filter((m) => m.scope_type === scope);
      if (scoped.length === 0) return null;
      return `${scopeLabels[scope]}:\n${scoped
        .map((m) => `- [${formatMemoryKindLabel(m.kind)}] ${m.text}`)
        .join("\n")}`;
    })
    .filter((section): section is string => Boolean(section));

  if (sections.length === 0) return "";

  return `═══ DURABLE WORKSPACE MEMORY ═══

These are saved decisions, facts, preferences, and risks from prior work. Use them when relevant, but do not treat them as stronger than direct document evidence in this turn.

${sections.join("\n\n")}

═══ END MEMORY ═══
`;
}

function rankMemories(
  memories: RelevantMemory[],
  candidateEntities: string[],
  excludeConversationId: string | null,
  projectId: string | null,
): RelevantMemory[] {
  const scored = memories.map((memory) => {
    const entityOverlap = candidateEntities.filter((entity) =>
      memory.entities.some(
        (saved) =>
          saved.toLowerCase().includes(entity.toLowerCase()) ||
          entity.toLowerCase().includes(saved.toLowerCase()),
      ),
    ).length;

    let score = entityOverlap * 2 + memory.importance;

    if (
      memory.scope_type === "thread" &&
      memory.scope_id &&
      memory.scope_id === excludeConversationId
    ) {
      score -= 3;
    }

    if (memory.scope_type === "project") {
      if (projectId && memory.scope_id === projectId) score += 3;
      else if (memory.scope_id && projectId && memory.scope_id !== projectId) score -= 4;
    } else if (memory.scope_type === "shared") {
      score += 0.6;
    } else if (memory.scope_type === "institution") {
      score += 0.3;
    }

    return { memory, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((item) => item.memory);
}

function isRelevantScope(
  scopeType: string,
  scopeId: string | null | undefined,
  excludeConversationId: string | null,
  projectId: string | null,
): boolean {
  if (scopeType === "thread") {
    return Boolean(scopeId && scopeId !== excludeConversationId);
  }
  if (scopeType === "project") {
    return Boolean(projectId && scopeId === projectId);
  }
  return scopeType === "shared" || scopeType === "institution";
}

function formatMemoryKindLabel(kind: RelevantMemory["kind"]): string {
  if (kind === "recommendation") return "recommendation";
  if (kind === "concern") return "risk";
  return kind;
}

function mapLegacyKindToMemoryItemKind(kind: MemoryKind): MemoryItemKind {
  switch (kind) {
    case "recommendation":
      return "instruction";
    case "concern":
      return "risk";
    default:
      return kind;
  }
}

function extractCandidateEntities(text: string): string[] {
  const candidates = new Set<string>();

  for (const match of text.matchAll(/["«»“”'']([^"«»“”'']{3,40})["«»“”'']/g)) {
    candidates.add(match[1].trim());
  }

  for (const match of text.matchAll(/\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,4})\b/g)) {
    candidates.add(match[1].trim());
  }

  for (const match of text.matchAll(/([\u0600-\u06FF]{4,}(?:\s+[\u0600-\u06FF]{2,}){0,4})/g)) {
    if (match[1].length >= 6) candidates.add(match[1].trim());
  }

  return Array.from(candidates).slice(0, 20);
}
