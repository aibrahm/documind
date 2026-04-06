/**
 * Normalization layer for extracted document content.
 * Ensures consistent data format regardless of source.
 */

// ============================================================
// NUMBER NORMALIZATION
// ============================================================

const ARABIC_TO_WESTERN: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

/**
 * Convert Arabic/Hindi numerals to Western numerals.
 * ٢٠٢٣ → 2023, ٨٣ → 83
 */
export function normalizeNumbers(text: string): string {
  return text.replace(/[٠-٩]/g, (char) => ARABIC_TO_WESTERN[char] || char);
}

// ============================================================
// DATE NORMALIZATION
// ============================================================

const ARABIC_MONTHS: Record<string, string> = {
  "يناير": "01", "فبراير": "02", "مارس": "03", "أبريل": "04",
  "مايو": "05", "يونيو": "06", "يوليو": "07", "أغسطس": "08",
  "سبتمبر": "09", "أكتوبر": "10", "نوفمبر": "11", "ديسمبر": "12",
  // Alternate spellings
  "كانون الثاني": "01", "شباط": "02", "آذار": "03", "نيسان": "04",
  "أيار": "05", "حزيران": "06", "تموز": "07", "آب": "08",
  "أيلول": "09", "تشرين الأول": "10", "تشرين الثاني": "11", "كانون الأول": "12",
};

const ENGLISH_MONTHS: Record<string, string> = {
  "january": "01", "february": "02", "march": "03", "april": "04",
  "may": "05", "june": "06", "july": "07", "august": "08",
  "september": "09", "october": "10", "november": "11", "december": "12",
  "jan": "01", "feb": "02", "mar": "03", "apr": "04",
  "jun": "06", "jul": "07", "aug": "08", "sep": "09",
  "oct": "10", "nov": "11", "dec": "12",
};

export interface NormalizedDate {
  original: string;
  iso: string | null; // YYYY-MM-DD or YYYY-MM or YYYY
  year: number | null;
  month: number | null;
  day: number | null;
}

/**
 * Extract and normalize dates from text.
 * Returns all dates found in ISO format.
 */
export function extractDates(text: string): NormalizedDate[] {
  const normalized = normalizeNumbers(text);
  const dates: NormalizedDate[] = [];
  const seen = new Set<string>();

  // Pattern 1: DD/MM/YYYY or DD-MM-YYYY
  for (const m of normalized.matchAll(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/g)) {
    const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    if (!seen.has(iso)) {
      seen.add(iso);
      dates.push({ original: m[0], iso, year: +m[3], month: +m[2], day: +m[1] });
    }
  }

  // Pattern 2: YYYY/MM/DD
  for (const m of normalized.matchAll(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/g)) {
    const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    if (!seen.has(iso)) {
      seen.add(iso);
      dates.push({ original: m[0], iso, year: +m[1], month: +m[2], day: +m[3] });
    }
  }

  // Pattern 3: Arabic month names: "سبتمبر 2016" or "15 يناير 2023"
  for (const [monthName, monthNum] of Object.entries(ARABIC_MONTHS)) {
    const pattern = new RegExp(`(\\d{1,2})\\s*${monthName}\\s*(\\d{4})`, "g");
    for (const m of normalized.matchAll(pattern)) {
      const iso = `${m[2]}-${monthNum}-${m[1].padStart(2, "0")}`;
      if (!seen.has(iso)) {
        seen.add(iso);
        dates.push({ original: m[0], iso, year: +m[2], month: +monthNum, day: +m[1] });
      }
    }
    // Without day: "سبتمبر 2016"
    const pattern2 = new RegExp(`${monthName}\\s*(\\d{4})`, "g");
    for (const m of normalized.matchAll(pattern2)) {
      const iso = `${m[1]}-${monthNum}`;
      if (!seen.has(iso)) {
        seen.add(iso);
        dates.push({ original: m[0], iso, year: +m[1], month: +monthNum, day: null });
      }
    }
  }

  // Pattern 4: English month names
  for (const [monthName, monthNum] of Object.entries(ENGLISH_MONTHS)) {
    const pattern = new RegExp(`(\\d{1,2})\\s*${monthName}\\s*(\\d{4})`, "gi");
    for (const m of normalized.matchAll(pattern)) {
      const iso = `${m[2]}-${monthNum}-${m[1].padStart(2, "0")}`;
      if (!seen.has(iso)) {
        seen.add(iso);
        dates.push({ original: m[0], iso, year: +m[2], month: +monthNum, day: +m[1] });
      }
    }
    const pattern2 = new RegExp(`${monthName}\\s*(\\d{4})`, "gi");
    for (const m of normalized.matchAll(pattern2)) {
      const iso = `${m[1]}-${monthNum}`;
      if (!seen.has(iso)) {
        seen.add(iso);
        dates.push({ original: m[0], iso, year: +m[1], month: +monthNum, day: null });
      }
    }
  }

  // Pattern 5: "عام 2014" or "سنة 2002" (year only)
  for (const m of normalized.matchAll(/(?:عام|سنة|لسنة)\s*(\d{4})/g)) {
    const iso = m[1];
    if (!seen.has(iso)) {
      seen.add(iso);
      dates.push({ original: m[0], iso, year: +m[1], month: null, day: null });
    }
  }

  return dates;
}

// ============================================================
// FIGURE/TABLE/GRAPH EXTRACTION
// ============================================================

export interface ExtractedFigure {
  type: "figure" | "table" | "map" | "chart" | "graph" | "image";
  caption: string;
  description: string;
  pageNumber: number;
  referenceId: string | null; // e.g. "شكل 1-4" or "Table 3"
}

/**
 * Extract figure/table references from text.
 */
