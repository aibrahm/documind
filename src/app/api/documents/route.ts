import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const classification = searchParams.get("classification");
  const type = searchParams.get("type");
  const includeVersions = searchParams.get("include_versions") === "true";

  let query = supabase
    .from("documents")
    .select(
      "id, title, type, classification, language, page_count, status, processing_error, context_card, metadata, entities, created_at, is_current, version_number, version_of",
    )
    .order("created_at", { ascending: false });

  // Default: hide superseded versions. They're still in the DB and queryable
  // by id, but they don't appear in lists/pickers/recent.
  if (!includeVersions) {
    query = query.eq("is_current", true);
  }

  if (classification) query = query.eq("classification", classification);
  if (type) query = query.eq("type", type);

  const { data, error } = await query;

  if (error) {
    console.error("Documents list error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json({ documents: data });
}
