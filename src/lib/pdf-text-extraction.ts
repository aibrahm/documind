import { PDFParse } from "pdf-parse";
import type {
  NormalizedBlock,
  NormalizedDocumentArtifact,
  NormalizedPage,
  RawOcrArtifact,
} from "@/lib/extraction-v2-schema";
import type { ExtractionPreferences, LanguageCode } from "@/lib/extraction-schema";

const PAGE_MARKER_RE = /--\s*\d+\s*of\s*\d+\s*--/gi;
const NOISE_PATTERNS = [
  /^scanned with$/i,
  /^camscanner®?$/i,
  /^cs$/i,
  /^rd\s*\d{4}/i,
];

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeMultilineText(text: string): string {
  return text
    .replace(PAGE_MARKER_RE, "\n")
    .replace(/\r/g, "")
    .replace(/\u0000/g, "")
    .trim();
}

function isNoiseText(text: string): boolean {
  const normalized = collapseWhitespace(text);
  if (!normalized) return true;
  return NOISE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function detectLanguage(text: string, hint: LanguageCode | null | undefined): LanguageCode {
  if (hint) return hint;
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const latinChars = (text.match(/[A-Za-z]/g) || []).length;
  if (arabicChars > 0 && latinChars > 0) return "mixed";
  if (arabicChars > 0) return "ar";
  return "en";
}

export function isConfidentNativeTextLaneCandidate(
  normalized: NormalizedDocumentArtifact | null | undefined,
  preferences?: ExtractionPreferences,
): boolean {
  if (!normalized) return false;

  if (preferences?.mode === "high_fidelity" || preferences?.mode === "verbatim_legal") {
    return false;
  }

  if (preferences?.languageHint === "ar" || preferences?.languageHint === "mixed") {
    return false;
  }

  const text = normalized.fullText || "";
  const latinChars = (text.match(/[A-Za-z]/g) || []).length;
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const digitChars = (text.match(/[0-9\u0660-\u0669]/g) || []).length;

  if (latinChars < 400) return false;
  if (arabicChars > 8) return false;
  if (normalized.languageHint !== "en") return false;

  const languageSignal = latinChars / Math.max(1, latinChars + arabicChars + digitChars);
  return languageSignal >= 0.65;
}

function looksLikeTitle(line: string, lineIndex: number): boolean {
  if (lineIndex > 12) return false;
  if (line.length > 140) return false;
  return /(مشروع قانون|قرار|مذكرة|تقرير|دراسة|اتفاقية|عقد|محضر|مستشار|هيئة|وزارة|brief|roadmap|presentation|strategy|strategic|plan|overview|summary|proposal|report|memo|letter)/i.test(
    line,
  );
}

function looksLikeHeading(line: string): boolean {
  return (
    /^(المادة|مادة|الفصل|الباب|الجزء|الموضوع|أولاً|ثانياً|ثالثاً|رابعاً|خامساً|سادساً|سابعاً)/.test(
      line,
    ) ||
    /[:：]$/.test(line)
  );
}

function looksLikeSignature(line: string): boolean {
  if (line.length > 120) return false;
  return /^(رئيس|المستشار|المدير|الوزير|نائب|Chairman|Vice Chairman|Kind regards|Regards)/i.test(
    line,
  );
}

function buildTextBlocks(pageNumber: number, pageText: string): NormalizedBlock[] {
  const lines = normalizeMultilineText(pageText)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const blocks: NormalizedBlock[] = [];
  let paragraphLines: string[] = [];
  let order = 0;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const text = collapseWhitespace(paragraphLines.join(" "));
    if (text) {
      blocks.push({
        id: `p-${pageNumber}-${order}`,
        pageNumber,
        kind: "paragraph",
        text,
        role: "paragraph",
        order,
      });
      order += 1;
    }
    paragraphLines = [];
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (!line || isNoiseText(line)) {
      flushParagraph();
      continue;
    }

    if (looksLikeTitle(line, lineIndex)) {
      flushParagraph();
      blocks.push({
        id: `t-${pageNumber}-${order}`,
        pageNumber,
        kind: "title",
        text: line,
        role: "title",
        order,
      });
      order += 1;
      continue;
    }

    if (looksLikeHeading(line)) {
      flushParagraph();
      blocks.push({
        id: `h-${pageNumber}-${order}`,
        pageNumber,
        kind: "heading",
        text: line,
        role: "heading",
        order,
      });
      order += 1;
      continue;
    }

    if (looksLikeSignature(line)) {
      flushParagraph();
      blocks.push({
        id: `s-${pageNumber}-${order}`,
        pageNumber,
        kind: "signature",
        text: line,
        role: "signature",
        order,
      });
      order += 1;
      continue;
    }

    paragraphLines.push(line);
  }

  flushParagraph();
  return blocks;
}

