import type {
  AzureDocumentIntelligenceResponse,
  AzureLayoutParagraph,
  AzureLayoutTable,
  NormalizedBlock,
  NormalizedBlockKind,
  NormalizedDocumentArtifact,
  NormalizedPage,
  NormalizedTable,
  RawOcrArtifact,
} from "@/lib/extraction-v2-schema";
import type {
  DocumentClassification,
  DocumentType,
  ExtractedPage,
  ExtractedSection,
  ExtractionMetadata,
  ExtractionPreferences,
  LanguageCode,
} from "@/lib/extraction-schema";
import { validateExtraction } from "@/lib/extraction-validation";
import { extractDates as extractNormalizedDates, normalizeNumbers } from "@/lib/normalize";
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
  if (["pageHeader", "pageFooter", "pageNumber", "title", "sectionHeading"].includes(role || "")) {
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
  const nearSide = bounds.maxX <= pageWidth * 0.28 || bounds.minX >= pageWidth * 0.72;
  const verticalish = bounds.height > bounds.width * 1.8;

  if (rotated && veryShortText && (nearTop || nearBottom || nearSide || verticalish)) return true;
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

function blockKindFromRole(role: string | undefined, text: string): NormalizedBlockKind {
  if (isNoiseText(text)) return "noise";
  const normalized = collapseWhitespace(stripInlinePageFurniture(text));
  const looksLikeBodyText =
    normalized.length > 180 ||
    normalized.split(/\s+/).length > 28 ||
    /القانون|الاتفاقية|المحاجر|الملاحات|المنطقة الاقتصادية|تتولى|تختص|shall|agreement/i.test(
      normalized,
    );

  if (["pageHeader", "pageFooter", "pageNumber"].includes(role || "") && looksLikeBodyText) {
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
    if (rows[cell.rowIndex] && rows[cell.rowIndex][cell.columnIndex] !== undefined) {
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
    .filter((row, index) => !(index === 0 && headerRow.length > 0));

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
): NormalizedBlock[] {
  const page = (response.analyzeResult?.pages || []).find((candidate) => candidate.pageNumber === pageNumber);
  const paragraphs = (response.analyzeResult?.paragraphs || [])
    .filter((paragraph) =>
      pageNumbersFromRegions(paragraph.boundingRegions).includes(pageNumber),
    )
    .sort((a, b) => paragraphOrder(a) - paragraphOrder(b));

  return paragraphs.map((paragraph, index) => {
    const polygon = paragraph.boundingRegions?.[0]?.polygon;
    const cleanedText = collapseWhitespace(stripInlinePageFurniture(paragraph.content));
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

    return {
      id: `p-${pageNumber}-${index}`,
      pageNumber,
      kind,
      text: cleanedText,
      role: paragraph.role || null,
      polygon,
      order: paragraphOrder(paragraph),
    };
  });
}

function mapTablesToBlocks(
  response: AzureDocumentIntelligenceResponse,
  pageNumber: number,
): NormalizedBlock[] {
  const tables = (response.analyzeResult?.tables || [])
    .filter((table) => pageNumbersFromRegions(table.boundingRegions).includes(pageNumber))
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
        order: table.spans?.[0]?.offset ?? Number.MAX_SAFE_INTEGER - (1000 - index),
        table: normalizedTable,
      };
    })
    .filter((table): table is NonNullable<typeof table> => Boolean(table));

  return tables;
}

