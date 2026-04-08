export interface InventoryDocument {
  id: string;
  title: string;
}

export interface ResolvedDocumentTarget {
  id: string;
  title: string;
  reason: "inventory_position" | "exact_title";
  detail: string;
}

const ENGLISH_ORDINALS: Record<string, number> = {
  first: 1,
  "1st": 1,
  second: 2,
  "2nd": 2,
  third: 3,
  "3rd": 3,
  fourth: 4,
  "4th": 4,
  fifth: 5,
  "5th": 5,
  sixth: 6,
  "6th": 6,
  seventh: 7,
  "7th": 7,
  eighth: 8,
  "8th": 8,
  ninth: 9,
  "9th": 9,
  tenth: 10,
  "10th": 10,
};

const ARABIC_ORDINALS: Record<string, number> = {
  الاول: 1,
  الأولى: 1,
  الاولى: 1,
  الثاني: 2,
  الثانية: 2,
  الثالث: 3,
  الثالثة: 3,
  الرابع: 4,
  الرابعة: 4,
  الخامس: 5,
  الخامسة: 5,
  السادس: 6,
  السادسة: 6,
  السابع: 7,
  السابعة: 7,
  الثامن: 8,
  الثامنة: 8,
  التاسع: 9,
  التاسعة: 9,
  العاشر: 10,
  العاشرة: 10,
};

function toAsciiDigits(value: string): string {
  return value.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

function normalizeText(value: string): string {
  return toAsciiDigits(value)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/["'`“”‘’«»]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractInventoryPosition(userMessage: string, max: number): number | null {
  const ascii = toAsciiDigits(userMessage);

  const numericMatch = ascii.match(
    /(?:document|doc|file|item|number|#|رقم|المستند|الوثيقة)\s*#?\s*(\d{1,3})/i,
  );
  if (numericMatch) {
    const index = Number.parseInt(numericMatch[1], 10);
    return index >= 1 && index <= max ? index : null;
  }

  const englishMatch = ascii.match(
    /\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|sixth|6th|seventh|7th|eighth|8th|ninth|9th|tenth|10th)\b/i,
  );
  if (englishMatch) {
    const index = ENGLISH_ORDINALS[englishMatch[1].toLowerCase()];
    return index >= 1 && index <= max ? index : null;
  }

  const normalized = normalizeText(userMessage);
  for (const [token, index] of Object.entries(ARABIC_ORDINALS)) {
    if (normalized.includes(token) && index <= max) {
      return index;
    }
  }

  return null;
}

function extractQuotedPhrases(userMessage: string): string[] {
  const matches = userMessage.matchAll(/["'“”‘’«»]([^"'“”‘’«»]{4,})["'“”‘’«»]/g);
  return [...matches]
    .map((match) => match[1]?.trim() || "")
    .filter(Boolean);
}

export function resolveDocumentTargetsFromInventory(
  userMessage: string,
  inventory: InventoryDocument[],
): ResolvedDocumentTarget[] {
  if (inventory.length === 0) return [];

  const resolved: ResolvedDocumentTarget[] = [];
  const seen = new Set<string>();
  const add = (doc: InventoryDocument, reason: ResolvedDocumentTarget["reason"], detail: string) => {
    if (seen.has(doc.id)) return;
    seen.add(doc.id);
    resolved.push({ id: doc.id, title: doc.title, reason, detail });
  };

  const byIndex = extractInventoryPosition(userMessage, inventory.length);
  if (byIndex !== null) {
    const doc = inventory[byIndex - 1];
    if (doc) add(doc, "inventory_position", `inventory item #${byIndex}`);
  }

  const normalizedMessage = normalizeText(userMessage);
  const quotedPhrases = extractQuotedPhrases(userMessage);

  const exactMatches = inventory
    .map((doc) => ({
      doc,
      normalizedTitle: normalizeText(doc.title),
    }))
    .filter(({ normalizedTitle }) => normalizedTitle.length >= 6)
    .filter(({ normalizedTitle }) => {
      if (quotedPhrases.length > 0) {
        return quotedPhrases.some((phrase) => {
          const normalizedPhrase = normalizeText(phrase);
          return (
            normalizedTitle === normalizedPhrase ||
            normalizedTitle.includes(normalizedPhrase) ||
            normalizedPhrase.includes(normalizedTitle)
          );
        });
      }
      return normalizedMessage.includes(normalizedTitle);
    })
    .sort((a, b) => b.normalizedTitle.length - a.normalizedTitle.length);

  for (const match of exactMatches.slice(0, 2)) {
    add(match.doc, "exact_title", `title match: ${match.doc.title}`);
  }

  return resolved;
}
