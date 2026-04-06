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
}

// ============================================================
// MAIN PIPELINE: Classify → Extract → Correct → Validate
// ============================================================

export async function extractDocument(
  fileBuffer: Buffer,
  fileName: string
): Promise<ExtractionResult> {
  const costs = { classification: 0, extraction: 0, correction: 0, total: 0 };

  // Convert PDF pages to PNG images using pdf-to-img
  const pageImages: string[] = [];
  for await (const page of await pdfToImg(fileBuffer, { scale: 2 })) {
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
  const BATCH_SIZE = 5;
  for (let i = 0; i < pageImages.length; i += BATCH_SIZE) {
    const batch = pageImages.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((img, j) =>
        extractPage(img, i + j + 1, classification.result.documentType)
      )
    );
    for (const { page, cost } of batchResults) {
      rawPages.push(page);
      costs.extraction += cost;
    }
  }

  // Step 3: Correct Arabic text (batch all pages in one call)
  const { pages: correctedPages, corrections, cost: correctionCost } = await correctText(rawPages);
  costs.correction = correctionCost;

  // Step 4: Rule-based validation (deterministic, no LLM)
  const validation = validateExtraction(correctedPages, classification.result.documentType);
  validation.corrections = corrections;

  // Step 5: Extract metadata
  const allText = correctedPages.flatMap(p => p.sections.map(s => s.content)).join("\n\n");
  const { metadata, referencedLaws, cost: metaCost } = await extractMetadata(allText, fileName, classification.result.documentType);
  costs.extraction += metaCost;

  costs.total = costs.classification + costs.extraction + costs.correction;

  return {
    classification: classification.result,
    pages: correctedPages,
    referencedLaws,
    validation,
    metadata,
    costs,
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

async function classifyDocument(pageImageBase64: string): Promise<{ result: DocumentClassification; cost: number }> {
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
  const parsed = JSON.parse(res.choices[0].message.content || "{}");
  const cost = ((res.usage?.prompt_tokens || 0) * 0.15 + (res.usage?.completion_tokens || 0) * 0.6) / 1_000_000;
  return { result: parsed as DocumentClassification, cost };
}

// ============================================================
// STEP 2: EXTRACT (type-aware)
// ============================================================

const EXTRACTION_PROMPTS: Record<string, string> = {
  law: `Extract this LEGAL DOCUMENT page. Return JSON:
{
  "header": "official header or null",
  "footer": "footer text or null",
  "pageType": "cover|toc|body|appendix|signature|blank",
  "language": "ar|en|mixed",
  "sections": [{
    "clauseNumber": "e.g. المادة الأولى or مادة (١٤) or null",
    "title": "section title or null",
    "content": "full exact text of this section",
    "type": "preamble|article|clause|sub_clause|definition|penalty|transitional|signature|body",
    "subItems": ["(أ) full text", "(ب) full text"]
  }]
}
Rules:
- Preserve EXACT Arabic legal phrasing — do not paraphrase
- Every article/clause MUST have clauseNumber
- Sub-items (أ، ب، ج) go in subItems array, NOT in content
- Capture preamble (بعد الاطلاع على...) as type "preamble"
- NUMERALS: preserve digits EXACTLY as they appear (Arabic-Indic ٠١٢٣٤٥٦٧٨٩ stays Arabic-Indic; Western 0123456789 stays Western). DO NOT translate or convert digit systems.
- Empty pages → pageType "blank", empty sections array`,

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
): Promise<{ page: ExtractedPage; cost: number }> {
  const prompt = EXTRACTION_PROMPTS[documentType] || EXTRACTION_PROMPTS.default;
  const openai = getOpenAI();

  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    max_tokens: 8192,
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

  const parsed = JSON.parse(res.choices[0].message.content || "{}");
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

  return { page, cost };
}

// ============================================================
// STEP 3: CORRECT (Arabic text cleanup)
// ============================================================

async function correctText(
  pages: ExtractedPage[]
): Promise<{ pages: ExtractedPage[]; corrections: string[]; cost: number }> {
  // Only correct body pages with actual content
  const bodyPages = pages.filter(p => p.pageType === "body" && p.sections.length > 0);
  if (bodyPages.length === 0) return { pages, corrections: [], cost: 0 };

  // Send sections for correction (batch to save tokens)
  const sectionsToCorrect = bodyPages.flatMap((p, pi) =>
    p.sections.map((s, si) => ({ pageIdx: pi, sectionIdx: si, content: s.content, subItems: s.subItems }))
  );

  // Process in batches of 10 sections
  const allCorrections: string[] = [];
  let totalCost = 0;

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

    const parsed = JSON.parse(res.choices[0].message.content || "{}");
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

  return { pages, corrections: allCorrections, cost: totalCost };
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

  const parsed = JSON.parse(res.choices[0].message.content || "{}");
  const cost = ((res.usage?.prompt_tokens || 0) * 0.15 + (res.usage?.completion_tokens || 0) * 0.6) / 1_000_000;

  return {
    metadata: {
      ...parsed,
      references: referencedLaws.map(r => ({ text: r, type: "law" })),
    },
    referencedLaws,
    cost,
  };
}

