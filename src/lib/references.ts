import { supabaseAdmin } from "./supabase";
import { normalizeNumbers } from "./normalize";

interface DetectedReference {
  text: string;
  type: "law" | "article" | "decree" | "regulation";
}

/**
 * Detect cross-references in document text.
 * Identifies references to Egyptian laws, articles, and decrees.
 */
export function detectReferences(text: string): DetectedReference[] {
  const references: DetectedReference[] = [];
  const seen = new Set<string>();

  // Arabic law references: القانون رقم X لسنة YYYY
  const arabicLawPattern =
    /القانون\s+رقم\s+[\d٠-٩]+\s+لسنة\s+[\d٠-٩]+/g;
  for (const match of text.matchAll(arabicLawPattern)) {
    const normalized = normalizeNumbers(match[0]);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      references.push({ text: match[0], type: "law" });
    }
  }

  // Arabic decree references: المرسوم بقانون رقم X لسنة YYYY
  const decreePattern =
    /(?:المرسوم\s+)?بقانون\s+رقم\s+[\d٠-٩]+\s+لسنة\s+[\d٠-٩]+/g;
  for (const match of text.matchAll(decreePattern)) {
    const normalized = normalizeNumbers(match[0]);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      references.push({ text: match[0], type: "decree" });
    }
  }

  // Arabic article references: المادة (X) or مادة X
  const articlePattern = /(?:ال)?مادة\s*(?:\([\d٠-٩]+\)|[\d٠-٩]+)/g;
  for (const match of text.matchAll(articlePattern)) {
    if (!seen.has(match[0])) {
      seen.add(match[0]);
      references.push({ text: match[0], type: "article" });
    }
  }

  // English law references: Law No. X of YYYY
  const englishLawPattern = /Law\s+No\.?\s+\d+\s+of\s+\d{4}/gi;
  for (const match of text.matchAll(englishLawPattern)) {
    if (!seen.has(match[0])) {
      seen.add(match[0]);
      references.push({ text: match[0], type: "law" });
    }
  }

  return references;
}

/**
 * Store detected references and attempt to resolve them against existing documents.
 */
export async function storeAndResolveReferences(
  sourceDocId: string,
  references: DetectedReference[]
): Promise<void> {
  if (references.length === 0) return;

  for (const ref of references) {
    // Try to find a matching document in the system
    const { data: matchingDocs } = await supabaseAdmin
      .from("documents")
      .select("id, title")
      .or(`title.ilike.%${extractLawNumber(ref.text)}%`)
      .limit(1);

    const targetId = matchingDocs?.[0]?.id || null;

    await supabaseAdmin.from("document_references").upsert(
      {
        source_id: sourceDocId,
        target_id: targetId,
        reference_text: ref.text,
        reference_type: ref.type,
        resolved: !!targetId,
      },
      { onConflict: "source_id,reference_text" }
    );
  }
}

/**
 * Extract a law number string for fuzzy matching.
 */
function extractLawNumber(refText: string): string {
  const normalized = normalizeNumbers(refText);
  const numbers = normalized.match(/\d+/g);
  return numbers ? numbers.join(" ") : refText;
}
