import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { processDocumentContent } from "@/lib/document-processing";
import {
  DOCUMENT_TYPES,
  EXTRACTION_MODES,
  LANGUAGE_CODES,
  type DocumentType,
  type ExtractionMode,
  type ExtractionPreferences,
  type LanguageCode,
} from "@/lib/extraction-schema";

export const maxDuration = 300; // Allow up to 5 min for OCR + structuring on large PDFs

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

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const classificationOverride = formData.get("classification") as string | null;
    const versionOf = formData.get("versionOf") as string | null;
    const relatedTo = formData.get("relatedTo") as string | null;
    const titleOverride = formData.get("title") as string | null;
    const linkToProject = formData.get("linkToProject") as string | null;
    const documentTypeHint = parseDocumentType(formData.get("documentType"));
    const languageHint = parseLanguageCode(formData.get("languageHint"));
    const extractionMode = parseExtractionMode(formData.get("extractionMode"));
    const skipClassification = formData.get("skipClassification") === "true";
    const extractionPreferences: ExtractionPreferences | null =
      documentTypeHint || languageHint || extractionMode || skipClassification || titleOverride
        ? {
            documentTypeHint,
            languageHint,
            titleHint: titleOverride,
            mode: extractionMode || "auto",
            skipClassification,
          }
        : null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "Only PDF files are supported" }, { status: 400 });
    }

    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File exceeds 50MB limit" }, { status: 400 });
    }

    // Step 1: Upload file to Supabase Storage
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(fileBuffer).digest("hex");
    const filePath = `documents/${Date.now()}_${crypto.randomUUID()}.pdf`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("documents")
      .upload(filePath, fileBuffer, {
        contentType: "application/pdf",
      });

    if (uploadError) {
      console.error("File upload failed:", uploadError);
      return NextResponse.json(
        { error: "File upload failed" },
        { status: 500 }
      );
    }

    // Step 2: Create document record (status: processing).
    // Store sha256 in metadata so the librarian can short-circuit on
    // future re-uploads of the exact same file.
    const { data: doc, error: docError } = await supabaseAdmin
      .from("documents")
      .insert({
        title: file.name,
        file_url: filePath,
        file_size: fileBuffer.length,
        status: "processing",
        version_of: versionOf || null,
        metadata: {
          sha256,
          ...(extractionPreferences
            ? {
                extractionPreferences: {
                  documentTypeHint,
                  languageHint,
                  titleHint: titleOverride,
                  mode: extractionMode || "auto",
                  skipClassification,
                },
              }
            : {}),
        },
      })
      .select()
      .single();

    if (docError || !doc) {
      console.error("Failed to create document:", docError);
      return NextResponse.json(
        { error: "Failed to create document" },
        { status: 500 }
      );
    }

    // Process document inline — await so errors are caught and status is updated
    try {
      await processDocumentContent({
        docId: doc.id,
        fileBuffer,
        fileName: file.name,
        classificationOverride,
        extractionPreferences,
        versionOf,
        relatedTo,
        titleOverride,
      });
    } catch (err) {
      console.error(`Document processing failed for ${doc.id}:`, err);
      await supabaseAdmin
        .from("documents")
        .update({ status: "error", processing_error: String(err).slice(0, 500) })
        .eq("id", doc.id);
    }

    // Phase 07: link the document to a project if requested by the user
    // (the librarian's project suggestion was accepted on the upload page)
    if (linkToProject) {
      const { error: linkErr } = await supabaseAdmin
        .from("project_documents")
        .upsert(
          {
            project_id: linkToProject,
            document_id: doc.id,
            added_by: "librarian",
          },
          { onConflict: "project_id,document_id" },
        );
      if (linkErr) {
        console.error("Failed to link uploaded doc to project:", linkErr);
      }
    }

    await logAudit("upload", {
      documentId: doc.id,
      fileName: file.name,
      fileSize: fileBuffer.length,
      ...(extractionPreferences ? { extractionPreferences } : {}),
      ...(linkToProject ? { linkedProjectId: linkToProject } : {}),
    });

    // Get the updated document title (set during extraction)
    const { data: updatedDoc } = await supabaseAdmin
      .from("documents")
      .select("title, status")
      .eq("id", doc.id)
      .single();

    return NextResponse.json({
      id: doc.id,
      status: updatedDoc?.status || "ready",
      title: updatedDoc?.title || file.name,
      message: "Document processed successfully",
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
