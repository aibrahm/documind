// src/lib/tools/report-layout.ts
//
// DOCX report generator. Takes a structured ReportContent schema and
// produces a Microsoft Word document buffer ready to upload to storage.
// The layout is hardcoded here for now; later this can be replaced
// with docxtemplater + a real .docx letterhead file edited in Word.
//
// The entire look-and-feel is defined in style-prompt.ts — fonts,
// colors, sizes, margins, brand strings. Change a font there and every
// generated report picks it up.
//
// Arabic support: every paragraph that might contain Arabic text sets
// `bidirectional: true` and every text run sets `rtl: true` when the
// report language is "ar" or "mixed". This is how docx handles right-
// to-left flow — without these flags, Arabic text renders left-aligned
// and characters appear in the wrong order in Word.

import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageNumber,
  Header,
  Footer,
  BorderStyle,
  LevelFormat,
  convertInchesToTwip,
  PageOrientation,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from "docx";
import {
  FONTS,
  COLORS,
  SIZES_HALFPT,
  MARGINS_TWIPS,
  BRAND,
  AR_LABELS,
  EN_LABELS,
  arabicOrdinal,
} from "@/lib/tools/style-prompt";

// ─────────────────────────────────────────────────────────────────────
// Schema — what the LLM tool call passes in
// ─────────────────────────────────────────────────────────────────────

export type ReportLanguage = "ar" | "en" | "mixed";

/**
 * Simple tabular data. Every row must have exactly `headers.length`
 * cells — the normalizer in create-report.ts pads or trims rows that
 * don't match so a malformed LLM output can't crash the renderer.
 * Exported so presentation-layout.ts can reuse the same shape for
 * PPTX tables — one schema across DOCX and PPTX means the tool
 * description can describe it once.
 */
export interface TableSpec {
  caption?: string;
  headers: string[];
  rows: string[][];
}

export interface ReportSection {
  heading: string;
  paragraphs: string[];
  /** Optional tables rendered after the paragraphs of this section. */
  tables?: TableSpec[];
}

export interface ReportContent {
  title: string;
  subtitle?: string | null;
  language: ReportLanguage;
  executive_summary: string;
  sections: ReportSection[];
  recommendations?: string[];
  next_steps?: string[];
  // Reports are intentionally UNSIGNED — no personal attribution. The
  // organization brand on the header is the only identity. A previous
  // version pulled the operator name/title/org from workspace_profile
  // and stamped them on the cover; that was removed because the user
  // explicitly asked for unsigned documents. If you're re-adding it,
  // also re-add the AUTHORSHIP block in style-prompt.ts.
}

// ─────────────────────────────────────────────────────────────────────
// Text utilities
// ─────────────────────────────────────────────────────────────────────

/**
 * `docx` needs explicit per-run flags for RTL. Arabic reports set them
 * on every single TextRun. We wrap this in a helper so callers don't
 * repeat the check.
 */
function isRtl(language: ReportLanguage): boolean {
  return language === "ar" || language === "mixed";
}

/**
 * Build a single TextRun with the right language flags baked in. Use
 * this everywhere we create text so we never forget the RTL setting.
 */
function textRun(
  text: string,
  language: ReportLanguage,
  opts: {
    bold?: boolean;
    size?: number; // half-points
    color?: string; // hex without #
    font?: string;
  } = {},
): TextRun {
  const rtl = isRtl(language);
  return new TextRun({
    text,
    bold: opts.bold ?? false,
    size: opts.size ?? SIZES_HALFPT.body,
    color: opts.color ?? COLORS.ink,
    font: opts.font ?? (rtl ? FONTS.arabic : FONTS.body),
    rightToLeft: rtl,
  });
}

/**
 * Build a paragraph that handles RTL when needed. Wraps textRun()s
 * and sets bidirectional on the paragraph itself.
 */
function paragraph(
  text: string,
  language: ReportLanguage,
  opts: {
    heading?: typeof HeadingLevel.HEADING_1 | typeof HeadingLevel.HEADING_2 | typeof HeadingLevel.HEADING_3;
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
    spacingBefore?: number;
    spacingAfter?: number;
    bold?: boolean;
    size?: number;
    color?: string;
    font?: string;
  } = {},
): Paragraph {
  const rtl = isRtl(language);
  return new Paragraph({
    heading: opts.heading,
    alignment: opts.alignment ?? (rtl ? AlignmentType.RIGHT : AlignmentType.LEFT),
    bidirectional: rtl,
    spacing: {
      before: opts.spacingBefore ?? 0,
      after: opts.spacingAfter ?? 120, // 6pt default gap after
      line: 320, // ~1.3x line height
    },
    children: [
      textRun(text, language, {
        bold: opts.bold,
        size: opts.size,
        color: opts.color,
        font: opts.font,
      }),
    ],
  });
}