export function extractFigureReferences(text: string, pageNumber: number): ExtractedFigure[] {
  const figures: ExtractedFigure[] = [];
  const normalized = normalizeNumbers(text);

  // Arabic: شكل X-Y or جدول X-Y
  for (const m of normalized.matchAll(/(?:شكل|الشكل)\s*([\d\-\.]+)\s*[:\s]*([^\n.]{5,80})/g)) {
    figures.push({
      type: "figure",
      caption: m[2].trim(),
      description: "",
      pageNumber,
      referenceId: `شكل ${m[1]}`,
    });
  }

  for (const m of normalized.matchAll(/(?:جدول|الجدول)\s*([\d\-\.]+)\s*[:\s]*([^\n.]{5,80})/g)) {
    figures.push({
      type: "table",
      caption: m[2].trim(),
      description: "",
      pageNumber,
      referenceId: `جدول ${m[1]}`,
    });
  }

  for (const m of normalized.matchAll(/(?:خريطة|الخريطة)\s*([\d\-\.]+)?\s*[:\s]*([^\n.]{5,80})/g)) {
    figures.push({
      type: "map",
      caption: m[2].trim(),
      description: "",
      pageNumber,
      referenceId: m[1] ? `خريطة ${m[1]}` : null,
    });
  }

  // English: Figure X, Table X, Chart X
  for (const m of normalized.matchAll(/(?:Figure|Fig\.?)\s*([\d\-\.]+)\s*[:\s]*([^\n.]{5,80})/gi)) {
    figures.push({
      type: "figure",
      caption: m[2].trim(),
      description: "",
      pageNumber,
      referenceId: `Figure ${m[1]}`,
    });
  }

  for (const m of normalized.matchAll(/(?:Table)\s*([\d\-\.]+)\s*[:\s]*([^\n.]{5,80})/gi)) {
    figures.push({
      type: "table",
      caption: m[2].trim(),
      description: "",
      pageNumber,
      referenceId: `Table ${m[1]}`,
    });
  }

  return figures;
}

// ============================================================
// UNIFIED DOCUMENT SCHEMA
// ============================================================

/**
 * The ONE schema all documents normalize into.
 * Same shape regardless of document type.
 */
export interface NormalizedDocument {
  document: {
    title: string;
    type: string;
    language: string;
    pageCount: number;
    classification: string;
  };
  pages: NormalizedPage[];
  dates: NormalizedDate[];
  figures: ExtractedFigure[];
  referencedLaws: string[];
  entities: Array<{ name: string; type: string; nameEn: string | null }>;
  validation: {
    valid: boolean;
    errors: number;
    warnings: number;
    details: Array<{ severity: string; type: string; message: string }>;
  };
}

export interface NormalizedPage {
  number: number;
  type: string; // cover, toc, body, appendix, signature, blank
  header: string | null;
  footer: string | null;
  sections: NormalizedSection[];
}

export interface NormalizedSection {
  id: string | null;      // section/clause number: "1", "3-3", "مادة 14"
  title: string | null;
  type: string;           // article, clause, introduction, body, table, figure_caption, footnote, etc.
  content: string;        // ALL numbers are Western (0-9), text is cleaned
  subItems: string[];     // bullet points / sub-clauses
  confidence: number;     // 0.0-1.0 — how confident the correction layer is about this text
}

/**
 * Normalize a full extraction result into the unified schema.
 */
export function normalizeDocument(
  extraction: {
    classification: { documentType: string; title: string; language: string };
    pages: Array<{
      pageNumber: number;
      header: string | null;
      footer: string | null;
      pageType: string;
      sections: Array<{
        clauseNumber: string | null;
        title: string | null;
        type: string;
        content: string;
        subItems: string[];
        confidence?: number;
      }>;
    }>;
    referencedLaws: string[];
    validation: { valid: boolean; issues: Array<{ severity: string; type: string; message: string }> };
    metadata: {
      entities?: Array<{ name: string; type: string; nameEn?: string }>;
    };
  },
  classificationLabel: string
): NormalizedDocument {
  const allText = extraction.pages
    .flatMap((p) => p.sections.map((s) => s.content))
    .join("\n");

  // Extract dates and figures from all text
  const dates = extractDates(allText);
  const figures = extraction.pages.flatMap((p) =>
    p.sections.flatMap((s) => extractFigureReferences(s.content, p.pageNumber))
  );

  return {
    document: {
      title: normalizeNumbers(extraction.classification.title),
      type: extraction.classification.documentType,
      language: extraction.classification.language,
      pageCount: extraction.pages.length,
      classification: classificationLabel,
    },
    pages: extraction.pages.map((p) => ({
      number: p.pageNumber,
      type: p.pageType,
      header: p.header ? normalizeNumbers(p.header) : null,
      footer: p.footer ? normalizeNumbers(p.footer) : null,
      sections: p.sections.map((s) => ({
        id: s.clauseNumber ? normalizeNumbers(s.clauseNumber) : null,
        title: s.title ? normalizeNumbers(s.title) : null,
        type: s.type,
        content: normalizeNumbers(s.content),
        subItems: s.subItems.map(normalizeNumbers),
        confidence: s.confidence ?? 1.0,
      })),
    })),
    dates,
    figures,
    referencedLaws: extraction.referencedLaws.map(normalizeNumbers),
    entities: (extraction.metadata.entities || []).map((e) => ({
      name: e.name,
      type: e.type,
      nameEn: e.nameEn || null,
    })),
    validation: {
      valid: extraction.validation.valid,
      errors: extraction.validation.issues.filter((i) => i.severity === "error").length,
      warnings: extraction.validation.issues.filter((i) => i.severity === "warning").length,
      details: extraction.validation.issues.map((i) => ({
        severity: i.severity,
        type: i.type,
        message: i.message,
      })),
    },
  };
}
