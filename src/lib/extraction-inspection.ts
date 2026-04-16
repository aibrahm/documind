import {
  DOCUMENT_TYPES,
  type DocumentClassification,
  type DocumentType,
  type ExtractedPage,
  type ExtractedSection,
  type ExtractedTable,
  type ExtractionArtifact,
  type ExtractionMetadata,
  type ExtractionWarnings,
  LANGUAGE_CODES,
  type LanguageCode,
  type NormalizedExtractionPayload,
  parseMetadataPayload,
  SECTION_TYPES,
  type SectionType,
  type ValidationResult,
} from "@/lib/extraction-schema";

export interface ExtractionInspectionDocument {
  title: string;
  type: string;
  language: string;
  metadata: Record<string, unknown> | null;
}

export interface ExtractionInspectionChunk {
  content: string;
  page_number: number;
  section_title: string | null;
  clause_number: string | null;
  chunk_index: number;
  metadata: Record<string, unknown> | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function coerceString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return fallback;
}

function coerceNullableString(value: unknown): string | null {
  const text = coerceString(value, "").trim();
  return text || null;
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => coerceString(item, "").trim()).filter(Boolean);
}

/**
 * Reconstructed-from-chunks payloads used to default missing confidence
 * to 1, which made the doc-detail page render every chunk with a green
 * "HIGH" tag — the screenshot bug. We now return null when the chunk
 * metadata didn't capture a real Azure word-level score, and the display
 * layer (`confidenceLabel`) hides the tag for null inputs.
 */
function coerceConfidence(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(1, parsed));
  }
  return null;
}

function coerceDocumentType(value: string): DocumentType {
  return DOCUMENT_TYPES.includes(value as DocumentType)
    ? (value as DocumentType)
    : "other";
}

function coerceLanguage(value: string): LanguageCode {
  return LANGUAGE_CODES.includes(value as LanguageCode)
    ? (value as LanguageCode)
    : "ar";
}

function coerceSectionType(value: unknown): SectionType {
  return typeof value === "string" &&
    SECTION_TYPES.includes(value as SectionType)
    ? (value as SectionType)
    : "body";
}

function parseTableObject(value: unknown): ExtractedTable | null {
  const obj = asRecord(value);
  if (!obj) return null;

  const headersSource = Array.isArray(obj.headers)
    ? obj.headers
    : Array.isArray(obj.columns)
      ? obj.columns
      : [];
  const headers = headersSource
    .map((cell) => coerceString(cell, ""))
    .filter(Boolean);

  const rows = Array.isArray(obj.rows)
    ? obj.rows
        .map((row) =>
          Array.isArray(row) ? row.map((cell) => coerceString(cell, "")) : null,
        )
        .filter((row): row is string[] => Array.isArray(row) && row.length > 0)
    : [];

  if (rows.length === 0) return null;

  const caption = coerceNullableString(obj.caption);
  return {
    ...(caption ? { caption } : {}),
    ...(headers.length > 0 ? { headers } : {}),
    rows,
  };
}

function parseMarkdownTable(content: string): ExtractedTable | null {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 3) return null;

  let caption: string | undefined;
  if (lines[0]?.startsWith("**") && lines[0]?.endsWith("**")) {
    caption =
      lines
        .shift()
        ?.replace(/^\*\*|\*\*$/g, "")
        .trim() || undefined;
  }

  const tableLines = lines.filter(
    (line) => line.startsWith("|") && line.endsWith("|"),
  );
  if (tableLines.length < 3) return null;

  const parseLine = (line: string) =>
    line
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());

  const headerRow = parseLine(tableLines[0]);
  const separatorRow = parseLine(tableLines[1]);
  const isSeparator = separatorRow.every((cell) => /^:?-{3,}:?$/.test(cell));
  if (!isSeparator) return null;

  const rows = tableLines
    .slice(2)
    .map(parseLine)
    .filter((row) => row.length > 0);
  if (rows.length === 0) return null;

  return {
    ...(caption ? { caption } : {}),
    ...(headerRow.length > 0 ? { headers: headerRow } : {}),
    rows,
  };
}

function parseLooseTableSection(
  section: ExtractedSection,
): ExtractedTable | null {
  const rawRows = section.subItems
    .map((item) =>
      item
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    )
    .filter((row) => row.length > 0);
  if (rawRows.length === 0) return null;

  const headerLines = section.content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const widthCounts = new Map<number, number>();
  for (const row of rawRows) {
    widthCounts.set(row.length, (widthCounts.get(row.length) || 0) + 1);
  }
  const rowWidth =
    [...widthCounts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0] - b[0],
    )[0]?.[0] || 0;
  if (rowWidth === 0) return null;

  const rows = rawRows.flatMap((row) => {
    if (row.length === rowWidth) return [row];
    if (row.length === rowWidth + 1) {
      return [
        [
          row[0],
          ...Array.from({ length: Math.max(0, rowWidth - 1) }, () => ""),
        ],
        row.slice(1),
      ];
    }
    if (row.length < rowWidth) {
      return [
        [...row, ...Array.from({ length: rowWidth - row.length }, () => "")],
      ];
    }
    return [row];
  });

  let headers: string[] | undefined;
  if (headerLines.length > 0) {
    if (rowWidth > 1 && headerLines.length === rowWidth - 1) {
      headers = headerLines;
    } else if (
      rowWidth > 1 &&
      headerLines.length % (rowWidth - 1) === 0 &&
      headerLines.length <= 8
    ) {
      const groupSize = headerLines.length / (rowWidth - 1);
      headers = Array.from({ length: rowWidth - 1 }, (_, index) =>
        headerLines
          .slice(index * groupSize, (index + 1) * groupSize)
          .join("\n"),
      );
    } else if (headerLines.length <= rowWidth) {
      headers = headerLines;
    }
  }

  return {
    ...(headers && headers.length > 0 ? { headers } : {}),
    rows,
  };
}

