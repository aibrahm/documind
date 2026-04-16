// src/lib/entity-extraction-llm.ts
//
// LLM-based named-entity extraction. Replaces the regex / heuristic
// pipeline that used to live in ocr-normalization.ts:452–610 and produced
// the failure modes the user flagged in the entity explorer screenshot:
//
//   1. Prose fragments tagged as entities ("...القيام بأعمال الاستغلال...")
//   2. The same entity split into 3+ rows because of OCR variants (GTEZA)
//   3. Wrong type (Authority and Place on the same org)
//   4. Duplicate Ministry of Finance rows
//   5. Concatenated entities ("Defense AND Engineering Authority")
//   6. Generic descriptions tagged as named entities ("الشركة الإسرائيلية")
//
// Each rule below maps directly to one of those failures.
//
// Cost: gpt-4o-mini structured output, ~$0.002 per typical doc (12k char
// sample). Recorded via withMetric so the monthly-spend dashboard stays
// honest.
//
// Returns: array of canonical-name + alternate-spellings tuples. The
// downstream canonicalizer (entities.ts) is responsible for cross-document
// deduplication via embeddings.

import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { getOpenAI } from "@/lib/clients";
import { costForLlmUsage, withMetric } from "@/lib/metrics";
import { UTILITY_MODEL } from "@/lib/models";

// Hard cap on input text. gpt-4o-mini has 128k context but we don't need
// it; legal docs are repetitive and the first ~12k chars almost always
// contain every named entity worth extracting (parties, ministries,
// laws, places). Going wider just spends more on the same answer.
const MAX_INPUT_CHARS = 12000;

export const ENTITY_TYPES = [
  "ministry",
  "authority",
  "company",
  "person",
  "place",
  "project",
  "law",
] as const;
export type ExtractedEntityType = (typeof ENTITY_TYPES)[number];

const EntitySchema = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      "The single canonical name. Use the most complete official form seen in the text. Arabic for Arabic entities, English for English entities. NEVER concatenate two entities with 'و' (and).",
    ),
  nameEn: z
    .string()
    .nullable()
    .describe(
      "Best-effort English translation/transliteration. Null if the entity is already English or no obvious mapping exists.",
    ),
  type: z
    .enum(ENTITY_TYPES)
    .describe(
      "Primary type. ONE per entity (an authority is not also a place). Use 'law' for statutes/decrees/regulations referenced as named instruments.",
    ),
  aliases: z
    .array(z.string())
    .describe(
      "Alternate surface forms seen in the text — abbreviations, OCR variants, in-context shortenings (e.g. 'الهيئة' when contextually GTEZA). Empty array if only one form was used.",
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "Honest 0–1 score for how clearly this is a real named entity (not a guess). Use 0.5–0.7 for ambiguous cases, 0.9+ only for unambiguous proper nouns. NEVER hardcode 1.",
    ),
  contextSpan: z
    .string()
    .nullable()
    .describe(
      "Short verbatim quote (≤120 chars) showing where in the text the entity was identified. Helps the user verify.",
    ),
});

const ResponseSchema = z.object({
  entities: z.array(EntitySchema),
});

export type ExtractedEntity = z.infer<typeof EntitySchema>;

const SYSTEM_PROMPT = [
  "You extract named entities from Arabic and English legal, governmental, and",
  "commercial documents.",
  "",
  "OUTPUT ONLY named entities — specific proper nouns. STRICT REJECTION RULES:",
  "",
  "1. REJECT sentence fragments and prose. If the candidate is a clause from the",
  "   document text rather than a name, drop it. Examples:",
  '   - REJECT: "...القيام بأعمال الاستغلال لحالات المحاجر والمعادن في دائرة..."',
  '   - REJECT: "to undertake operations and exploitation"',
  '   - KEEP:   "الهيئة العامة للمنطقة الاقتصادية للمثلث الذهبي"',
  "",
  "2. REJECT generic descriptions without a proper noun. Examples:",
  '   - REJECT: "الشركة الإسرائيلية" (just "the Israeli Company" — no name)',
  '   - REJECT: "the Minister" (no specific ministry attached)',
  '   - KEEP:   "Apollo Industries Ltd"',
  '   - KEEP:   "Ministry of Petroleum and Mineral Wealth"',
  "",
  "3. NEVER concatenate two entities. If the source text says",
  '   "وزارة الدفاع والهيئة الهندسية للقوات المسلحة" (Ministry of Defense AND',
  "   the Engineering Authority of the Armed Forces), emit TWO separate",
  "   entities, not one merged row.",
  "",
  "4. ONE PRIMARY TYPE per entity. The same organization is not both an",
  '   "authority" and a "place." Choose the dominant role:',
  '     - "الهيئة العامة للمنطقة الاقتصادية للمثلث الذهبي" → type "authority"',
  "       (it IS an organization, the Golden Triangle is a place mentioned in its name).",
  '     - "محافظة البحر الأحمر" → type "place" (it IS a geographical division).',
  "",
  "5. COLLECT ALIASES on a single row. If the same entity appears under multiple",
  "   surface forms in the document — full Arabic name, English name, an",
  '   abbreviation like "GTEZA", an OCR variant like "للمست الذهبي" instead of',
  '   "للمثلث الذهبي", or in-context shortenings like "الهيئة" — emit ONE entity',
  "   row with the most complete form as `name` and the rest in `aliases`.",
  "",
  "6. CONFIDENCE is honest. Score 0.95+ only for clearly named, unambiguous",
  "   entities. 0.7–0.85 for plausible but not-fully-specified ones. Below 0.7",
  "   means you would rather drop it than commit. NEVER return 1.0 for everything.",
  "",
  "7. TYPES allowed: ministry, authority, company, person, place, project, law.",
  "   - 'law' is for statutes/decrees/regulations referenced as instruments",
  '     (e.g. "Law No. 83 of 2002", "المرسوم بقانون رقم 95 لسنة 2018"). Pull',
  "     from the law name itself, not the chapter or article reference.",
  "   - 'project' is for named initiatives (e.g. \"Suez Canal Economic Zone\",",
  '     "Phase 2 of the Golden Triangle Industrial Park").',
  "",
  "Output ONLY valid JSON matching the schema. No prose explanation.",
].join("\n");

