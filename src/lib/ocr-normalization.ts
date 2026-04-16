import type {
  DocumentClassification,
  DocumentType,
  ExtractedPage,
  ExtractedSection,
  ExtractionMetadata,
  ExtractionPreferences,
  LanguageCode,
} from "@/lib/extraction-schema";
import type {
  AzureDocumentIntelligenceResponse,
  AzureLayoutParagraph,
  AzureLayoutTable,
  AzureLayoutWord,
  AzureSpan,
  NormalizedBlock,
  NormalizedBlockKind,
  NormalizedDocumentArtifact,
  NormalizedPage,
  NormalizedTable,
  RawOcrArtifact,
} from "@/lib/extraction-v2-schema";
import { validateExtraction } from "@/lib/extraction-validation";
import {
  extractDates as extractNormalizedDates,
  normalizeNumbers,
} from "@/lib/normalize";
import { detectReferences } from "@/lib/references";

const NOISE_PATTERNS = [
  /^scanned with$/i,
  /^camscanner®?$/i,
  /^cs$/i,
  /^rd\s*\d{4}/i,
];

const ARABIC_DATE_RE = /\b\d{4}\/\d{1,2}\/\d{1,2}\b/g;

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripInlinePageFurniture(text: string): string {
  return text
    .replace(/\bRD\s*\d{4}\/\d{1,2}\/\d{1,2}\b/gi, " ")
    .replace(/\b\d+\s+دراسات\s+قانونية\s+\d{4}\b/g, " ")
    .replace(/\bscanned with\b/gi, " ")
    .replace(/\bCamScanner®?\b/gi, " ");
}