// ─────────────────────────────────────────────────────────────────────
// Section builders
// ─────────────────────────────────────────────────────────────────────

/**
 * Formal Arab government letterhead cover block.
 *
 * Structure (matches real Arab ministerial memos, NOT the AI "hero +
 * eyebrow + horizontal-rule" pattern):
 *
 *   [ country name — centered, small ]
 *   [ organization full name (Arabic) — centered, larger ]
 *   [ organization full name (English) — centered, smaller ]
 *   ──────────────────────────────────────────
 *   [ reference: —        |  date: <today> ]
 *
 *   Subject: <title>
 *   <optional subtitle in plain type>
 *   ──────────────────────────────────────────
 *
 *   [executive summary block follows in buildExecutiveSummary]
 *
 * Every element is plain monochrome. No colored labels, no "tagline"
 * line, no accent anywhere.
 */
function buildCover(content: ReportContent): Paragraph[] {
  const rtl = isRtl(content.language);
  const lang = content.language;
  const showArabicBrand = lang !== "en";
  const showEnglishBrand = lang !== "ar";
  const labels = lang === "en" ? EN_LABELS : AR_LABELS;
  const paragraphs: Paragraph[] = [];

  // ── Letterhead block — country + organization, centered ──

  // Country name (small, centered). For Arabic/mixed, Arabic country name;
  // for English-only, English country name.
  const countryLine = showArabicBrand
    ? BRAND.countryAr
    : BRAND.countryEn;
  paragraphs.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      bidirectional: rtl,
      spacing: { before: 0, after: 80 },
      children: [
        textRun(countryLine, lang, {
          size: SIZES_HALFPT.body,
          color: COLORS.ink,
          bold: false,
          font: FONTS.body,
        }),
      ],
    }),
  );

  // Organization name (Arabic) — primary identity
  if (showArabicBrand) {
    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        bidirectional: true,
        spacing: { before: 0, after: showEnglishBrand ? 40 : 160 },
        children: [
          textRun(BRAND.longNameAr, "ar", {
            size: SIZES_HALFPT.h1,
            color: COLORS.ink,
            bold: true,
            font: FONTS.arabic,
          }),
        ],
      }),
    );
  }

  // Organization name (English) — secondary, only when doc isn't Arabic-only
  if (showEnglishBrand) {
    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        bidirectional: false,
        spacing: { before: 0, after: 160 },
        children: [
          textRun(BRAND.longNameEn, "en", {
            size: SIZES_HALFPT.h3,
            color: COLORS.subtle,
            bold: false,
            font: FONTS.body,
          }),
        ],
      }),
    );
  }

  // Thin horizontal rule under the letterhead
  paragraphs.push(
    new Paragraph({
      spacing: { before: 0, after: 240 },
      border: {
        bottom: {
          color: COLORS.border,
          space: 1,
          style: BorderStyle.SINGLE,
          size: 6,
        },
      },
      children: [],
    }),
  );

  // ── Reference + date row ──
  //
  // In real Arab letterheads the reference / date block sits aligned to
  // the document's natural "inner edge" — for RTL Arabic documents that
  // means aligned LEFT (because the reading eye starts top-right and
  // the reference lives opposite the sender's name). For LTR English it
  // means aligned RIGHT. We use one paragraph per line for maximum Word
  // compatibility — tables would be cleaner but docx tables inside a
  // simple cover are fiddly and this layout works fine.
  const dateLine = new Date().toLocaleDateString(rtl ? "ar-EG" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const refAlignment = rtl ? AlignmentType.LEFT : AlignmentType.RIGHT;

  paragraphs.push(
    new Paragraph({
      alignment: refAlignment,
      bidirectional: rtl,
      spacing: { before: 0, after: 40 },
      children: [
        textRun(`${labels.referenceLine}: —`, lang, {
          size: SIZES_HALFPT.small,
          color: COLORS.subtle,
        }),
      ],
    }),
  );
  paragraphs.push(
    new Paragraph({
      alignment: refAlignment,
      bidirectional: rtl,
      spacing: { before: 0, after: 360 },
      children: [
        textRun(`${labels.dateLine}: ${dateLine}`, lang, {
          size: SIZES_HALFPT.small,
          color: COLORS.subtle,
        }),
      ],
    }),
  );

  // ── Subject line ──
  //
  // "الموضوع: [title]" / "Subject: [title]" — this is the primary title
  // treatment in a formal memo, NOT a huge "hero" heading. Real gov docs
  // don't shout the title in 22pt; they use a readable H1.
  paragraphs.push(
    new Paragraph({
      alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      bidirectional: rtl,
      spacing: { before: 0, after: content.subtitle ? 80 : 200 },
      children: [
        textRun(`${labels.subjectLine}: `, lang, {
          size: SIZES_HALFPT.h1,
          color: COLORS.ink,
          bold: true,
        }),
        textRun(content.title, lang, {
          size: SIZES_HALFPT.h1,
          color: COLORS.ink,
          bold: true,
        }),
      ],
    }),
  );

  // Optional subtitle as a plain line beneath the subject (no eyebrow,
  // no separate styling — just smaller body text).
  if (content.subtitle) {
    paragraphs.push(
      new Paragraph({
        alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
        bidirectional: rtl,
        spacing: { before: 0, after: 240 },
        children: [
          textRun(content.subtitle, lang, {
            size: SIZES_HALFPT.body,
            color: COLORS.subtle,
            bold: false,
          }),
        ],
      }),
    );
  }

  // Second thin rule — marks the end of the letterhead / cover and the
  // start of the body. Real memos use a rule here too.
  paragraphs.push(
    new Paragraph({
      spacing: { before: 0, after: 320 },
      border: {
        bottom: {
          color: COLORS.border,
          space: 1,
          style: BorderStyle.SINGLE,
          size: 6,
        },
      },
      children: [],
    }),
  );

  return paragraphs;
}

