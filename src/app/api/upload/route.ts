import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { processDocumentContent } from "@/lib/document-processing";
import { validateUploadBuffer } from "@/lib/upload-validation";
import {
  DOCUMENT_TYPES,
  LANGUAGE_CODES,
  type DocumentType,
  type ExtractionPreferences,
  type LanguageCode,
} from "@/lib/extraction-schema";

export const maxDuration = 300; // Allow up to 5 min for OCR + structuring on large PDFs

// Hard size cap is enforced centrally inside validateUploadBuffer — see
// src/lib/upload-validation.ts for the canonical MAX_UPLOAD_BYTES value.
const BUCKET = "documents";

function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === "string" && DOCUMENT_TYPES.includes(value as DocumentType);
}
function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && LANGUAGE_CODES.includes(value as LanguageCode);
}

function parseDocumentType(value: FormDataEntryValue | null): DocumentType | null {
  return isDocumentType(value) ? value : null;
}
function parseLanguageCode(value: FormDataEntryValue | null): LanguageCode | null {
  return isLanguageCode(value) ? value : null;
}

/**
 * Document upload endpoint. Two body shapes are supported:
 *
 *   1. JSON  { storagePath, fileName, classification, title, ...preferences }
 *      The direct-upload path: the browser already uploaded the file to
 *      Supabase Storage via /api/storage/signed-upload. This endpoint just
 *      downloads the file server-side, runs extraction, and persists the
 *      document record. Handles files up to 100MB because Vercel never sees
 *      the raw body.
 *
 *   2. multipart/form-data with `file` field
 *      The legacy path: the file is in the request body. Capped at ~4.5MB
 *      by Vercel's serverless body limit. Kept for backward compatibility.
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";

    let fileBuffer: Buffer;
    let fileName: string;
    let filePath: string;
    let classificationOverride: string | null = null;
    let versionOf: string | null = null;
    let relatedTo: string | null = null;
    let titleOverride: string | null = null;
    let linkToProject: string | null = null;
    let extractionPreferences: ExtractionPreferences | null = null;

    if (contentType.includes("application/json")) {
      // ── Direct-upload path ──
      const body = await request.json().catch(() => ({}));
      const {
        storagePath,
        fileName: bodyFileName,
        classification,
        versionOf: bodyVersionOf,
        relatedTo: bodyRelatedTo,
        title,
        linkToProject: bodyLinkToProject,
        documentType,
        languageHint,
        skipClassification,
      } = body as {
        storagePath?: string;
        fileName?: string;
        classification?: string;
        versionOf?: string;
        relatedTo?: string;
        title?: string;
        linkToProject?: string;
        documentType?: string;
        languageHint?: string;
        skipClassification?: boolean;
      };

      if (!storagePath || typeof storagePath !== "string") {
        return NextResponse.json(
          { error: "storagePath is required" },
          { status: 400 },
        );
      }

      const { data: blob, error: downloadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .download(storagePath);

      if (downloadError || !blob) {
        console.error("Storage download failed:", downloadError);
        return NextResponse.json(
          { error: "File not found in storage" },
          { status: 404 },
        );
      }

      fileBuffer = Buffer.from(await blob.arrayBuffer());

      const checkName =
        typeof bodyFileName === "string" && bodyFileName.length > 0
          ? bodyFileName
          : storagePath.split("/").pop() || "file.pdf";
      const validation = validateUploadBuffer(fileBuffer, checkName);
      if (!validation.ok) {
        return NextResponse.json(
          { error: validation.error },
          { status: validation.status ?? 400 },
        );
      }

      fileName = checkName;

      // The file is already at storagePath — reuse it as the canonical file_url
      filePath = storagePath;

      classificationOverride = typeof classification === "string" ? classification : null;
      versionOf = typeof bodyVersionOf === "string" ? bodyVersionOf : null;
      relatedTo = typeof bodyRelatedTo === "string" ? bodyRelatedTo : null;
      titleOverride = typeof title === "string" ? title : null;
      linkToProject = typeof bodyLinkToProject === "string" ? bodyLinkToProject : null;

      const dt = isDocumentType(documentType) ? documentType : null;
      const lh = isLanguageCode(languageHint) ? languageHint : null;
      const skip = skipClassification === true;
      extractionPreferences =
        dt || lh || skip || titleOverride
          ? {
              documentTypeHint: dt,
              languageHint: lh,
              titleHint: titleOverride,
              skipClassification: skip,
            }
          : null;
    } else {
      // ── Legacy multipart/form-data path (≤4.5MB on Vercel) ──
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      classificationOverride = formData.get("classification") as string | null;
      versionOf = formData.get("versionOf") as string | null;
      relatedTo = formData.get("relatedTo") as string | null;
      titleOverride = formData.get("title") as string | null;
      linkToProject = formData.get("linkToProject") as string | null;
      const documentTypeHint = parseDocumentType(formData.get("documentType"));
      const languageHint = parseLanguageCode(formData.get("languageHint"));
      const skipClassification = formData.get("skipClassification") === "true";
      extractionPreferences =
        documentTypeHint || languageHint || skipClassification || titleOverride
          ? {
              documentTypeHint,
              languageHint,
              titleHint: titleOverride,
              skipClassification,
            }
          : null;

      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }

      fileBuffer = Buffer.from(await file.arrayBuffer());
      fileName = file.name;

      const validation = validateUploadBuffer(fileBuffer, file.name);
      if (!validation.ok) {
        return NextResponse.json(
          { error: validation.error },
          { status: validation.status ?? 400 },
        );
      }

      // Legacy path: upload to storage now
      filePath = `${Date.now()}_${randomUUID()}.pdf`;
      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(filePath, fileBuffer, { contentType: "application/pdf" });
      if (uploadError) {
        console.error("File upload failed:", uploadError);
        return NextResponse.json({ error: "File upload failed" }, { status: 500 });
      }
    }

    const sha256 = createHash("sha256").update(fileBuffer).digest("hex");

    // Create document record (status: processing).
    const { data: doc, error: docError } = await supabaseAdmin
      .from("documents")
      .insert({
        title: fileName,
        file_url: filePath,
        file_size: fileBuffer.length,
        status: "processing",
        version_of: versionOf || null,
        metadata: {
          sha256,
          ...(extractionPreferences
            ? {
                extractionPreferences: {
                  documentTypeHint: extractionPreferences.documentTypeHint,
                  languageHint: extractionPreferences.languageHint,
                  titleHint: extractionPreferences.titleHint,
                  skipClassification: extractionPreferences.skipClassification === true,
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
        { status: 500 },
      );
    }

    // Process document inline — await so errors are caught and status is updated
    try {
      await processDocumentContent({
        docId: doc.id,
        fileBuffer,
        fileName,
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

    // Link the document to a project if requested by the user
    // (for example when the upload flow suggested a project fit).
    if (linkToProject) {
      const { error: linkErr } = await supabaseAdmin
        .from("project_documents")
        .upsert(
          {
            project_id: linkToProject,
            document_id: doc.id,
            added_by: "auto",
          },
          { onConflict: "project_id,document_id" },
        );
      if (linkErr) {
        console.error("Failed to link uploaded doc to project:", linkErr);
      }
    }

    await logAudit("upload", {
      documentId: doc.id,
      fileName,
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
      title: updatedDoc?.title || fileName,
      message: "Document processed successfully",
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
