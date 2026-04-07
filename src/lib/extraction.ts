import { getOpenAI } from "@/lib/clients";
import { detectReferences } from "./references";
import { pdf as pdfToImg } from "pdf-to-img";

// ============================================================
// STANDARDIZED OUTPUT TYPES
// ============================================================

export type DocumentType = "law" | "contract" | "mou" | "report" | "memo" | "policy" | "decree" | "letter" | "financial" | "other";
export type SectionType = "preamble" | "article" | "clause" | "sub_clause" | "definition" | "obligation" | "right" | "penalty" | "termination" | "duration" | "parties" | "signature" | "introduction" | "findings" | "recommendation" | "conclusion" | "table" | "footnote" | "header" | "body" | "appendix";

export interface ExtractedTable {
  caption?: string;
  headers?: string[];
  rows: string[][];
}

export interface ExtractedSection {
  clauseNumber: string | null;
  title: string | null;
  content: string;
  type: SectionType;
  subItems: string[];
  confidence: number; // 0.0 - 1.0, set by correction layer
  table?: ExtractedTable; // populated when type === "table"
}

export interface ExtractedPage {
  pageNumber: number;
  header: string | null;
  footer: string | null;
  sections: ExtractedSection[];
  language: "ar" | "en" | "mixed";
  pageType: "cover" | "toc" | "body" | "appendix" | "signature" | "blank";
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  corrections: string[];
}

export interface ValidationIssue {
  type: "missing_clause_number" | "unordered_items" | "incomplete_reference" | "empty_content" | "duplicate_clause" | "orphaned_sub_item";
  message: string;
  sectionIndex: number;
  severity: "error" | "warning";
}

export interface DocumentClassification {
  documentType: DocumentType;
  title: string;
  language: "ar" | "en" | "mixed";
  confidence: number;
}

export interface ExtractionResult {
  classification: DocumentClassification;
  pages: ExtractedPage[];
  referencedLaws: string[];
  validation: ValidationResult;
  metadata: {
    parties?: string[];
    dates?: string[];
    duration?: string;
    obligations?: string[];
    penalties?: string[];
    sector?: string;
    entities?: Array<{ name: string; type: string; nameEn?: string }>;
    references?: Array<{ text: string; type: string }>;
  };
  costs: {
    classification: number;
    extraction: number;
    correction: number;
    total: number;
  };
  /**
   * Per-page extraction failures discovered during the pipeline. Empty when
   * all pages succeeded. Populated when an LLM call returned malformed JSON,
   * hit the token cap, or otherwise produced unusable output. The upload
   * route surfaces this on the document row so the user knows the doc is
   * partially extracted instead of silently shipping empty pages.
   */
  warnings: {
    failedPages: number[];
    classificationFailed: boolean;
    metadataFailed: boolean;
    correctionBatchesFailed: number;
    /**
     * For LAW documents only: high-stakes verifier mismatches. Each entry is
     * a human-readable message naming the page + the missing article label,
     * percentage, or law reference. Empty for non-law docs or when the
     * verifier and the extraction agreed.
     */
    verifierMismatches: string[];
  };
}

// ============================================================
// MAIN PIPELINE: Classify → Extract → Correct → Validate
// ============================================================

