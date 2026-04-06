import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("conversations")
      .select("id, title, mode, query, created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Conversations list error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ conversations: data });
  } catch (err) {
    console.error("Conversations GET error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, mode, query, response, sources, classification, model, scores, search_results } = body;

    if (!title || !mode || !query) {
      return NextResponse.json(
        { error: "title, mode, and query are required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("conversations")
      .insert({
        title,
        mode,
        query,
        response: response ?? null,
        sources: sources ?? null,
        classification: classification ?? null,
        model: model ?? null,
        scores: scores ?? null,
        search_results: search_results ?? null,
      })
      .select("id, title")
      .single();

    if (error) {
      console.error("Conversation create error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("Conversations POST error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
