import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { analyzeUpload } from "@/lib/intake";
import { validateUploadBuffer } from "@/lib/upload-validation";
import {
  DOCUMENT_TYPES,
  LANGUAGE_CODES,
  type DocumentType,
  type ExtractionPreferences,
  type LanguageCode,
} from "@/lib/extraction-schema";

export const maxDuration = 180;

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
 * Intake analysis endpoint. Accepts two body shapes:
 *
 *   1. JSON  { storagePath, fileName, ...preferences }
 *      Used for files already uploaded to Supabase Storage via the
 *      signed-upload flow (see /api/storage/signed-upload). This is
 *      the path for any file bigger than ~4.5MB because of Vercel's
 *      serverless function body limit.
 *
 *   2. multipart/form-data with `file` field
 *      Legacy path for small files uploaded directly through the
 *      function. Kept for backward compatibility but capped at 4.5MB
 *      by Vercel itself.
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";

    let buffer: Buffer;
    let fileName: string;
    let extractionPreferences: ExtractionPreferences | undefined;

    if (contentType.includes("application/json")) {
      // ── Direct-upload path ──
      const body = await request.json().catch(() => ({}));
      const {
        storagePath,
        fileName: bodyFileName,
        documentType,
        languageHint,
        skipClassification,
        title,
      } = body as {
        storagePath?: string;
        fileName?: string;
        documentType?: string;
        languageHint?: string;
        skipClassification?: boolean;
        title?: string;
      };

      if (!storagePath || typeof storagePath !== "string") {
        return NextResponse.json(
          { error: "storagePath is required" },
          { status: 400 },
        );
      }

      const { data: blob, error: downloadError } = await supabaseAdmin.storage
        .from("documents")
        .download(storagePath);

      if (downloadError || !blob) {
        console.error("Storage download failed:", downloadError);
        return NextResponse.json(
          { error: "File not found in storage" },
          { status: 404 },
        );
      }

      buffer = Buffer.from(await blob.arrayBuffer());
      fileName = typeof bodyFileName === "string" && bodyFileName.length > 0
        ? bodyFileName
        : (storagePath.split("/").pop() || "file.pdf");
      const validation = validateUploadBuffer(buffer, fileName);
      if (!validation.ok) {
        return NextResponse.json(
          { error: validation.error },
          { status: validation.status ?? 400 },
        );
      }

      const dt = isDocumentType(documentType) ? documentType : null;
      const lh = isLanguageCode(languageHint) ? languageHint : null;
      const skip = skipClassification === true;
      const titleStr = typeof title === "string" ? title : null;
      extractionPreferences =
        dt || lh || skip || titleStr
          ? {
              documentTypeHint: dt,
              languageHint: lh,
              titleHint: titleStr,
              skipClassification: skip,
            }
          : undefined;
    } else {
      // ── Legacy multipart/form-data path (≤4.5MB on Vercel) ──
      const formData = await request.formData();
      const file = formData.get("file") as File | null;

      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }

      const documentTypeHint = parseDocumentType(formData.get("documentType"));
      const languageHint = parseLanguageCode(formData.get("languageHint"));
      const skipClassification = formData.get("skipClassification") === "true";
      const titleHint = formData.get("title");
      extractionPreferences =
        documentTypeHint ||
        languageHint ||
        skipClassification ||
        typeof titleHint === "string"
          ? {
              documentTypeHint,
              languageHint,
              titleHint: typeof titleHint === "string" ? titleHint : null,
              skipClassification,
            }
          : undefined;

      buffer = Buffer.from(await file.arrayBuffer());
      fileName = file.name;

      const validation = validateUploadBuffer(buffer, file.name);
      if (!validation.ok) {
        return NextResponse.json(
          { error: validation.error },
          { status: validation.status ?? 400 },
        );
      }
    }

    const proposal = await analyzeUpload(buffer, fileName, extractionPreferences);
    return NextResponse.json({ proposal });
  } catch (err) {
    console.error("Intake analyze failed:", err);
    return NextResponse.json(
      { error: "Failed to analyze document" },
      { status: 500 },
    );
  }
}
