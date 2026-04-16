import { createHash } from "node:crypto";
import { after, type NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { processDocumentContent } from "@/lib/document-processing";
import {
  DOCUMENT_TYPES,
  type DocumentType,
  type ExtractionPreferences,
  LANGUAGE_CODES,
  type LanguageCode,
} from "@/lib/extraction-schema";
import { supabaseAdmin } from "@/lib/supabase";
import { validateUploadBuffer } from "@/lib/upload-validation";

// `after()` runs the processing pipeline AFTER the response is sent. The
// serverless function still needs maxDuration big enough to cover the
// background work (Azure can take 30 s – 4 min for a large doc), so we
// keep the existing 5-min cap. The user-perceived latency is now <1 s
// because the response goes out before processing starts.
export const maxDuration = 300;

const BUCKET = "documents";

function isDocumentType(value: unknown): value is DocumentType {
  return (
    typeof value === "string" && DOCUMENT_TYPES.includes(value as DocumentType)
  );
}
function isLanguageCode(value: unknown): value is LanguageCode {
  return (
    typeof value === "string" && LANGUAGE_CODES.includes(value as LanguageCode)
  );
}

interface UploadBody {
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
  /**
   * When the SHA matches an existing doc, we return early with
   * `{ duplicate: true, ... }` instead of re-extracting. Pass `force: true`
   * to bypass that check (e.g. user clicks "upload anyway" on the toast).
   */
  force?: boolean;
}

/**
 * Document upload endpoint.
 *
 * Flow:
 *   1. Browser uploads the PDF directly to Supabase Storage via a signed
 *      URL (see /api/storage/signed-upload).
 *   2. Browser POSTs JSON `{ storagePath, fileName, ... }` to this route.
 *   3. We download the file, run validation + SHA dedup, create a
 *      `documents` row with status `queued`, then schedule the heavy
 *      OCR + LLM pipeline via `after()` so the response goes out
 *      immediately. The browser redirects to /documents and watches the
 *      row flip from `queued` → `processing` → `ready` (or `error`).
 *
 * The legacy multipart/form-data path was deleted — every client now uses
 * the signed-upload + JSON path. Rationale: Vercel's 4.5 MB body cap made
 * the multipart path unusable for the typical Arabic legal scan, and
 * keeping two upload codepaths was a constant source of drift.
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return NextResponse.json(
        { error: "Content-Type must be application/json" },
        { status: 400 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as UploadBody;
    const {
      storagePath,
      fileName: bodyFileName,
      classification,
      versionOf,
      relatedTo,
      title,
      linkToProject,
      documentType,
      languageHint,
      skipClassification,
      force,
    } = body;

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
    const fileBuffer = Buffer.from(await blob.arrayBuffer());

    const fileName =
      typeof bodyFileName === "string" && bodyFileName.length > 0
        ? bodyFileName
        : storagePath.split("/").pop() || "file.pdf";

    const validation = validateUploadBuffer(fileBuffer, fileName);
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error },
        { status: validation.status ?? 400 },
      );
    }

    // ── SHA dedup ──
    // Compute the SHA before doing anything else and check whether this
    // exact byte sequence is already in the library. Saves a full Azure
    // run on accidental re-uploads — the most common waste case after the
    // intake-then-upload double-call we just removed.
    const sha256 = createHash("sha256").update(fileBuffer).digest("hex");
    if (!force) {
      const { data: existing } = await supabaseAdmin
        .from("documents")
        .select("id, title, status")
        .eq("metadata->>sha256", sha256)
        .eq("is_current", true)
        .maybeSingle();
      if (existing) {
        return NextResponse.json({
          duplicate: true,
          existingDocId: existing.id,
          existingTitle: existing.title,
          existingStatus: existing.status,
        });
      }
    }

    // ── Build extraction preferences (optional power-user overrides) ──
    const dt = isDocumentType(documentType) ? documentType : null;
    const lh = isLanguageCode(languageHint) ? languageHint : null;
    const skip = skipClassification === true;
    const titleOverride = typeof title === "string" ? title : null;
    const extractionPreferences: ExtractionPreferences | null =
      dt || lh || skip || titleOverride
        ? {
            documentTypeHint: dt,
            languageHint: lh,
            titleHint: titleOverride,
            skipClassification: skip,
          }
        : null;

    const classificationOverride =
      typeof classification === "string" ? classification : null;
    const versionOfId = typeof versionOf === "string" ? versionOf : null;
    const relatedToId = typeof relatedTo === "string" ? relatedTo : null;
    const linkToProjectId =
      typeof linkToProject === "string" ? linkToProject : null;

    // ── Create the doc row in `queued` so the library shows it immediately ──
    const { data: doc, error: docError } = await supabaseAdmin
      .from("documents")
      .insert({
        title: fileName,
        file_url: storagePath,
        file_size: fileBuffer.length,
        status: "queued",
        version_of: versionOfId,
        metadata: {
          sha256,
          ...(extractionPreferences
            ? {
                extractionPreferences: {
                  documentTypeHint: extractionPreferences.documentTypeHint,
                  languageHint: extractionPreferences.languageHint,
                  titleHint: extractionPreferences.titleHint,
                  skipClassification:
                    extractionPreferences.skipClassification === true,
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

    // Project link is set up-front so the library card shows the right
    // badge from the moment the doc appears (status: queued).
    if (linkToProjectId) {
      const { error: linkErr } = await supabaseAdmin
        .from("project_documents")
        .upsert(
          {
            project_id: linkToProjectId,
            document_id: doc.id,
            added_by: "user",
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
      ...(linkToProjectId ? { linkedProjectId: linkToProjectId } : {}),
    });

    // ── Background processing via after() ──
    // The serverless function keeps running after the response is sent;
    // the user gets `{ docId, status: "queued" }` in <1 s and watches the
    // library row flip to `processing`/`ready` via the existing 5 s poll.
    after(async () => {
      try {
        // Flip to `processing` so the UI distinguishes "in flight" from
        // "queued but not started yet" — useful while we still poll
        // rather than subscribe to Realtime.
        await supabaseAdmin
          .from("documents")
          .update({ status: "processing" })
          .eq("id", doc.id);

        await processDocumentContent({
          docId: doc.id,
          fileBuffer,
          fileName,
          classificationOverride,
          extractionPreferences,
          versionOf: versionOfId,
          relatedTo: relatedToId,
          titleOverride,
        });
      } catch (err) {
        console.error(`Document processing failed for ${doc.id}:`, err);
        await supabaseAdmin
          .from("documents")
          .update({
            status: "error",
            processing_error: String((err as Error).message ?? err).slice(
              0,
              2000,
            ),
          })
          .eq("id", doc.id);
      }
    });

    return NextResponse.json({
      id: doc.id,
      status: "queued",
      title: fileName,
      message: "Document queued for extraction",
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
