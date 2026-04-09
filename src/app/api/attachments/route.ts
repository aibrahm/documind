import { NextRequest, NextResponse } from "next/server";
import { extractPdfTextWithAzure } from "@/lib/intake/read";

export const maxDuration = 60;

const MAX_SIZE = 25 * 1024 * 1024; // 25 MB for ephemeral attachments
const MAX_CONTENT_CHARS = 80_000; // truncate to keep prompts manageable

/**
 * Ephemeral chat attachment endpoint.
 * Reads a PDF through Azure Layout and returns text directly to the client
 * (no DB storage). The client then includes the extracted content in the
 * chat request body.
 *
 * Differs from /api/upload:
 * - No classification, embeddings, or KB indexing
 * - Scoped to one conversation, not persisted as a document
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
      return NextResponse.json({ error: "File exceeds 25MB limit" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { title, content, pageCount, truncated } = await extractPdfTextWithAzure(
      buffer,
      file.name,
      MAX_CONTENT_CHARS,
    );

    if (!content.trim()) {
      return NextResponse.json(
        { error: "Could not extract text. PDF may be scanned or image-only." },
        { status: 422 },
      );
    }

    return NextResponse.json({
      title,
      content,
      pageCount,
      size: file.size,
      truncated,
    });
  } catch (err) {
    console.error("Attachment extraction failed:", err);
    return NextResponse.json(
      { error: "Failed to process attachment" },
      { status: 500 },
    );
  }
}
