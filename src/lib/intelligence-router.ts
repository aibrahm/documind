import { getOpenAI } from "@/lib/clients";
import { ROUTER_MODEL } from "@/lib/models";
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

  // Document-generation intent — deterministic shortcut.
  //
  // When the user asks for a downloadable document (memo, report, deck,
  // letter, brief…), we MUST route to deep mode. That's the only path
  // that runs `runClaudeWithTools`, which is where `create_report` and
  // `create_presentation` live. Going through the LLM router here risks
  // a false negative — GPT classifies the request as "casual" and the
  // drafter says "I don't have that tool", which is exactly the bug the
  // user just hit. Keyword detection is cheap and eliminates the race.
  //
  // Keywords deliberately cover drafting verbs + document nouns in both
  // English and Arabic. We match word boundaries where possible so we
  // don't flip every message that happens to mention "report".
  if (isDocumentGenerationIntent(message)) {
    return {
      mode: "deep",
      shouldSearch: true,
      shouldWebSearch: false,
      // Drafting typically pulls from investment/governance analysis;
      // the tool itself handles the write step, doctrines just shape
      // retrieval. Keep it small so we don't waste scoring cycles.
      doctrines: ["investment", "governance"],
      searchQuery: message,
      reasoning:
        "Document-generation intent detected — forced deep mode so create_report / create_presentation tools are available.",
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
    model: ROUTER_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    max_completion_tokens: 512,
    messages: [
      {
        role: "system",
        content: `You are an intelligence router for a document intelligence system. Given a user message and conversation history, decide how to respond.

Return JSON:
{
  "mode": "casual|search|deep",
  "shouldSearch": true/false,
  "shouldWebSearch": true/false,
  "doctrines": [],  // array of strings from the ENUM below — never free-form text
  "searchQuery": "optimized query",
  "reasoning": "brief explanation"
}

DOCTRINES ENUM — you may ONLY use these exact strings, nothing else:
- "legal"       → legal / regulatory / contract analysis
- "investment"  → financial / NPV / commercial viability
- "governance"  → institutional / stakeholder / oversight
- "negotiation" → deal structuring / term-sheet work

If the message is deep mode, pick 1–3 doctrines from the enum that match the user's intent. Never invent new names like "analysis" or "contract-risk" or "document-grounded" — those are not valid and will be silently dropped.
If the message is casual or search mode, set doctrines to [].

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

  const rawContent = res.choices[0].message.content || "{}";
  try {
    const parsed = JSON.parse(rawContent);
    // Defensive enum filter: the router model has historically hallucinated
    // doctrine names like "analysis" or "document-grounded" that don't exist
    // in the DB. We hard-filter to the valid set here so downstream code
    // never sees invalid names and the routing label never shows them.
    const VALID_DOCTRINES: DoctrineName[] = [
      "legal",
      "investment",
      "governance",
      "negotiation",
    ];
    const doctrines = Array.isArray(parsed.doctrines)
      ? (parsed.doctrines as unknown[])
          .filter((d): d is DoctrineName =>
            VALID_DOCTRINES.includes(d as DoctrineName),
          )
      : [];
    return {
      mode: parsed.mode || "casual",
      shouldSearch: parsed.shouldSearch ?? false,
      shouldWebSearch: parsed.shouldWebSearch ?? false,
      doctrines,
      searchQuery: parsed.searchQuery || message,
      reasoning: parsed.reasoning || "",
    };
  } catch (err) {
    // Fail-loud per CLAUDE.md: log the malformed response with the raw content
    // so we can debug. The fallback to casual mode is annotated in `reasoning`
    // so the UI shows the degraded state instead of pretending the routing
    // worked.
    console.error(
      `intelligence-router: failed to parse JSON response from ${ROUTER_MODEL}:`,
      (err as Error).message,
      "\n  raw content:",
      rawContent.slice(0, 500),
    );
    return {
      mode: "casual",
      shouldSearch: false,
      shouldWebSearch: false,
      doctrines: [],
      searchQuery: message,
      reasoning:
        "⚠️ Routing fell back to casual mode (JSON parse failure). Response may be less accurate than usual.",
    };
  }
}

/**
 * Heuristic: does this message look like a request to GENERATE a
 * downloadable document (as opposed to asking a question about one)?
 *
 * The distinction matters. "what does the memo say about X" is casual
 * retrieval — we should NOT hand it to the drafter. "write me a memo
 * about X" is drafting — we MUST route it to deep mode so the tool is
 * available. The way we tell them apart is the presence of a drafting
 * VERB ("write", "draft", "prepare", "generate", "create", Arabic
 * equivalents) AND a document NOUN ("memo", "report", "deck",
 * "presentation", "brief", Arabic equivalents), OR a document verb
 * phrase like "make me a deck".
 *
 * Kept as a separate function so future fixes (add a new document
 * type, new synonym) land in one obvious place.
 */
function isDocumentGenerationIntent(message: string): boolean {
  const lower = message.toLowerCase();

  // English drafting verbs. `\b` boundary stops false positives like
  // "drafted a response" in a question about a past action — but we
  // accept that trade-off since "draft me a response" still matches.
  const enVerbRe =
    /\b(write|draft|prepare|generate|create|make|build|compose|produce)\b/;
  const enNounRe =
    /\b(memo|report|deck|presentation|brief(?:ing)?|letter|document|paper|board\s+pack|decision\s+memo|term\s+sheet)\b/;

  if (enVerbRe.test(lower) && enNounRe.test(lower)) return true;

  // Shortcut: some English phrasings skip the verb ("a 5-slide deck
  // on…", "I need a memo covering…"). Catch the common ones.
  if (/\b(i\s+need|i\s+want|give\s+me)\b.*\b(memo|report|deck|presentation|brief|letter)\b/.test(lower)) {
    return true;
  }

  // Arabic drafting verbs — cover both imperative ("اكتب لي") and
  // polite request ("ممكن تعملي") forms. Arabic has no case, so a
  // simple substring match is safe for these stems.
  const arVerbs = [
    "اكتب",
    "اكتبلي",
    "اكتب لي",
    "اعمل",
    "اعملي",
    "اعمل لي",
    "حضّر",
    "حضر",
    "جهز",
    "جهّز",
    "صيغ",
    "صِغ",
    "ابعت",
    "أنشئ",
    "انشئ",
    "أعد",
    "اعد لي",
    "ارسم",
    "عايز",
    "أريد",
    "اريد",
    "ممكن تعمل",
    "ممكن تكتب",
  ];
  const arNouns = [
    "مذكرة",
    "مذكره",
    "تقرير",
    "عرض",
    "عرض تقديمي",
    "بريزنتيشن",
    "ورقة",
    "ورقه",
    "خطاب",
    "رسالة",
    "رساله",
    "موجز",
    "ملخص",
    "مستند",
    "وثيقة",
    "ملف ورد",
    "باوربوينت",
    "باور بوينت",
    "بوربوينت",
  ];

  const hasArVerb = arVerbs.some((v) => message.includes(v));
  const hasArNoun = arNouns.some((n) => message.includes(n));
  if (hasArVerb && hasArNoun) return true;

  // Arabic noun alone is a weaker signal but still meaningful when
  // combined with "لي" / "ليا" (for me) — "مذكرة ليا عن…".
  if (hasArNoun && /\s(لي|ليا|لنا)\b/.test(message)) return true;

  return false;
}
