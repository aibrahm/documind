import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-validation";

/**
 * Direct-to-storage upload endpoint.
 *
 * Vercel serverless functions have a hard 4.5MB request body limit, which
 * makes it impossible to upload real-world PDFs (government documents often
 * 10–50MB) through a regular POST handler. The standard fix is direct
 * client-to-storage uploads via signed URLs: the browser gets a short-lived
 * signed upload URL from this endpoint, uploads the file DIRECTLY to
 * Supabase Storage (bypassing Vercel entirely), then calls the processing
 * endpoints with just the resulting `storagePath`. The server-side handlers
 * download the file from Supabase Storage when they need to parse it.
 *
 * Flow:
 *   1. browser → POST /api/storage/signed-upload with { fileName, size }
 *   2. this endpoint → Supabase `createSignedUploadUrl()` → { signedUrl, token, path }
 *   3. browser → PUT file directly to signedUrl (or supabase.storage.uploadToSignedUrl)
 *   4. browser → POST /api/intake/analyze with { storagePath }
 *   5. browser → POST /api/upload with { storagePath, ...preferences }
 */

// Align the pre-upload cap with the downstream /api/upload hard limit.
// Previously this was set to 100MB, but /api/upload only accepts 50MB,
// which means an attacker (or a client bug) could push a 100MB file
// into storage that the extraction pipeline would reject anyway — so
// storage accumulated garbage with no downstream processing path.
// See src/lib/upload-validation.ts for the canonical cap.
const MAX_SIZE = MAX_UPLOAD_BYTES;
const BUCKET = "documents";

export async function POST(request: NextRequest) {
  let body: { fileName?: string; size?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { fileName, size } = body;
  if (!fileName || typeof fileName !== "string") {
    return NextResponse.json(
      { error: "fileName is required" },
      { status: 400 },
    );
  }
  if (!fileName.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json(
      { error: "Only PDF files are supported" },
      { status: 400 },
    );
  }
  if (typeof size === "number" && size > MAX_SIZE) {
    return NextResponse.json(
      { error: `File exceeds ${MAX_SIZE / 1024 / 1024}MB limit` },
      { status: 400 },
    );
  }

  // Generate a unique storage path. We deliberately avoid putting the
  // original filename in the path (Arabic / spaces / weird characters
  // cause headaches). The original filename flows through the API
  // separately as metadata.
  const storagePath = `${Date.now()}_${randomUUID()}.pdf`;

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    console.error("createSignedUploadUrl failed:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to create signed URL" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    storagePath,
    signedUrl: data.signedUrl,
    token: data.token,
    bucket: BUCKET,
  });
}