/**
 * Executive summary / الخلاصة block. Plain section — the label is a
 * normal bold H2 heading in the document language, NOT a colored
 * eyebrow. Real gov docs don't use eyebrow labels anywhere.
 */
function buildExecutiveSummary(content: ReportContent): Paragraph[] {
  const rtl = isRtl(content.language);
  const labels = content.language === "en" ? EN_LABELS : AR_LABELS;

  return [
    // Plain H2 heading in bold ink, no accent color
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      bidirectional: rtl,
      spacing: { before: 0, after: 120 },
      children: [
        textRun(labels.summary, content.language, {
          bold: true,
          size: SIZES_HALFPT.h1,
          color: COLORS.ink,
        }),
      ],
    }),
    // The paragraph itself
    new Paragraph({
      alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      bidirectional: rtl,
      spacing: { before: 0, after: 360, line: 360 },
      children: [
        textRun(content.executive_summary, content.language, {
          size: SIZES_HALFPT.body,
        }),
      ],
    }),
  ];
}

/**
 * Build a DOCX table from a TableSpec. Returns an array of
 * (Paragraph | Table) because we render an optional caption as a
 * paragraph before the table and a small spacer paragraph after, so
 * tables slot cleanly into the flat section-body stream. Colors pull
 * from COLORS.border (grid), the ink palette (cells), and a muted
 * slate fill (F1F5F9) for the header row — matches the muted tones
 * the rest of the document uses.
 */
function buildTable(
  table: TableSpec,
  language: ReportLanguage,
): (Paragraph | Table)[] {
  const rtl = isRtl(language);
  const out: (Paragraph | Table)[] = [];

  // Optional caption — small, muted, sits just above the table.
  if (table.caption && table.caption.trim().length > 0) {
    out.push(
      new Paragraph({
        alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
        bidirectional: rtl,
        spacing: { before: 120, after: 60 },
        children: [
          textRun(table.caption, language, {
            size: SIZES_HALFPT.small,
            color: COLORS.subtle,
            bold: true,
          }),
        ],
      }),
    );
  }

  const cols = Math.max(1, table.headers.length);
  const pctPerCol = Math.floor(100 / cols);

  const cellParagraph = (text: string, bold: boolean): Paragraph =>
    new Paragraph({
      alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      bidirectional: rtl,
      spacing: { before: 40, after: 40, line: 280 },
      children: [
        textRun(text, language, {
          size: SIZES_HALFPT.small,
          bold,
          color: COLORS.ink,
        }),
      ],
    });

  const makeCell = (text: string, header: boolean): TableCell =>
    new TableCell({
      width: { size: pctPerCol, type: WidthType.PERCENTAGE },
      shading: header ? { fill: "F1F5F9" } : undefined,
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
      children: [cellParagraph(text, header)],
    });

  const headerRow = new TableRow({
    tableHeader: true,
    children: table.headers.map((h) => makeCell(h, true)),
  });

  // Normalize rows — pad short rows, trim long ones — so a malformed
  // LLM output never crashes the renderer mid-document.
  const bodyRows = table.rows.map((row) => {
    const padded = row.slice(0, cols);
    while (padded.length < cols) padded.push("");
    return new TableRow({
      children: padded.map((c) => makeCell(c, false)),
    });
  });

  const borderSide = {
    style: BorderStyle.SINGLE,
    size: 4,
    color: COLORS.border,
  };

  out.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      visuallyRightToLeft: rtl,
      rows: [headerRow, ...bodyRows],
      borders: {
        top: borderSide,
        bottom: borderSide,
        left: borderSide,
        right: borderSide,
        insideHorizontal: borderSide,
        insideVertical: borderSide,
      },
    }),
  );

  // Small spacer after the table so the next paragraph has breathing
  // room. Tables in `docx` don't apply their own trailing margin.
  out.push(
    new Paragraph({
      spacing: { before: 0, after: 160 },
      children: [],
    }),
  );

  return out;
}

