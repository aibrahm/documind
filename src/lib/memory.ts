import { supabaseAdmin } from "./supabase";
import { getOpenAI } from "./clients";

export type MemoryKind = "decision" | "fact" | "recommendation" | "concern" | "preference";

export interface ConversationMemory {
  id: string;
  conversation_id: string | null;
  text: string;
  kind: MemoryKind;
  entities: string[];
  importance: number;
  created_at: string;
}

interface ExtractedMemory {
  text: string;
  kind: MemoryKind;
  entities: string[];
  importance: number;
}

/**
 * Extract durable memories from a single conversation turn (user message +
 * assistant response). Runs in the background after the response is streamed.
 *
 * Memories are NOT just summaries — they're the things the user would want
 * surfaced again in a future unrelated conversation.
 *
 * Examples of good memories:
 * - "User decided to reject the El Sewedy Scenario 2 in favor of negotiating Scenario 1 + 20% partnership"
 * - "GTEZ has 88-page master plan for Golden Triangle (المخطط العام الشامل)"
 * - "User is preparing recommendations for the financial & investment committee"
 *
 * Examples of BAD memories (to avoid):
 * - "User asked about the document" (not actionable)
 * - "Assistant provided a list of documents" (low information value)
 */
export async function extractMemories(
  userMessage: string,
  assistantMessage: string,
  conversationId: string,
): Promise<ExtractedMemory[]> {
  // Skip extraction for trivial exchanges
  if (assistantMessage.length < 200) return [];

  try {
    const openai = getOpenAI();
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You distill durable institutional memory from conversation turns. Your output will be injected into FUTURE conversations as context, so the user can pick up where they left off.

EXTRACT 0-3 memories per turn. Return JSON: {"memories": [{"text": "...", "kind": "...", "entities": [...], "importance": 0.0-1.0}]}.

KIND must be one of:
- "decision": user made a choice or commitment
- "fact": factual information about the org, deals, documents, people
- "recommendation": advisor recommended a specific action
- "concern": user flagged a risk, blocker, or issue
- "preference": user expressed a working style or format preference

ENTITIES: real-world named entities mentioned (companies, people, projects, documents, places, laws). Use the language they appeared in.

IMPORTANCE 0.0-1.0:
- 1.0: critical decisions, major findings
- 0.7-0.9: substantive recommendations or facts
- 0.4-0.6: useful context
- 0.0-0.3: trivial — just don't return these

GOOD MEMORIES (extract):
- "Vice Chairman is reviewing two scenarios from El Sewedy Electric for Safaga industrial zone — Scenario 1 (developer + 20% partnership) and Scenario 2 (developer only)"
- "GTEZ master plan exists as 88-page document covering mining, infrastructure, sectors"
- "Recommended renegotiating land price from $1/m² to $3/m² and tying utilities cost to phases"

BAD (do NOT extract):
- "User asked about documents" (too generic)
- "Assistant explained the difference between attachments and uploads" (system-level, not domain)
- Anything that's just a paraphrase of the message

If nothing durable was discussed, return {"memories": []}.`,
        },
        {
          role: "user",
          content: `USER MESSAGE:\n${userMessage.slice(0, 2000)}\n\nASSISTANT RESPONSE:\n${assistantMessage.slice(0, 4000)}`,
        },
      ],
    });

    const parsed = JSON.parse(res.choices[0].message.content || "{}");
    const memories: ExtractedMemory[] = Array.isArray(parsed.memories) ? parsed.memories : [];
    return memories
      .filter((m) => m && typeof m.text === "string" && m.text.length > 10)
      .filter((m) => m.importance >= 0.4)
      .slice(0, 3);
  } catch (err) {
    console.error("Memory extraction failed:", err);
    return [];
  }
}

/**
 * Persist extracted memories to the conversation_memory table.
 */
export async function storeMemories(
  memories: ExtractedMemory[],
  conversationId: string,
): Promise<void> {
  if (memories.length === 0) return;
  const rows = memories.map((m) => ({
    conversation_id: conversationId,
    text: m.text,
    kind: m.kind,
    entities: m.entities || [],
    importance: m.importance,
  }));
  const { error } = await supabaseAdmin.from("conversation_memory").insert(rows);
  if (error) console.error("Memory store failed:", error);
}

/**
 * Retrieve relevant memories for a new user message. Strategy:
 * 1. Extract candidate entities from the message text (regex on quoted/Arabic
 *    or capitalized terms is enough for the first pass).
 * 2. Match memories whose entities[] overlaps with extracted entities.
 * 3. Always also include the top-N most important recent memories regardless
 *    of entity match — these are the "general standing" of the org.
 * 4. Cap total to keep token budget reasonable.
 */
export async function retrieveRelevantMemories(
  userMessage: string,
  excludeConversationId?: string | null,
  maxResults = 8,
): Promise<ConversationMemory[]> {
  const candidateEntities = extractCandidateEntities(userMessage);

  // Pull a generous superset by entity OR by importance, then dedupe & rank
  let query = supabaseAdmin
    .from("conversation_memory")
    .select("*")
    .order("importance", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50);

  if (excludeConversationId) {
    query = query.neq("conversation_id", excludeConversationId);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  const memories = data as ConversationMemory[];

  // Score each memory: entity overlap is the strongest signal
  const scored = memories.map((m) => {
    const entityOverlap = candidateEntities.filter((e) =>
      m.entities.some((me) => me.toLowerCase().includes(e.toLowerCase()) || e.toLowerCase().includes(me.toLowerCase())),
    ).length;
    const score = entityOverlap * 2 + m.importance;
    return { memory: m, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults).map((s) => s.memory);
}

/**
 * Format memories as a system-prompt section for injection.
 */
export function formatMemoriesForPrompt(memories: ConversationMemory[]): string {
  if (memories.length === 0) return "";
  const grouped: Record<MemoryKind, string[]> = {
    decision: [],
    fact: [],
    recommendation: [],
    concern: [],
    preference: [],
  };
  for (const m of memories) {
    grouped[m.kind].push(m.text);
  }

  const sections: string[] = [];
  if (grouped.decision.length > 0) {
    sections.push("DECISIONS MADE:\n" + grouped.decision.map((t) => `- ${t}`).join("\n"));
  }
  if (grouped.recommendation.length > 0) {
    sections.push("PRIOR RECOMMENDATIONS:\n" + grouped.recommendation.map((t) => `- ${t}`).join("\n"));
  }
  if (grouped.fact.length > 0) {
    sections.push("INSTITUTIONAL CONTEXT:\n" + grouped.fact.map((t) => `- ${t}`).join("\n"));
  }
  if (grouped.concern.length > 0) {
    sections.push("OPEN CONCERNS:\n" + grouped.concern.map((t) => `- ${t}`).join("\n"));
  }
  if (grouped.preference.length > 0) {
    sections.push("USER PREFERENCES:\n" + grouped.preference.map((t) => `- ${t}`).join("\n"));
  }

  return `═══ MEMORY FROM PRIOR CONVERSATIONS ═══

These are durable insights distilled from your previous exchanges with this user. Reference them naturally when relevant — e.g. "كما ناقشنا في المحادثات السابقة..." Do not invent memories not listed here.

${sections.join("\n\n")}

═══ END MEMORY ═══
`;
}

/**
 * Extract candidate entities from a user message via lightweight regex.
 * Catches: quoted strings, Arabic word groups (3+ char runs), capitalized
 * English phrases. Good enough for the first-pass match.
 */
function extractCandidateEntities(text: string): string[] {
  const candidates = new Set<string>();

  // Quoted strings
  for (const m of text.matchAll(/["«»“”'']([^"«»“”'']{3,40})["«»“”'']/g)) {
    candidates.add(m[1].trim());
  }

  // Capitalized English phrases (2+ words)
  for (const m of text.matchAll(/\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,4})\b/g)) {
    candidates.add(m[1].trim());
  }

  // Long Arabic word groups (4+ chars, mainly Arabic letters)
  for (const m of text.matchAll(/([\u0600-\u06FF]{4,}(?:\s+[\u0600-\u06FF]{2,}){0,4})/g)) {
    if (m[1].length >= 6) candidates.add(m[1].trim());
  }

  return Array.from(candidates).slice(0, 20);
}
