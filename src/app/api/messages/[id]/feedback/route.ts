// src/app/api/messages/[id]/feedback/route.ts
//
// POST a single verdict on a single assistant message.
//
// Request body: { verdict: "helpful" | "wrong", note?: string }
//
// This is the most important product metric right now: how many answers
// did the Vice Chairman mark as worth acting on. We keep the schema as
// small as possible — two buttons, no forms, no stars — so the friction
// to give feedback is close to zero. See CLAUDE.md "Fail Loud" and the
// 2-week shiplist for why we don't bury this behind "rate this response".

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

type Verdict = "helpful" | "wrong";

function isVerdict(value: unknown): value is Verdict {
  return value === "helpful" || value === "wrong";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing message id" }, { status: 400 });
  }

  let body: { verdict?: unknown; note?: unknown };
  try {
    body = (await request.json()) as { verdict?: unknown; note?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isVerdict(body.verdict)) {
    return NextResponse.json(
      { error: "verdict must be 'helpful' or 'wrong'" },
      { status: 400 },
    );
  }
  const verdict: Verdict = body.verdict;
  const note = typeof body.note === "string" && body.note.trim().length > 0
    ? body.note.trim().slice(0, 2000)
    : null;

  // Upsert on (message_id, verdict) — a repeat click on the same button is
  // a no-op. Clicking the opposite button inserts a second row so the flip
  // is visible in telemetry.
  const { error } = await supabaseAdmin
    .from("message_feedback")
    .upsert(
      { message_id: id, verdict, note },
      { onConflict: "message_id,verdict" },
    );

  if (error) {
    console.error("message_feedback insert failed:", error);
    return NextResponse.json(
      { error: "Failed to record feedback" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE removes a single verdict. Used when the user toggles a button
 * off (e.g. clicking an already-active "This helped" to retract it).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(request.url);
  const verdictParam = url.searchParams.get("verdict");
  if (!isVerdict(verdictParam)) {
    return NextResponse.json(
      { error: "verdict query param must be 'helpful' or 'wrong'" },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin
    .from("message_feedback")
    .delete()
    .eq("message_id", id)
    .eq("verdict", verdictParam);

  if (error) {
    console.error("message_feedback delete failed:", error);
    return NextResponse.json(
      { error: "Failed to remove feedback" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