function buildSection(
  section: ReportSection,
  language: ReportLanguage,
): (Paragraph | Table)[] {
  const rtl = isRtl(language);
  const out: (Paragraph | Table)[] = [];

  // Section heading — plain bold ink, one size below the top-level
  // section labels (الخلاصة / التوصيات). No accent color, no custom
  // font. Real gov doc headings look like body text with weight, not
  // like SaaS dashboard h1s.
  out.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      bidirectional: rtl,
      spacing: { before: 320, after: 160 },
      children: [
        textRun(section.heading, language, {
          bold: true,
          size: SIZES_HALFPT.h2,
          color: COLORS.ink,
        }),
      ],
    }),
  );

  // Body paragraphs
  for (const para of section.paragraphs) {
    out.push(
      new Paragraph({
        alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
        bidirectional: rtl,
        spacing: { before: 0, after: 160, line: 320 },
        children: [
          textRun(para, language, {
            size: SIZES_HALFPT.body,
          }),
        ],
      }),
    );
  }

  // Optional tables — rendered after the prose so the narrative still
  // reads top-down even when a section has data.
  if (section.tables && section.tables.length > 0) {
    for (const t of section.tables) {
      out.push(...buildTable(t, language));
    }
  }

  return out;
}

/**
 * Numbered list with formal labels. In Arabic documents, items are
 * numbered with ordinal words (أولاً، ثانياً، ثالثاً …) — this is the
 * convention in real ministerial memos and decrees. In English, plain
 * numeric labels (1. 2. 3.) which is correct for formal English gov
 * docs.
 *
 * The helper that produces the Arabic ordinal label lives in
 * style-prompt.ts (arabicOrdinal) so both report and presentation
 * layouts share the same formatter.
 */
function buildNumberedList(
  items: string[],
  label: string,
  language: ReportLanguage,
): Paragraph[] {
  const rtl = isRtl(language);
  const paragraphs: Paragraph[] = [];

  // Section heading — plain bold ink, no accent
  paragraphs.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      bidirectional: rtl,
      spacing: { before: 320, after: 160 },
      children: [
        textRun(label, language, {
          bold: true,
          size: SIZES_HALFPT.h1,
          color: COLORS.ink,
        }),
      ],
    }),
  );

  // Numbered items — manual numbering (not docx auto-numbering)
  // because we need the specific formal Arabic ordinal words, not
  // whatever Word's RTL number formatting produces.
  items.forEach((item, i) => {
    const oneBasedIndex = i + 1;
    const marker =
      language === "en" ? `${oneBasedIndex}.` : `${arabicOrdinal(oneBasedIndex)}:`;
    paragraphs.push(
      new Paragraph({
        alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
        bidirectional: rtl,
        spacing: { before: 0, after: 160, line: 320 },
        indent: rtl ? { right: 360 } : { left: 360 },
        children: [
          // Marker in bold (ordinals are always bold in formal memos)
          textRun(`${marker}  `, language, {
            size: SIZES_HALFPT.body,
            bold: true,
          }),
          // Item text in regular weight
          textRun(item, language, {
            size: SIZES_HALFPT.body,
          }),
        ],
      }),
    );
  });

  return paragraphs;
}

// ─────────────────────────────────────────────────────────────────────
// Header & footer
// ─────────────────────────────────────────────────────────────────────

/**
 * Running page header — shows just the organization name (in document
 * language) with a thin rule under it. Continuation-page style from
 * the UAE letterhead spec: "continuation pages use the letterhead
 * without the footer". We keep this minimal so the cover's fuller
 * letterhead remains distinctive.
 */
