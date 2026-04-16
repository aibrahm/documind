import { generateEmbeddings } from "./embeddings";
import { supabaseAdmin } from "./supabase";

/**
 * Entity canonicalization (embedding-backed).
 *
 * Goal: when extraction surfaces "El Sewedy Electric", "Elsewedy",
 * "السويدي إلكتريك", and an OCR-mangled "للمست الذهبي" instead of the
 * intended "للمثلث الذهبي", they should resolve to the SAME entity row
 * in the database, not four different ones — which is what the entity
 * explorer screenshot showed under the prior fuzzy-string matcher.
 *
 * Strategy:
 *   1. Build a search string per candidate from name + nameEn + aliases.
 *   2. Embed every candidate in one Cohere batch (1024-dim, same model
 *      as chunks.embedding so the vector space is consistent).
 *   3. For each candidate, find the best existing entity of the SAME type
 *      with cosine similarity above CANONICAL_SIMILARITY_THRESHOLD (0.88).
 *      If found → merge (append aliases to the existing row, log it,
 *      reuse the existing id).
 *   4. Else insert a new row with the embedding stored.
 *   5. Every decision is logged to `entity_canonicalization_log` so the
 *      threshold can be tuned post-migration by inspecting false merges
 *      and false splits.
 *
 * The fuzzy-string `normalizeName` and `similarity` helpers are kept
 * exported because the entities route + the picker still use them for
 * UI-level deduplication on already-canonicalized rows. They are NOT
 * the canonicalization mechanism anymore.
 */

// ────────────────────────────────────────
// TYPES
// ────────────────────────────────────────

export interface CandidateEntity {
  name: string;
  type: string;
  nameEn?: string | null;
  aliases?: string[];
}

export interface CanonicalEntity {
  id: string;
  name: string;
  type: string;
  name_en: string | null;
}

interface ExistingEntityRow {
  id: string;
  name: string;
  name_en: string | null;
  type: string;
  aliases: string[] | null;
  embedding: number[] | null;
}

// ────────────────────────────────────────
// PUBLIC HELPERS (kept for backwards compatibility)
// ────────────────────────────────────────

/**
 * Normalize a name for matching:
 * - Trim and collapse whitespace
 * - Lowercase Latin characters
 * - Strip Arabic diacritics (tashkeel)
 * - Normalize Arabic alif variants (أ إ آ → ا)
 * - Normalize teh marbouta (ة → ه)
 * - Normalize alef maksura (ى → ي)
 * - Strip common corporate suffixes (Ltd, Inc, LLC, شركة, ...)
 * - Remove Western punctuation
 *
 * Used by the entities API route and the picker for surface-level dedup
 * after canonicalization has already chosen which row to point to.
 */
