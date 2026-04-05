import { getOpenAI } from "@/lib/clients";
import type { DoctrineName } from "./doctrine";

export type ResponseMode = "casual" | "search" | "deep";

export interface RoutingDecision {
  mode: ResponseMode;
  shouldSearch: boolean;
  doctrines: DoctrineName[];
  searchQuery: string;
  reasoning: string;
}

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Intelligence Router — automatically decides how to respond to a message.
 *
 * Considers the message text + conversation history to pick:
 * - casual: simple question, follow-up, translation, summary → fast natural answer
 * - search: user wants to find specific info → hybrid search results
 * - deep: evaluation, risk analysis, comparison, scoring → full doctrine pipeline
 */
export async function routeMessage(
  message: string,
  conversationHistory: Message[] = []
): Promise<RoutingDecision> {
  // Check for explicit command prefixes
  if (message.startsWith("/search ")) {
    return {
      mode: "search",
      shouldSearch: true,
      doctrines: [],
      searchQuery: message.slice(8).trim(),
      reasoning: "User used /search command",
    };
  }
  if (message.startsWith("/analyze ")) {
    return {
      mode: "deep",
      shouldSearch: true,
      doctrines: ["legal", "investment", "governance"],
      searchQuery: message.slice(9).trim(),
      reasoning: "User used /analyze command",
    };
  }

  const openai = getOpenAI();

  // Build conversation context for the router
  const historyContext = conversationHistory.slice(-6).map(m =>
    `${m.role}: ${m.content.slice(0, 200)}`
  ).join("\n");

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an intelligence router for a document intelligence system. Given a user message and conversation history, decide how to respond.

Return JSON:
{
  "mode": "casual|search|deep",
  "shouldSearch": true/false,
  "doctrines": [],
  "searchQuery": "optimized query for document retrieval",
  "reasoning": "brief explanation"
}

MODE RULES:
- "casual": Simple questions, follow-ups, clarifications, translations, greetings, "what is X", "summarize", "explain", general conversation. MOST messages should be casual. Use this unless there's a clear signal for search or deep.
- "search": User explicitly wants to FIND something. "find", "search", "where is", "show me all", "list documents about". The response will be a list of matching document sections.
- "deep": User wants EVALUATION, ANALYSIS, SCORING, COMPARISON, RISK ASSESSMENT. Keywords: "analyze", "evaluate", "assess", "compare", "score", "what are the risks", "حلل", "قيّم", "قارن". This activates doctrine-based structured analysis.

DOCTRINE SELECTION (only for mode=deep):
- "legal": contracts, clauses, enforceability, disputes, legal compliance
- "investment": deals, ROI, value capture, financial assessment
- "negotiation": leverage, BATNA, power dynamics, demands
- "governance": execution risk, oversight, monitoring, institutional control

shouldSearch: true if the answer likely needs information from uploaded documents. false for greetings, general knowledge, meta-questions about the system.

searchQuery: if shouldSearch=true, rewrite the user's message into an effective search query. For follow-ups, incorporate relevant context from history. For Arabic queries, keep them in Arabic.

IMPORTANT: Default to "casual". Only escalate to "deep" when the user clearly wants analysis/evaluation. A question like "what does this contract say about penalties?" is casual (retrieve and answer). A question like "evaluate the penalty clauses and assess enforcement risks" is deep.`,
      },
      {
        role: "user",
        content: `Conversation history:\n${historyContext || "(new conversation)"}\n\nLatest message: ${message}`,
      },
    ],
  });

  try {
    const parsed = JSON.parse(res.choices[0].message.content || "{}");
    return {
      mode: parsed.mode || "casual",
      shouldSearch: parsed.shouldSearch ?? true,
      doctrines: (parsed.doctrines || []) as DoctrineName[],
      searchQuery: parsed.searchQuery || message,
      reasoning: parsed.reasoning || "",
    };
  } catch {
    // Fallback: casual with search
    return {
      mode: "casual",
      shouldSearch: true,
      doctrines: [],
      searchQuery: message,
      reasoning: "Routing failed, defaulting to casual",
    };
  }
}
