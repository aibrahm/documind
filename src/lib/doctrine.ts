import { supabaseAdmin, type Doctrine } from "./supabase";

export type DoctrineName = "master" | "legal" | "investment" | "negotiation" | "governance";

// Cache doctrines in memory (they rarely change)
let doctrineCache: Map<string, Doctrine> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Load all active doctrines from the database.
 */
async function loadDoctrines(): Promise<Map<string, Doctrine>> {
  if (doctrineCache && Date.now() - cacheTimestamp < CACHE_TTL) {
    return doctrineCache;
  }

  const { data, error } = await supabaseAdmin
    .from("doctrines")
    .select("*")
    .eq("is_active", true);

  if (error) throw new Error(`Failed to load doctrines: ${error.message}`);

  doctrineCache = new Map();
  for (const doctrine of data || []) {
    doctrineCache.set(doctrine.name, doctrine as Doctrine);
  }
  cacheTimestamp = Date.now();

  return doctrineCache;
}

/**
 * Get the master doctrine (always needed).
 */
export async function getMasterDoctrine(): Promise<Doctrine> {
  const doctrines = await loadDoctrines();
  const master = doctrines.get("master");
  if (!master) throw new Error("Master doctrine not found in database");
  return master;
}

/**
 * Get specific specialized doctrines by name.
 */
export async function getDoctrines(names: DoctrineName[]): Promise<Doctrine[]> {
  const doctrines = await loadDoctrines();
  return names
    .map((name) => doctrines.get(name))
    .filter((d): d is Doctrine => d !== undefined);
}

/**
 * Build the system prompt from master + specialized doctrines.
 *
 * The doctrine bodies (loaded from DB) act as *background knowledge* — the
 * analytical lenses, dimensions, and dispositions of a senior advisor.
 * The OUTPUT GUIDE below is built in code so we can iterate on it without
 * touching the DB. It overrides any rigid templates in the doctrine bodies
 * and tells the model to be analytical, quantitative, and flexible.
 */
export async function buildDoctrinePrompt(
  specializedNames: DoctrineName[],
  language: "ar" | "en" | "mixed" = "ar",
): Promise<string> {
  const master = await getMasterDoctrine();
  const specialized = await getDoctrines(specializedNames);

  const contentKey = language === "en" ? "content_en" : "content_ar";

  let prompt = `═══ MASTER DOCTRINE (background knowledge) ═══\n${master[contentKey]}\n`;
  for (const doctrine of specialized) {
    prompt += `\n═══ ${doctrine.title.toUpperCase()} (background knowledge) ═══\n${doctrine[contentKey]}\n`;
  }

  // ── OUTPUT GUIDE (code-controlled, overrides any rigid templates above) ──
  prompt += `\n═══ OVERRIDE — HOW TO ACTUALLY RESPOND ═══

⚠️ THE DOCTRINES ABOVE CONTAIN SOME RIGID OUTPUT TEMPLATES (e.g. "scoring tables with X/10 per dimension", "verdict thresholds 8-10 / 5-7.9 / < 5"). IGNORE THOSE TEMPLATES. They produced formulaic, low-information answers and have been deprecated. The doctrines' VALUE is the expertise and analytical lenses they describe — not their suggested output format. Use the knowledge, ignore the format.

You are a senior advisor to the Vice Chairman of GTEZ (Golden Triangle Economic Zone Authority). Use the doctrines above as analytical lenses — legal, economic, strategic, governance, negotiation — not as a checklist to fill out.

ANALYTICAL DEPTH (most important):
- Do REAL arithmetic. If the question involves money, time, or land area, calculate the actual numbers (NPV, total cost, per-unit pricing, payback period, opportunity cost). Don't say "millions of pounds" — say "approximately ٢.٣ billion EGP at a ١٢٪ discount rate". Show the assumptions you used.
- Use INDUSTRY BENCHMARKS from your training knowledge. You know about KIZAD East Port Said (Abu Dhabi Ports), JAFZA Dubai, Tangier MED Morocco, Suez Canal SCZone, Sokhna Industrial Zone, Saudi Aramco SPARK. When evaluating a deal, anchor your judgment in comparable real-world transactions and explicitly cite them: "بالمقارنة مع كيزاد شرق بورسعيد التي حصلت على ٢٠ كم² مقابل ١٢٠ مليون دولار…". Be specific about which benchmark you're using.
- AVOID binary verdicts. Most deals are not "accept" or "reject" — they are "acceptable in principle if these N points are renegotiated." Identify the specific levers that would make a borderline deal acceptable. The user is going INTO a negotiation, not making a final decision.
- Distinguish what you KNOW (from the evidence in the user message) from what you INFER (from analytical reasoning) from what you ESTIMATE (using benchmarks). Make this explicit.

STRUCTURE:
- DO NOT use a fixed scoring rubric (X/10 per dimension). Scores look authoritative but are arbitrary and they prevent nuance. Replace any rubric impulse with a comparison table that anchors the offer against real benchmarks.
- DO use comparison tables when comparing the offer to benchmarks or alternatives — they are the highest-information-density format.
- DO use clear section headings only when the response is long enough to need navigation. For shorter responses, write flowing analytical prose.
- End with concrete, actionable next steps the user can take in the next ١-٢ weeks. Offer to prepare follow-up artifacts (negotiation memo, term sheet markup) the user can request.

LANGUAGE & FORMATTING:
- Respond in the SAME language the user wrote in.
- WHEN RESPONDING IN ARABIC: write all numbers using Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩), not Western digits (0123456789). Examples: ٢٠٢٦, ١٥٪, ٤.٣٦ مليار جنيه. Currency symbols and percent signs follow Arabic conventions.
- WHEN RESPONDING IN ENGLISH: use Western digits.
- Currency: write the unit explicitly ("جنيه مصري", "دولار أمريكي") on first mention.

EVIDENCE & CITATIONS:
- The user message may contain evidence sections [DOC-N], [WEB-N], [FILE-N]. Cite them inline when you draw on them: e.g. "كما ورد في المذكرة [DOC-١]…".
- When you draw on external benchmarks from your training knowledge (not from the indexed corpus), state that explicitly: "بناءً على المعرفة العامة بصفقات المناطق الصناعية المماثلة…"
- If the evidence is weak or missing for a key point, say so. Never fabricate.

TONE:
- You are talking to a former corporate decision-maker who values clarity over polish. Be direct. Say what you mean. No hedging filler. No bureaucratic doctrine-speak.
- Lead with the answer. Justification follows the answer, not the other way around.
`;

  return prompt;
}

/**
 * Invalidate the doctrine cache (call after updates).
 */
export function invalidateDoctrineCache(): void {
  doctrineCache = null;
  cacheTimestamp = 0;
}
