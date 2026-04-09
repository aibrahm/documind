import type { ExtractionPreferences } from "@/lib/extraction-schema";
import type {
  AzureDocumentIntelligenceResponse,
  NormalizedDocumentArtifact,
} from "@/lib/extraction-v2-schema";
import {
  analyzeDocumentWithAzureLayout,
  isAzureDocumentIntelligenceConfigured,
} from "@/lib/azure-document-intelligence";
import {
  buildStructuredDocumentFromNormalized,
  normalizeAzureLayoutDocument,
} from "@/lib/ocr-normalization";

export async function readPdfWithAzure(
  fileBuffer: Buffer,
  fileName: string,
  preferences?: ExtractionPreferences,
): Promise<{
  response: AzureDocumentIntelligenceResponse;
  normalized: NormalizedDocumentArtifact;
  structured: ReturnType<typeof buildStructuredDocumentFromNormalized>;
}> {
  if (!isAzureDocumentIntelligenceConfigured()) {
    throw new Error(
      "Azure Document Intelligence is required for PDF reading but is not configured.",
    );
  }

  const response = await analyzeDocumentWithAzureLayout(fileBuffer);
  const normalized = normalizeAzureLayoutDocument(response, fileName, preferences);
  const structured = buildStructuredDocumentFromNormalized({
    normalized,
    fileName,
    preferences,
  });

  return {
    response,
    normalized,
    structured,
  };
}

export async function extractPdfTextWithAzure(
  fileBuffer: Buffer,
  fileName: string,
  maxContentChars = Number.POSITIVE_INFINITY,
): Promise<{
  title: string;
  content: string;
  pageCount: number;
  truncated: boolean;
}> {
  const { normalized, structured } = await readPdfWithAzure(fileBuffer, fileName);
  const fullText = normalized.fullText.trim();
  const truncated = fullText.length > maxContentChars;

  return {
    title: structured.classification.title || fileName.replace(/\.pdf$/i, ""),
    content: truncated
      ? `${fullText.slice(0, maxContentChars)}\n\n[...truncated]`
      : fullText,
    pageCount: normalized.pages.length,
    truncated,
  };
}
