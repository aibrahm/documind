import { supabaseAdmin } from "./supabase";

/**
 * Entity canonicalization.
 *
 * Goal: when extraction surfaces "El Sewedy Electric", "Elsewedy",
 * "السويدي إلكتريك", and "El-Sewedy Electric Industries", they should all
 * resolve to the SAME entity row in the database, not four different rows.
 *
 * Strategy:
 * 1. Normalize candidate name (case, whitespace, common variants).
 * 2. Look for an exact match against the normalized form of any existing
 *    entity's name OR name_en (cross-language matching is allowed).
 * 3. Fall back to fuzzy match (token overlap + edit-distance ratio) above
 *    a similarity threshold.
 * 4. If still no match, insert a new canonical row.
 *
 * Returns the canonical entity ID for each input.
 */

export interface CandidateEntity {
  name: string;
  type: string; // "company" | "ministry" | "project" | "person" | "place" | "law" etc
  nameEn?: string | null;
}

export interface CanonicalEntity {
  id: string;
  name: string;
  type: string;
  name_en: string | null;
}

const SIMILARITY_THRESHOLD = 0.82;

// Government and authority names almost always have stable keywords
// ("هيئة", "وزارة", "authority", "ministry") plus a specific qualifier
// that gets OCR-mangled in slightly different ways on different scans
// of the same document. The Abu Dhabi Ports memo we debugged showed
// the same authority appearing FOUR times under near-duplicate spellings
// that the 0.82 threshold was letting through as distinct.
//
// For these high-risk types we apply an additional content-prefix
// check: if two normalized names share their first NORMALIZED_PREFIX
// characters AND are both of the same authority-like type, they're
// considered the same entity regardless of the numeric similarity score.
const AUTHORITY_TYPES = new Set([
  "authority",
  "ministry",
  "institution",
  "government",
  "agency",
]);
const NORMALIZED_PREFIX = 14;

function authorityPrefixMatch(
  a: { name: string; type: string },
  b: { name: string; type: string },
): boolean {
  if (!AUTHORITY_TYPES.has(a.type.toLowerCase())) return false;
  if (!AUTHORITY_TYPES.has(b.type.toLowerCase())) return false;
  const na = normalizeName(a.name);
  const nb = normalizeName(b.name);
  if (na.length < NORMALIZED_PREFIX || nb.length < NORMALIZED_PREFIX) return false;
  return na.slice(0, NORMALIZED_PREFIX) === nb.slice(0, NORMALIZED_PREFIX);
}

// ────────────────────────────────────────
// NORMALIZATION
// ────────────────────────────────────────

/**
 * Normalize a name for matching:
 * - Trim and collapse whitespace
 * - Lowercase Latin characters
 * - Strip Arabic diacritics (tashkeel)
 * - Normalize Arabic alif variants (أ إ آ → ا)
 * - Normalize teh marbouta (ة → ه) for matching
 * - Normalize alef maksura (ى → ي)
 * - Strip common corporate suffixes (Ltd, Inc, LLC, Co, شركة)
 * - Remove punctuation
 */
