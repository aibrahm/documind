// src/lib/date-sanitize.ts
//
// Filter OCR garbage out of extracted date strings before they hit the UI
// or retrieval. The problem: Azure's layout model occasionally reads a
// scanned page wrong and returns strings like "لسنة 7025" or "سنة 1447"
// as "dates." Those are text artifacts, not calendar values — no
// Egyptian government document is actually dated year 7025.
//
// The filter is deliberately permissive so we don't accidentally drop
// real dates:
//
//   - Gregorian years: 1900–(current + 10). Any string containing a
//     four-digit year outside that window is discarded.
//   - Hijri years: 1300–1460. Same treatment. 1447 (what we saw in the
//     screenshot) falls inside this window so it's kept — BUT only if
//     the surrounding context actually looks like a Hijri reference
//     (the string contains "هـ" or "AH" or the number clearly reads
//     as a Hijri year). Otherwise 1447 is suspect.
//   - Strings that contain no four-digit year at all (e.g. "فبراير 2026"
//     where the year is already inside) are kept if they parse at all.
//
// Return null means "drop this". Return a string means "safe to show".

const CURRENT_YEAR = new Date().getFullYear();
const GREG_MIN = 1900;
const GREG_MAX = CURRENT_YEAR + 10;
const HIJRI_MIN = 1300;
const HIJRI_MAX = 1460;

// Map Arabic-Indic digits to ASCII so number checks are uniform.
function toAsciiDigits(s: string): string {
  return s.replace(/[\u0660-\u0669]/g, (d) =>
    String(d.charCodeAt(0) - 0x0660),
  );
}

export function sanitizeDateString(value: string): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const normalized = toAsciiDigits(trimmed);
  // Scan for four-digit year tokens. A "date" string with no such token
  // (e.g. bare "ديسمبر" or "March") isn't useful anyway, drop it.
  const yearMatches = normalized.match(/\b\d{4}\b/g);
  if (!yearMatches || yearMatches.length === 0) return null;

  // If any year in the string is clearly nonsense (both outside Gregorian
  // range AND outside Hijri range), drop the whole string.
  const looksHijri = /هـ|AH\b|\bلسنة\b|\bسنة\b/i.test(normalized);
  for (const y of yearMatches) {
    const n = parseInt(y, 10);
    const gregOk = n >= GREG_MIN && n <= GREG_MAX;
    const hijriOk = n >= HIJRI_MIN && n <= HIJRI_MAX;

    if (!gregOk && !hijriOk) {
      // Nonsense year — "7025", "9999" etc.
      return null;
    }
    // If only the Hijri window matches, require a Hijri context marker.
    // Without one, we're probably looking at an OCR misread of a 4-digit
    // number that happened to land in the Hijri window by accident.
    if (!gregOk && hijriOk && !looksHijri) {
      return null;
    }
  }

  return trimmed;
}
