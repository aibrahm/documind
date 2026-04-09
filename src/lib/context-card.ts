/**
 * Document context card generator.
 *
 * After extraction + chunking completes, we run one additional LLM pass
 * that reads a sample of the document plus the user's project landscape
 * and produces a structured "context card" — a high-signal document-level
 * summary that gives retrieval something to work with beyond raw chunks.
 *
 * The card is stored on `documents.context_card` (JSONB) and later
 * injected into chat system prompts when the document is in scope.
 *
 * Philosophy: fail loud. If the contextualizer call fails, we log loudly
 * and return null — the document is still usable, but the caller knows
 * the card is missing and can show a degraded-mode indicator.
 */

import { getOpenAI, calculateCost } from "@/lib/clients";
import { createLogger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase";

const log = createLogger("context-card");

import { UTILITY_MODEL } from "./models";
import { sanitizeDateString } from "./date-sanitize";
const CONTEXTUALIZER_MODEL = UTILITY_MODEL;
const MAX_SAMPLE_CHARS = 8000;

export interface DocumentContextCard {
  summary_en: string;
  summary_ar: string | null;
  topics: string[];
  key_parties: string[];
  key_obligations: string[];
  key_dates: string[];
  document_role: string;
  fits_with_projects: string[];
  fit_rationale: string;
  generated_at: string;
  model: string;
}

interface ProjectHint {
  id: string;
  name: string;
  description: string | null;
  context_summary?: string | null;
}

interface GenerateInput {
  title: string;
  documentType: string;
  classification: string;
  language: string;
  fullText: string;
  entities: string[];
  knownProjects: ProjectHint[];
}

/**
 * Pull the list of known projects from the DB so the contextualizer can
 * suggest where the document fits. Cheap query, called once per upload.
 */
export async function loadProjectHints(): Promise<ProjectHint[]> {
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("id, name, description, context_summary")
    .neq("status", "archived")
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) {
    log.warn("failed to load project hints for contextualizer", { error: error.message });
    return [];
  }
  return (data || []) as ProjectHint[];
}

function buildSystemPrompt(): string {
  return [
    "You are a document analyst building a structured context card for a new",
    "document that was just ingested into a bilingual (Arabic/English) legal",
    "and commercial document intelligence workspace.",
    "",
    "Your job is to produce a high-signal summary that describes WHAT the",
    "document is, WHO it involves, what it OBLIGATES, and WHERE it fits in",
    "the user's project landscape.",
    "",
    "Rules:",
    "- Use only facts visible in the document text provided. Do not invent.",
    "- If a field is unknowable, return an empty string or empty array.",
    "- Summaries must be tight and factual. No marketing language.",
    "- Arabic summary is optional — produce one only if the document is",
    "  Arabic or bilingual. Otherwise set summary_ar to null.",
    "- For fits_with_projects: list project UUIDs from the provided list",
    "  where the document plausibly belongs based on parties, subject, or",
    "  scope overlap. Be conservative — only suggest strong matches.",
    "- Topics are short tag-like labels (e.g. \"power_purchase\",",
    "  \"renewable_energy\", \"uae_free_zones\"). 3-8 topics max.",
    "",
    "Output ONLY valid JSON matching the schema. No prose.",
  ].join("\n");
}

