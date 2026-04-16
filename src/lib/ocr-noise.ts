// src/lib/ocr-noise.ts
//
// Heuristic for "this is OCR output from a figure/map/icon, not real
// text." Used at two layers:
//
//   1. Chunking (src/lib/chunking.ts) — sections flagged as noise are
//      skipped outright, so the character soup never becomes a chunk
//      that gets embedded + retrieved.
//   2. Extraction tab display (documents/[id]/page.tsx) — belt-and-
//      suspenders filter on what's rendered, catching any noise that
//      survived from the old extraction pipeline before a re-migration.
//
// Noise shapes we catch (real examples from a Hamza Fuels slide deck
// extraction — the user's complaint that kicked this off):
//   - "T D D 0 D D 0 D D T A A A 4 A A A"  — single-char tokens
//     pulled from a DAC schematic diagram's labels
//   - "TO 11 A"                              — icon caption fragments
//   - "$ %"                                  — symbol soup from a
//     services list
//   - "0 O Be $ 0 Z O D ®"                  — alternating chars from
//     a row of pictograms
//
// The rules are intentionally conservative — they only flag short
// content (<100 chars) where most tokens are single characters or
// symbols. Longer prose with occasional abbreviations (like "ISO
// 14001" or "Egypt's GDP") passes through untouched.

/**
 * Return true if `content` looks like OCR output from a figure, map,
 * icon, or other graphic — i.e., it's too fragmented or symbol-heavy
 * to be real prose. Tables should be checked separately by the caller
 * before applying this (a table can have sparse text and still be real
 * data).
 */
export function looksLikeOcrNoise(content: string): boolean {
  const trimmed = content.trim();
  // Sub-3-char single tokens ("S", "A", "®") are always noise.
  if (trimmed.length < 3) return true;

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;

  // If more than half the whitespace-separated tokens are single
  // characters, this is almost certainly an icon/diagram OCR. Catches
  // the "T D D 0 D D 0" horror strings from pictogram rows.
  const singleCharTokens = tokens.filter((t) => t.length === 1).length;
  if (singleCharTokens / tokens.length > 0.5) return true;

  // Short content (<100 chars) with a very low average token length is
  // symbol soup. Catches "TO 11 A" and "$ %". The 100-char cap keeps
  // the rule from nuking legitimate short labels like "Revenue 2024".
  const alphanumericLength = trimmed.replace(/\s+/g, "").length;
  const avgTokenLength = alphanumericLength / tokens.length;
  if (avgTokenLength < 1.7 && trimmed.length < 100) return true;

  return false;
}
