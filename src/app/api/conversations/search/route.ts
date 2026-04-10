// src/app/api/conversations/search/route.ts
//
// In-chat conversation search. Hits message content, not just titles.
//
// The sidebar in src/components/project-sidebar.tsx used to filter
// the visible conversation list by `string.includes()` against the
// title — useless if the user remembers what they discussed but not
// what they named the thread. This endpoint searches the actual
// message bodies via the FTS index added in migration 019, returning
// matching conversations with snippet context highlighted around
// the match.
//
// Request:
//   GET /api/conversations/search?q=abu+dhabi+ports&limit=20
//
// Response:
//   {
//     query: "abu dhabi ports",
//     results: [
//       {
//         conversationId,
//         title,
//         projectId,
//         snippet,         // "...the «Abu Dhabi Ports» MoU is..."
//         matchedRole,     // "user" | "assistant"
//         rank,
//         lastMessageAt,
//       }
//     ]
//   }

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizeForSearch } from "@/lib/normalize";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawQuery = searchParams.get("q") ?? "";
  const limitParam = searchParams.get("limit");
  const limit = Math.max(
    1,
    Math.min(50, parseInt(limitParam ?? "20", 10) || 20),
  );

  const query = normalizeForSearch(rawQuery);
  if (query.length < 2) {
    return NextResponse.json({ query, results: [] });
  }

  const { data, error } = await supabaseAdmin.rpc("search_conversations", {
    query_text: query,
    match_count: limit,
  });

  if (error) {
    console.error("conversation search RPC failed:", error);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 },
    );
  }

  // Map RPC rows to a smaller client-side shape. We deliberately
  // strip the message_id (the sidebar doesn't need it — clicking
  // a result navigates to the conversation, which scrolls itself).
  const results = (data ?? []).map(
    (r: {
      conversation_id: string;
      conversation_title: string | null;
      project_id: string | null;
      matched_message_role: string | null;
      snippet: string | null;
      rank: number | null;
      last_message_at: string | null;
    }) => ({
      conversationId: r.conversation_id,
      title: r.conversation_title ?? "Untitled conversation",
      projectId: r.project_id,
      snippet: r.snippet ?? "",
      matchedRole: (r.matched_message_role ?? "user") as
        | "user"
        | "assistant"
        | "system",
      rank: r.rank ?? 0,
      lastMessageAt: r.last_message_at,
    }),
  );

  return NextResponse.json({ query, results });
}
