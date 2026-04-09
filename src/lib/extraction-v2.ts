import type { ExtractionPreferences } from "@/lib/extraction-schema";
import type { ExtractionV2Result } from "@/lib/extraction-v2-schema";
import {
  analyzeDocumentWithAzureLayout,
  isAzureDocumentIntelligenceConfigured,
} from "@/lib/azure-document-intelligence";
import {
  buildStructuredDocumentFromNormalized,
  normalizeAzureLayoutDocument,
  summarizeRawOcrArtifact,
} from "@/lib/ocr-normalization";

export async function extractDocumentV2(
  fileBuffer: Buffer,
  fileName: string,
  preferences?: ExtractionPreferences,
): Promise<ExtractionV2Result> {
  if (!isAzureDocumentIntelligenceConfigured()) {
    throw new Error(
      "Azure Document Intelligence is required for document intake but is not configured.",
    );
  }

  const azureResponse = await analyzeDocumentWithAzureLayout(fileBuffer);
  const rawOcr = summarizeRawOcrArtifact(azureResponse);
  const normalized = normalizeAzureLayoutDocument(azureResponse, fileName, preferences);

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
    classification: structured.classification,
    pages: structured.pages,
    referencedLaws: structured.referencedLaws,
    validation: structured.validation,
    metadata: structured.metadata,
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
    verifier: { kind: "none", pages: [] },
  };
}
