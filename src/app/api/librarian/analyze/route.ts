import { NextRequest, NextResponse } from "next/server";
import { analyzeUpload } from "@/lib/librarian";

export const maxDuration = 60;

const MAX_SIZE = 50 * 1024 * 1024; // 50MB

/**
 * Quick librarian analysis of a new document.
 *
 * Receives the file, runs a fast pdf-parse + classification + entity extraction +
 * KB similarity search, and returns a proposal that the upload UI shows the user
 * BEFORE running the full extraction pipeline.
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

    const buffer = Buffer.from(await file.arrayBuffer());
    const proposal = await analyzeUpload(buffer, file.name);

    return NextResponse.json({ proposal });
  } catch (err) {
    console.error("Librarian analyze failed:", err);
    return NextResponse.json(
      { error: "Failed to analyze document" },
      { status: 500 },
    );
  }
}