export async function extractDocument(
  fileBuffer: Buffer,
  fileName: string
): Promise<ExtractionResult> {
  const costs = { classification: 0, extraction: 0, correction: 0, total: 0 };

  // Convert PDF pages to PNG images using pdf-to-img.
  // scale: 3 (was 2) gives ~2.25× more pixels per character. For dense
  // Arabic legal text this is the single highest-impact image change —
  // GPT-4o vision is resolution-bound on small Arabic letterforms more
  // than it is contrast- or skew-bound. Bumping scale costs ~30% more
  // upload time per page but materially reduces character-confusion
  // failures (ب/ت/ث/ن/ي, ص/ض, ع/غ) on scanned PDFs.
  const pageImages: string[] = [];
  for await (const page of await pdfToImg(fileBuffer, { scale: 3 })) {
    pageImages.push(Buffer.from(page).toString("base64"));
  }

  if (pageImages.length === 0) {
    throw new Error("Failed to convert PDF to images — no pages found");
  }

  // Step 1: Classify using first page image
  const classification = await classifyDocument(pageImages[0]);
  costs.classification = classification.cost;

  // Step 2: Extract all pages with type-specific prompt (batched for parallelism)
  const rawPages: ExtractedPage[] = [];
  const failedPages: number[] = [];
  const BATCH_SIZE = 5;
  for (let i = 0; i < pageImages.length; i += BATCH_SIZE) {
    const batch = pageImages.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((img, j) =>
        extractPage(img, i + j + 1, classification.result.documentType)
      )
    );
    for (let k = 0; k < batchResults.length; k++) {
      const { page, cost, failed } = batchResults[k];
      rawPages.push(page);
      costs.extraction += cost;
      if (failed) failedPages.push(i + k + 1);
    }
  }

  // Fail loud: if EVERY page failed, the document is unusable. Throw so the
  // upload route sets status='error' with a clear message instead of saving
  // a "ready" doc with zero content.
  if (failedPages.length === pageImages.length) {
    throw new Error(
      `Extraction failed on ALL ${pageImages.length} pages. ` +
        `Likely causes: model rate limit, content-policy block, or persistent token-budget overflow. ` +
        `See server logs for per-page errors.`,
    );
  }

  // Step 2.5: Law verifier (Pass 2) — for law documents, re-read each page
  // asking ONLY for high-stakes fields (article labels, percentages, law
  // references, years) and cross-check against the extracted content.
  // This catches the failure mode where the model "smoothed" the text and
  // dropped or substituted critical legal values. Verifier mismatches are
  // surfaced as warnings on the document row, not as a hard failure.
  const verifierMismatches: string[] = [];
  if (classification.result.documentType === "law") {
    const verifierResults = await Promise.all(
      pageImages.map((img, i) => verifyLawPage(img, i + 1)),
    );
    for (let i = 0; i < verifierResults.length; i++) {
      const v = verifierResults[i];
      costs.extraction += v.cost;
      if (v.failed || rawPages[i] === undefined) continue;
      const mismatches = diffVerifierAgainstPage(v, rawPages[i]);
      verifierMismatches.push(...mismatches);
    }
    if (verifierMismatches.length > 0) {
      console.error(
        `extractDocument: law verifier found ${verifierMismatches.length} mismatch(es) across ${pageImages.length} pages. ` +
          `These indicate the extraction may have substituted or omitted high-stakes legal values. ` +
          `Sample: ${verifierMismatches.slice(0, 3).join(" | ")}`,
      );
    }
  }

  // Step 3: Correct Arabic text (batch all pages in one call)
  const {
    pages: correctedPages,
    corrections,
    cost: correctionCost,
    failedBatches: correctionBatchesFailed,
  } = await correctText(rawPages);
  costs.correction = correctionCost;

  // Step 4: Rule-based validation (deterministic, no LLM)
  const validation = validateExtraction(correctedPages, classification.result.documentType);
  validation.corrections = corrections;

  // Step 5: Extract metadata
  const allText = correctedPages.flatMap(p => p.sections.map(s => s.content)).join("\n\n");
  const {
    metadata,
    referencedLaws,
    cost: metaCost,
    failed: metadataFailed,
  } = await extractMetadata(allText, fileName, classification.result.documentType);
  costs.extraction += metaCost;

  costs.total = costs.classification + costs.extraction + costs.correction;

  return {
    classification: classification.result,
    pages: correctedPages,
    referencedLaws,
    validation,
    metadata,
    costs,
    warnings: {
      failedPages,
      classificationFailed: classification.failed,
      metadataFailed,
      correctionBatchesFailed,
      verifierMismatches,
    },
  };
}

// ============================================================
// NUMERAL & DATE NORMALIZATION
// ============================================================

const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const EXT_ARABIC_INDIC_DIGITS = "۰۱۲۳۴۵۶۷۸۹"; // Persian/Urdu variant

/**
 * Convert Arabic-Indic and Extended Arabic-Indic digits to Western digits.
 * Critical for date accuracy: vision OCR often misreads ٢٠٢٦ as 2023, but
 * if we ask the model to output Arabic-Indic verbatim and convert in code,
 * accuracy improves dramatically.
 */
export function normalizeDigits(text: string): string {
  let out = text;
  for (let i = 0; i < 10; i++) {
    out = out.replaceAll(ARABIC_INDIC_DIGITS[i], String(i));
    out = out.replaceAll(EXT_ARABIC_INDIC_DIGITS[i], String(i));
  }
  return out;
}

/**
 * Recursively normalize digits in all text fields of an extracted page.
 * Applied AFTER extraction so the LLM never has to translate digits itself.
 */
function normalizePageDigits(page: ExtractedPage): ExtractedPage {
  return {
    ...page,
    header: page.header ? normalizeDigits(page.header) : null,
    footer: page.footer ? normalizeDigits(page.footer) : null,
    sections: page.sections.map((s) => ({
      ...s,
      clauseNumber: s.clauseNumber ? normalizeDigits(s.clauseNumber) : null,
      title: s.title ? normalizeDigits(s.title) : null,
      content: normalizeDigits(s.content),
      subItems: s.subItems.map((si) => normalizeDigits(si)),
      table: s.table
        ? {
            ...s.table,
            caption: s.table.caption ? normalizeDigits(s.table.caption) : undefined,
            headers: s.table.headers?.map((h) => normalizeDigits(h)),
            rows: s.table.rows.map((row) => row.map((cell) => normalizeDigits(cell))),
          }
        : undefined,
    })),
  };
}

// ============================================================
// TABLE PARSING
// ============================================================

/**
 * If a section's content is JSON describing a table, parse it into structured
 * form and replace content with a human-readable markdown table for embeddings.
 */
function parseTableSection(section: ExtractedSection): ExtractedSection {
  if (section.type !== "table") return section;
  const raw = section.content.trim();
  if (!raw.startsWith("{")) return section;

  try {
    const parsed = JSON.parse(raw) as {
      caption?: string;
      columns?: string[];
      headers?: string[];
      rows?: unknown[][];
    };
    const headers = parsed.headers || parsed.columns || [];
    const rows = (parsed.rows || []).map((row) => row.map((cell) => String(cell ?? "")));
    if (rows.length === 0) return section;

    const table: ExtractedTable = {
      caption: parsed.caption,
      headers: headers.length > 0 ? headers : undefined,
      rows,
    };

    // Convert to markdown for embeddings + display
    const lines: string[] = [];
    if (parsed.caption) lines.push(`**${parsed.caption}**`);
    if (headers.length > 0) {
      lines.push(`| ${headers.join(" | ")} |`);
      lines.push(`| ${headers.map(() => "---").join(" | ")} |`);
    }
    for (const row of rows) {
      lines.push(`| ${row.join(" | ")} |`);
    }

    return { ...section, content: lines.join("\n"), table };
  } catch {
    return section; // Keep as-is if parse fails
  }
}

