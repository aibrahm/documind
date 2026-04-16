import type {
  DocumentClassification,
  ExtractedPage,
  ExtractionMetadata,
  ExtractionResult,
  LanguageCode,
  ValidationResult,
} from "@/lib/extraction-schema";

export type OcrProvider = "azure-layout" | "pdf-text";

export const NORMALIZED_BLOCK_KINDS = [
  "title",
  "heading",
  "paragraph",
  "table",
  "figure",
  "header",
  "footer",
  "signature",
  "noise",
  "note",
] as const;

export type NormalizedBlockKind = (typeof NORMALIZED_BLOCK_KINDS)[number];

export interface AzureBoundingRegion {
  pageNumber: number;
  polygon?: number[];
}

export interface AzureSpan {
  offset: number;
  length: number;
}

export interface AzureLayoutWord {
  content: string;
  confidence?: number;
  polygon?: number[];
  span?: AzureSpan;
}

export interface AzureLayoutLine {
  content: string;
  polygon?: number[];
  spans?: AzureSpan[];
}

export interface AzureLayoutPage {
  pageNumber: number;
  angle?: number;
  width?: number;
  height?: number;
  unit?: string;
  spans?: AzureSpan[];
  words?: AzureLayoutWord[];
  lines?: AzureLayoutLine[];
}

export interface AzureLayoutParagraph {
  role?: string;
  content: string;
  boundingRegions?: AzureBoundingRegion[];
  spans?: AzureSpan[];
}

export interface AzureLayoutTableCell {
  rowIndex: number;
  columnIndex: number;
  content: string;
  kind?: string;
  boundingRegions?: AzureBoundingRegion[];
  spans?: AzureSpan[];
}

export interface AzureLayoutTable {
  rowCount: number;
  columnCount: number;
  cells: AzureLayoutTableCell[];
  boundingRegions?: AzureBoundingRegion[];
  spans?: AzureSpan[];
}

export interface AzureLayoutFigure {
  boundingRegions?: AzureBoundingRegion[];
  spans?: AzureSpan[];
  caption?: {
    content?: string;
    boundingRegions?: AzureBoundingRegion[];
  };
}

export interface AzureDocumentIntelligenceAnalyzeResult {
  apiVersion?: string;
  modelId?: string;
  content?: string;
  contentFormat?: string;
  pages?: AzureLayoutPage[];
  paragraphs?: AzureLayoutParagraph[];
  tables?: AzureLayoutTable[];
  figures?: AzureLayoutFigure[];
  sections?: unknown[];
  styles?: unknown[];
  stringIndexType?: string;
}

export interface AzureDocumentIntelligenceResponse {
  status?: string;
  createdDateTime?: string;
  lastUpdatedDateTime?: string;
  analyzeResult?: AzureDocumentIntelligenceAnalyzeResult;
}

export interface RawOcrArtifact {
  provider: OcrProvider;
  pipelineVersion: 2;
  apiVersion: string | null;
  modelId: string | null;
  contentFormat: string | null;
  pageCount: number;
  paragraphCount: number;
  tableCount: number;
  figureCount: number;
  contentLength: number;
}

export interface NormalizedTable {
  headers?: string[];
  rows: string[][];
}

export interface NormalizedBlock {
  id: string;
  pageNumber: number;
  kind: NormalizedBlockKind;
  text: string;
  role: string | null;
  polygon?: number[];
  order: number;
  confidence?: number;
  table?: NormalizedTable;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface NormalizedPage {
  pageNumber: number;
  header: string | null;
  footer: string | null;
  blocks: NormalizedBlock[];
  fullText: string;
  warnings: string[];
}

export interface NormalizedDocumentArtifact {
  provider: OcrProvider;
  pipelineVersion: 2;
  title: string | null;
  languageHint: LanguageCode | null;
  pages: NormalizedPage[];
  fullText: string;
  warnings: string[];
}

export interface StructuredDocumentArtifact {
  provider: OcrProvider;
  pipelineVersion: 2;
  classification: DocumentClassification;
  pages: ExtractedPage[];
  metadata: ExtractionMetadata;
  validation: ValidationResult;
  referencedLaws: string[];
}

export interface ExtractionV2ArtifactBundle {
  rawOcr: RawOcrArtifact;
  normalized: NormalizedDocumentArtifact;
  structured: StructuredDocumentArtifact;
}

export interface ExtractionV2Result extends ExtractionResult {
  pipeline: {
    provider: OcrProvider;
    version: 2;
  };
  rawOcr: RawOcrArtifact;
  normalized: NormalizedDocumentArtifact;
  /**
   * The full Azure Document Intelligence `analyzeResult` payload as it
   * came back from the API. Persisted end-to-end (instead of the previous
   * five-integer summary) so future features that need word polygons,
   * styles, figures, or per-word confidence don't have to call Azure a
   * second time.
   */
  azureRaw: AzureDocumentIntelligenceAnalyzeResult | null;
}
