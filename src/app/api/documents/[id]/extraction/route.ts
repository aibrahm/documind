import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data, error } = await supabaseAdmin
    .from("chunks")
    .select(
      "id, content, page_number, section_title, clause_number, chunk_index, metadata"
    )
    .eq("document_id", id)
    .order("chunk_index", { ascending: true });

  if (error) {
    console.error("Extraction chunks fetch error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ chunks: data || [] });
}
