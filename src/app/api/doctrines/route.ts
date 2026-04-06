import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("doctrines")
    .select("id, name, title, content_ar, content_en, version, is_active")
    .eq("is_active", true)
    .order("name");

  if (error) {
    console.error("Failed to fetch doctrines:", error);
    return NextResponse.json({ error: "Failed to fetch doctrines" }, { status: 500 });
  }

  return NextResponse.json({ doctrines: data });
}