// ============================================================
// PDF PAGE COUNT (lightweight, no native deps)
// ============================================================

/**
 * Extract page count from raw PDF bytes by finding /Type /Pages dictionary
 * with /Count N. This avoids needing pdf-parse or pdfjs-dist which pull in
 * native canvas bindings that crash Turbopack dev server.
 */
function getPdfPageCount(buffer: Buffer): number {
  const text = buffer.toString("latin1");
  // Match the root Pages object: /Type /Pages ... /Count <number>
  // There can be multiple /Type /Pages (nested page trees), but the root one
  // has the total count. We look for all and take the largest.
  const countMatches = text.matchAll(/\/Type\s*\/Pages\b[^]*?\/Count\s+(\d+)/g);
  let maxCount = 0;
  for (const m of countMatches) {
    const count = parseInt(m[1], 10);
    if (count > maxCount) maxCount = count;
  }
  // Fallback: if regex failed, assume 1 page
  return maxCount || 1;
}

// ============================================================
// STEP 1: CLASSIFY
// ============================================================

async function classifyDocument(pageImageBase64: string): Promise<{ result: DocumentClassification; cost: number; failed: boolean }> {
  const openai = getOpenAI();
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Classify this document from its first page. Output JSON:
{"documentType": "law|contract|mou|report|memo|policy|decree|letter|financial|other", "title": "document title in original language", "language": "ar|en|mixed", "confidence": 0.0-1.0}`,
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Classify this document. Return JSON." },
          { type: "image_url", image_url: { url: `data:image/png;base64,${pageImageBase64}`, detail: "low" } },
        ],
      },
    ],
  });
  const rawContent = res.choices[0].message.content || "{}";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  let failed = false;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    console.error(
      "classifyDocument: JSON.parse failed, falling back to defaults:",
      (err as Error).message,
    );
    parsed = {};
    failed = true;
  }
  const cost = ((res.usage?.prompt_tokens || 0) * 0.15 + (res.usage?.completion_tokens || 0) * 0.6) / 1_000_000;
  return { result: parsed as DocumentClassification, cost, failed };
}

// ============================================================
// STEP 2: EXTRACT (type-aware)
// ============================================================

const EXTRACTION_PROMPTS: Record<string, string> = {
  law: `أنت ناسخ قانوني عربي / You are an Arabic legal scribe transcribing a single page of a draft law, decree, or statute. Your only job is verbatim transcription. You are NOT an editor, summarizer, smoother, or translator.

Return JSON:
{
  "header": "official header line at the top of the page only (e.g. 'مشروع قانون', republic name) or null",
  "footer": "page number or footer line only or null",
  "pageType": "cover|toc|body|appendix|signature|blank",
  "language": "ar|en|mixed",
  "sections": [{
    "clauseNumber": "e.g. المادة الأولى, المادة الثانية, مادة (14), مادة (37 مكرراً), مادة (38 مكرراً/أ), مادة 47 مكرراً — copy the EXACT label from the page. Use null only if no label is present.",
    "title": "section title if any, or null",
    "content": "the exact verbatim text of this section as it appears on the page",
    "type": "preamble|article|clause|sub_clause|definition|penalty|transitional|signature|body",
    "subItems": ["(أ) verbatim text", "(ب) verbatim text"]
  }]
}

VERBATIM TRANSCRIPTION RULES — these are non-negotiable:

1. **Do not invent text.** If a word is partially obscured, ambiguous, or you are not sure, write [غير واضح] in its place. Never guess. Never substitute a word that "sounds right." Never auto-correct.

2. **Do not paraphrase, smooth, or normalize.** Copy what is on the page literally. If the page has unusual wording, keep it. If a phrase is grammatically awkward, keep it. The page is the source of truth, not your prior knowledge of how Egyptian law is usually phrased.

3. **Do not duplicate phrases.** If you accidentally start to repeat a clause (e.g. "وزير المالية، ووزير المالية"), stop and re-read the line. Each phrase appears in the text exactly as many times as the page shows it.

4. **Do not invent connective tissue between lines.** If two adjacent lines on the page do not actually connect grammatically, do not add "و" or "كما" or any glue word to make them flow. Keep the original line breaks as separate sentences if the page does.

5. **Numbers, percentages, article numbers, year numbers, and law references are critical.** Copy every digit exactly. Examples to be especially careful with:
   - النسب المئوية (e.g. ١٧٪، ٥٠٪، ٨٠٪) — copy the exact digit, do not round
   - أرقام المواد (e.g. مادة 14، مادة 37 مكرراً، مادة 38 مكرراً/ب) — copy with all suffixes (مكرراً, /أ, /ب) intact
   - أرقام القوانين والسنوات (e.g. القانون رقم 83 لسنة 2002) — copy law number and year exactly
   - Dates and durations
   These fields are higher-stakes than the surrounding prose. If you are unsure of any digit, write [غير واضح] for that token, not a guess.

6. **Easily-confused Arabic letters.** Pay special attention to:
   - تيسيرات vs تنسيبات (the former is a real legal term; the latter is meaningless)
   - التعاقدات vs التعليقات (the former is "contracts"; the latter is unrelated)
   - Similar letterforms (ب/ت/ث، ج/ح/خ، د/ذ، ر/ز، س/ش، ص/ض، ط/ظ، ع/غ)
   If the page uses one of these easily-confused words, look at it carefully and copy the exact letter you see. If unclear, mark [غير واضح].

7. **Sub-items (أ، ب، ج، 1، 2، 3) go in subItems array, NOT in content.** Each sub-item is its own array entry, transcribed verbatim with its label.

8. **Every article/clause MUST have its clauseNumber field populated** if a label is visible on the page. Examples of valid clauseNumber values: "المادة الأولى", "المادة الثانية", "مادة (14)", "مادة (37) مكرراً", "مادة (38 مكرراً/أ)", "مادة 47 مكرراً". Use null only when there is genuinely no label.

9. **Preamble.** A preamble (بعد الاطلاع على القانون رقم...، وعلى القانون رقم...) goes as a single section with type="preamble" and clauseNumber=null. Do not split each "وعلى" reference into its own section.

10. **Numerals system.** Preserve the digit system exactly as printed. If the page uses Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩), keep them. If the page uses Western digits (0123456789), keep them. Do NOT convert between systems — code post-processes that.