function promoteRepeatedPageFurniture(pages: NormalizedPage[]): NormalizedPage[] {
  const firstBlockCounts = new Map<string, number>();
  const lastBlockCounts = new Map<string, number>();

  for (const page of pages) {
    const meaningful = page.blocks.filter((block) => block.kind !== "noise");
    const first = meaningful[0]?.text;
    const last = meaningful.at(-1)?.text;
    if (first && first.length <= 180) {
      firstBlockCounts.set(first, (firstBlockCounts.get(first) || 0) + 1);
    }
    if (last && last.length <= 180) {
      lastBlockCounts.set(last, (lastBlockCounts.get(last) || 0) + 1);
    }
  }

  return pages.map((page) => {
    const blocks = page.blocks.map((block, index, pageBlocks) => {
      const isFirst = index === 0;
      const isLast = index === pageBlocks.length - 1;
      if (
        isFirst &&
        firstBlockCounts.get(block.text)! >= 2 &&
        block.kind === "paragraph"
      ) {
        return { ...block, kind: "header" as const, role: "header" };
      }
      if (
        isLast &&
        lastBlockCounts.get(block.text)! >= 2 &&
        block.kind === "paragraph"
      ) {
        return { ...block, kind: "footer" as const, role: "footer" };
      }
      return block;
    });

    const header = blocks
      .filter((block) => block.kind === "header")
      .map((block) => block.text)
      .join("\n") || null;
    const footer = blocks
      .filter((block) => block.kind === "footer")
      .map((block) => block.text)
      .join("\n") || null;
    const fullText = blocks
      .filter((block) => !["header", "footer", "noise"].includes(block.kind))
      .map((block) => block.text)
      .join("\n\n");

    return {
      ...page,
      blocks,
      header,
      footer,
      fullText,
    };
  });
}

export async function analyzeDocumentWithPdfTextLayer({
  fileBuffer,
  fileName,
  preferences,
}: {
  fileBuffer: Buffer;
  fileName: string;
  preferences?: ExtractionPreferences;
}): Promise<{
  rawOcr: RawOcrArtifact;
  normalized: NormalizedDocumentArtifact;
} | null> {
  const parser = new PDFParse({ data: new Uint8Array(fileBuffer) });

  try {
    const [textResult, tableResult] = await Promise.all([
      parser.getText({ pageJoiner: "", lineEnforce: true }),
      parser.getTable().catch(() => null),
    ]);

    const pageTexts = textResult.pages.map((page) => ({
      pageNumber: page.num,
      text: normalizeMultilineText(page.text),
    }));

    const meaningfulChars = pageTexts.reduce(
      (sum, page) =>
        sum +
        page.text
          .replace(PAGE_MARKER_RE, " ")
          .replace(/\s+/g, "")
          .length,
      0,
    );

    if (pageTexts.length === 0 || meaningfulChars < 300) {
      return null;
    }

    const tablesByPage = new Map<number, string[][][]>(
      (tableResult?.pages || []).map((page) => [page.num, page.tables]),
    );

    const initialPages: NormalizedPage[] = pageTexts.map((page) => {
      const blocks = buildTextBlocks(page.pageNumber, page.text);
      const tableBlocks: NormalizedBlock[] = (tablesByPage.get(page.pageNumber) || []).map(
        (rows, index) => ({
          id: `table-${page.pageNumber}-${index}`,
          pageNumber: page.pageNumber,
          kind: "table",
          text: rows.map((row) => row.join(" | ")).join("\n"),
          role: "table",
          order: blocks.length + index,
          table: { rows },
        }),
      );
      const mergedBlocks = [...blocks, ...tableBlocks].sort((a, b) => a.order - b.order);

      return {
        pageNumber: page.pageNumber,
        header: null,
        footer: null,
        blocks: mergedBlocks,
        fullText: mergedBlocks.map((block) => block.text).join("\n\n"),
        warnings: [],
      };
    });

    const pages = promoteRepeatedPageFurniture(initialPages);
    const fullText = pages.map((page) => page.fullText).filter(Boolean).join("\n\n");

    const rawOcr: RawOcrArtifact = {
      provider: "pdf-text",
      pipelineVersion: 2,
      apiVersion: null,
      modelId: "pdf-parse",
      contentFormat: "text",
      pageCount: textResult.total || pageTexts.length,
      paragraphCount: pages.reduce(
        (sum, page) => sum + page.blocks.filter((block) => block.kind === "paragraph").length,
        0,
      ),
      tableCount: tableResult?.mergedTables?.length || 0,
      figureCount: 0,
      contentLength: fullText.length,
    };

    const normalized: NormalizedDocumentArtifact = {
      provider: "pdf-text",
      pipelineVersion: 2,
      title: preferences?.titleHint?.trim() || fileName.replace(/\.pdf$/i, "") || null,
      languageHint: detectLanguage(fullText, preferences?.languageHint),
      pages,
      fullText,
      warnings: [],
    };

    return { rawOcr, normalized };
  } finally {
    await parser.destroy().catch(() => {});
  }
}
