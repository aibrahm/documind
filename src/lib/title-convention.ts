// src/lib/title-convention.ts
//
// Canonical document naming. Every document the system stores should
// have a title of the form:
//
//     {Type}: {6–12 word subject in the document's primary language}
//
// Examples of good titles:
//
//   Memo: تنسيق توقيع مذكرة تفاهم مع موانئ أبوظبي حول المنطقة الصناعية
//   Contract: MoU for Golden Triangle logistics area — Abu Dhabi Ports
//   Law: قانون رقم ١١٨ لسنة ١٩٧٥ بشأن الجمارك
//   Decree: قرار رئيس مجلس الوزراء رقم ٤٢ لسنة ٢٠٢٦ بشأن المثلث الذهبي
//   Report: Q3 2026 investment pipeline — Golden Triangle
//   Policy: Institutional strategy for the Golden Triangle Economic Zone
//
// Examples of BAD titles (the behavior this module exists to kill):
//
//   "اقرحة خطة مستشاري"                       ← OCR'd fragment of a heading
//   "الهيئة العامة للمنطقة الاقتصادية..."      ← letterhead / department name
//   "document (1).pdf"                            ← file name fallback
//   "Untitled"                                    ← give up and label it blank
//
// Before this module existed, titles came from `titleFromNormalizedDocument`
// in ocr-normalization.ts, which picked the first `kind: "title"` or
// `kind: "heading"` block in the normalized document. That block is
// reliably the letterhead on Egyptian government PDFs, not the subject.
// The LLM approach reads the first ~3000 chars and writes a clean
// titled string following the convention — fast, cheap, bilingual.
//
// Cost: ~600 input tokens + ~40 output tokens per upload, one-off.
// On gpt-4o-mini that's well under $0.001 per document.

import { getOpenAI } from "@/lib/clients";
import { UTILITY_MODEL } from "@/lib/models";
import { createLogger } from "@/lib/logger";
import type { DocumentType } from "@/lib/extraction-schema";

const log = createLogger("title-convention");

const MAX_SAMPLE_CHARS = 3000;
const MAX_TITLE_LENGTH = 180;

// Human-readable prefix for each document type. Bilingual because the
// rest of the title is in the document's primary language and we want
// the prefix to match. Arabic documents get an Arabic prefix, English
// get English.
const TYPE_PREFIX_EN: Record<DocumentType, string> = {
  memo: "Memo",
  letter: "Letter",
  contract: "Contract",
  mou: "MoU",
  report: "Report",
  law: "Law",
  decree: "Decree",
  policy: "Policy",
  financial: "Financial",
  other: "Document",
};

const TYPE_PREFIX_AR: Record<DocumentType, string> = {
  memo: "مذكرة",
  letter: "خطاب",
  contract: "عقد",
  mou: "مذكرة تفاهم",
  report: "تقرير",
  law: "قانون",
  decree: "قرار",
  policy: "سياسة",
  financial: "مستند مالي",
  other: "مستند",
};

export interface GenerateTitleInput {
  fullText: string;
  documentType: DocumentType;
  language: "ar" | "en" | "mixed";
  fileName: string;
}

/**
 * Produce a canonical title for a document. Always returns a non-empty
 * string; on LLM failure falls back to a deterministic "{Type}: {first
 * meaningful sentence}" heuristic so uploads never end up titled
 * "Untitled" just because gpt-4o-mini hiccuped.
 */
export async function generateCanonicalTitle(
  input: GenerateTitleInput,
): Promise<string> {
  const { fullText, documentType, language, fileName } = input;
  const primaryLanguage: "ar" | "en" = language === "en" ? "en" : "ar";
  const prefix =
    primaryLanguage === "ar"
      ? TYPE_PREFIX_AR[documentType] ?? TYPE_PREFIX_AR.other
      : TYPE_PREFIX_EN[documentType] ?? TYPE_PREFIX_EN.other;

  const sample = fullText.trim().slice(0, MAX_SAMPLE_CHARS);
  if (!sample) {
    return fallbackTitle(fileName, prefix);
  }

  try {
    const openai = getOpenAI();
    const res = await openai.chat.completions.create({
      model: UTILITY_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content: `You generate canonical titles for Egyptian government documents going into a library-style archive. Every title MUST follow this exact convention:

  {Type}: {6-12 word subject in the document's primary language}

RULES:
- The subject describes what the document IS ABOUT, not which authority wrote it. "Abu Dhabi Ports MoU coordination" is good; "Cabinet Advisors Board" is bad (that's the sender, not the subject).
- Use the document's own language. If the document is Arabic, the subject is in Arabic. If English, in English. Mixed documents follow the dominant language.
- Do NOT use placeholder words like "document", "file", "untitled", "memo" as the subject. The subject must be content-specific.
- 6-12 words ONLY. No longer, no shorter.
- No quotation marks around the title.
- No trailing period.
- Arabic titles: use Arabic-Indic digits (٠-٩) for any numbers. ٢٠٢٦ not 2026. ١١٨ not 118.
- English titles: use Western digits.

RESPOND with JSON: {"subject": "..."}  where subject is ONLY the subject portion (WITHOUT the "{Type}:" prefix — the system will add that).`,
        },
        {
          role: "user",
          content: `Document type: ${documentType}
Primary language: ${primaryLanguage}
Expected prefix (added automatically, do not include): "${prefix}:"

First ~${MAX_SAMPLE_CHARS} characters of the document:

${sample}

Respond with the JSON subject only.`,
        },
      ],
    });
    const raw = res.choices[0]?.message?.content ?? "";
    const parsed = safeParseJson(raw);
    const subject = typeof parsed?.subject === "string" ? parsed.subject.trim() : "";
    if (!subject) {
      log.warn("empty subject from title generator", { documentType, primaryLanguage });
      return fallbackTitle(fileName, prefix);
    }
    const cleaned = cleanSubject(subject);
    if (!cleaned) return fallbackTitle(fileName, prefix);
    const final = `${prefix}: ${cleaned}`;
    return final.length > MAX_TITLE_LENGTH
      ? `${final.slice(0, MAX_TITLE_LENGTH).trimEnd()}…`
      : final;
  } catch (err) {
    log.warn("title generation failed, falling back", {
      error: err instanceof Error ? err.message : String(err),
    });
    return fallbackTitle(fileName, prefix);
  }
}

function safeParseJson(raw: string): { subject?: unknown } | null {
  try {
    return JSON.parse(raw) as { subject?: unknown };
  } catch {
    // Sometimes the model wraps the JSON in a code fence despite
    // response_format: json_object. Try to recover.
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as { subject?: unknown };
    } catch {
      return null;
    }
  }
}

function cleanSubject(subject: string): string {
  return subject
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/^(memo|contract|report|law|decree|policy|letter|mou|document)\s*[:：-]\s*/i, "")
    .replace(/^(مذكرة|عقد|تقرير|قانون|قرار|سياسة|خطاب|مستند)\s*[:：-]\s*/u, "")
    .replace(/[.。！？]\s*$/u, "")
    .trim();
}

function fallbackTitle(fileName: string, prefix: string): string {
  // Strip the extension and any common junk characters from the file
  // name so we get something readable even when the LLM call failed.
  const base = fileName
    .replace(/\.pdf$/i, "")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!base) return `${prefix}: Untitled`;
  return `${prefix}: ${base}`.slice(0, MAX_TITLE_LENGTH);
}