11. **Empty pages → pageType "blank", empty sections array.**

12. **Do not include translation, commentary, or meta-notes.** No "this section discusses..." text. No square-bracket annotations except [غير واضح].

If you find yourself wanting to "fix" something on the page, stop. Your job is to faithfully record what the page says, not to produce a polished version. A faithful but messy transcription is correct. A clean, polished version with substituted words is wrong.`,

  report: `Extract this REPORT page. Return JSON:
{
  "header": "ONLY the small repeated header line at top of page (org name, contract number) or null. Body text is NOT header.",
  "footer": "ONLY footer at bottom (page number, footnote ref) or null. Body text is NOT footer.",
  "pageType": "cover|toc|body|appendix|signature|blank",
  "language": "ar|en|mixed",
  "sections": [{
    "clauseNumber": "section number e.g. ١-٢ or 3-3 or null",
    "title": "section heading or null",
    "content": "ALL text in this section. Capture EVERY paragraph and sentence. Do NOT truncate.",
    "type": "introduction|findings|recommendation|conclusion|table|chart|map|figure_caption|footnote|body",
    "subItems": ["bullet points or numbered list items if any"]
  }]
}
CRITICAL RULES:
- header field = ONLY the small repeated line at page top (e.g. org name). NEVER put body text here.
- footer field = ONLY page number or footnote marker. NEVER put body text here.
- CAPTURE ALL TEXT. Every paragraph on the page must appear in some section. Missing text is a failure.
- Nested sections: use clauseNumber like "٣-٣" for subsection 3 of section 3
- NUMERALS: preserve digits EXACTLY as they appear (Arabic-Indic ٠١٢٣٤٥٦٧٨٩ stays Arabic-Indic; Western 0123456789 stays Western). DO NOT translate or convert digit systems — that causes errors. Code will normalize after extraction.
- Tables: type "table". Set content to a JSON STRING with this exact shape: {"caption":"title or section name","headers":["col1","col2"],"rows":[["val1","val2"],["val3","val4"]]}. Each cell is a string. Preserve numbers verbatim. Do not flatten the table into prose.
- Charts/Graphs: type "chart". Set content to JSON: {"chartType":"bar|line|pie","caption":"title","data":[{"label":"x","value":123}],"unit":"unit","description":"what the chart shows"}
- Maps: type "map". Set content to JSON: {"caption":"title","description":"detailed description","features":["feature1"]}
- Figures/Images: type "figure_caption". Set content to JSON: {"caption":"title","description":"detailed description"}
- Footnotes: type "footnote" as separate section
- Long pages: include ALL content even if it makes the JSON large`,

  contract: `Extract this CONTRACT/MoU page. Return JSON:
{
  "header": "header or null",
  "footer": "footer or null",
  "pageType": "cover|toc|body|appendix|signature|blank",
  "language": "ar|en|mixed",
  "sections": [{
    "clauseNumber": "article/clause number or null",
    "title": "section heading or null",
    "content": "full text",
    "type": "parties|definition|obligation|right|penalty|termination|duration|signature|body|preamble|table",
    "subItems": []
  }]
}
Rules:
- Identify parties (الطرف الأول، الطرف الثاني) with type "parties"
- Preserve exact financial figures, dates, and durations
- Tag obligations vs rights vs penalties accurately
- NUMERALS: preserve digits EXACTLY as they appear (Arabic-Indic ٠١٢٣٤٥٦٧٨٩ stays Arabic-Indic; Western 0123456789 stays Western). DO NOT translate or convert digit systems.
- Tables: type "table". Set content to JSON STRING: {"caption":"title","headers":["col1","col2"],"rows":[["val1","val2"]]}. Preserve numbers verbatim.`,

  default: `Extract all text from this document page. Return JSON:
{
  "header": "header or null",
  "footer": "footer or null",
  "pageType": "cover|toc|body|appendix|signature|blank",
  "language": "ar|en|mixed",
  "sections": [{
    "clauseNumber": "number or null",
    "title": "heading or null",
    "content": "full text",
    "type": "body|header|table|footnote",
    "subItems": []
  }]
}
Rules:
- Preserve original text exactly. Fix scanning artifacts only.
- NUMERALS: preserve digits EXACTLY as they appear (Arabic-Indic ٠١٢٣٤٥٦٧٨٩ stays Arabic-Indic; Western 0123456789 stays Western). DO NOT translate or convert digit systems.
- Tables: type "table". Set content to JSON STRING: {"caption":"title","headers":["col1","col2"],"rows":[["val1","val2"]]}. Preserve numbers verbatim.`,
};

async function extractPage(
  pageImageBase64: string,
  pageNumber: number,
  documentType: DocumentType
): Promise<{ page: ExtractedPage; cost: number; failed: boolean }> {
  const prompt = EXTRACTION_PROMPTS[documentType] || EXTRACTION_PROMPTS.default;
  const openai = getOpenAI();

  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    // 16384 is gpt-4o's max output budget. Dense Arabic legal pages can run
    // 10k+ output tokens (full preserved text + sections + sub-items).
    // Previously was 8192 — caused mid-string truncation on long pages and
    // crashed the entire upload via JSON.parse.
    max_tokens: 16384,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: prompt },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Extract page ${pageNumber}. Return JSON.`,
          },
          { type: "image_url", image_url: { url: `data:image/png;base64,${pageImageBase64}`, detail: "high" } },
        ],
      },
    ],
  });

  // Detect token-budget truncation visibly so we know which pages are
  // degraded. Don't crash the upload — fall back to an empty page so the
  // rest of the document still extracts.
  const finishReason = res.choices[0]?.finish_reason;
  const rawContent = res.choices[0].message.content || "{}";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  let failed = false;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    console.error(
      `extractPage(${pageNumber}): JSON.parse failed (finish_reason=${finishReason}, content_length=${rawContent.length}). Falling back to empty page so the rest of the document can still process.`,
      (err as Error).message,
    );
    parsed = {};
    failed = true;
  }
  if (finishReason === "length") {
    console.error(
      `extractPage(${pageNumber}): hit max_tokens cap (finish_reason=length). Page output may be incomplete.`,
    );
    failed = true;
  }
  const cost = ((res.usage?.prompt_tokens || 0) * 2.5 + (res.usage?.completion_tokens || 0) * 10) / 1_000_000;

  const rawPage: ExtractedPage = {
    pageNumber,
    header: parsed.header || null,
    footer: parsed.footer || null,
    language: parsed.language || "ar",
    pageType: parsed.pageType || "body",
    sections: (parsed.sections || []).map((s: Record<string, unknown>) => ({
      clauseNumber: (s.clauseNumber as string) || null,
      title: (s.title as string) || null,
      content: (s.content as string) || "",
      type: (s.type as SectionType) || "body",
      subItems: Array.isArray(s.subItems) ? (s.subItems as string[]) : [],
      confidence: 1.0, // will be adjusted by correction layer
    })),
  };

  // Parse table JSON content into structured rows and convert to markdown
  rawPage.sections = rawPage.sections.map(parseTableSection);

  // Normalize Arabic-Indic digits → Western digits everywhere
  const page = normalizePageDigits(rawPage);

  return { page, cost, failed };
}

