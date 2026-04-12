import { supabaseAdmin as _sb } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin = _sb as any;
import { getOpenAI } from "@/lib/clients";
import { UTILITY_MODEL } from "@/lib/models";
import { createLogger } from "@/lib/logger";

const log = createLogger("knowledge-graph");

interface ExtractedRelationship {
  entity_a: string;
  entity_b: string;
  relation_type: string;
  direction: "a_to_b" | "b_to_a" | "bidirectional";
  confidence: "high" | "medium" | "low";
}

interface ExtractedObligation {
  responsible_party: string;
  counterparty: string | null;
  action: string;
  deadline: string | null;
}

interface ExtractedFact {
  claim_key: string;
  claim_label: string;
  value: string;
}

interface KnowledgeGraphResult {
  relationships: ExtractedRelationship[];
  obligations: ExtractedObligation[];
  facts: ExtractedFact[];
}

async function resolveEntityId(name: string): Promise<string | null> {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;

  const { data } = await supabaseAdmin
    .from("entities")
    .select("id, name")
    .or(`name.ilike.%${normalized}%,name_en.ilike.%${normalized}%`)
    .limit(1);

  return data?.[0]?.id ?? null;
}

export async function extractKnowledgeGraph(
  documentId: string,
): Promise<{ relationships: number; obligations: number; facts: number }> {
  const { data: chunks } = await supabaseAdmin
    .from("chunks")
    .select("id, content, page_number, section_title")
    .eq("document_id", documentId)
    .order("chunk_index", { ascending: true })
    .limit(30);

  if (!chunks || chunks.length === 0) {
    return { relationships: 0, obligations: 0, facts: 0 };
  }

  const { data: doc } = await supabaseAdmin
    .from("documents")
    .select("title, created_at")
    .eq("id", documentId)
    .single();

  const sampleText = chunks
    .map((c: { content: string }) => c.content)
    .join("\n\n---\n\n")
    .slice(0, 10000);

  const openai = getOpenAI();

  let extracted: KnowledgeGraphResult;
  try {
    const res = await openai.chat.completions.create({
      model: UTILITY_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a knowledge graph extractor for government and business documents. Given document text, extract three types of structured information. Return valid JSON only.

Output schema:
{
  "relationships": [
    {
      "entity_a": "Organization or person name",
      "entity_b": "Organization or person name",
      "relation_type": "one of: offered_to, subsidiary_of, partnered_with, represents, regulates, contracted_with, invested_in, advises, competes_with",
      "direction": "a_to_b",
      "confidence": "high"
    }
  ],
  "obligations": [
    {
      "responsible_party": "Who must act",
      "counterparty": "Who they owe the action to (or null)",
      "action": "What must be done — specific and concrete",
      "deadline": "ISO date string or null if no deadline mentioned"
    }
  ],
  "facts": [
    {
      "claim_key": "normalized_snake_case_key (e.g. usufruct_period, capex_estimate, land_area)",
      "claim_label": "Human-readable label (e.g. Usufruct Period)",
      "value": "The stated value with units (e.g. 14 years, 1.2 billion EGP, 500,000 sqm)"
    }
  ]
}

Rules:
- Only extract relationships between NAMED entities (organizations, people, authorities). Skip generic references.
- Obligations must be concrete actions, not descriptions of policy. "Submit environmental report by June 2026" is an obligation. "The authority promotes investment" is not.
- Facts must be specific quantitative or qualitative claims that could change between documents (prices, areas, durations, percentages, dates, classifications).
- If uncertain, omit rather than guess. Empty arrays are fine.
- Keep arrays concise: max 10 relationships, 8 obligations, 15 facts per document.`,
        },
        {
          role: "user",
          content: `Document: "${doc?.title ?? "Untitled"}"\n\n${sampleText}`,
        },
      ],
    });

    extracted = JSON.parse(res.choices[0].message.content ?? "{}");
  } catch (err) {
    log.error("Knowledge graph extraction LLM call failed", err, {
      documentId,
    });
    return { relationships: 0, obligations: 0, facts: 0 };
  }

  let relCount = 0;
  let oblCount = 0;
  let factCount = 0;

  // Store relationships
  for (const rel of extracted.relationships ?? []) {
    const [aId, bId] = await Promise.all([
      resolveEntityId(rel.entity_a),
      resolveEntityId(rel.entity_b),
    ]);
    if (!aId || !bId || aId === bId) continue;

    const { error } = await supabaseAdmin
      .from("entity_relationships")
      .insert({
        entity_a_id: aId,
        entity_b_id: bId,
        relation_type: rel.relation_type,
        direction: rel.direction ?? "a_to_b",
        source_document_id: documentId,
        source_chunk_id: chunks[0]?.id ?? null,
        confidence: rel.confidence ?? "medium",
      });
    if (!error) relCount++;
  }

  // Store obligations
  for (const obl of extracted.obligations ?? []) {
    const responsibleId = await resolveEntityId(obl.responsible_party);

    let counterpartyId: string | null = null;
    if (obl.counterparty) {
      counterpartyId = await resolveEntityId(obl.counterparty);
    }

    // Find project link if document is in a project
    const { data: projLink } = await supabaseAdmin
      .from("project_documents")
      .select("project_id")
      .eq("document_id", documentId)
      .limit(1);

    const { error } = await supabaseAdmin.from("obligations").insert({
      responsible_entity_id: responsibleId,
      counterparty_entity_id: counterpartyId,
      action: obl.action,
      deadline: obl.deadline ?? null,
      status: "pending",
      source_document_id: documentId,
      source_chunk_id: chunks[0]?.id ?? null,
      project_id: projLink?.[0]?.project_id ?? null,
    });
    if (!error) oblCount++;
  }

  // Store / update fact versions
  for (const fact of extracted.facts ?? []) {
    const { data: existing } = await supabaseAdmin
      .from("fact_versions")
      .select("id, value")
      .eq("claim_key", fact.claim_key)
      .order("extracted_at", { ascending: false })
      .limit(1);

    const previousValue = existing?.[0]?.value ?? null;

    if (previousValue === fact.value) continue;

    const { error } = await supabaseAdmin.from("fact_versions").insert({
      claim_key: fact.claim_key,
      claim_label: fact.claim_label,
      value: fact.value,
      previous_value: previousValue,
      source_document_id: documentId,
      source_chunk_id: chunks[0]?.id ?? null,
      document_date: doc?.created_at
        ? new Date(doc.created_at).toISOString().split("T")[0]
        : null,
    });
    if (!error) factCount++;
  }

  log.info("Knowledge graph extracted", {
    documentId,
    relationships: relCount,
    obligations: oblCount,
    facts: factCount,
  });

  return { relationships: relCount, obligations: oblCount, facts: factCount };
}