function buildUserPrompt(input: GenerateInput): string {
  const sample = input.fullText.slice(0, MAX_SAMPLE_CHARS);
  const truncated = input.fullText.length > MAX_SAMPLE_CHARS;

  const entitiesBlock = input.entities.length
    ? input.entities.slice(0, 20).join(", ")
    : "(none extracted)";

  // We no longer ask the model for fits_with_projects / fit_rationale
  // at extraction time. That field was being baked into the DB as a
  // frozen snapshot — it didn't reflect the CURRENT project list, it
  // reflected whatever the project list looked like the day the doc
  // was uploaded. Any "which project does this belong to?" suggestion
  // is now computed live, not archived.
  return [
    `Document title: ${input.title}`,
    `Document type: ${input.documentType}`,
    `Classification: ${input.classification}`,
    `Language: ${input.language}`,
    `Entities already extracted: ${entitiesBlock}`,
    "",
    `Document text${truncated ? " (truncated to first 8000 chars)" : ""}:`,
    sample,
    "",
    "Produce the context card as JSON with this exact schema:",
    "{",
    '  "summary_en": string,',
    '  "summary_ar": string | null,',
    '  "topics": string[],',
    '  "key_parties": string[],',
    '  "key_obligations": string[],',
    '  "key_dates": string[],',
    '  "document_role": string',
    "}",
  ].join("\n");
}

/**
 * Generate a context card for a freshly extracted document. Returns null
 * on failure — the caller should log and proceed without a card (the
 * document is still usable).
 */
export async function generateContextCard(
  input: GenerateInput,
): Promise<DocumentContextCard | null> {
  const openai = getOpenAI();

  try {
    const res = await openai.chat.completions.create({
      model: CONTEXTUALIZER_MODEL,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(input) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    const raw = res.choices[0]?.message?.content;
    if (!raw) {
      log.error("contextualizer returned empty content", undefined, {
        title: input.title,
      });
      return null;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      log.error("contextualizer returned invalid JSON", err, {
        title: input.title,
        raw: raw.slice(0, 200),
      });
      return null;
    }

    const card: DocumentContextCard = {
      summary_en: toStringSafe(parsed.summary_en),
      summary_ar:
        typeof parsed.summary_ar === "string" && parsed.summary_ar.trim()
          ? parsed.summary_ar
          : null,
      topics: toStringArray(parsed.topics),
      key_parties: toStringArray(parsed.key_parties),
      key_obligations: toStringArray(parsed.key_obligations),
      // Filter OCR garbage dates (year 7025, Hijri years without Hijri
      // context, etc.) before writing to the DB so retrieval and UI
      // never see them. See src/lib/date-sanitize.ts for the rules.
      key_dates: toStringArray(parsed.key_dates)
        .map(sanitizeDateString)
        .filter((d): d is string => d !== null),
      document_role: toStringSafe(parsed.document_role),
      // Project fit is now computed live, not frozen at extraction time.
      // Kept as empty arrays so the DocumentContextCard type still
      // matches existing rows that have stale values; consumers should
      // ignore these fields and ask the live suggestion computer
      // instead.
      fits_with_projects: [],
      fit_rationale: "",
      generated_at: new Date().toISOString(),
      model: CONTEXTUALIZER_MODEL,
    };

    const cost = calculateCost(res.usage, UTILITY_MODEL);
    log.info("context card generated", {
      title: input.title,
      topics: card.topics.length,
      parties: card.key_parties.length,
      fits: card.fits_with_projects.length,
      cost: cost.toFixed(5),
    });

    return card;
  } catch (err) {
    log.error("contextualizer call failed", err, { title: input.title });
    return null;
  }
}

/**
 * Format a context card for injection into a chat system prompt. Kept in
 * this module so prompt shape and generator shape evolve together.
 */
export function formatContextCardForPrompt(
  card: DocumentContextCard,
  title: string,
): string {
  const lines: string[] = [`Document: ${title}`];
  if (card.summary_en) lines.push(`Summary: ${card.summary_en}`);
  if (card.document_role) lines.push(`Role: ${card.document_role}`);
  if (card.key_parties.length) lines.push(`Parties: ${card.key_parties.join(", ")}`);
  if (card.key_obligations.length)
    lines.push(`Obligations: ${card.key_obligations.join("; ")}`);
  if (card.key_dates.length) lines.push(`Dates: ${card.key_dates.join(", ")}`);
  if (card.topics.length) lines.push(`Topics: ${card.topics.join(", ")}`);
  return lines.join("\n");
}

function toStringSafe(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
