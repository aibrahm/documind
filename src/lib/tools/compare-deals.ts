// src/lib/tools/compare-deals.ts
//
// Tool: side-by-side comparison of 2 to 5 negotiations across their key_terms.
// Pure DB read + JSON shape transform — no LLM call inside the tool.

import { supabaseAdmin } from "@/lib/supabase";

interface CompareInput {
  negotiation_ids: string[];
}

interface NegotiationRow {
  id: string;
  name: string;
  status: string;
  opened_at: string | null;
  closed_at: string | null;
  key_terms: Record<string, unknown> | null;
}

export async function runCompareDeals(rawInput: unknown): Promise<string> {
  const input = (rawInput || {}) as Partial<CompareInput>;

  if (
    !Array.isArray(input.negotiation_ids) ||
    input.negotiation_ids.length < 2
  ) {
    return JSON.stringify({
      error:
        "Provide at least 2 negotiation_ids (max 5). Got: " +
        (input.negotiation_ids?.length ?? 0),
    });
  }
  if (input.negotiation_ids.length > 5) {
    return JSON.stringify({
      error:
        "Max 5 negotiations per comparison. Got: " +
        input.negotiation_ids.length,
    });
  }
  for (const id of input.negotiation_ids) {
    if (typeof id !== "string") {
      return JSON.stringify({ error: "All negotiation_ids must be strings" });
    }
  }

  const { data: rows, error } = await supabaseAdmin
    .from("negotiations")
    .select("id, name, status, opened_at, closed_at, key_terms")
    .in("id", input.negotiation_ids);

  if (error) {
    return JSON.stringify({ error: `DB error: ${error.message}` });
  }
  if (!rows || rows.length === 0) {
    return JSON.stringify({
      error: "No negotiations found for the given ids",
      requested: input.negotiation_ids,
    });
  }

  // Preserve the requested order
  const byId = new Map(rows.map((r) => [r.id, r as NegotiationRow]));
  const ordered: NegotiationRow[] = input.negotiation_ids
    .map((id) => byId.get(id))
    .filter((r): r is NegotiationRow => r !== undefined);

  const missing = input.negotiation_ids.filter((id) => !byId.has(id));

  // Collect every unique key from all key_terms
  const allKeys = new Set<string>();
  for (const n of ordered) {
    if (n.key_terms && typeof n.key_terms === "object") {
      for (const k of Object.keys(n.key_terms)) allKeys.add(k);
    }
  }

  // Build the side-by-side matrix
  const matrix: Array<{
    field: string;
    values: Array<{
      negotiation_id: string;
      negotiation_name: string;
      value: unknown;
    }>;
  }> = [];
  const sortedKeys = [...allKeys].sort();
  for (const key of sortedKeys) {
    matrix.push({
      field: key,
      values: ordered.map((n) => ({
        negotiation_id: n.id,
        negotiation_name: n.name,
        value:
          (n.key_terms as Record<string, unknown> | null)?.[key] ?? null,
      })),
    });
  }

  // Highlight which fields actually differ across negotiations
  const differing: string[] = [];
  for (const row of matrix) {
    const uniqueValues = new Set(row.values.map((v) => JSON.stringify(v.value)));
    if (uniqueValues.size > 1) differing.push(row.field);
  }

  return JSON.stringify({
    operation: "compare_deals",
    negotiations: ordered.map((n) => ({
      id: n.id,
      name: n.name,
      status: n.status,
      opened_at: n.opened_at,
      closed_at: n.closed_at,
    })),
    missing,
    field_count: matrix.length,
    matrix,
    differing_fields: differing,
    note:
      "Use the differing_fields list to highlight where the scenarios diverge. For NPV/IRR comparisons across scenarios, call financial_model on each negotiation's cashflows separately and contrast the results.",
  });
}