// ============================================================
// LAW VERIFIER (Pass 2) — re-read page for high-stakes fields
// ============================================================

interface LawVerifierResult {
  /** Verbatim list of clause/article labels the verifier saw on the page */
  articleLabels: string[];
  /** Verbatim list of percentages on the page (e.g. "17%", "٥٠٪") */
  percentages: string[];
  /** Verbatim list of "law N of YEAR" references */
  lawReferences: string[];
  /** Year tokens visible on the page (e.g. "2002", "2025") */
  years: string[];
  cost: number;
  failed: boolean;
}

async function verifyLawPage(
  pageImageBase64: string,
  pageNumber: number,
): Promise<LawVerifierResult> {
  const openai = getOpenAI();
  let res;
  try {
    res = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0,
      max_tokens: 1500,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `أنت مدقق قانوني عربي. مهمتك هي قراءة صورة صفحة من قانون أو مشروع قانون عربي، ثم استخراج فقط الحقول العالية الخطورة كما تظهر حرفيًا في الصورة. لا تنسخ النص بالكامل.

Return JSON:
{
  "articleLabels": ["المادة الأولى", "المادة الثانية", "مادة (14)", "مادة (37 مكرراً)", ...],
  "percentages": ["17%", "50%", "80%", ...],
  "lawReferences": ["قانون رقم 83 لسنة 2002", "قانون رقم 91 لسنة 2005", ...],
  "years": ["2002", "2005", "2025", ...]
}

CRITICAL RULES:
- Look at the IMAGE, not at any prior assumption about the document
- Copy each value EXACTLY as it appears on this specific page (verbatim digit form, verbatim suffixes like مكرراً or /أ or /ب)
- If a label has a sub-letter suffix (e.g. مكرراً/أ, مكرراً/ب), include the suffix
- Empty arrays are fine — only list what is actually visible on this page
- DO NOT invent or add anything that is not on the page
- If you cannot read a digit clearly, omit that value entirely (do NOT guess)

This is the second pass of a two-pass extraction. The first pass already transcribed the page. Your output is used to cross-check the first pass for high-stakes errors (article numbers, tax rates, law references).`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Verify high-stakes fields on page ${pageNumber}. Return JSON.` },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${pageImageBase64}`, detail: "high" },
            },
          ],
        },
      ],
    });
  } catch (err) {
    console.error(`verifyLawPage(${pageNumber}): API call failed:`, (err as Error).message);
    return {
      articleLabels: [],
      percentages: [],
      lawReferences: [],
      years: [],
      cost: 0,
      failed: true,
    };
  }

  const rawContent = res.choices[0].message.content || "{}";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  let failed = false;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    console.error(
      `verifyLawPage(${pageNumber}): JSON.parse failed:`,
      (err as Error).message,
    );
    parsed = {};
    failed = true;
  }
  const cost =
    ((res.usage?.prompt_tokens || 0) * 2.5 + (res.usage?.completion_tokens || 0) * 10) /
    1_000_000;

  return {
    articleLabels: Array.isArray(parsed.articleLabels) ? parsed.articleLabels : [],
    percentages: Array.isArray(parsed.percentages) ? parsed.percentages : [],
    lawReferences: Array.isArray(parsed.lawReferences) ? parsed.lawReferences : [],
    years: Array.isArray(parsed.years) ? parsed.years : [],
    cost,
    failed,
  };
}

