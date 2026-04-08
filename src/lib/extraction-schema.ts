export const DOCUMENT_TYPES = [
  "law",
  "contract",
  "mou",
  "report",
  "memo",
  "policy",
  "decree",
  "letter",
  "financial",
  "other",
] as const;

export const PAGE_TYPES = [
  "cover",
  "toc",
  "body",
  "appendix",
  "signature",
  "blank",
] as const;

export const SECTION_TYPES = [
  "preamble",
  "article",
  "clause",
  "sub_clause",
  "definition",
  "obligation",
  "right",
  "penalty",
  "termination",
  "duration",
  "parties",
  "signature",
  "introduction",
  "findings",
  "recommendation",
  "conclusion",
  "table",
  "footnote",
  "header",
  "body",
  "appendix",
  "transitional",
  "payment",
  "warranty",
  "confidentiality",
  "dispute_resolution",
  "chart",
  "map",
  "figure_caption",
  "header_block",
  "background",
  "analysis",
  "vision",
  "mission",
  "principle",
  "objective",
  "strategy",
  "action_item",
  "summary",
  "line_item",
  "note",
  "salutation",
  "subject",
  "attachment",
  "cc",
] as const;

export const LANGUAGE_CODES = ["ar", "en", "mixed"] as const;
export const EXTRACTION_MODES = [
  "auto",
  "fast",
  "high_fidelity",
  "verbatim_legal",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type PageType = (typeof PAGE_TYPES)[number];
export type SectionType = (typeof SECTION_TYPES)[number];
export type LanguageCode = (typeof LANGUAGE_CODES)[number];
export type ExtractionMode = (typeof EXTRACTION_MODES)[number];

export interface ExtractionPreferences {
  documentTypeHint?: DocumentType | null;
  languageHint?: LanguageCode | null;
  titleHint?: string | null;
  mode?: ExtractionMode | null;
  skipClassification?: boolean;
}

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
  confidence: number;
  table?: ExtractedTable;
}

export interface ExtractedPage {
  pageNumber: number;
  header: string | null;
  footer: string | null;
  sections: ExtractedSection[];
  language: LanguageCode;
  pageType: PageType;
}

export interface ValidationIssue {
  type:
    | "missing_clause_number"
    | "unordered_items"
    | "incomplete_reference"
    | "empty_content"
    | "duplicate_clause"
    | "orphaned_sub_item"
    | "degenerate_repetition";
  message: string;
  sectionIndex: number;
  severity: "error" | "warning";
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  corrections: string[];
}

export interface DocumentClassification {
  documentType: DocumentType;
  title: string;
  language: LanguageCode;
  confidence: number;
}

export interface ExtractionMetadata {
  parties?: string[];
  dates?: string[];
  duration?: string;
  obligations?: string[];
  penalties?: string[];
  sector?: string;
  entities?: Array<{ name: string; type: string; nameEn?: string }>;
  references?: Array<{ text: string; type: string }>;
}

export interface ExtractionWarnings {
  failedPages: number[];
  classificationFailed: boolean;
  metadataFailed: boolean;
  correctionBatchesFailed: number;
  verifierMismatches: string[];
  schemaWarnings: string[];
}

export interface LegalVerifierResult {
  articleLabels: string[];
  percentages: string[];
  lawReferences: string[];
  years: string[];
  cost: number;
  failed: boolean;
}

export interface ContractVerifierResult {
  clauseLabels: string[];
  partyNames: string[];
  dates: string[];
  amounts: string[];
  percentages: string[];
  durations: string[];
  cost: number;
  failed: boolean;
}

export interface FinancialVerifierResult {
  headers: string[];
  lineItems: string[];
  dates: string[];
  amounts: string[];
  percentages: string[];
  totals: string[];
  cost: number;
  failed: boolean;
}

export interface MemoVerifierResult {
  headerLines: string[];
  subjects: string[];
  dates: string[];
  recommendationLabels: string[];
  signatories: string[];
  cost: number;
  failed: boolean;
}

export interface LetterVerifierResult {
  dates: string[];
  addressees: string[];
  subjects: string[];
  signatories: string[];
  attachments: string[];
  ccEntries: string[];
  cost: number;
  failed: boolean;
}

export interface LegalVerifierPageArtifact {
  pageNumber: number;
  result: Omit<LegalVerifierResult, "cost" | "failed">;
  failed: boolean;
}

export interface ContractVerifierPageArtifact {
  pageNumber: number;
  result: Omit<ContractVerifierResult, "cost" | "failed">;
  failed: boolean;
}

