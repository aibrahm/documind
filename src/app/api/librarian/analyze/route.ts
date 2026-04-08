import { NextRequest, NextResponse } from "next/server";
import { analyzeUpload } from "@/lib/librarian";
import {
  DOCUMENT_TYPES,
  EXTRACTION_MODES,
  LANGUAGE_CODES,
  type DocumentType,
  type ExtractionMode,
  type ExtractionPreferences,
  type LanguageCode,
} from "@/lib/extraction-schema";

export const maxDuration = 180;

const MAX_SIZE = 50 * 1024 * 1024; // 50MB

function parseDocumentType(value: FormDataEntryValue | null): DocumentType | null {
  return typeof value === "string" && DOCUMENT_TYPES.includes(value as DocumentType)
    ? (value as DocumentType)
    : null;
}

function parseLanguageCode(value: FormDataEntryValue | null): LanguageCode | null {
  return typeof value === "string" && LANGUAGE_CODES.includes(value as LanguageCode)
    ? (value as LanguageCode)
    : null;
}

function parseExtractionMode(value: FormDataEntryValue | null): ExtractionMode | null {
  return typeof value === "string" && EXTRACTION_MODES.includes(value as ExtractionMode)
    ? (value as ExtractionMode)
    : null;
}

/**
 * Quick librarian analysis of a new document.
 *
 * Receives the file, runs a fast native-text / OCR-backed structural analysis +
 * deterministic classification + entity extraction + KB similarity search, and
 * returns a proposal that the upload UI shows the user before the main
 * extraction pipeline runs.
 *
 * The user reviews the proposal (detected metadata, related docs, recommended
 * action) and either confirms or overrides. Then /api/upload runs with the
 * chosen action.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "Only PDF files are supported" }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File exceeds 50MB limit" }, { status: 400 });
    }

    const documentTypeHint = parseDocumentType(formData.get("documentType"));
    const languageHint = parseLanguageCode(formData.get("languageHint"));
    const extractionMode = parseExtractionMode(formData.get("extractionMode"));
    const skipClassification = formData.get("skipClassification") === "true";
    const titleHint = formData.get("title");
    const extractionPreferences: ExtractionPreferences | undefined =
      documentTypeHint ||
      languageHint ||
      extractionMode ||
      skipClassification ||
      typeof titleHint === "string"
        ? {
            documentTypeHint,
            languageHint,
            titleHint: typeof titleHint === "string" ? titleHint : null,
            mode: extractionMode || "auto",
            skipClassification,
          }
        : undefined;

    const buffer = Buffer.from(await file.arrayBuffer());
    const proposal = await analyzeUpload(buffer, file.name, extractionPreferences);

    return NextResponse.json({ proposal });
  } catch (err) {
    console.error("Librarian analyze failed:", err);
    return NextResponse.json(
      { error: "Failed to analyze document" },
      { status: 500 },
    );
  }
}
