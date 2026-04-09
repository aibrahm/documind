// src/lib/workspace-suggestions.ts
//
// Landing page guided queries.
//
// The home screen used to show "greeting + ChatInput + recent uploads" — the
// last block was a list of filenames, which is work for the reader and no
// direction. For a single executive user, the landing screen should instead
// offer three queries tuned to what he has in the system, so the very first
// click is already on a useful question.
//
// We derive three suggestions from real data:
//   1. Most recently touched active project          → "Brief me on X"
//   2. Entity with the most document links           → "What have we committed to X?"
//   3. Most recently ingested ready document         → "What's the key risk in X?"
//
// Any of the three may be unavailable on a fresh workspace. In that case we
// fall back to generic prompts so the UI always renders three cards (no
// conditional empty-state — consistent shape is calmer).
//
// All queries run in parallel and use the admin client because the page is
// a server component inside the authenticated workspace layout. None of
// these reads expose anything the user shouldn't already see.

import { supabaseAdmin } from "@/lib/supabase";

export interface WorkspaceSuggestion {
  id: "project" | "entity" | "document" | "fallback";
  /** Short label shown in bold on the card (the subject the question is about). */
  subject: string;
  /** One-line reason shown below the prompt so the VC knows why this is suggested. */
  hint: string;
  /** The exact text we drop into the chat input when the card is clicked. */
  prompt: string;
}

const FALLBACK_SUGGESTIONS: WorkspaceSuggestion[] = [
  {
    id: "fallback",
    subject: "Get started",
    hint: "Upload a PDF to begin — the assistant will read and remember it.",
    prompt: "What can you help me with?",
  },
  {
    id: "fallback",
    subject: "Arabic documents",
    hint: "Drop a scanned Arabic contract and ask about it in either language.",
    prompt: "I'll upload a document — can you give me a one-page brief on it?",
  },
  {
    id: "fallback",
    subject: "Institutional memory",
    hint: "Once documents are indexed, ask across everything we've signed.",
    prompt: "What have we previously committed to on this topic?",
  },
];

export async function getWorkspaceSuggestions(): Promise<WorkspaceSuggestion[]> {
  const [projectRes, entityRes, docRes] = await Promise.all([
    supabaseAdmin
      .from("projects")
      .select("name")
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Top-linked entity: pick the entity with the most document_entities rows.
    // We over-fetch a small batch of recent links and count in JS rather than
    // write a grouped SQL query, because the set is small (single-user) and
    // we'd rather avoid another migration for an RPC. If this ever scales,
    // push this into a view.
    supabaseAdmin
      .from("document_entities")
      .select("entity_id")
      .limit(500),
    supabaseAdmin
      .from("documents")
      .select("title")
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const suggestions: WorkspaceSuggestion[] = [];

  // 1. Most recent project
  const projectName = projectRes.data?.name?.trim();
  if (projectName) {
    suggestions.push({
      id: "project",
      subject: projectName,
      hint: "Brief me from everything we have on this project",
      prompt: `Brief me on ${projectName}. Pull from every document we have about it and cite specific clauses.`,
    });
  }

  // 2. Top-linked entity — count in JS
  if (entityRes.data && entityRes.data.length > 0) {
    const counts = new Map<string, number>();
    for (const row of entityRes.data) {
      counts.set(row.entity_id, (counts.get(row.entity_id) ?? 0) + 1);
    }
    const topEntityId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (topEntityId) {
      const { data: entity } = await supabaseAdmin
        .from("entities")
        .select("name, name_en")
        .eq("id", topEntityId)
        .maybeSingle();
      const entityName = (entity?.name ?? entity?.name_en ?? "").trim();
      if (entityName) {
        suggestions.push({
          id: "entity",
          subject: entityName,
          hint: "What we've committed to across every document",
          prompt: `What have we committed to with ${entityName}? Summarize every obligation from documents we've signed and cite the clauses.`,
        });
      }
    }
  }

  // 3. Most recent ready document
  const docTitle = docRes.data?.title?.trim();
  if (docTitle) {
    suggestions.push({
      id: "document",
      subject: docTitle,
      hint: "Most recent upload — ready to discuss",
      prompt: `What are the key risks and commitments in "${docTitle}"? Quote the exact clauses that matter most for a decision.`,
    });
  }

  // Always return exactly 3 cards. Fill with generic fallbacks if we didn't
  // get enough real data (cold start, empty workspace, etc.).
  while (suggestions.length < 3) {
    const fallback = FALLBACK_SUGGESTIONS[suggestions.length] ?? FALLBACK_SUGGESTIONS[0];
    suggestions.push(fallback);
  }
  return suggestions.slice(0, 3);
}
