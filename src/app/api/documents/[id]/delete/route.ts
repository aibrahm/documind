import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Delete chunks first (cascade should handle this but be explicit)
    await supabaseAdmin.from("chunks").delete().eq("document_id", id);
    await supabaseAdmin.from("document_entities").delete().eq("document_id", id);
    await supabaseAdmin.from("document_references").delete().eq("source_id", id);

    // Get file_url before deleting the document
    const { data: doc } = await supabaseAdmin
      .from("documents")
      .select("file_url")
      .eq("id", id)
      .single();

    // Delete the document record
    const { error } = await supabaseAdmin
      .from("documents")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Delete document error:", error);
      return NextResponse.json({ error: "Failed to delete document" }, { status: 500 });
    }

    // Delete the file from storage
    if (doc?.file_url) {
      await supabaseAdmin.storage.from("documents").remove([doc.file_url]);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Delete error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