export interface ExtractEntitiesResult {
  entities: ExtractedEntity[];
  modelVersion: string;
  truncated: boolean;
}

/**
 * Extract named entities from a document via gpt-4o-mini structured output.
 *
 * Throws on infrastructure failure (network, parse error). Caller should
 * catch + log + continue without entities — losing entities shouldn't
 * fail the whole document, but the failure must be visible.
 *
 * Telemetry is recorded via `withMetric(stage: "llm_entities", ...)`.
 *
 * @param fullText  Full document text (will be truncated to MAX_INPUT_CHARS).
 * @param language  Document language hint (`ar` | `en` | `mixed`). Helps the
 *                  model preserve the right script in canonical names.
 * @param documentId Optional doc id; passed through to extraction_runs.
 */
export async function extractEntitiesFromDocument({
  fullText,
  language,
  documentId,
}: {
  fullText: string;
  language: string | null;
  documentId: string | null;
}): Promise<ExtractEntitiesResult> {
  const trimmed = fullText.trim();
  if (!trimmed) {
    return { entities: [], modelVersion: UTILITY_MODEL, truncated: false };
  }

  const truncated = trimmed.length > MAX_INPUT_CHARS;
  const sample = truncated ? trimmed.slice(0, MAX_INPUT_CHARS) : trimmed;

  const userPrompt = [
    `Document language: ${language ?? "unknown"}`,
    truncated
      ? `Document text (truncated to first ${MAX_INPUT_CHARS} characters):`
      : "Document text:",
    "",
    sample,
  ].join("\n");

  const result = await withMetric(
    {
      stage: "llm_entities",
      documentId,
      modelVersion: UTILITY_MODEL,
      extractUsage: (r) => {
        const usage = (r as { usage?: unknown }).usage as
          | { prompt_tokens?: number; completion_tokens?: number }
          | undefined;
        return {
          tokensIn: usage?.prompt_tokens ?? 0,
          tokensOut: usage?.completion_tokens ?? 0,
          usdCost: costForLlmUsage(UTILITY_MODEL, usage),
        };
      },
    },
    async () => {
      const completion = await getOpenAI().chat.completions.parse({
        model: UTILITY_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: zodResponseFormat(ResponseSchema, "entity_extraction"),
        temperature: 0.1,
      });

      const parsed = completion.choices[0]?.message?.parsed;
      if (!parsed) {
        throw new Error("entity-extraction LLM returned no parsed result");
      }
      return { parsed, usage: completion.usage };
    },
  );

  // Sanity-clean the model output. The schema enforces shape but not
  // domain rules — strip empty names, clamp confidence, dedupe aliases.
  const cleaned: ExtractedEntity[] = [];
  for (const raw of result.parsed.entities) {
    const name = raw.name.trim();
    if (!name) continue;
    if (name.length > 200) continue; // model occasionally pastes a paragraph
    const aliases = Array.from(
      new Set(
        (raw.aliases || [])
          .map((a) => a.trim())
          .filter((a) => a && a !== name && a.length <= 200),
      ),
    );
    cleaned.push({
      name,
      nameEn: raw.nameEn?.trim() || null,
      type: raw.type,
      aliases,
      confidence: Math.max(0, Math.min(1, raw.confidence)),
      contextSpan: raw.contextSpan?.trim().slice(0, 200) || null,
    });
  }

  return {
    entities: cleaned,
    modelVersion: UTILITY_MODEL,
    truncated,
  };
}

// Re-export the cost helper so callers don't have to import metrics for
// this single use case — keeps the pipeline orchestration tidy.
export { costForLlmUsage };
