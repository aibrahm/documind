// src/lib/tools/extract-key-terms.ts
//
// Tool: extract structured commercial facts from a project's documents (or a
// specific list of documents) using GPT-4o-mini.

import { supabaseAdmin } from "@/lib/supabase";
import { getOpenAI } from "@/lib/clients";
import { resolveProjectId } from "@/lib/projects";

const MAX_CONTEXT_CHARS = 30000;

const EXTRACTION_SYSTEM_PROMPT = `You extract structured commercial facts from document text for an Egyptian special economic zone authority. Output STRICT JSON only — no prose, no markdown.

Fields to extract when present (omit any field not clearly stated in the source):

- land_area_m2: number (square meters)
- tenor_years: number (concession or lease length)
- rou_egp: number (right-of-use payment in EGP)
- rou_egp_per_m2: number (computed if both land_area and rou are present)
- revenue_share_pct: number (percentage)
- royalty_pct: number
- equity_split: object like { "developer": 80, "authority": 20 }
- capex_egp: number (developer's stated investment)
- exclusivity: string (whether the deal grants exclusivity)
- termination_clauses: string (one-line summary)
- key_dates: array of { event: string, iso_date: string }
- milestones: array of { milestone: string, target_date: string }
- counterparty_name: string (name of the developer / investor)
- governing_law: string
- dispute_resolution: string
- notes: string (anything important that doesn't fit the schema above)

Rules:
- Numbers must be plain numbers (no commas, no units in the value).
- If a field is genuinely absent, omit it. Do not guess.
- If a field appears multiple times with different values, prefer the latest version.
- If the documents are in Arabic, translate field VALUES to English where reasonable, but keep proper nouns in their original script.
- Output a single JSON object with the extracted fields at the top level.`;

interface ExtractInput {
  project?: string;
  document_ids?: string[];
  focus?: string;
}

interface ResolvedDoc {
  id: string;
  title: string;
  language: string | null;
}

async function resolveDocumentIds(input: ExtractInput): Promise<{
  ok: boolean;
  documentIds?: string[];
  error?: string;
}> {
  if (Array.isArray(input.document_ids) && input.document_ids.length > 0) {
    return { ok: true, documentIds: input.document_ids };
  }
  if (input.project && typeof input.project === "string") {
    const projectId = await resolveProjectId(input.project);
    if (!projectId) {
      return { ok: false, error: `Project not found: ${input.project}` };
    }
    const { data, error } = await supabaseAdmin
      .from("project_documents")
      .select("document_id")
      .eq("project_id", projectId);
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      documentIds: (data ?? []).map((r) => r.document_id),
    };
  }
  return {
    ok: false,
    error: "Provide either `project` (slug/uuid) or `document_ids` (array)",
  };
}

async function loadChunkText(
  documentIds: string[],
): Promise<{ docs: ResolvedDoc[]; combinedText: string; truncated: boolean }> {
  if (documentIds.length === 0) {
    return { docs: [], combinedText: "", truncated: false };
  }

  const { data: docs } = await supabaseAdmin
    .from("documents")
    .select("id, title, language, is_current")
    .in("id", documentIds);
  const currentDocs = (docs ?? [])
    .filter((d) => d.is_current !== false)
    .map((d) => ({
      id: d.id,
      title: d.title,
      language: d.language,
    }));
  const currentIds = currentDocs.map((d) => d.id);
  if (currentIds.length === 0) {
    return { docs: [], combinedText: "", truncated: false };
  }

  const { data: chunks } = await supabaseAdmin
    .from("chunks")
    .select("document_id, page_number, content, chunk_index")
    .in("document_id", currentIds)
    .order("chunk_index", { ascending: true });

  const byDoc = new Map<string, Array<{ page: number; text: string }>>();
  for (const c of chunks ?? []) {
    if (!byDoc.has(c.document_id)) byDoc.set(c.document_id, []);
    byDoc.get(c.document_id)!.push({ page: c.page_number, text: c.content });
  }

  let combined = "";
  let truncated = false;
  for (const doc of currentDocs) {
    const docChunks = byDoc.get(doc.id) || [];
    const header = `\n\n=== ${doc.title} (${doc.language || "unknown"}) ===\n`;
    if (combined.length + header.length > MAX_CONTEXT_CHARS) {
      truncated = true;
      break;
    }
    combined += header;
    for (const ch of docChunks) {
      const chunkText = `[p.${ch.page}] ${ch.text}\n`;
      if (combined.length + chunkText.length > MAX_CONTEXT_CHARS) {
        truncated = true;
        break;
      }
      combined += chunkText;
    }
    if (truncated) break;
  }

  return { docs: currentDocs, combinedText: combined, truncated };
}

export async function runExtractKeyTerms(rawInput: unknown): Promise<string> {
  const input = (rawInput || {}) as ExtractInput;

  // 1. Resolve document set
  const resolved = await resolveDocumentIds(input);
  if (!resolved.ok) {
    return JSON.stringify({ error: resolved.error });
  }
  const documentIds = resolved.documentIds!;

  // 2. Pull chunk text
  const { docs, combinedText, truncated } = await loadChunkText(documentIds);
  if (docs.length === 0 || combinedText.length === 0) {
    return JSON.stringify({
      error: "No current document content found for the given input.",
      document_count: 0,
    });
  }

  // 3. Run extraction via GPT-4o-mini (structured JSON output)
  const openai = getOpenAI();
  const focusLine = input.focus ? `\n\nUser focus: ${input.focus}\n` : "";

  let extracted: Record<string, unknown>;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.1,
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT + focusLine },
        {
          role: "user",
          content: `Extract structured commercial facts from the following documents:${combinedText}`,
        },
      ],
    });
    const content = completion.choices[0]?.message?.content || "{}";
    extracted = JSON.parse(content);
  } catch (err) {
    return JSON.stringify({
      error: `Extraction failed: ${(err as Error).message}`,
    });
  }

  return JSON.stringify({
    operation: "extract_workspace_facts",
    document_count: docs.length,
    documents: docs.map((d) => ({ id: d.id, title: d.title })),
    truncated,
    extracted,
  });
}
