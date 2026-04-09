import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  return NextResponse.json({ document: data });
}

// Maximum allowed title length. 300 is already long enough for a full
// sentence-cased Arabic document title; anything longer is either pasted
// junk or an attempt to push garbage into a column we display verbatim.
const MAX_TITLE_LENGTH = 300;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { title?: unknown };

  // Explicit allow-list: we never take arbitrary fields from the client.
  // Today only `title` is updatable; when we add more fields we add them
  // here, not by spreading `body`. This is the single-tenant equivalent
  // of the workspace filter flagged in CONCERNS.md — under single-user
  // basic-auth there's no second user to isolate from, but we still
  // refuse to trust the request body shape.
  if (typeof body.title !== "string") {
    return NextResponse.json(
      { error: "Title must be a string" },
      { status: 400 },
    );
  }
  const trimmedTitle = body.title.trim();
  if (trimmedTitle.length === 0) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  if (trimmedTitle.length > MAX_TITLE_LENGTH) {
    return NextResponse.json(
      { error: `Title must be ${MAX_TITLE_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }

  // Reject edits while the document is still being processed. Renaming a
  // document whose extraction is mid-flight can race with the pipeline's
  // own title updates (the extractor sometimes derives a better title
  // from the first page).
  const { data: existing, error: readErr } = await supabase
    .from("documents")
    .select("id, status")
    .eq("id", id)
    .single();

  if (readErr || !existing) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  if (existing.status === "processing") {
    return NextResponse.json(
      { error: "Document is still processing — try again in a moment" },
      { status: 409 },
    );
  }

  const { data, error } = await supabase
    .from("documents")
    .update({ title: trimmedTitle })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Failed to update document" }, { status: 500 });
  }

  return NextResponse.json({ document: data });
}
