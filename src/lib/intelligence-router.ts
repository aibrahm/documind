import { getOpenAI } from "@/lib/clients";
import type { DoctrineName } from "./doctrine";

export type ResponseMode = "casual" | "search" | "deep";

export interface RoutingDecision {
  mode: ResponseMode;
  shouldSearch: boolean;
  shouldWebSearch: boolean;
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
      shouldWebSearch: false,
      doctrines: [],
      searchQuery: message.slice(8).trim(),
      reasoning: "User used /search command",
    };
  }
  if (message.startsWith("/analyze ")) {
    return {
      mode: "deep",
      shouldSearch: true,
      shouldWebSearch: false,
      doctrines: ["legal", "investment", "governance"],
      searchQuery: message.slice(9).trim(),
      reasoning: "User used /analyze command",
    };
  }
  if (message.startsWith("/web ")) {
    return {
      mode: "casual",
      shouldSearch: false,
      shouldWebSearch: true,
      doctrines: [],
      searchQuery: message.slice(5).trim(),
      reasoning: "User used /web command",
    };
  }

  const openai = getOpenAI();

  // Build conversation context for the router. Include last 8 messages with
  // generous content slice so the router can detect topic continuity for
  // follow-up queries like "try again" or "this is old".
  const historyContext = conversationHistory.slice(-8).map(m =>
    `${m.role}: ${m.content.slice(0, 400)}`
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
  "shouldWebSearch": true/false,
  "doctrines": [],
  "searchQuery": "optimized query",
  "reasoning": "brief explanation"
}

MODE RULES:
- "casual": Simple questions, follow-ups, clarifications, translations, greetings, general conversation, LISTING DOCUMENTS, SUMMARIZING. DEFAULT mode. Use this whenever in doubt.
- "search": ONLY when the user explicitly invokes search ("/search ...") or uses verbs like "find me the exact clause", "locate the section". Pure retrieval intent. Never for summaries, lists, or natural questions.
- "deep": User wants EVALUATION, ANALYSIS, SCORING. "analyze", "evaluate", "assess", "compare risks". Activates doctrine scoring.

DEFAULT TO CASUAL. Search is rare. Deep requires explicit analysis intent.

shouldSearch: true ONLY if the answer needs content from the user's uploaded institutional documents. false for: greetings, meta-questions, general knowledge, web lookups, off-topic questions.

shouldWebSearch: true if the user wants information from THE INTERNET — news, external facts, verification, company info, market data. Keywords: "search online", "latest news", "look up", "verify online", "what's happening", "search the web", "ابحث في الانترنت". This is SEPARATE from document search.

searchQuery: optimized query for whichever search type is active.

CONTEXT-AWARE QUERY GENERATION (CRITICAL):
The user's latest message may be a FOLLOW-UP that doesn't repeat the topic literally.
Examples:
- Prior turn: "what is the price of gold today" → assistant gave answer
- Current message: "this is old data" / "try again" / "retry" / "search again" / "the price as of today"
  → searchQuery MUST be reconstructed from the prior topic. e.g. "current gold price spot per ounce 2026"
  → NOT "this is old data" (literal text — useless as a search query)

When the latest message is a continuation or refinement, ALWAYS rebuild the searchQuery from the conversation topic, not from the literal latest message text.

Other examples:
- Prior: "tell me about Elsewedy", Current: "and their financials?" → searchQuery: "Elsewedy Electric financials revenue 2025"
- Prior: "what does the master plan say about mining", Current: "what about the timeline?" → searchQuery: "master plan mining sector timeline phases"
- Prior: "summarize the contract", Current: "what about the penalties?" → searchQuery: "contract penalties termination clauses" + topic from prior

IMPORTANT DISTINCTIONS:
- "what documents do I have?" → shouldSearch:false, mode:casual (inventory is in system prompt, no search needed)
- "list all my documents" → shouldSearch:false, mode:casual
- "give me a summary of the latest documents" → shouldSearch:false, mode:casual (uses inventory)
- "tell me about document #6" → shouldSearch:true, mode:casual (need content, search will retrieve it)
- "search latest world news" → shouldSearch:false, shouldWebSearch:true (this is about the internet, not documents)
- "find clause 14 of the law" → shouldSearch:true, mode:casual
- "verify this company online" → shouldSearch:false, shouldWebSearch:true
- "what does the contract say about penalties?" → shouldSearch:true, shouldWebSearch:false, mode:casual
- "analyze the investment risks" → shouldSearch:true, shouldWebSearch:false, mode:deep

If the query has NOTHING to do with documents or web search (like "tell me a joke"), set both to false and mode to casual.`,
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
      shouldSearch: parsed.shouldSearch ?? false,
      shouldWebSearch: parsed.shouldWebSearch ?? false,
      doctrines: (parsed.doctrines || []) as DoctrineName[],
      searchQuery: parsed.searchQuery || message,
      reasoning: parsed.reasoning || "",
    };
  } catch {
    return {
      mode: "casual",
      shouldSearch: false,
      shouldWebSearch: false,
      doctrines: [],
      searchQuery: message,
      reasoning: "Routing failed, defaulting to casual",
    };
  }
}
