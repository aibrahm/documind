import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { data, error } = await supabaseAdmin
      .from("conversations")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      console.error("Conversation GET error:", error);
      const status = error.code === "PGRST116" ? 404 : 500;
      return NextResponse.json({ error: status === 404 ? "Conversation not found" : "Internal server error" }, { status });
    }

    return NextResponse.json({ conversation: data });
  } catch (err) {
    console.error("Conversation GET error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { error } = await supabaseAdmin
      .from("conversations")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Conversation DELETE error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Conversation DELETE error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (!body || Object.keys(body).length === 0) {
      return NextResponse.json(
        { error: "Request body must contain fields to update" },
        { status: 400 }
      );
    }

    const ALLOWED_FIELDS = new Set(["title", "response", "sources", "classification", "model", "scores", "search_results"]);
    const unknownFields = Object.keys(body).filter((k) => !ALLOWED_FIELDS.has(k));
    if (unknownFields.length > 0) {
      return NextResponse.json(
        { error: `Disallowed fields: ${unknownFields.join(", ")}` },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("conversations")
      .update(body)
      .eq("id", id);

    if (error) {
      console.error("Conversation PATCH error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Conversation PATCH error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