function buildHeader(language: ReportLanguage): Header {
  const rtl = isRtl(language);
  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        bidirectional: rtl,
        border: {
          bottom: {
            color: COLORS.border,
            space: 6,
            style: BorderStyle.SINGLE,
            size: 4,
          },
        },
        children: [
          textRun(
            language === "en" ? BRAND.longNameEn : BRAND.longNameAr,
            language,
            {
              size: SIZES_HALFPT.header,
              color: COLORS.subtle,
              bold: false,
            },
          ),
        ],
      }),
    ],
  });
}

function buildFooter(language: ReportLanguage): Footer {
  const rtl = isRtl(language);
  const pageLabel = language === "en" ? "Page" : "صفحة";
  const ofLabel = language === "en" ? "of" : "من";

  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        bidirectional: rtl,
        border: {
          top: {
            color: COLORS.border,
            space: 6,
            style: BorderStyle.SINGLE,
            size: 4,
          },
        },
        // Centered via AlignmentType.CENTER on the paragraph — no
        // tabStops needed. (They were a leftover from an earlier
        // footer design and pulled in two extra `docx` imports.)
        children: [
          textRun(`${pageLabel} `, language, {
            size: SIZES_HALFPT.small,
            color: COLORS.subtle,
          }),
          new TextRun({
            children: [PageNumber.CURRENT],
            size: SIZES_HALFPT.small,
            color: COLORS.subtle,
            font: rtl ? FONTS.arabic : FONTS.body,
            rightToLeft: rtl,
          }),
          textRun(` ${ofLabel} `, language, {
            size: SIZES_HALFPT.small,
            color: COLORS.subtle,
          }),
          new TextRun({
            children: [PageNumber.TOTAL_PAGES],
            size: SIZES_HALFPT.small,
            color: COLORS.subtle,
            font: rtl ? FONTS.arabic : FONTS.body,
            rightToLeft: rtl,
          }),
        ],
      }),
    ],
  });
}

// ─────────────────────────────────────────────────────────────────────
// Top-level generator
// ─────────────────────────────────────────────────────────────────────

/**
 * Turn a structured report schema into a complete DOCX Document ready
 * to be serialized to a buffer by the tool handler.
 */
export function buildReportDocument(content: ReportContent): Document {
  const language = content.language;
  const rtl = isRtl(language);
  // Section body is a mix of Paragraphs and Tables. `docx` allows both
  // directly in a section's children array.
  const allChildren: (Paragraph | Table)[] = [];

  // 1. Cover
  allChildren.push(...buildCover(content));

  // 2. Executive summary
  if (content.executive_summary && content.executive_summary.trim()) {
    allChildren.push(...buildExecutiveSummary(content));
  }

  // 3. Body sections
  for (const section of content.sections) {
    allChildren.push(...buildSection(section, language));
  }

  const labels = language === "en" ? EN_LABELS : AR_LABELS;

  // 4. Recommendations — labelled with the shared constant so a rename
  //    in style-prompt.ts flows through both the renderer and the LLM
  //    instructions automatically.
  if (content.recommendations && content.recommendations.length > 0) {
    allChildren.push(
      ...buildNumberedList(content.recommendations, labels.recommendations, language),
    );
  }

  // 5. Proposed actions / next steps
  if (content.next_steps && content.next_steps.length > 0) {
    allChildren.push(
      ...buildNumberedList(content.next_steps, labels.nextSteps, language),
    );
  }

  const doc = new Document({
    // Word metadata only — not shown on the cover. Reports are unsigned,
    // so we use the organization brand instead of any personal name.
    creator: BRAND.shortName,
    title: content.title,
    description: content.subtitle || "",
    styles: {
      default: {
        document: {
          run: {
            font: rtl ? FONTS.arabic : FONTS.body,
            size: SIZES_HALFPT.body,
          },
          paragraph: {
            spacing: { line: 320 },
          },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: "default-numbering",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: rtl
                    ? { right: convertInchesToTwip(0.3) }
                    : { left: convertInchesToTwip(0.3) },
                },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              orientation: PageOrientation.PORTRAIT,
            },
            margin: {
              top: MARGINS_TWIPS.top,
              right: MARGINS_TWIPS.right,
              bottom: MARGINS_TWIPS.bottom,
              left: MARGINS_TWIPS.left,
              header: MARGINS_TWIPS.header,
              footer: MARGINS_TWIPS.footer,
            },
          },
        },
        headers: { default: buildHeader(language) },
        footers: { default: buildFooter(language) },
        children: allChildren,
      },
    ],
  });

  return doc;
}
