import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { error } = await supabaseAdmin.from("artifacts").delete().eq("id", id);
  if (error) {
    console.error("artifact DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete output" }, { status: 500 });
  }

  return NextResponse.json({ removed: true });
}