export function normalizeName(raw: string): string {
  if (!raw) return "";
  let s = raw.trim();
  s = s.replace(/[\u064B-\u0652\u0670]/g, "");
  s = s
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
  s = s.replace(/[.,'"`’‘\-_/\\()]/g, " ");
  s = s.toLowerCase();
  s = s
    .replace(
      /\b(ltd|llc|inc|corp|corporation|company|co|gmbh|sa|holdings?|industries|group|plc)\b/g,
      "",
    )
    .replace(/شركة\s+/g, "")
    .replace(/مؤسسة\s+/g, "")
    .replace(/مجموعة\s+/g, "");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Hybrid Jaccard + Levenshtein similarity in [0, 1]. Surface-level only —
 * the canonicalizer uses embeddings, not this function. The entities API
 * route still uses it for "did you mean to merge these two rows" hints.
 */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = new Set(b.split(" ").filter(Boolean));
  const intersection = new Set([...aTokens].filter((t) => bTokens.has(t)));
  const union = new Set([...aTokens, ...bTokens]);
  const jaccard = union.size === 0 ? 0 : intersection.size / union.size;
  const distance = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  const editRatio = maxLen === 0 ? 0 : 1 - distance / maxLen;
  return 0.65 * jaccard + 0.35 * editRatio;
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

// ────────────────────────────────────────
// CANONICALIZATION (embedding-based)
// ────────────────────────────────────────

/**
 * Cosine similarity threshold above which two entities are considered the
 * same. Starting point — tune by inspecting `entity_canonicalization_log`
 * after the library migration. Higher = more splits, lower = more merges.
 *
 * 0.88 was chosen by:
 *   - Cohere multilingual-v3 embeds the same Arabic name across OCR
 *     variants typically at ~0.93–0.97 cosine.
 *   - Distinct entities of the same type ("Ministry of Defense" vs
 *     "Ministry of Finance") sit around 0.78–0.85.
 *   - 0.88 splits the gap with bias toward merging OCR variants.
 */
const CANONICAL_SIMILARITY_THRESHOLD = 0.88;

function buildSearchText(input: {
  name: string;
  nameEn?: string | null;
  aliases?: string[];
}): string {
  return [input.name, input.nameEn ?? "", ...(input.aliases ?? [])]
    .filter(Boolean)
    .join(" · ");
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * pgvector serializes embeddings as JSON-array text inside the Postgres
 * driver — supabase-js returns them as either `string` or `number[]`
 * depending on the column quoting. This normalizes both shapes to a
 * plain `number[]` for cosine math.
 */
function parseEmbedding(raw: unknown): number[] | null {
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as number[]) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Get or create the bucket array for a key in a Map<K, V[]>. Avoids the
 * `if (!map.has) set; map.get(key)!` pattern that biome flags as a
 * non-null assertion.
 */
function bucketFor<K, V>(map: Map<K, V[]>, key: K): V[] {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = [];
    map.set(key, bucket);
  }
  return bucket;
}

function dedupeAliases(
  existing: string[],
  incoming: string[],
  canonicalName: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const skip = (s: string) => normalizeName(s) === normalizeName(canonicalName);
  for (const a of [...existing, ...incoming]) {
    const trimmed = a.trim();
    if (!trimmed) continue;
    if (skip(trimmed)) continue;
    const key = normalizeName(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

async function logCanonDecision(opts: {
  documentId: string | null;
  candidate: CandidateEntity;
  decision: "merged" | "inserted";
  matchedEntityId: string | null;
  similarity: number | null;
}) {
  await supabaseAdmin.from("entity_canonicalization_log").insert({
    document_id: opts.documentId,
    raw_name: opts.candidate.name,
    raw_name_en: opts.candidate.nameEn ?? null,
    raw_type: opts.candidate.type,
    decision: opts.decision,
    matched_entity_id: opts.matchedEntityId,
    similarity: opts.similarity,
    threshold: CANONICAL_SIMILARITY_THRESHOLD,
  });
}

/**
 * Resolve a list of candidate entities against the existing canonical
 * entities in the database, using embedding cosine similarity.
 *
 * Returns canonical entity IDs in the same order as the input. Side
 * effect: inserts new canonical rows for entities that don't match,
 * and updates `aliases` on rows that do.
 *
 * @param candidates  Raw entities pulled from the LLM extractor.
 * @param documentId  Source doc id, recorded in the canonicalization log.
 */
export async function canonicalizeEntities(
  candidates: CandidateEntity[],
  documentId: string | null = null,
): Promise<string[]> {
  if (candidates.length === 0) return [];

  // Embed every candidate in one Cohere batch.
  const candidateTexts = candidates.map(buildSearchText);
  const candidateEmbeddings = await generateEmbeddings(
    candidateTexts,
    "search_document",
  );

  // Pull every existing entity of the relevant types (per the screenshot
  // the user shared, the entire entities table is small enough that
  // pulling the full set per-type is fine — typically <200 rows even at
  // moderate scale). When this becomes a hot path we can switch to a
  // pgvector RPC.
  const types = [...new Set(candidates.map((c) => c.type))];
  const { data: existing, error } = await supabaseAdmin
    .from("entities")
    .select("id, name, name_en, type, aliases, embedding")
    .in("type", types);
  if (error) {
    console.error(
      "[canonicalize] failed to load existing entities:",
      error.message,
    );
  }

  const byType = new Map<string, ExistingEntityRow[]>();
  for (const row of (existing as ExistingEntityRow[] | null) ?? []) {
    bucketFor(byType, row.type).push(row);
  }

  const resolvedIds: string[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const candidateEmbedding = candidateEmbeddings[i];
    if (!candidateEmbedding) {
      console.warn(
        `[canonicalize] no embedding for candidate ${candidate.name}, skipping`,
      );
      continue;
    }

    const sameType = byType.get(candidate.type) ?? [];

    // Find best existing match by cosine similarity.
    let best: { row: ExistingEntityRow; score: number } | null = null;
    for (const row of sameType) {
      const rowEmbedding = parseEmbedding(row.embedding);
      if (!rowEmbedding) continue;
      const score = cosine(candidateEmbedding, rowEmbedding);
      if (score > (best?.score ?? 0)) {
        best = { row, score };
      }
    }

    if (best && best.score >= CANONICAL_SIMILARITY_THRESHOLD) {
      // ── MERGE ──
      // Append any new alias (including the candidate's name itself if
      // it differs from the canonical row's name) to the existing row.
      const incoming = [candidate.name, ...(candidate.aliases ?? [])];
      const mergedAliases = dedupeAliases(
        best.row.aliases ?? [],
        incoming,
        best.row.name,
      );

      const { error: updateError } = await supabaseAdmin
        .from("entities")
        .update({ aliases: mergedAliases })
        .eq("id", best.row.id);
      if (updateError) {
        console.warn(
          `[canonicalize] failed to update aliases on ${best.row.id}:`,
          updateError.message,
        );
      } else {
        // Reflect the change in the local cache so subsequent candidates
        // in this batch see the merged state.
        best.row.aliases = mergedAliases;
      }

      resolvedIds.push(best.row.id);
      await logCanonDecision({
        documentId,
        candidate,
        decision: "merged",
        matchedEntityId: best.row.id,
        similarity: best.score,
      });
      continue;
    }

    // ── INSERT new row ──
    const embeddingLiteral = `[${candidateEmbedding.join(",")}]`;
    const aliases = candidate.aliases ?? [];
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("entities")
      .insert({
        name: candidate.name,
        type: candidate.type,
        name_en: candidate.nameEn ?? null,
        aliases,
        embedding: embeddingLiteral,
      })
      .select("id, name, name_en, type, aliases")
      .single();

    if (insertError || !inserted) {
      // Most likely a violation of the legacy `UNIQUE(name, type)`
      // constraint — fetch the existing row and reuse its id rather than
      // failing the whole batch.
      const { data: dupe } = await supabaseAdmin
        .from("entities")
        .select("id, name, name_en, type, aliases")
        .eq("name", candidate.name)
        .eq("type", candidate.type)
        .maybeSingle();
      if (dupe) {
        resolvedIds.push(dupe.id);
        await logCanonDecision({
          documentId,
          candidate,
          decision: "merged",
          matchedEntityId: dupe.id,
          similarity: null,
        });
        continue;
      }
      console.error(
        `[canonicalize] failed to insert ${candidate.name}:`,
        insertError?.message,
      );
      continue;
    }

    resolvedIds.push(inserted.id);
    // Add the new row to the per-type cache so the next candidate in the
    // same batch can match it without a roundtrip.
    const row: ExistingEntityRow = {
      id: inserted.id,
      name: inserted.name,
      name_en: inserted.name_en,
      type: inserted.type,
      aliases: inserted.aliases ?? [],
      embedding: candidateEmbedding,
    };
    bucketFor(byType, candidate.type).push(row);

    await logCanonDecision({
      documentId,
      candidate,
      decision: "inserted",
      matchedEntityId: inserted.id,
      similarity: best?.score ?? null,
    });
  }

  return resolvedIds;
}