export interface FinancialVerifierPageArtifact {
  pageNumber: number;
  result: Omit<FinancialVerifierResult, "cost" | "failed">;
  failed: boolean;
}

export interface MemoVerifierPageArtifact {
  pageNumber: number;
  result: Omit<MemoVerifierResult, "cost" | "failed">;
  failed: boolean;
}

export interface LetterVerifierPageArtifact {
  pageNumber: number;
  result: Omit<LetterVerifierResult, "cost" | "failed">;
  failed: boolean;
}

export type ExtractionVerifierArtifact =
  | {
      kind: "none";
      pages: [];
    }
  | {
      kind: "legal";
      pages: LegalVerifierPageArtifact[];
    }
  | {
      kind: "contract";
      pages: ContractVerifierPageArtifact[];
    }
  | {
      kind: "financial";
      pages: FinancialVerifierPageArtifact[];
    }
  | {
      kind: "memo";
      pages: MemoVerifierPageArtifact[];
    }
  | {
      kind: "letter";
      pages: LetterVerifierPageArtifact[];
    };

export interface ExtractionResult {
  classification: DocumentClassification;
  pages: ExtractedPage[];
  referencedLaws: string[];
  validation: ValidationResult;
  metadata: ExtractionMetadata;
  costs: {
    classification: number;
    extraction: number;
    correction: number;
    total: number;
  };
  warnings: ExtractionWarnings;
  verifier: ExtractionVerifierArtifact;
}

export interface ExtractionArtifact {
  version: 1;
  storedAt: string;
  classification: DocumentClassification;
  pages: ExtractedPage[];
  referencedLaws: string[];
  validation: ValidationResult;
  metadata: ExtractionMetadata;
  warnings: ExtractionWarnings;
  verifier: ExtractionVerifierArtifact;
  costs: ExtractionResult["costs"];
  pipeline?: {
    provider: string;
    version: number;
  };
  rawOcr?: Record<string, unknown>;
  normalized?: Record<string, unknown>;
}

export interface NormalizedExtractionPayload {
  source: "artifact" | "reconstructed";
  version: number | null;
  storedAt: string | null;
  classification: DocumentClassification;
  pages: ExtractedPage[];
  referencedLaws: string[];
  validation: ValidationResult;
  metadata: ExtractionMetadata;
  warnings: ExtractionWarnings;
  verifier: ExtractionVerifierArtifact;
  costs: ExtractionResult["costs"] | null;
}

export interface ParsedPayload<T> {
  value: T;
  failed: boolean;
  warnings: string[];
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function coerceString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function coerceNullableString(value: unknown): string | null {
  const str = coerceString(value, "").trim();
  return str ? str : null;
}

function clampConfidence(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(1, parsed));
  }
  return fallback;
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => coerceString(item, "").trim())
    .filter(Boolean);
}

function coerceEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return typeof value === "string" && allowed.includes(value as T[number])
    ? (value as T[number])
    : fallback;
}