export function normalizeName(raw: string): string {
  if (!raw) return "";
  let s = raw.trim();

  // Strip Arabic diacritics
  s = s.replace(/[\u064B-\u0652\u0670]/g, "");

  // Normalize Arabic letter variants
  s = s
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");

  // Strip common Western punctuation
  s = s.replace(/[.,'"`’‘\-_/\\()]/g, " ");

  // Lowercase Latin
  s = s.toLowerCase();

  // Strip common corporate suffixes (after lowercase)
  s = s
    .replace(/\b(ltd|llc|inc|corp|corporation|company|co|gmbh|sa|holdings?|industries|group|plc)\b/g, "")
    .replace(/شركة\s+/g, "")
    .replace(/مؤسسة\s+/g, "")
    .replace(/مجموعة\s+/g, "");

  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

// ────────────────────────────────────────
// SIMILARITY (token + edit distance hybrid)
// ────────────────────────────────────────

/**
 * Hybrid similarity score in [0, 1]. Combines token overlap (Jaccard) with
 * edit-distance ratio (Levenshtein normalized to length). The hybrid handles
 * both word reorderings and minor spelling variations.
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

  // Weighted combination: token overlap is more reliable for word-order
  // variations, edit ratio catches typos within words.
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
// CANONICALIZATION
// ────────────────────────────────────────

/**
 * Resolve a list of candidate entities against the existing canonical entities
 * in the database. Returns canonical entity IDs in the same order as input.
 *
 * Side effect: inserts new canonical rows for entities that don't match anything.
 */
export async function canonicalizeEntities(
  candidates: CandidateEntity[],
): Promise<string[]> {
  if (candidates.length === 0) return [];

  // Pull all existing entities of the relevant types in one query
  const types = [...new Set(candidates.map((c) => c.type))];
  const { data: existing } = await supabaseAdmin
    .from("entities")
    .select("id, name, type, name_en")
    .in("type", types);

  const existingByType = new Map<string, CanonicalEntity[]>();
  for (const e of (existing || []) as CanonicalEntity[]) {
    if (!existingByType.has(e.type)) existingByType.set(e.type, []);
    existingByType.get(e.type)!.push(e);
  }

  // Pre-compute normalized forms for existing entities
  const normalizedCache = new Map<string, { name: string; nameEn: string }>();
  for (const e of (existing || []) as CanonicalEntity[]) {
    normalizedCache.set(e.id, {
      name: normalizeName(e.name),
      nameEn: normalizeName(e.name_en || ""),
    });
  }

  const resolvedIds: string[] = [];
  // Track newly-inserted entities so subsequent candidates in the same batch
  // can resolve to them rather than creating duplicates.
  const newlyInserted: CanonicalEntity[] = [];

  for (const candidate of candidates) {
    const normName = normalizeName(candidate.name);
    const normNameEn = normalizeName(candidate.nameEn || "");
    const sameType = existingByType.get(candidate.type) || [];

    let bestMatch: { id: string; score: number } | null = null;
    // Authority-prefix match is a HARD override: if two authority-type
    // names share their first 14 normalized characters, we consider them
    // the same entity regardless of the numeric similarity score. This
    // catches OCR spelling drift on government entities where the
    // standard similarity score sometimes dips under the 0.82 threshold.
    let authorityOverride: string | null = null;

    // Compare against existing
    for (const e of sameType) {
      const cached = normalizedCache.get(e.id)!;
      // Cross-language matching: candidate.name vs e.name AND e.name_en, both directions
      const scores = [
        similarity(normName, cached.name),
        normNameEn ? similarity(normNameEn, cached.nameEn) : 0,
        normNameEn ? similarity(normNameEn, cached.name) : 0,
        cached.nameEn ? similarity(normName, cached.nameEn) : 0,
      ];
      const score = Math.max(...scores);
      if (score > (bestMatch?.score ?? 0)) {
        bestMatch = { id: e.id, score };
      }
      if (
        !authorityOverride &&
        authorityPrefixMatch(
          { name: candidate.name, type: candidate.type },
          { name: e.name, type: e.type },
        )
      ) {
        authorityOverride = e.id;
      }
    }

    // Also compare against entities inserted earlier in this batch
    for (const e of newlyInserted) {
      if (e.type !== candidate.type) continue;
      const score = Math.max(
        similarity(normName, normalizeName(e.name)),
        normNameEn ? similarity(normNameEn, normalizeName(e.name_en || "")) : 0,
      );
      if (score > (bestMatch?.score ?? 0)) {
        bestMatch = { id: e.id, score };
      }
      if (
        !authorityOverride &&
        authorityPrefixMatch(
          { name: candidate.name, type: candidate.type },
          { name: e.name, type: e.type },
        )
      ) {
        authorityOverride = e.id;
      }
    }

    if (authorityOverride) {
      resolvedIds.push(authorityOverride);
    } else if (bestMatch && bestMatch.score >= SIMILARITY_THRESHOLD) {
      resolvedIds.push(bestMatch.id);
    } else {
      // Insert new canonical row
      const { data: inserted, error } = await supabaseAdmin
        .from("entities")
        .insert({
          name: candidate.name,
          type: candidate.type,
          name_en: candidate.nameEn || null,
        })
        .select("id, name, type, name_en")
        .single();

      if (error || !inserted) {
        // If duplicate-key error from old `(name,type)` constraint, try fetching
        const { data: existingRow } = await supabaseAdmin
          .from("entities")
          .select("id, name, type, name_en")
          .eq("name", candidate.name)
          .eq("type", candidate.type)
          .maybeSingle();
        if (existingRow) {
          resolvedIds.push(existingRow.id);
          continue;
        }
        // Last resort: skip
        console.error("Failed to canonicalize entity:", candidate, error);
        continue;
      }

      resolvedIds.push(inserted.id);
      newlyInserted.push(inserted as CanonicalEntity);
      // Add to per-type cache so subsequent candidates can match it
      if (!existingByType.has(candidate.type)) existingByType.set(candidate.type, []);
      existingByType.get(candidate.type)!.push(inserted as CanonicalEntity);
      normalizedCache.set(inserted.id, {
        name: normalizeName(inserted.name),
        nameEn: normalizeName(inserted.name_en || ""),
      });
    }
  }

  return resolvedIds;
}

/**
 * Common short tokens that should NOT count as a distinctive entity match
 * even if they appear in both the entity name and the user text.
 */
const COMMON_TOKENS = new Set([
  "the", "and", "of", "in", "for", "to", "a", "an", "is", "with",
  "electric", "industries", "company", "group", "international", "global",
  "general", "authority", "ministry", "egypt", "egyptian",
  "في", "من", "على", "إلى", "هو", "هي", "ال", "شركة", "هيئة",
  "العامة", "المصرية", "مصر", "دولة", "وزارة",
]);

const DISTINCTIVE_TOKEN_MIN_LENGTH = 4;

/**
 * Find entities matching a free-text query (used by the chat router to detect
 * when a user message references a known entity).
 *
 * Match strategies, in order of confidence:
 * 1. Full substring match of the entity name in the text (e.g. "elsewedy electric" found verbatim)
 * 2. Distinctive token match — at least one rare/long token from the entity
 *    name appears in the text (e.g. "elsewedy" appears, even without "electric")
 * 3. Multi-token overlap above 50%
 */
export async function findEntitiesInText(
  text: string,
  maxResults = 5,
): Promise<CanonicalEntity[]> {
  if (!text || text.length < 2) return [];

  const { data: entities } = await supabaseAdmin
    .from("entities")
    .select("id, name, type, name_en");
  if (!entities) return [];

  const normalizedText = normalizeName(text);
  const textTokens = new Set(normalizedText.split(" ").filter(Boolean));
  const matches: Array<{ entity: CanonicalEntity; score: number }> = [];

  for (const e of entities as CanonicalEntity[]) {
    const normName = normalizeName(e.name);
    const normNameEn = normalizeName(e.name_en || "");

    // Strategy 1: full substring match
    if (normName && normName.length >= 3 && normalizedText.includes(normName)) {
      matches.push({ entity: e, score: 1.0 });
      continue;
    }
    if (normNameEn && normNameEn.length >= 3 && normalizedText.includes(normNameEn)) {
      matches.push({ entity: e, score: 1.0 });
      continue;
    }

    // Tokenize entity (use both name and name_en, dedupe)
    const allEntityTokens = [
      ...normName.split(" "),
      ...normNameEn.split(" "),
    ].filter((t) => t.length >= 3);
    const entityTokens = [...new Set(allEntityTokens)];
    if (entityTokens.length === 0) continue;

    // Strategy 2: distinctive single-token match
    // A "distinctive" token is long enough and not in the common-token list.
    // Even one match of a distinctive token is strong evidence (e.g.
    // "elsewedy" alone is enough — no one else is named that).
    const distinctiveHits = entityTokens.filter(
      (t) => t.length >= DISTINCTIVE_TOKEN_MIN_LENGTH && !COMMON_TOKENS.has(t) && textTokens.has(t),
    );
    if (distinctiveHits.length > 0) {
      matches.push({ entity: e, score: 0.9 });
      continue;
    }

    // Strategy 3: multi-token overlap
    let totalHits = 0;
    for (const et of entityTokens) {
      if (textTokens.has(et)) totalHits++;
    }
    const overlap = totalHits / entityTokens.length;
    if (overlap >= 0.5) {
      matches.push({ entity: e, score: 0.6 + 0.3 * overlap });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, maxResults).map((m) => m.entity);
}
