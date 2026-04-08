import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("workspace_profile")
    .select("*")
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    console.error("workspace_profile GET error:", error);
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
  }

  return NextResponse.json({ profile: data });
}

export async function PATCH(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const organization =
    typeof body.organization === "string" ? body.organization.trim() : "";
  const signature = typeof body.signature === "string" ? body.signature.trim() : "";

  if (!fullName || !title || !organization || !signature) {
    return NextResponse.json(
      { error: "full_name, title, organization, and signature are required" },
      { status: 400 },
    );
  }

  const row = {
    id: "default",
    full_name: fullName,
    title,
    organization,
    organization_short:
      typeof body.organization_short === "string" && body.organization_short.trim()
        ? body.organization_short.trim()
        : null,
    email:
      typeof body.email === "string" && body.email.trim() ? body.email.trim() : null,
    phone:
      typeof body.phone === "string" && body.phone.trim() ? body.phone.trim() : null,
    signature,
    preferred_language:
      typeof body.preferred_language === "string" && body.preferred_language.trim()
        ? body.preferred_language.trim()
        : "en",
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from("workspace_profile")
    .upsert(row)
    .select("*")
    .single();

  if (error) {
    console.error("workspace_profile PATCH error:", error);
    return NextResponse.json({ error: "Failed to save profile" }, { status: 500 });
  }

  return NextResponse.json({ profile: data });
}
