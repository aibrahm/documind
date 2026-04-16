import {
  analyzeDocumentWithAzureLayout,
  isAzureDocumentIntelligenceConfigured,
} from "@/lib/azure-document-intelligence";
import type { ExtractionPreferences } from "@/lib/extraction-schema";
import type { ExtractionV2Result } from "@/lib/extraction-v2-schema";
import { AZURE_LAYOUT_USD_PER_PAGE, withMetric } from "@/lib/metrics";
import {
  buildStructuredDocumentFromNormalized,
  normalizeAzureLayoutDocument,
  summarizeRawOcrArtifact,
} from "@/lib/ocr-normalization";

/**
 * Run the full Azure layout extraction + normalization for a single PDF.
 *
 * The `costs` field is intentionally zeroed here — real per-stage spend
 * lives in the `extraction_runs` table (populated via withMetric below).
 * The artifact field is kept zeroed to avoid breaking older readers that
 * still reach for `extraction.costs`; the dashboard reads from
 * `extraction_runs` instead.
 *
 * Same goes for `verifier` — the legacy field is permanently `{ kind:
 * "none", pages: [] }`. We don't run a verifier pass; if/when one is
 * added, populate it for real or remove the type.
 */
export async function extractDocumentV2(
  fileBuffer: Buffer,
  fileName: string,
  preferences?: ExtractionPreferences,
  documentId: string | null = null,
): Promise<ExtractionV2Result> {
  if (!isAzureDocumentIntelligenceConfigured()) {
    throw new Error(
      "Azure Document Intelligence is required for document intake but is not configured.",
    );
  }

  const azureResponse = await withMetric(
    {
      stage: "ocr",
      documentId,
      modelVersion: "azure-prebuilt-layout",
      // Cost is determined by page count which we only learn after the
      // call returns. We compute and amend the row inside extractUsage
      // so the metric matches the actual page count of THIS document.
      extractUsage: (response) => {
        const pageCount =
          (response as { analyzeResult?: { pages?: unknown[] } }).analyzeResult
            ?.pages?.length ?? 0;
        return { usdCost: pageCount * AZURE_LAYOUT_USD_PER_PAGE };
      },
    },
    () => analyzeDocumentWithAzureLayout(fileBuffer),
  );

  const rawOcr = summarizeRawOcrArtifact(azureResponse);
  const normalized = await withMetric(
    { stage: "normalize", documentId },
    async () =>
      normalizeAzureLayoutDocument(azureResponse, fileName, preferences),
  );

  const structured = buildStructuredDocumentFromNormalized({
    normalized,
    fileName,
    preferences,
  });

  const hasValidationErrors = structured.validation.issues.some(
    (issue) => issue.severity === "error",
  );

  return {
    pipeline: {
      provider: rawOcr.provider,
      version: 2,
    },
    rawOcr,
    normalized,
    azureRaw: azureResponse.analyzeResult ?? null,
    classification: structured.classification,
    pages: structured.pages,
    referencedLaws: structured.referencedLaws,
    validation: structured.validation,
    metadata: structured.metadata,
    // Real per-stage cost lives in `extraction_runs`. Kept here as zero to
    // satisfy the legacy `ExtractionResult["costs"]` shape; the dashboard
    // does NOT read from this field.
    costs: {
      classification: 0,
      extraction: 0,
      correction: 0,
      total: 0,
    },
    warnings: {
      failedPages: hasValidationErrors
        ? structured.validation.issues
            .filter(
              (issue) =>
                issue.type === "empty_content" &&
                issue.severity === "error" &&
                issue.sectionIndex === -1,
            )
            .map((issue) => {
              const match = issue.message.match(/^Page\s+(\d+)/);
              return match ? Number(match[1]) : null;
            })
            .filter((value): value is number => Number.isInteger(value))
        : [],
      classificationFailed: false,
      metadataFailed: false,
      correctionBatchesFailed: 0,
      verifierMismatches: [],
      schemaWarnings: [...normalized.warnings],
    },
    // Legacy stub — no verifier pass exists in v2. Field kept so older
    // readers (extraction-inspection.ts, document-processing.ts) don't
    // need to be touched in this round.
    verifier: { kind: "none", pages: [] },
  };
}