function isNoiseText(text: string): boolean {
  const normalized = collapseWhitespace(stripInlinePageFurniture(text));
  if (!normalized) return true;
  return NOISE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function paragraphOrder(paragraph: AzureLayoutParagraph): number {
  return paragraph.spans?.[0]?.offset ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Average the per-word confidence values that fall inside the given
 * paragraph spans. Returns null when no word-level signal is available
 * (Azure occasionally returns paragraphs without word coverage, or whole
 * documents without word-level data on certain prebuilt-layout API
 * versions). Null propagates to ExtractedSection.confidence so the
 * display layer can hide the tag instead of faking a HIGH score.
 *
 * Azure returns global content offsets (paragraph.spans + word.span share
 * the same coordinate space), so we just iterate. With <10k words per
 * typical doc the linear scan is fine.
 */
function aggregateConfidenceForSpans(
  spans: AzureSpan[] | undefined,
  globalWords: AzureLayoutWord[],
): number | null {
  if (!spans?.length || globalWords.length === 0) return null;
  let sum = 0;
  let count = 0;
  for (const word of globalWords) {
    if (typeof word.confidence !== "number") continue;
    if (!word.span) continue;
    const wordEnd = word.span.offset + word.span.length;
    for (const span of spans) {
      const spanEnd = span.offset + span.length;
      if (word.span.offset >= span.offset && wordEnd <= spanEnd) {
        sum += word.confidence;
        count++;
        break;
      }
    }
  }
  return count > 0 ? sum / count : null;
}

function getPolygonBounds(polygon: number[] | undefined) {
  if (!polygon || polygon.length < 8) return null;
  const xs = [polygon[0], polygon[2], polygon[4], polygon[6]];
  const ys = [polygon[1], polygon[3], polygon[5], polygon[7]];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function polygonTopEdgeAngleDegrees(polygon: number[] | undefined): number {
  if (!polygon || polygon.length < 4) return 0;
  const dx = polygon[2] - polygon[0];
  const dy = polygon[3] - polygon[1];
  return Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
}

function isLikelyDecorativeNoise({
  text,
  polygon,
  pageWidth,
  pageHeight,
  role,
}: {
  text: string;
  polygon?: number[];
  pageWidth?: number;
  pageHeight?: number;
  role?: string;
}): boolean {
  if (!polygon || !pageWidth || !pageHeight) return false;
  if (
    [
      "pageHeader",
      "pageFooter",
      "pageNumber",
      "title",
      "sectionHeading",
    ].includes(role || "")
  ) {
    return false;
  }

  const normalized = collapseWhitespace(stripInlinePageFurniture(text));
  if (!normalized) return true;

  const bounds = getPolygonBounds(polygon);
  if (!bounds) return false;

  const angle = polygonTopEdgeAngleDegrees(polygon);
  const rotated = angle >= 12 && angle <= 78;
  const shortText = normalized.length <= 80;
  const veryShortText = normalized.length <= 40;
  const wordCount = normalized.split(/\s+/).length;
  const nearTop = bounds.maxY <= Math.min(2.0, pageHeight * 0.18);
  const nearBottom = bounds.minY >= pageHeight * 0.74;
  const nearSide =
    bounds.maxX <= pageWidth * 0.28 || bounds.minX >= pageWidth * 0.72;
  const verticalish = bounds.height > bounds.width * 1.8;

  if (
    rotated &&
    veryShortText &&
    (nearTop || nearBottom || nearSide || verticalish)
  )
    return true;
  if (rotated && shortText && nearTop) return true;
  if (rotated && wordCount <= 4 && nearBottom) return true;
  return false;
}

function inferHeaderFromContent({
  text,
  polygon,
  pageWidth,
  pageHeight,
}: {
  text: string;
  polygon?: number[];
  pageWidth?: number;
  pageHeight?: number;
}): boolean {
  if (!polygon || !pageWidth || !pageHeight) return false;
  const bounds = getPolygonBounds(polygon);
  if (!bounds) return false;
  const normalized = collapseWhitespace(stripInlinePageFurniture(text));
  if (!normalized || normalized.length > 120) return false;
  const nearTop = bounds.maxY <= Math.min(2.2, pageHeight * 0.2);
  return (
    nearTop &&
    /(جمهورية مصر العربية|رئاسة مجلس الوزراء|هيئة مستشار[ىي] مجلس الوزراء|الهيئة العامة)/.test(
      normalized,
    )
  );
}

function blockKindFromRole(
  role: string | undefined,
  text: string,
): NormalizedBlockKind {
  if (isNoiseText(text)) return "noise";
  const normalized = collapseWhitespace(stripInlinePageFurniture(text));
  const looksLikeBodyText =
    normalized.length > 180 ||
    normalized.split(/\s+/).length > 28 ||
    /القانون|الاتفاقية|المحاجر|الملاحات|المنطقة الاقتصادية|تتولى|تختص|shall|agreement/i.test(
      normalized,
    );

  if (
    ["pageHeader", "pageFooter", "pageNumber"].includes(role || "") &&
    looksLikeBodyText
  ) {
    return "paragraph";
  }

  switch (role) {
    case "title":
      return "title";
    case "sectionHeading":
      return "heading";
    case "pageHeader":
      return "header";
    case "pageFooter":
    case "pageNumber":
      return "footer";
    case "footnote":
      return "note";
    default:
      return "paragraph";
  }
}

function buildNormalizedTable(table: AzureLayoutTable): NormalizedTable | null {
  const rows = Array.from({ length: table.rowCount }, () =>
    Array.from({ length: table.columnCount }, () => ""),
  );

  for (const cell of table.cells) {
    if (
      rows[cell.rowIndex] &&
      rows[cell.rowIndex][cell.columnIndex] !== undefined
    ) {
      rows[cell.rowIndex][cell.columnIndex] = collapseWhitespace(cell.content);
    }
  }

  const headerRow = table.cells
    .filter((cell) => cell.kind === "columnHeader" && cell.rowIndex === 0)
    .sort((a, b) => a.columnIndex - b.columnIndex)
    .map((cell) => collapseWhitespace(cell.content))
    .filter(Boolean);

  const bodyRows = rows
    .filter((row) => row.some(Boolean))
    .filter((_row, index) => !(index === 0 && headerRow.length > 0));

  if (bodyRows.length === 0) return null;

  return {
    ...(headerRow.length > 0 ? { headers: headerRow } : {}),
    rows: bodyRows,
  };
}

function pageNumbersFromRegions(
  regions: Array<{ pageNumber: number }> | undefined,
): number[] {
  return [...new Set((regions || []).map((region) => region.pageNumber))];
}

function mapParagraphsToBlocks(
  response: AzureDocumentIntelligenceResponse,
  pageNumber: number,
  globalWords: AzureLayoutWord[],
): NormalizedBlock[] {
  const page = (response.analyzeResult?.pages || []).find(
    (candidate) => candidate.pageNumber === pageNumber,
  );
  const paragraphs = (response.analyzeResult?.paragraphs || [])
    .filter((paragraph) =>
      pageNumbersFromRegions(paragraph.boundingRegions).includes(pageNumber),
    )
    .sort((a, b) => paragraphOrder(a) - paragraphOrder(b));

  return paragraphs.map((paragraph, index) => {
    const polygon = paragraph.boundingRegions?.[0]?.polygon;
    const cleanedText = collapseWhitespace(
      stripInlinePageFurniture(paragraph.content),
    );
    let kind = blockKindFromRole(paragraph.role, cleanedText);

    if (
      isLikelyDecorativeNoise({
        text: cleanedText,
        polygon,
        pageWidth: page?.width,
        pageHeight: page?.height,
        role: paragraph.role,
      })
    ) {
      kind = "noise";
    } else if (
      kind === "paragraph" &&
      inferHeaderFromContent({
        text: cleanedText,
        polygon,
        pageWidth: page?.width,
        pageHeight: page?.height,
      })
    ) {
      kind = "header";
    }

    const confidence = aggregateConfidenceForSpans(
      paragraph.spans,
      globalWords,
    );

    return {
      id: `p-${pageNumber}-${index}`,
      pageNumber,
      kind,
      text: cleanedText,
      role: paragraph.role || null,
      polygon,
      order: paragraphOrder(paragraph),
      ...(confidence !== null ? { confidence } : {}),
    };
  });
}

function mapTablesToBlocks(
  response: AzureDocumentIntelligenceResponse,
  pageNumber: number,
): NormalizedBlock[] {
  const tables = (response.analyzeResult?.tables || [])
    .filter((table) =>
      pageNumbersFromRegions(table.boundingRegions).includes(pageNumber),
    )
    .map((table, index) => {
      const normalizedTable = buildNormalizedTable(table);
      if (!normalizedTable) return null;
      return {
        id: `t-${pageNumber}-${index}`,
        pageNumber,
        kind: "table" as const,
        text: [
          normalizedTable.headers?.join(" | ") || "",
          ...normalizedTable.rows.map((row) => row.join(" | ")),
        ]
          .filter(Boolean)
          .join("\n"),
        role: "table",
        polygon: table.boundingRegions?.[0]?.polygon,
        order:
          table.spans?.[0]?.offset ?? Number.MAX_SAFE_INTEGER - (1000 - index),
        table: normalizedTable,
      };
    })
    .filter((table): table is NonNullable<typeof table> => Boolean(table));

  return tables;
}

function dedupeRepeatedHeadersFooters(
  blocks: NormalizedBlock[],
): NormalizedBlock[] {
  const seen = new Set<string>();
  return blocks.filter((block) => {
    if (!["header", "footer", "noise"].includes(block.kind)) return true;
    const key = `${block.kind}:${block.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function summarizeRawOcrArtifact(
  response: AzureDocumentIntelligenceResponse,
): RawOcrArtifact {
  const analyzeResult = response.analyzeResult || {};
  return {
    provider: "azure-layout",
    pipelineVersion: 2,
    apiVersion: analyzeResult.apiVersion || null,
    modelId: analyzeResult.modelId || null,
    contentFormat: analyzeResult.contentFormat || null,
    pageCount: analyzeResult.pages?.length || 0,
    paragraphCount: analyzeResult.paragraphs?.length || 0,
    tableCount: analyzeResult.tables?.length || 0,
    figureCount: analyzeResult.figures?.length || 0,
    contentLength: analyzeResult.content?.length || 0,
  };
}

export function normalizeAzureLayoutDocument(
  response: AzureDocumentIntelligenceResponse,
  fileName: string,
  preferences?: ExtractionPreferences,
): NormalizedDocumentArtifact {
  // Flatten every page's word array once. Azure uses GLOBAL content
  // offsets (paragraph.spans + word.span share one coordinate space),
  // so we don't need to partition by page — the lookup just needs the
  // full word list to match against any paragraph's spans.
  const globalWords = (response.analyzeResult?.pages || []).flatMap(
    (page) => page.words ?? [],
  );

  const pages = (response.analyzeResult?.pages || []).map((page) => {
    const paragraphBlocks = mapParagraphsToBlocks(
      response,
      page.pageNumber,
      globalWords,
    );
    const tableBlocks = mapTablesToBlocks(response, page.pageNumber);
    const mergedBlocks = dedupeRepeatedHeadersFooters(
      [...paragraphBlocks, ...tableBlocks].sort((a, b) => a.order - b.order),
    );

    const contentBlocks = mergedBlocks.filter(
      (block) =>
        block.kind !== "noise" &&
        block.kind !== "footer" &&
        block.kind !== "header",
    );
    const headerBlocks = mergedBlocks.filter(
      (block) => block.kind === "header",
    );
    const footerBlocks = mergedBlocks.filter(
      (block) => block.kind === "footer",
    );

    const warnings: string[] = [];
    if (mergedBlocks.some((block) => block.kind === "noise")) {
      warnings.push("suppressed scanner/logo noise");
    }

    return {
      pageNumber: page.pageNumber,
      header:
        headerBlocks
          .map((block) => block.text)
          .filter(Boolean)
          .join("\n") || null,
      footer:
        footerBlocks
          .map((block) => block.text)
          .filter(Boolean)
          .join("\n") || null,
      blocks: mergedBlocks.filter((block) => block.kind !== "noise"),
      fullText: contentBlocks
        .map((block) => block.text)
        .filter(Boolean)
        .join("\n\n"),
      warnings,
    } satisfies NormalizedPage;
  });

  const fullText = pages
    .map((page) => page.fullText)
    .filter(Boolean)
    .join("\n\n");
  return {
    provider: "azure-layout",
    pipelineVersion: 2,
    // Title precedence: explicit hint from the user wins; otherwise we
    // fall back to a cleaned filename so downstream consumers (chunking,
    // chat context) always see SOMETHING reasonable instead of `null`.
    title:
      preferences?.titleHint?.trim() ||
      fileName.replace(/\.pdf$/i, "").trim() ||
      null,
    languageHint: preferences?.languageHint || null,
    pages,
    fullText,
    warnings: pages.flatMap((page) =>
      page.warnings.map((warning) => `page ${page.pageNumber}: ${warning}`),
    ),
  };
}

function titleFromNormalizedDocument(
  normalized: NormalizedDocumentArtifact,
  fileName: string,
): string {
  const titleBlock = normalized.pages
    .flatMap((page) => page.blocks)
    .find((block) => block.kind === "title" || block.kind === "heading");
  return (
    titleBlock?.text || fileName.replace(/\.pdf$/i, "") || "Untitled document"
  );
}

function guessDocumentType(text: string): DocumentType {
  const memoSignals = [
    /الموضوع/,
    /مرفقات/,
    /صورة إلى|نسخة إلى|صورة مرفقة|صورة طبق الأصل/,
    /السيد|السيدة/,
    /تحية طيبة/,
    /وتفضلوا بقبول/,
    /\bsubject:\b/i,
    /\bcc:\b/i,
    /\bdear\b/i,
    /\bkind regards\b/i,
  ].filter((pattern) => pattern.test(text)).length;

  if (memoSignals >= 2) return "memo";
  if (
    /عقد|الطرف الأول|الطرف الثاني|مذكرة تفاهم|\bcontract\b|\bmemorandum of understanding\b|\bmou\b/i.test(
      text,
    )
  )
    return "contract";
  if (
    /الإيرادات|المصروفات|الميزانية|القوائم المالية|\brevenue\b|\bexpenses\b|\bfinancial statements?\b|\bbalance sheet\b/i.test(
      text,
    )
  )
    return "financial";
  if (
    /تقرير|الملخص التنفيذي|الدراسة|\bbrief\b|\broadmap\b|\breport\b|\boverview\b|\bexecutive summary\b/i.test(
      text,
    )
  )
    return "report";
  if (
    /سياسة|استراتيجية|الرؤية|الرسالة|\bpolicy\b|\bstrategy\b|\bstrategic\b|\bframework\b/i.test(
      text,
    )
  )
    return "policy";
  if (
    /قرار رئيس مجلس الوزراء|مرسوم|قرار وزاري|\bdecree\b|\bministerial decision\b/i.test(
      text,
    )
  )
    return "decree";
  if (
    /مشروع قانون|القانون رقم|المادة\s*\(|\barticle\s+\d+|\bdraft law\b/i.test(
      text,
    )
  )
    return "law";
  return "other";
}

function detectLanguage(
  text: string,
  hint: LanguageCode | null | undefined,
): LanguageCode {
  if (hint) return hint;
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const latinChars = (text.match(/[A-Za-z]/g) || []).length;
  if (arabicChars > 0 && latinChars > 0) return "mixed";
  if (arabicChars > 0) return "ar";
  return "en";
}

function classifyNormalizedDocument(
  normalized: NormalizedDocumentArtifact,
  fileName: string,
  preferences?: ExtractionPreferences,
): DocumentClassification {
  const text = normalized.fullText;
  const hintedType = preferences?.documentTypeHint;
  const documentType = hintedType || guessDocumentType(text);
  return {
    documentType,
    title: titleFromNormalizedDocument(normalized, fileName),
    language: detectLanguage(text, normalized.languageHint),
    confidence: hintedType ? 1 : 0.8,
  };
}

function extractDates(text: string): string[] {
  const structuredDates = extractNormalizedDates(text);
  if (structuredDates.length > 0) {
    return [
      ...new Set(
        structuredDates
          .map((date) => date.original || date.iso || "")
          .filter(Boolean),
      ),
    ];
  }

  return [...new Set(normalizeNumbers(text).match(ARABIC_DATE_RE) || [])];
}

/**
 * Sector inference is the only domain heuristic kept from the previous
 * extraction pipeline — it just looks at the document text for known
 * Egyptian sector keywords and returns a category label. Entity
 * extraction itself moved to `entity-extraction-llm.ts` (gpt-4o-mini
 * structured output) which fixes the prose-as-entity, split, merged,
 * and wrong-type bugs the regex pipeline produced.
 */
function inferSector(fullText: string): string | undefined {
  const text = normalizeNumbers(fullText);
  if (/المحاجر|الملاحات|الثروة المعدنية|التعدين|المناجم/.test(text)) {
    return "المعادن والمحاجر";
  }
  if (/الكهرباء|الطاقة|الطاقة المتجددة|الطاقة الشمسية/.test(text)) {
    return "الطاقة";
  }
  if (/الإسكان|المجتمعات العمرانية|العمران/.test(text)) {
    return "العمران والإسكان";
  }
  return undefined;
}

function collectRecommendationSections(text: string): Array<{
  label: string;
  content: string;
}> {
  const normalized = text.replace(/\r/g, "");
  const matches = [
    ...normalized.matchAll(
      /(?:^|\n)\s*(أولاً|ثانياً|ثالثاً|رابعاً|خامساً|سادساً)\s*[:：-]?\s*/g,
    ),
  ];
  if (matches.length === 0) return [];

  return matches
    .map((match, index) => {
      const start = match.index ?? 0;
      const nextStart =
        index + 1 < matches.length
          ? (matches[index + 1].index ?? normalized.length)
          : normalized.length;
      const label = match[1];
      const content = normalized
        .slice(start + match[0].length, nextStart)
        .trim();
      return { label, content };
    })
    .filter((item) => item.content.length > 0);
}

function splitLinesAsSubItems(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => collapseWhitespace(line))
    .filter(
      (line) =>
        /^[-•]\s+/.test(line) || /^(?:\d+|[A-Za-zأ-ي])[.)-]\s*/.test(line),
    );
}

function inferPageTypeForMemo(
  sections: ExtractedSection[],
): ExtractedPage["pageType"] {
  if (sections.length === 0) return "blank";
  const signatureLikeCount = sections.filter((section) =>
    ["signature", "cc", "attachment"].includes(section.type),
  ).length;
  if (signatureLikeCount >= Math.max(2, Math.ceil(sections.length / 2))) {
    return "signature";
  }
  const hasBody = sections.some((section) =>
    ["body", "recommendation", "analysis", "background"].includes(section.type),
  );
  return hasBody ? "body" : "cover";
}

function inferPageTypeForLaw(
  sections: ExtractedSection[],
  pageNumber: number,
): ExtractedPage["pageType"] {
  if (sections.length === 0) return "blank";
  const hasArticles = sections.some((section) => section.type === "article");
  if (!hasArticles && pageNumber === 1) return "cover";
  return "body";
}

function extractArticleHeaderAndBody(text: string): {
  clauseNumber: string;
  body: string;
} | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const lines = trimmed
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstLine = lines[0] || trimmed;
  if (!/^(المادة|مادة)\s*/.test(firstLine)) return null;

  const rest = lines.slice(1).join("\n\n").trim();
  return {
    clauseNumber: firstLine,
    body: rest,
  };
}

function buildLawPages(
  normalized: NormalizedDocumentArtifact,
  language: LanguageCode,
): ExtractedPage[] {
  return normalized.pages.map((page) => {
    const sections: ExtractedSection[] = [];
    let currentArticle: ExtractedSection | null = null;

    for (const block of page.blocks) {
      if (block.kind === "table" && block.table) {
        if (currentArticle) {
          sections.push(currentArticle);
          currentArticle = null;
        }
        sections.push({
          clauseNumber: null,
          title: null,
          content: JSON.stringify(block.table),
          type: "table",
          subItems: [],
          confidence: block.confidence ?? null,
          table: block.table,
        });
        continue;
      }

      const text = block.text;
      if (!text) continue;

      if (block.kind === "title" && sections.length === 0) {
        sections.push({
          clauseNumber: null,
          title: text,
          content: text,
          type: "preamble",
          subItems: [],
          confidence: block.confidence ?? null,
        });
        continue;
      }

      const parsedInlineArticle = extractArticleHeaderAndBody(text);
      const articleMatch = text.match(/^(المادة|مادة)\s*(.+)$/);
      if ((block.kind === "heading" && articleMatch) || parsedInlineArticle) {
        if (currentArticle) sections.push(currentArticle);
        currentArticle = {
          clauseNumber:
            parsedInlineArticle?.clauseNumber || articleMatch?.[0] || text,
          title: null,
          content: parsedInlineArticle?.body || "",
          type: "article",
          subItems: [],
          confidence: block.confidence ?? null,
        };
        continue;
      }

      if (currentArticle) {
        currentArticle.content = currentArticle.content
          ? `${currentArticle.content}\n\n${text}`
          : text;
      } else {
        sections.push({
          clauseNumber: null,
          title: block.kind === "heading" ? text : null,
          content: text,
          type: block.kind === "heading" ? "clause" : "body",
          subItems: [],
          confidence: block.confidence ?? null,
        });
      }
    }

    if (currentArticle) sections.push(currentArticle);

    const finalizedSections = sections.map((section) => {
      if (section.type !== "article") return section;
      const recommendations = collectRecommendationSections(section.content);
      return {
        ...section,
        subItems:
          recommendations.length > 0
            ? recommendations.map((item) => `${item.label}: ${item.content}`)
            : splitLinesAsSubItems(section.content),
      };
    });

    return {
      pageNumber: page.pageNumber,
      header: page.header,
      footer: page.footer,
      sections: finalizedSections,
      language,
      pageType: inferPageTypeForLaw(finalizedSections, page.pageNumber),
    } satisfies ExtractedPage;
  });
}

function buildMemoPages(
  normalized: NormalizedDocumentArtifact,
  language: LanguageCode,
): ExtractedPage[] {
  return normalized.pages.map((page) => {
    const sections: ExtractedSection[] = [];

    for (const block of page.blocks) {
      if (block.kind === "header" || block.kind === "footer") continue;

      if (block.kind === "table" && block.table) {
        sections.push({
          clauseNumber: null,
          title: null,
          content: JSON.stringify(block.table),
          type: "table",
          subItems: [],
          confidence: block.confidence ?? null,
          table: block.table,
        });
        continue;
      }

      const text = block.text.trim();
      if (!text) continue;

      const recommendations = collectRecommendationSections(text);
      if (recommendations.length > 0) {
        for (const item of recommendations) {
          sections.push({
            clauseNumber: item.label,
            title: item.label,
            content: item.content,
            type: "recommendation",
            subItems: [],
            confidence: block.confidence ?? null,
          });
        }
        continue;
      }

      const subItems = splitLinesAsSubItems(text).map((item) =>
        item.replace(/^[-•]\s*/, ""),
      );

      let type: ExtractedSection["type"] = "body";
      let title: string | null = null;

      if (/^الموضوع/.test(text)) {
        type = "subject";
        title = text;
      } else if (/^مرفقات/.test(text)) {
        type = "attachment";
      } else if (
        /^(صورة إلى|نسخة إلى|صورة مرفقة|صورة طبق الأصل)/.test(text) ||
        subItems.length > 0
      ) {
        type = "cc";
      } else if (
        /^(تحية طيبة|السيد|السيدة)/.test(text) ||
        block.kind === "title"
      ) {
        type = "header_block";
        title = block.kind === "title" ? text : null;
      } else if (/^(وتفضلوا|يرجى التفضل|نأمل|مع خالص|مع وافر)/.test(text)) {
        type = "conclusion";
      } else if (
        block.kind === "signature" ||
        /^(رئيس|المستشار|الوزير|المدير|نائب)/.test(text)
      ) {
        type = "signature";
      } else if (block.kind === "heading") {
        type = "header_block";
        title = text;
      }

      sections.push({
        clauseNumber: null,
        title,
        content: text,
        type,
        subItems: type === "cc" ? subItems : [],
        confidence: block.confidence ?? null,
      });
    }

    return {
      pageNumber: page.pageNumber,
      header: page.header,
      footer: page.footer,
      sections,
      language,
      pageType: inferPageTypeForMemo(sections),
    } satisfies ExtractedPage;
  });
}

function buildGenericPages(
  normalized: NormalizedDocumentArtifact,
  documentType: DocumentType,
  language: LanguageCode,
): ExtractedPage[] {
  return normalized.pages.map((page) => {
    const sections: ExtractedSection[] = page.blocks
      .filter((block) => block.kind !== "header" && block.kind !== "footer")
      .flatMap<ExtractedSection>((block) => {
        if (!block.text && !block.table) return [];

        if (block.kind === "table" && block.table) {
          return [
            {
              clauseNumber: null,
              title: null,
              content: JSON.stringify(block.table),
              type: "table" as const,
              subItems: [],
              confidence: block.confidence ?? null,
              table: block.table,
            },
          ];
        }

        const trimmed = block.text.trim();
        if (!trimmed) return [];

        let type: ExtractedSection["type"] = "body";
        if (block.kind === "signature") {
          type = "signature";
        } else if (documentType === "memo") {
          if (/^الموضوع/.test(trimmed)) type = "subject";
          else if (/^مرفقات/.test(trimmed)) type = "attachment";
          else if (/^(صورة إلى|نسخة إلى)/.test(trimmed)) type = "cc";
          else if (
            /(رئيس|المستشار|وزير|مدير)/.test(trimmed) &&
            block.kind === "heading"
          )
            type = "signature";
          else if (block.kind === "title" || block.kind === "heading")
            type = "header_block";
        } else if (documentType === "letter") {
          if (/^الموضوع/.test(trimmed)) type = "subject";
          else if (/^(صورة إلى|نسخة إلى)/.test(trimmed)) type = "cc";
          else if (/(وتفضلوا|مع خالص|مع وافر)/.test(trimmed))
            type = "signature";
        } else if (block.kind === "heading") {
          type = "clause";
        }

        return [
          {
            clauseNumber: null,
            title:
              block.kind === "heading" || block.kind === "title"
                ? trimmed
                : null,
            content: trimmed,
            type,
            subItems: [],
            confidence: block.confidence ?? null,
          },
        ];
      });

    return {
      pageNumber: page.pageNumber,
      header: page.header,
      footer: page.footer,
      sections,
      language,
      pageType: sections.length === 0 ? "blank" : "body",
    } satisfies ExtractedPage;
  });
}

export function buildStructuredDocumentFromNormalized({
  normalized,
  fileName,
  preferences,
}: {
  normalized: NormalizedDocumentArtifact;
  fileName: string;
  preferences?: ExtractionPreferences;
}): {
  classification: DocumentClassification;
  pages: ExtractedPage[];
  metadata: ExtractionMetadata;
  validation: ReturnType<typeof validateExtraction>;
  referencedLaws: string[];
} {
  const classification = classifyNormalizedDocument(
    normalized,
    fileName,
    preferences,
  );
  const pages =
    classification.documentType === "law" ||
    classification.documentType === "decree"
      ? buildLawPages(normalized, classification.language)
      : classification.documentType === "memo" ||
          classification.documentType === "letter"
        ? buildMemoPages(normalized, classification.language)
        : buildGenericPages(
            normalized,
            classification.documentType,
            classification.language,
          );
  const fullText = pages
    .flatMap((page) => page.sections.map((section) => section.content))
    .join("\n\n");
  const references = detectReferences(fullText);
  const sector = inferSector(fullText);

  const metadata: ExtractionMetadata = {
    dates: extractDates(fullText),
    // Entities are populated downstream by the LLM extractor (see
    // src/lib/entity-extraction-llm.ts) and canonicalized via embeddings
    // in src/lib/entities.ts. The old regex pipeline is gone.
    entities: [],
    ...(sector ? { sector } : {}),
    references: references.map((reference) => ({
      text: reference.text,
      type: reference.type,
    })),
  };

  return {
    classification,
    pages,
    metadata,
    validation: validateExtraction(pages, classification.documentType),
    referencedLaws: references
      .filter(
        (reference) => reference.type === "law" || reference.type === "decree",
      )
      .map((reference) => reference.text),
  };
}