function dedupeRepeatedHeadersFooters(blocks: NormalizedBlock[]): NormalizedBlock[] {
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
  const pages = (response.analyzeResult?.pages || []).map((page) => {
    const paragraphBlocks = mapParagraphsToBlocks(response, page.pageNumber);
    const tableBlocks = mapTablesToBlocks(response, page.pageNumber);
    const mergedBlocks = dedupeRepeatedHeadersFooters(
      [...paragraphBlocks, ...tableBlocks].sort((a, b) => a.order - b.order),
    );

    const contentBlocks = mergedBlocks.filter(
      (block) => block.kind !== "noise" && block.kind !== "footer" && block.kind !== "header",
    );
    const headerBlocks = mergedBlocks.filter((block) => block.kind === "header");
    const footerBlocks = mergedBlocks.filter((block) => block.kind === "footer");

    const warnings: string[] = [];
    if (mergedBlocks.some((block) => block.kind === "noise")) {
      warnings.push("suppressed scanner/logo noise");
    }

    return {
      pageNumber: page.pageNumber,
      header:
        headerBlocks.map((block) => block.text).filter(Boolean).join("\n") || null,
      footer:
        footerBlocks.map((block) => block.text).filter(Boolean).join("\n") || null,
      blocks: mergedBlocks.filter((block) => block.kind !== "noise"),
      fullText: contentBlocks.map((block) => block.text).filter(Boolean).join("\n\n"),
      warnings,
    } satisfies NormalizedPage;
  });

  const fullText = pages.map((page) => page.fullText).filter(Boolean).join("\n\n");
  return {
    provider: "azure-layout",
    pipelineVersion: 2,
    title: preferences?.titleHint?.trim() || null,
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
  return titleBlock?.text || fileName.replace(/\.pdf$/i, "") || "Untitled document";
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
  if (/عقد|الطرف الأول|الطرف الثاني|مذكرة تفاهم|\bcontract\b|\bmemorandum of understanding\b|\bmou\b/i.test(text)) return "contract";
  if (/الإيرادات|المصروفات|الميزانية|القوائم المالية|\brevenue\b|\bexpenses\b|\bfinancial statements?\b|\bbalance sheet\b/i.test(text)) return "financial";
  if (/تقرير|الملخص التنفيذي|الدراسة|\bbrief\b|\broadmap\b|\breport\b|\boverview\b|\bexecutive summary\b/i.test(text)) return "report";
  if (/سياسة|استراتيجية|الرؤية|الرسالة|\bpolicy\b|\bstrategy\b|\bstrategic\b|\bframework\b/i.test(text)) return "policy";
  if (/قرار رئيس مجلس الوزراء|مرسوم|قرار وزاري|\bdecree\b|\bministerial decision\b/i.test(text)) return "decree";
  if (/مشروع قانون|القانون رقم|المادة\s*\(|\barticle\s+\d+|\bdraft law\b/i.test(text)) return "law";
  return "other";
}

function detectLanguage(text: string, hint: LanguageCode | null | undefined): LanguageCode {
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

function isArabicNameish(text: string): boolean {
  return /^[\u0600-\u06FF0-9\s\-\/()]+$/.test(text);
}

function cleanEntityName(text: string): string {
  return collapseWhitespace(text.replace(/[.:،؛]+$/g, ""));
}

const EXACT_ENTITY_PATTERNS: Array<{ regex: RegExp; type: string }> = [
  {
    regex: /الهيئة العامة للمنطقة الاقتصادية للمث(?:لث|ست)\s+الذهبي/g,
    type: "authority",
  },
  { regex: /هيئة مستشار[ىي] مجلس الوزراء/g, type: "authority" },
  { regex: /هيئة المجتمعات العمرانية الجديدة/g, type: "authority" },
  {
    regex: /الشركة المصرية للتعدين وإدارة واستغلال المحاجر والملاحات/g,
    type: "company",
  },
  { regex: /وزارة البترول والثروة المعدنية/g, type: "ministry" },
  { regex: /وزارة التنمية المحلية(?: والبيئة)?/g, type: "ministry" },
  { regex: /وزارة الإسكان والمرافق والمجتمعات العمرانية/g, type: "ministry" },
  { regex: /وزارة الدفاع/g, type: "ministry" },
  { regex: /رئاسة مجلس الوزراء/g, type: "authority" },
  { regex: /مجلس الوزراء/g, type: "authority" },
  { regex: /المنطقة الاقتصادية للمث(?:لث|ست)\s+الذهبي/g, type: "place" },
];

const GENERIC_ENTITY_PATTERNS: Array<{ regex: RegExp; type: string }> = [
  { regex: /(وزارة\s+[^\n،؛:().%٪]{2,100})/g, type: "ministry" },
  { regex: /(الهيئة\s+[^\n،؛:().%٪]{2,120})/g, type: "authority" },
  { regex: /(هيئة\s+[^\n،؛:().%٪]{2,120})/g, type: "authority" },
  { regex: /(الشركة\s+[^\n،؛:().%٪]{2,140})/g, type: "company" },
  { regex: /(محافظة\s+[^\n،؛:().%٪]{2,60})/g, type: "place" },
  { regex: /(المنطقة الاقتصادية\s+[^\n،؛:().%٪]{2,90})/g, type: "place" },
];

const ENTITY_STOP_PHRASES = [
  /للتفضل بالإحاطة/i,
  /وتحية طيبة(?: وبعد)?/i,
  /تحية طيبة(?: وبعد)?/i,
  /احترام وتقدير[ىي]/i,
  /قد أعدت/i,
  /قد اعدت/i,
  /في شأن/i,
  /بشأن/i,
  /وفق(?:اً|ا)\s+/i,
  /بموجب/i,
  /إذ\s+/i,
  /إذا\s+/i,
  /وذلك/i,
  /والتي/i,
  /التي/i,
  /الواقع(?:ة)?/i,
  /اعتبار(?:اً|ا)/i,
  /لحين/i,
  /حق استغلال/i,
  /استغلال\s+/i,
  /إدارة\s+/i,
  /المعروض/i,
  /المذكور(?:ة)?/i,
  /المشار إليه(?:ا)?/i,
  /لا يمتد/i,
  /ومن ثم/i,
  /على منح/i,
];

const ANY_DIGIT_RE = /[0-9\u0660-\u0669]/;

function trimEntityCandidate(raw: string, type: string): string | null {
  let candidate = collapseWhitespace(stripInlinePageFurniture(raw));
  if (!candidate) return null;

  candidate = candidate
    .replace(/^[\-–•*]+\s*/, "")
    .replace(
      /^(?:السيد|السيدة|معالي|الأستاذ|الأستاذة|الدكتور|الدكتورة|المهندس|المهندسة|اللواء)\s*\/?\s*/u,
      "",
    )
    .replace(/[،؛,:.].*$/u, "");

  for (const pattern of ENTITY_STOP_PHRASES) {
    candidate = candidate.replace(new RegExp(`\\s+${pattern.source}.*$`, pattern.flags), "");
  }

  candidate = candidate
    .replace(/\s+\(?[0-9\u0660-\u0669]+(?:[%٪)]|\/[0-9\u0660-\u0669]+.*)?$/u, "")
    .replace(/\s+(?:من|في|على|إلى|الى|عن|مع|بشأن|بشان)$/u, "")
    .replace(/\s+و$/u, "")
    .trim();

  if (!candidate) return null;
  if (/%|٪/.test(candidate) || ANY_DIGIT_RE.test(candidate)) return null;
  if (/(?:تحية|احترام|تقدير|وبعد|الرمن|الإدارة)/u.test(candidate)) return null;

  const words = candidate.split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  if (words.length > (type === "company" ? 10 : 8)) return null;

  const secondToken = words[1] || "";
  if (["ministry", "authority", "company"].includes(type)) {
    const allowedSecondToken =
      /^ال/u.test(secondToken) ||
      /^(?:مستشار[ىي]|العامة|المصرية|مجلس|المجتمعات|الثروة|المنطقة|الدفاع)$/u.test(
        secondToken,
      );
    if (!allowedSecondToken) return null;
  }

  if (!isArabicNameish(candidate)) return null;
  return cleanEntityName(candidate);
}

function addEntityCandidate(
  entities: Array<{ name: string; type: string; nameEn?: string }>,
  seen: Set<string>,
  raw: string,
  type: string,
) {
  const candidate = trimEntityCandidate(raw, type);
  if (!candidate) return;

  const key = `${type}:${normalizeNumbers(candidate)}`;
  if (seen.has(key)) return;
  seen.add(key);
  entities.push({ name: candidate, type });
}

function entitySourceSnippets(normalized: NormalizedDocumentArtifact): string[] {
  const snippets: string[] = [];
  for (const page of normalized.pages) {
    if (page.header) snippets.push(page.header);
    for (const block of page.blocks) {
      if (["noise", "footer", "table"].includes(block.kind)) continue;
      if (
        !["title", "heading", "header", "signature"].includes(block.kind) &&
        block.text.length > 160
      ) {
        continue;
      }
      snippets.push(block.text);
    }
  }
  return snippets;
}

function extractEntities(
  normalized: NormalizedDocumentArtifact,
  fullText: string,
): Array<{ name: string; type: string; nameEn?: string }> {
  const seen = new Set<string>();
  const entities: Array<{ name: string; type: string; nameEn?: string }> = [];

  for (const { regex, type } of EXACT_ENTITY_PATTERNS) {
    for (const match of fullText.matchAll(regex)) {
      addEntityCandidate(entities, seen, match[0], type);
    }
  }

  for (const snippet of entitySourceSnippets(normalized)) {
    const lines = snippet
      .split(/\n+/)
      .map((line) => collapseWhitespace(line))
      .filter(Boolean);

    for (const line of lines) {
      if (line.length > 220) continue;
      for (const { regex, type } of GENERIC_ENTITY_PATTERNS) {
        for (const match of line.matchAll(regex)) {
          addEntityCandidate(entities, seen, match[1] || match[0], type);
        }
      }
    }
  }

  return entities;
}

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

function extractParties(
  entities: Array<{ name: string; type: string; nameEn?: string }>,
): string[] | undefined {
  const parties = entities
    .filter((entity) =>
      ["company", "authority", "ministry", "organization"].includes(entity.type),
    )
    .map((entity) => entity.name);

  return parties.length > 0 ? [...new Set(parties)] : undefined;
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
      const content = normalized.slice(start + match[0].length, nextStart).trim();
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

function inferPageTypeForMemo(sections: ExtractedSection[]): ExtractedPage["pageType"] {
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

  const lines = trimmed.split(/\n+/).map((line) => line.trim()).filter(Boolean);
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
          confidence: 1,
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
          confidence: 1,
        });
        continue;
      }

      const parsedInlineArticle = extractArticleHeaderAndBody(text);
      const articleMatch = text.match(/^(المادة|مادة)\s*(.+)$/);
      if ((block.kind === "heading" && articleMatch) || parsedInlineArticle) {
        if (currentArticle) sections.push(currentArticle);
        currentArticle = {
          clauseNumber: parsedInlineArticle?.clauseNumber || articleMatch?.[0] || text,
          title: null,
          content: parsedInlineArticle?.body || "",
          type: "article",
          subItems: [],
          confidence: 1,
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
          confidence: 1,
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
          confidence: 1,
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
            confidence: 1,
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
      } else if (/^(تحية طيبة|السيد|السيدة)/.test(text) || block.kind === "title") {
        type = "header_block";
        title = block.kind === "title" ? text : null;
      } else if (/^(وتفضلوا|يرجى التفضل|نأمل|مع خالص|مع وافر)/.test(text)) {
        type = "conclusion";
      } else if (block.kind === "signature" || /^(رئيس|المستشار|الوزير|المدير|نائب)/.test(text)) {
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
        confidence: 1,
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
              confidence: 1,
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
          else if (/(رئيس|المستشار|وزير|مدير)/.test(trimmed) && block.kind === "heading") type = "signature";
          else if (block.kind === "title" || block.kind === "heading") type = "header_block";
        } else if (documentType === "letter") {
          if (/^الموضوع/.test(trimmed)) type = "subject";
          else if (/^(صورة إلى|نسخة إلى)/.test(trimmed)) type = "cc";
          else if (/(وتفضلوا|مع خالص|مع وافر)/.test(trimmed)) type = "signature";
        } else if (block.kind === "heading") {
          type = "clause";
        }

        return [
          {
            clauseNumber: null,
            title: block.kind === "heading" || block.kind === "title" ? trimmed : null,
            content: trimmed,
            type,
            subItems: [],
            confidence: 1,
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
  const classification = classifyNormalizedDocument(normalized, fileName, preferences);
  const pages =
    classification.documentType === "law" || classification.documentType === "decree"
      ? buildLawPages(normalized, classification.language)
      : classification.documentType === "memo" || classification.documentType === "letter"
        ? buildMemoPages(normalized, classification.language)
      : buildGenericPages(normalized, classification.documentType, classification.language);
  const fullText = pages.flatMap((page) => page.sections.map((section) => section.content)).join("\n\n");
  const references = detectReferences(fullText);
  const entities = extractEntities(normalized, fullText);
  const parties = extractParties(entities);
  const sector = inferSector(fullText);

  const metadata: ExtractionMetadata = {
    dates: extractDates(fullText),
    entities,
    ...(parties ? { parties } : {}),
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
      .filter((reference) => reference.type === "law" || reference.type === "decree")
      .map((reference) => reference.text),
  };
}