function coerceJsonContent(type: string, value: unknown): string {
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    ["table", "chart", "map", "figure_caption"].includes(type)
  ) {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function parseSection(section: unknown, index: number): ParsedPayload<ExtractedSection | null> {
  const obj = asRecord(section);
  if (!obj) {
    return {
      value: null,
      failed: true,
      warnings: [`section ${index}: expected object, received ${typeof section}`],
    };
  }

  const warnings: string[] = [];
  const rawType = obj.type;
  const type = coerceEnum(rawType, SECTION_TYPES, "body");
  if (rawType !== undefined && rawType !== type) {
    warnings.push(`section ${index}: unknown section type "${coerceString(rawType, "")}" -> body`);
  }

  const subItems =
    Array.isArray(obj.subItems) && obj.subItems.length > 0
      ? obj.subItems.map((item) => coerceString(item, "").trim()).filter(Boolean)
      : [];

  return {
    value: {
      clauseNumber: coerceNullableString(obj.clauseNumber),
      title: coerceNullableString(obj.title),
      content: coerceJsonContent(type, obj.content),
      type,
      subItems,
      confidence: clampConfidence(obj.confidence, 1),
    },
    failed: false,
    warnings,
  };
}

export function parseClassificationPayload(
  value: unknown,
  fallbackTitle: string,
): ParsedPayload<DocumentClassification> {
  const obj = asRecord(value);
  if (!obj) {
    return {
      value: {
        documentType: "other",
        title: fallbackTitle,
        language: "ar",
        confidence: 0,
      },
      failed: true,
      warnings: ["classification: response was not a JSON object"],
    };
  }

  const warnings: string[] = [];
  const rawDocumentType = obj.documentType;
  const rawLanguage = obj.language;
  const documentType = coerceEnum(rawDocumentType, DOCUMENT_TYPES, "other");
  const language = coerceEnum(rawLanguage, LANGUAGE_CODES, "ar");
  if (rawDocumentType !== undefined && rawDocumentType !== documentType) {
    warnings.push(`classification: unknown documentType "${coerceString(rawDocumentType, "")}" -> other`);
  }
  if (rawLanguage !== undefined && rawLanguage !== language) {
    warnings.push(`classification: unknown language "${coerceString(rawLanguage, "")}" -> ar`);
  }

  return {
    value: {
      documentType,
      title: coerceString(obj.title, fallbackTitle).trim() || fallbackTitle,
      language,
      confidence: clampConfidence(obj.confidence, 0),
    },
    failed: false,
    warnings,
  };
}

export function parseExtractedPagePayload(
  value: unknown,
  pageNumber: number,
): ParsedPayload<ExtractedPage> {
  const obj = asRecord(value);
  if (!obj) {
    return {
      value: {
        pageNumber,
        header: null,
        footer: null,
        language: "ar",
        pageType: "body",
        sections: [],
      },
      failed: true,
      warnings: [`page ${pageNumber}: response was not a JSON object`],
    };
  }

  const warnings: string[] = [];
  const rawPageType = obj.pageType;
  const rawLanguage = obj.language;
  const pageType = coerceEnum(rawPageType, PAGE_TYPES, "body");
  const language = coerceEnum(rawLanguage, LANGUAGE_CODES, "ar");
  if (rawPageType !== undefined && rawPageType !== pageType) {
    warnings.push(`page ${pageNumber}: unknown pageType "${coerceString(rawPageType, "")}" -> body`);
  }
  if (rawLanguage !== undefined && rawLanguage !== language) {
    warnings.push(`page ${pageNumber}: unknown language "${coerceString(rawLanguage, "")}" -> ar`);
  }

  const sectionsInput = obj.sections;
  let failed = false;
  const sections: ExtractedSection[] = [];
  if (Array.isArray(sectionsInput)) {
    for (let i = 0; i < sectionsInput.length; i++) {
      const parsedSection = parseSection(sectionsInput[i], i);
      warnings.push(...parsedSection.warnings.map((msg) => `page ${pageNumber}: ${msg}`));
      if (parsedSection.failed) {
        failed = true;
      }
      if (parsedSection.value) sections.push(parsedSection.value);
    }
  } else {
    warnings.push(`page ${pageNumber}: sections was not an array`);
    failed = true;
  }

  return {
    value: {
      pageNumber,
      header: coerceNullableString(obj.header),
      footer: coerceNullableString(obj.footer),
      language,
      pageType,
      sections,
    },
    failed,
    warnings,
  };
}

export function parseLegalVerifierPayload(
  value: unknown,
): ParsedPayload<Omit<LegalVerifierResult, "cost" | "failed">> {
  const obj = asRecord(value);
  if (!obj) {
    return {
      value: {
        articleLabels: [],
        percentages: [],
        lawReferences: [],
        years: [],
      },
      failed: true,
      warnings: ["legal verifier: response was not a JSON object"],
    };
  }

  return {
    value: {
      articleLabels: coerceStringArray(obj.articleLabels),
      percentages: coerceStringArray(obj.percentages),
      lawReferences: coerceStringArray(obj.lawReferences),
      years: coerceStringArray(obj.years),
    },
    failed: false,
    warnings: [],
  };
}

export function parseContractVerifierPayload(
  value: unknown,
): ParsedPayload<Omit<ContractVerifierResult, "cost" | "failed">> {
  const obj = asRecord(value);
  if (!obj) {
    return {
      value: {
        clauseLabels: [],
        partyNames: [],
        dates: [],
        amounts: [],
        percentages: [],
        durations: [],
      },
      failed: true,
      warnings: ["contract verifier: response was not a JSON object"],
    };
  }

  return {
    value: {
      clauseLabels: coerceStringArray(obj.clauseLabels),
      partyNames: coerceStringArray(obj.partyNames),
      dates: coerceStringArray(obj.dates),
      amounts: coerceStringArray(obj.amounts),
      percentages: coerceStringArray(obj.percentages),
      durations: coerceStringArray(obj.durations),
    },
    failed: false,
    warnings: [],
  };
}

export function parseFinancialVerifierPayload(
  value: unknown,
): ParsedPayload<Omit<FinancialVerifierResult, "cost" | "failed">> {
  const obj = asRecord(value);
  if (!obj) {
    return {
      value: {
        headers: [],
        lineItems: [],
        dates: [],
        amounts: [],
        percentages: [],
        totals: [],
      },
      failed: true,
      warnings: ["financial verifier: response was not a JSON object"],
    };
  }

  return {
    value: {
      headers: coerceStringArray(obj.headers),
      lineItems: coerceStringArray(obj.lineItems),
      dates: coerceStringArray(obj.dates),
      amounts: coerceStringArray(obj.amounts),
      percentages: coerceStringArray(obj.percentages),
      totals: coerceStringArray(obj.totals),
    },
    failed: false,
    warnings: [],
  };
}

export function parseMemoVerifierPayload(
  value: unknown,
): ParsedPayload<Omit<MemoVerifierResult, "cost" | "failed">> {
  const obj = asRecord(value);
  if (!obj) {
    return {
      value: {
        headerLines: [],
        subjects: [],
        dates: [],
        recommendationLabels: [],
        signatories: [],
      },
      failed: true,
      warnings: ["memo verifier: response was not a JSON object"],
    };
  }

  return {
    value: {
      headerLines: coerceStringArray(obj.headerLines),
      subjects: coerceStringArray(obj.subjects),
      dates: coerceStringArray(obj.dates),
      recommendationLabels: coerceStringArray(obj.recommendationLabels),
      signatories: coerceStringArray(obj.signatories),
    },
    failed: false,
    warnings: [],
  };
}

export function parseLetterVerifierPayload(
  value: unknown,
): ParsedPayload<Omit<LetterVerifierResult, "cost" | "failed">> {
  const obj = asRecord(value);
  if (!obj) {
    return {
      value: {
        dates: [],
        addressees: [],
        subjects: [],
        signatories: [],
        attachments: [],
        ccEntries: [],
      },
      failed: true,
      warnings: ["letter verifier: response was not a JSON object"],
    };
  }

  return {
    value: {
      dates: coerceStringArray(obj.dates),
      addressees: coerceStringArray(obj.addressees),
      subjects: coerceStringArray(obj.subjects),
      signatories: coerceStringArray(obj.signatories),
      attachments: coerceStringArray(obj.attachments),
      ccEntries: coerceStringArray(obj.ccEntries),
    },
    failed: false,
    warnings: [],
  };
}

export function parseCorrectionPayload(
  value: unknown,
  batchSize: number,
): ParsedPayload<{
  corrected: string[];
  corrections: string[];
  confidence: number[];
}> {
  const obj = asRecord(value);
  if (!obj) {
    return {
      value: { corrected: [], corrections: [], confidence: [] },
      failed: true,
      warnings: ["correction: response was not a JSON object"],
    };
  }

  const warnings: string[] = [];
  const corrected = Array.isArray(obj.corrected)
    ? obj.corrected.map((item) => coerceString(item, ""))
    : [];
  const corrections = coerceStringArray(obj.corrections);
  const confidence = Array.isArray(obj.confidence)
    ? obj.confidence.map((item) => clampConfidence(item, 0.9))
    : [];

  if (corrected.length > 0 && corrected.length !== batchSize) {
    warnings.push(
      `correction: expected ${batchSize} corrected entries, received ${corrected.length}`,
    );
  }
  if (confidence.length > 0 && confidence.length !== corrected.length) {
    warnings.push(
      `correction: confidence length ${confidence.length} did not match corrected length ${corrected.length}`,
    );
  }

  return {
    value: { corrected, corrections, confidence },
    failed: false,
    warnings,
  };
}

export function parseMetadataPayload(value: unknown): ParsedPayload<ExtractionMetadata> {
  const obj = asRecord(value);
  if (!obj) {
    return {
      value: {},
      failed: true,
      warnings: ["metadata: response was not a JSON object"],
    };
  }

  const entities = Array.isArray(obj.entities)
    ? obj.entities
        .map((entry) => {
          const entity = asRecord(entry);
          if (!entity) return null;
          const name = coerceString(entity.name, "").trim();
          const type = coerceString(entity.type, "").trim();
          if (!name || !type) return null;
          const nameEn = coerceString(entity.nameEn, "").trim();
          return {
            name,
            type,
            ...(nameEn ? { nameEn } : {}),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    : [];

  return {
    value: {
      parties: coerceStringArray(obj.parties),
      dates: coerceStringArray(obj.dates),
      duration: coerceNullableString(obj.duration) || undefined,
      obligations: coerceStringArray(obj.obligations),
      penalties: coerceStringArray(obj.penalties),
      sector: coerceNullableString(obj.sector) || undefined,
      entities,
    },
    failed: false,
    warnings: [],
  };
}
