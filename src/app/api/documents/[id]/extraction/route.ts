import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { readExtractionArtifact } from "@/lib/extraction-artifacts";
import { buildNormalizedExtractionPayload } from "@/lib/extraction-inspection";
import { processDocumentContent } from "@/lib/document-processing";
import { logAudit } from "@/lib/audit";
import {
  DOCUMENT_TYPES,
  LANGUAGE_CODES,
  type DocumentType,
  type ExtractionPreferences,
  type LanguageCode,
} from "@/lib/extraction-schema";

export const maxDuration = 300;

function readStoredExtractionPreferences(metadata: Record<string, unknown> | null): ExtractionPreferences | null {
  const raw =
    metadata?.extractionPreferences && typeof metadata.extractionPreferences === "object"
      ? (metadata.extractionPreferences as Record<string, unknown>)
      : null;
  if (!raw) return null;

  const documentTypeHint =
    typeof raw.documentTypeHint === "string" && DOCUMENT_TYPES.includes(raw.documentTypeHint as DocumentType)
      ? (raw.documentTypeHint as DocumentType)
      : null;
  const languageHint =
    typeof raw.languageHint === "string" && LANGUAGE_CODES.includes(raw.languageHint as LanguageCode)
      ? (raw.languageHint as LanguageCode)
      : null;
  const titleHint = typeof raw.titleHint === "string" ? raw.titleHint : null;
  const skipClassification = raw.skipClassification === true;

  if (!documentTypeHint && !languageHint && !titleHint && !skipClassification) {
    return null;
  }

  return {
    documentTypeHint,
    languageHint,
    titleHint,
    skipClassification,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const [{ data: chunks, error }, { data: document }] = await Promise.all([
    supabaseAdmin
      .from("chunks")
      .select(
        "id, content, page_number, section_title, clause_number, chunk_index, metadata"
      )
      .eq("document_id", id)
      .order("chunk_index", { ascending: true }),
    supabaseAdmin
      .from("documents")
      .select("title, type, language, metadata")
      .eq("id", id)
      .maybeSingle(),
  ]);

  if (error) {
    console.error("Extraction chunks fetch error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const metadata =
    document?.metadata && typeof document.metadata === "object"
      ? (document.metadata as Record<string, unknown>)
      : null;
  const artifact = await readExtractionArtifact(id, metadata);
  const payload = document
    ? buildNormalizedExtractionPayload({
        document: {
          title: document.title,
          type: document.type,
          language: document.language,
          metadata,
        },
        chunks: (chunks || []).map((chunk) => ({
          content: chunk.content,
          page_number: chunk.page_number,
          section_title: chunk.section_title,
          clause_number: chunk.clause_number,
          chunk_index: chunk.chunk_index,
          metadata:
            chunk.metadata && typeof chunk.metadata === "object"
              ? (chunk.metadata as Record<string, unknown>)
              : null,
        })),
        artifact,
      })
    : null;

  return NextResponse.json({ chunks: chunks || [], artifact, payload });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const rawBody = await request.text();
  let body: { preserveTitle?: boolean; preserveClassification?: boolean } = {};
  if (rawBody.trim()) {
    try {
      body = JSON.parse(rawBody) as { preserveTitle?: boolean; preserveClassification?: boolean };
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  }

  const preserveTitle = body.preserveTitle !== false;
  const preserveClassification = body.preserveClassification !== false;

  const { data: document, error } = await supabaseAdmin
    .from("documents")
    .select("id, title, file_url, classification, metadata")
    .eq("id", id)
    .maybeSingle();

  if (error || !document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (!document.file_url) {
    return NextResponse.json({ error: "Document has no stored file" }, { status: 400 });
  }

  await supabaseAdmin
    .from("documents")
    .update({ status: "processing", processing_error: null })
    .eq("id", id);

  try {
    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from("documents")
      .download(document.file_url);

    if (downloadError || !fileData) {
      console.error("Failed to download document for reprocess:", downloadError);
      await supabaseAdmin
        .from("documents")
        .update({ status: "error", processing_error: "Failed to download source PDF" })
        .eq("id", id);
      return NextResponse.json({ error: "Failed to download source PDF" }, { status: 500 });
    }

    const fileBuffer = Buffer.from(await fileData.arrayBuffer());
    const fileName = document.title.toLowerCase().endsWith(".pdf")
      ? document.title
      : `${document.title}.pdf`;
    const documentMetadata =
      document.metadata && typeof document.metadata === "object"
        ? (document.metadata as Record<string, unknown>)
        : null;
    const storedExtractionPreferences = readStoredExtractionPreferences(documentMetadata);

    const result = await processDocumentContent({
      docId: id,
      fileBuffer,
      fileName,
      classificationOverride:
        preserveClassification && typeof document.classification === "string"
          ? document.classification
          : null,
      extractionPreferences: storedExtractionPreferences,
      versionOf: null,
      titleOverride: preserveTitle ? document.title : null,
      replaceExistingDerivedData: true,
    });

    await logAudit("extraction", {
      documentId: id,
      reprocess: true,
      preserveTitle,
      preserveClassification,
      warningText: result.warningText,
    });

    return NextResponse.json({
      ok: true,
      id,
      status: "ready",
      title: result.title,
      warningText: result.warningText,
    });
  } catch (err) {
    console.error(`Document reprocess failed for ${id}:`, err);
    await supabaseAdmin
      .from("documents")
      .update({ status: "error", processing_error: String(err).slice(0, 500) })
      .eq("id", id);

    return NextResponse.json({ error: "Reprocess failed" }, { status: 500 });
  }
}
