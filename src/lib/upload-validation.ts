// src/lib/upload-validation.ts
//
// Shared input validation for document uploads. Centralizes the two rules
// every upload path needs to agree on:
//
//   1. File is actually a PDF (magic bytes, not just the filename)
//   2. File is under the workspace's hard size cap
//
// Previously each upload entry point rolled its own extension + size
// check, and the signed-upload route allowed up to 100MB while downstream
// /api/upload only accepted 50MB — a gap an attacker could use to push
// large garbage into storage without ever succeeding downstream. This
// module is the one rule, enforced in every place we see the bytes.

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB

/**
 * %PDF- is the canonical PDF magic header. We allow a small leading BOM
 * or whitespace because some Windows tools will prepend one. Anything
 * that doesn't start with those five bytes within the first 16 is not
 * a PDF, no matter what the filename says.
 */
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"

export function isPdfBuffer(buffer: Buffer | Uint8Array): boolean {
  if (buffer.length < PDF_MAGIC.length) return false;
  // Scan a short prefix (up to 16 bytes) for the magic. We don't compare
  // strictly at offset 0 because a stray UTF-8 BOM or a few leading null
  // bytes occasionally sneak in from pathological clients, and the PDF
  // reader itself will tolerate that. But we cap the scan so a non-PDF
  // with "%PDF-" buried deep in its metadata can't fool us.
  const scanLimit = Math.min(16, buffer.length - PDF_MAGIC.length + 1);
  for (let i = 0; i < scanLimit; i++) {
    let match = true;
    for (let j = 0; j < PDF_MAGIC.length; j++) {
      if (buffer[i + j] !== PDF_MAGIC[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

export interface UploadValidationResult {
  ok: boolean;
  /** User-facing error message when `ok` is false. Kept short + actionable. */
  error?: string;
  /** HTTP status code to return when `ok` is false. */
  status?: number;
}

/**
 * Validate a buffer before we let the extraction pipeline or storage
 * uploader touch it. Returns a structured result rather than throwing
 * so route handlers can convert it directly into `NextResponse.json`.
 */
export function validateUploadBuffer(
  buffer: Buffer | Uint8Array,
  fileName: string | null | undefined,
): UploadValidationResult {
  if (buffer.length === 0) {
    return { ok: false, error: "Uploaded file is empty", status: 400 };
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit`,
      status: 400,
    };
  }
  if (fileName && !fileName.toLowerCase().endsWith(".pdf")) {
    return { ok: false, error: "Only PDF files are supported", status: 400 };
  }
  if (!isPdfBuffer(buffer)) {
    return {
      ok: false,
      error:
        "File is not a valid PDF (missing %PDF- header). Extension-only uploads are rejected.",
      status: 400,
    };
  }
  return { ok: true };
}