function extractTable(
  metadata: Record<string, unknown> | null,
  section: Pick<ExtractedSection, "content" | "subItems">,
): ExtractedTable | undefined {
  const fromMetadata = parseTableObject(metadata?.table);
  if (fromMetadata) return fromMetadata;

  const fromContent = parseMarkdownTable(section.content);
  if (fromContent) return fromContent;

  const fromLooseSection = parseLooseTableSection({
    clauseNumber: null,
    title: null,
    content: section.content,
    type: "table",
    subItems: section.subItems,
    confidence: null,
  });
  return fromLooseSection || undefined;
}

function emptyValidation(): ValidationResult {
  return {
    valid: true,
    issues: [],
    corrections: [],
  };
}

function emptyWarnings(): ExtractionWarnings {
  return {
    failedPages: [],
    classificationFailed: false,
    metadataFailed: false,
    correctionBatchesFailed: 0,
    verifierMismatches: [],
    schemaWarnings: [],
  };
}

function extractStoredWarnings(
  metadata: Record<string, unknown> | null,
): ExtractionWarnings {
  const extracted = asRecord(metadata?.extractionWarnings);
  if (!extracted) return emptyWarnings();

  return {
    failedPages: Array.isArray(extracted.failedPages)
      ? extracted.failedPages
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value))
      : [],
    classificationFailed: extracted.classificationFailed === true,
    metadataFailed: extracted.metadataFailed === true,
    correctionBatchesFailed: Number.isFinite(
      Number(extracted.correctionBatchesFailed),
    )
      ? Number(extracted.correctionBatchesFailed)
      : 0,
    verifierMismatches: coerceStringArray(extracted.verifierMismatches),
    schemaWarnings: coerceStringArray(extracted.schemaWarnings),
  };
}

function extractStoredMetadata(
  metadata: Record<string, unknown> | null,
): ExtractionMetadata {
  return parseMetadataPayload(metadata).value;
}

function buildClassification(
  document: ExtractionInspectionDocument,
): DocumentClassification {
  return {
    documentType: coerceDocumentType(document.type),
    title: document.title,
    language: coerceLanguage(document.language),
    confidence: 0,
  };
}

function normalizeArtifactPages(pages: ExtractedPage[]): ExtractedPage[] {
  return pages.map((page) => ({
    ...page,
    sections: page.sections.map((section) => {
      if (section.type !== "table" || section.table) return section;
      const table = extractTable(null, section);
      return table ? { ...section, table } : section;
    }),
  }));
}

export function buildNormalizedExtractionPayload(args: {
  document: ExtractionInspectionDocument;
  chunks: ExtractionInspectionChunk[];
  artifact: ExtractionArtifact | null;
}): NormalizedExtractionPayload | null {
  const { document, chunks, artifact } = args;

  if (artifact) {
    return {
      source: "artifact",
      version: artifact.version,
      storedAt: artifact.storedAt,
      classification: artifact.classification,
      pages: normalizeArtifactPages(artifact.pages),
      referencedLaws: artifact.referencedLaws,
      validation: artifact.validation,
      metadata: artifact.metadata,
      warnings: artifact.warnings,
      verifier: artifact.verifier,
      costs: artifact.costs,
    };
  }

  if (chunks.length === 0) return null;

  const pagesByNumber = new Map<number, ExtractedPage>();
  const sortedChunks = [...chunks].sort(
    (a, b) => a.page_number - b.page_number || a.chunk_index - b.chunk_index,
  );

  for (const chunk of sortedChunks) {
    const pageNumber = chunk.page_number;
    const metadata =
      chunk.metadata && typeof chunk.metadata === "object"
        ? chunk.metadata
        : null;

    let page = pagesByNumber.get(pageNumber);
    if (!page) {
      page = {
        pageNumber,
        header: null,
        footer: null,
        language: coerceLanguage(document.language),
        pageType: "body",
        sections: [],
      };
      pagesByNumber.set(pageNumber, page);
    }

    const content = chunk.content || "";
    const type = coerceSectionType(metadata?.type);
    const sectionSeed: ExtractedSection = {
      clauseNumber: chunk.clause_number,
      title: chunk.section_title,
      content,
      type,
      subItems: [],
      confidence: coerceConfidence(metadata?.confidence),
    };
    const table = extractTable(metadata, sectionSeed);

    const section: ExtractedSection = table
      ? { ...sectionSeed, table }
      : sectionSeed;

    page.sections.push(section);
  }

  return {
    source: "reconstructed",
    version: null,
    storedAt: null,
    classification: buildClassification(document),
    pages: [...pagesByNumber.values()],
    referencedLaws: [],
    validation: emptyValidation(),
    metadata: extractStoredMetadata(document.metadata),
    warnings: extractStoredWarnings(document.metadata),
    verifier: { kind: "none", pages: [] },
    costs: null,
  };
}