/**
 * Compare a verifier result against an extracted page. Returns a list of
 * mismatches (verifier found a value that the extraction is missing). Used
 * to surface high-stakes extraction errors as warnings on the document row.
 */
function diffVerifierAgainstPage(
  verifier: LawVerifierResult,
  page: ExtractedPage,
): string[] {
  // Concatenate everything from the page so we can substring-check
  const pageText = page.sections
    .map((s) => `${s.clauseNumber || ""} ${s.title || ""} ${s.content} ${s.subItems.join(" ")}`)
    .join(" ");

  const mismatches: string[] = [];

  // Normalize digits before comparing (verifier may keep Arabic-Indic, page is post-normalized)
  const normalizeDigit = (s: string) =>
    s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const haystack = normalizeDigit(pageText);

  for (const label of verifier.articleLabels) {
    const needle = normalizeDigit(label);
    // Allow approximate match: collapse whitespace + check substring of significant tokens
    const tokens = needle.replace(/\s+/g, " ").trim();
    if (tokens && !haystack.includes(tokens)) {
      mismatches.push(`page ${page.pageNumber}: missing article label "${label}"`);
    }
  }

  for (const ref of verifier.lawReferences) {
    const needle = normalizeDigit(ref).replace(/\s+/g, " ").trim();
    // Match on the law number + year tokens since prose may rearrange wording
    const m = needle.match(/(\d+)[^\d]+(\d{4})/);
    if (m) {
      const num = m[1];
      const year = m[2];
      if (!haystack.includes(num) || !haystack.includes(year)) {
        mismatches.push(
          `page ${page.pageNumber}: missing law reference "${ref}" (looked for ${num} + ${year})`,
        );
      }
    }
  }

  for (const pct of verifier.percentages) {
    const num = pct.replace(/[^\d]/g, "");
    if (num && !haystack.includes(num)) {
      mismatches.push(`page ${page.pageNumber}: missing percentage "${pct}"`);
    }
  }

  return mismatches;
}

// ============================================================
// STEP 3: CORRECT (Arabic text cleanup)
// ============================================================

async function correctText(
  pages: ExtractedPage[]
): Promise<{ pages: ExtractedPage[]; corrections: string[]; cost: number; failedBatches: number }> {
  // Only correct body pages with actual content
  const bodyPages = pages.filter(p => p.pageType === "body" && p.sections.length > 0);
  if (bodyPages.length === 0) return { pages, corrections: [], cost: 0, failedBatches: 0 };

  // Send sections for correction (batch to save tokens)
  const sectionsToCorrect = bodyPages.flatMap((p, pi) =>
    p.sections.map((s, si) => ({ pageIdx: pi, sectionIdx: si, content: s.content, subItems: s.subItems }))
  );

  // Process in batches of 10 sections
  const allCorrections: string[] = [];
  let totalCost = 0;
  let failedBatches = 0;

  const openai = getOpenAI();
  for (let i = 0; i < sectionsToCorrect.length; i += 10) {
    const batch = sectionsToCorrect.slice(i, i + 10);
    const batchInput = batch.map((s, idx) => `[${idx}] ${s.content}`).join("\n---\n");

    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You correct Arabic text from scanned government documents. The text is mostly good but may have minor OCR errors.

RULES:
- Only fix CLEAR errors: broken words, missing hamza, obvious letter confusion
- If you are not sure a word is wrong, DO NOT change it
- Each correction must be specific: "word X on this section → word Y"
- Do NOT apply the same fix to every section — check each independently
- Do NOT paraphrase, rewrite, or restructure
- Do NOT invent corrections that don't exist in the text

Output JSON:
{
  "corrected": ["text for each section — unchanged if no issues found"],
  "corrections": ["section 0: 'فصلاً' → 'فضلاً' (ص/ض confusion)", "section 1: no changes"],
  "confidence": [0.95, 0.92]
}

Confidence: 0.95+ = clean, 0.85-0.94 = minor fixes, 0.70-0.84 = several issues, <0.70 = uncertain.
If unsure about a fix, leave the text unchanged and lower confidence.`,
        },
        {
          role: "user",
          content: `Correct these ${batch.length} sections from an Egyptian government document. Return JSON.\n\n${batchInput}`,
        },
      ],
    });

    const rawContent = res.choices[0].message.content || "{}";
    let parsed: { corrected?: string[]; corrections?: string[]; confidence?: number[] };
    try {
      parsed = JSON.parse(rawContent);
    } catch (err) {
      console.error(
        `correctText batch ${i / 10}: JSON.parse failed, skipping batch corrections:`,
        (err as Error).message,
      );
      parsed = {};
      failedBatches++;
    }
    totalCost += ((res.usage?.prompt_tokens || 0) * 0.15 + (res.usage?.completion_tokens || 0) * 0.6) / 1_000_000;

    const correctedTexts: string[] = parsed.corrected || [];
    const corrections: string[] = parsed.corrections || [];
    const confidences: number[] = parsed.confidence || [];

    // Apply corrections and verify integrity
    for (let j = 0; j < batch.length && j < correctedTexts.length; j++) {
      const { pageIdx, sectionIdx, content: originalContent } = batch[j];
      const page = bodyPages[pageIdx];
      if (!page || !page.sections[sectionIdx]) continue;

      let finalContent = correctedTexts[j];
      page.sections[sectionIdx].confidence = confidences[j] ?? 0.9;

      // If model logged corrections, enforce them via string replacement
      for (const c of corrections) {
        const arrowMatch = c.match(/[''"'"](.+?)[''"'"].*?→.*?[''"'"](.+?)[''"'"]/);
        if (arrowMatch && arrowMatch[1] !== arrowMatch[2]) {
          const before = arrowMatch[1];
          const after = arrowMatch[2];
          // Direct match
          if (finalContent.includes(before)) {
            finalContent = finalContent.replaceAll(before, after);
          } else {
            // Try fuzzy match: Arabic prefixes (ال، لل، بال، وال، فال، كال) may be attached
            const prefixes = ["لل", "بال", "وال", "فال", "كال", "ال"];
            for (const prefix of prefixes) {
              const prefixed = prefix + before.replace(/^ال/, "");
              const prefixedAfter = prefix + after.replace(/^ال/, "");
              if (finalContent.includes(prefixed)) {
                finalContent = finalContent.replaceAll(prefixed, prefixedAfter);
                break;
              }
            }
          }
        }
      }

      page.sections[sectionIdx].content = finalContent;
    }

    // Filter corrections: only keep real ones (before ≠ after, not "no changes")
    for (const c of corrections) {
      if (!c || c.match(/no.+change|unchanged|already correct|no correction/i)) continue;
      const arrowMatch = c.match(/[''](.+?)[''].*?→.*?[''](.+?)['']/);
      if (arrowMatch && arrowMatch[1] === arrowMatch[2]) continue; // Ghost
      allCorrections.push(c);
    }
  }

  return { pages, corrections: allCorrections, cost: totalCost, failedBatches };
}

// ============================================================
// STEP 4: RULE-BASED VALIDATION (deterministic, no LLM)
// ============================================================

export function validateExtraction(pages: ExtractedPage[], documentType: DocumentType): ValidationResult {
  const issues: ValidationIssue[] = [];
  const seenClauses = new Set<string>();

  for (const page of pages) {
    // === COMPLETENESS CHECK ===
    // Body pages should have meaningful content
    if (page.pageType === "body") {
      const totalContentLength = page.sections.reduce((sum, s) => sum + s.content.length + s.subItems.join("").length, 0);

      if (totalContentLength < 50) {
        issues.push({
          type: "empty_content",
          message: `Page ${page.pageNumber}: body page with almost no content (${totalContentLength} chars) — likely missing text`,
          sectionIndex: -1,
          severity: "error",
        });
      } else if (totalContentLength < 200 && page.sections.length <= 2) {
        issues.push({
          type: "empty_content",
          message: `Page ${page.pageNumber}: suspiciously little content (${totalContentLength} chars, ${page.sections.length} sections) — may be incomplete`,
          sectionIndex: -1,
          severity: "warning",
        });
      }
    }

    // === HEADER/FOOTER CONTAMINATION CHECK ===
    // Headers and footers should be short (< 200 chars). Long ones likely contain body text.
    if (page.header && page.header.length > 200) {
      issues.push({
        type: "empty_content",
        message: `Page ${page.pageNumber}: header is ${page.header.length} chars — likely contains body text that should be in sections`,
        sectionIndex: -1,
        severity: "error",
      });
    }
    if (page.footer && page.footer.length > 200) {
      issues.push({
        type: "empty_content",
        message: `Page ${page.pageNumber}: footer is ${page.footer.length} chars — likely contains body text that should be in sections`,
        sectionIndex: -1,
        severity: "error",
      });
    }

    // === COVER PAGE CHECK ===
    // Cover pages should not have introduction/body/findings sections
    if (page.pageType === "cover") {
      for (let si = 0; si < page.sections.length; si++) {
        if (["introduction", "findings", "body", "recommendation"].includes(page.sections[si].type)) {
          issues.push({
            type: "empty_content",
            message: `Page ${page.pageNumber}: cover page has "${page.sections[si].type}" section — likely misclassified page or misassigned content`,
            sectionIndex: si,
            severity: "warning",
          });
        }
      }
    }

    for (let si = 0; si < page.sections.length; si++) {
      const section = page.sections[si];

      // === SECTION-CONTENT ALIGNMENT ===
      // Introduction sections should not contain metadata-like content
      if (section.type === "introduction" && section.content) {
        const looksLikeMetadata = /^\s*(رقم العقد|Contract No|Reference|Date:|التاريخ)/i.test(section.content.trim());
        if (looksLikeMetadata) {
          issues.push({
            type: "empty_content",
            message: `Page ${page.pageNumber}, section ${si}: "${section.type}" contains metadata instead of introduction text`,
            sectionIndex: si,
            severity: "error",
          });
        }
      }

      // === CLAUSE NUMBER CHECKS (law/contract) ===
      if (["article", "clause"].includes(section.type) && !section.clauseNumber) {
        issues.push({
          type: "missing_clause_number",
          message: `Page ${page.pageNumber}, section ${si}: ${section.type} without clause number`,
          sectionIndex: si,
          severity: "error",
        });
      }

      // === EMPTY CONTENT ===
      if (!section.content || section.content.trim().length < 5) {
        issues.push({
          type: "empty_content",
          message: `Page ${page.pageNumber}, section ${si}: empty or near-empty content`,
          sectionIndex: si,
          severity: "warning",
        });
      }

      // === DUPLICATE CLAUSE NUMBERS ===
      if (section.clauseNumber) {
        const key = `${section.clauseNumber}`;
        if (seenClauses.has(key)) {
          issues.push({
            type: "duplicate_clause",
            message: `Page ${page.pageNumber}: duplicate clause "${section.clauseNumber}"`,
            sectionIndex: si,
            severity: "warning",
          });
        }
        seenClauses.add(key);
      }

      // === SUB-ITEM ORDER ===
      if (section.subItems.length > 1) {
        if (!checkSubItemOrder(section.subItems)) {
          issues.push({
            type: "unordered_items",
            message: `Page ${page.pageNumber}, clause "${section.clauseNumber}": sub-items may be out of order`,
            sectionIndex: si,
            severity: "warning",
          });
        }
      }

      // === ORPHANED SUB-ITEMS ===
      if (section.type === "sub_clause" && si === 0) {
        issues.push({
          type: "orphaned_sub_item",
          message: `Page ${page.pageNumber}: sub_clause at start of page without parent article`,
          sectionIndex: si,
          severity: "warning",
        });
      }
    }
  }

  // === LAW-SPECIFIC: incomplete law references ===
  if (documentType === "law" || documentType === "decree") {
    const allText = pages.flatMap(p => p.sections.map(s => s.content)).join(" ");
    // Match "قانون رقم X" NOT followed by "لسنة" — but exclude partial matches inside longer refs
    const incompleteRefs = allText.match(/قانون\s+رقم\s+[\d٠-٩]+(?!\s*[\d٠-٩]*\s*لسنة)/g);
    if (incompleteRefs) {
      for (const ref of incompleteRefs) {
        issues.push({
          type: "incomplete_reference",
          message: `Incomplete law reference: "${ref}" — missing "لسنة YYYY"`,
          sectionIndex: -1,
          severity: "warning",
        });
      }
    }
  }

  return {
    valid: issues.filter(i => i.severity === "error").length === 0,
    issues,
    corrections: [],
  };
}

/**
 * Check if sub-items follow Arabic alphabetical order (أ، ب، ت، ث، ج...) or Latin (a, b, c).
 */
function checkSubItemOrder(items: string[]): boolean {
  const arabicOrder = "أبتثجحخدذرزسشصضطظعغفقكلمنهوي";
  const latinOrder = "abcdefghijklmnopqrstuvwxyz";

  const extracted = items.map(item => {
    const arabicMatch = item.match(/^\s*\(?\s*([أ-ي])\s*\)?/);
    if (arabicMatch) return { type: "ar", char: arabicMatch[1] };
    const latinMatch = item.match(/^\s*\(?\s*([a-z])\s*\)?/i);
    if (latinMatch) return { type: "la", char: latinMatch[1].toLowerCase() };
    return null;
  });

  if (extracted.some(e => e === null)) return true; // Can't determine, assume ok

  for (let i = 1; i < extracted.length; i++) {
    const prev = extracted[i - 1]!;
    const curr = extracted[i]!;
    if (prev.type !== curr.type) return true; // Mixed, can't check
    const order = prev.type === "ar" ? arabicOrder : latinOrder;
    if (order.indexOf(curr.char) <= order.indexOf(prev.char)) return false;
  }
  return true;
}

// ============================================================
// STEP 5: METADATA EXTRACTION
// ============================================================

async function extractMetadata(
  fullText: string,
  fileName: string,
  documentType: DocumentType
): Promise<{
  metadata: ExtractionResult["metadata"];
  referencedLaws: string[];
  cost: number;
  failed: boolean;
}> {
  // Extract referenced laws with regex (deterministic)
  const referencedLaws = detectReferences(fullText)
    .filter((r) => r.type === "law" || r.type === "decree")
    .map((r) => r.text);

  // Extract metadata with LLM (cheap)
  const maxChars = 6000;
  const truncated = fullText.length > maxChars
    ? fullText.slice(0, maxChars / 2) + "\n...\n" + fullText.slice(-maxChars / 2)
    : fullText;

  const openai = getOpenAI();
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Extract metadata from this ${documentType} document. Output JSON:
{
  "parties": ["organizations/people involved"],
  "dates": ["key dates mentioned"],
  "duration": "agreement duration if applicable",
  "obligations": ["key obligations"],
  "penalties": ["penalties mentioned"],
  "sector": "economic sector",
  "entities": [{"name": "entity name", "type": "company|ministry|project|person|authority", "nameEn": "English name or null"}]
}
File: ${fileName}`,
      },
      { role: "user", content: `Extract metadata. Return JSON.\n\n${truncated}` },
    ],
  });

  const rawContent = res.choices[0].message.content || "{}";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  let failed = false;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    console.error(
      "extractMetadata: JSON.parse failed, falling back to empty metadata:",
      (err as Error).message,
    );
    parsed = {};
    failed = true;
  }
  const cost = ((res.usage?.prompt_tokens || 0) * 0.15 + (res.usage?.completion_tokens || 0) * 0.6) / 1_000_000;

  return {
    metadata: {
      ...parsed,
      references: referencedLaws.map(r => ({ text: r, type: "law" })),
    },
    referencedLaws,
    cost,
    failed,
  };
}

