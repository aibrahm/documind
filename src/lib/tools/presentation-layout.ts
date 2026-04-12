// src/lib/tools/presentation-layout.ts
//
// PPTX generator using pptxgenjs. Takes a structured PresentationContent
// schema (title + array of slides) and returns a Buffer ready for
// Supabase Storage.
//
// pptxgenjs has no "template file" concept — you design everything
// programmatically — but it does have SLIDE MASTERS, which is how we
// get consistent branding without repeating ourselves. We define one
// master with the background, footer, and page number, and every slide
// layout inherits it.
//
// Arabic / RTL: pptxgenjs supports `rtlMode: true` on text options
// (per their README and GitHub issue #73). We set it on every text
// element when language is "ar" or "mixed". Arabic font is Arial
// because it's the only Arabic-capable font guaranteed to exist on
// every PowerPoint install.

import PptxGenJS from "pptxgenjs";
import { FONTS, COLORS, BRAND, AR_LABELS, EN_LABELS } from "@/lib/tools/style-prompt";
import type { TableSpec } from "@/lib/tools/report-layout";

// Re-export so callers (create-presentation.ts, the tool schema) can
// import from this file without reaching into report-layout.
export type { TableSpec } from "@/lib/tools/report-layout";

// ─────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────

export type DeckLanguage = "ar" | "en" | "mixed";

export type SlideLayoutKind =
  | "title"
  | "section_header"
  | "content"
  | "two_column"
  | "numbers"
  | "conclusion"
  | "table"
  | "chart";

/** Supported chart types. Native pptxgenjs charts — render as editable
 *  Office chart objects, not images. Users can edit data in PowerPoint. */
export type ChartKind = "bar" | "column" | "line" | "pie";

export interface ChartSpec {
  type: ChartKind;
  /** X-axis category labels (or pie slice labels). */
  categories: string[];
  /** One or more data series. For pie charts use a single series. */
  series: Array<{ name: string; values: number[] }>;
  /** Optional caption rendered below the chart in muted type. */
  caption?: string;
}

export interface SlideContent {
  layout: SlideLayoutKind;
  title?: string;
  subtitle?: string;
  bullets?: string[];
  /** For two_column: left/right body text. */
  left?: string;
  right?: string;
  /** For numbers: key metrics to display as big figures with captions. */
  data?: Array<{ label: string; value: string }>;
  /** Optional body paragraph for content layouts. */
  body?: string;
  /** For table layout: tabular data rendered below the slide title. */
  table?: TableSpec;
  /** For chart layout: native editable chart rendered below the title. */
  chart?: ChartSpec;
}

export interface PresentationContent {
  title: string;
  subtitle?: string | null;
  language: DeckLanguage;
  slides: SlideContent[];
  // Decks are intentionally UNSIGNED — no personal attribution on the
  // cover. The slide master shows the organization brand strip; that's
  // the only identity. See the equivalent note in report-layout.ts.
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function isRtl(language: DeckLanguage): boolean {
  return language === "ar" || language === "mixed";
}

function fontForLang(language: DeckLanguage): string {
  return isRtl(language) ? FONTS.arabic : FONTS.heading;
}

/** Hex color with leading # stripped for pptxgenjs. */
function hex(c: string): string {
  return c.startsWith("#") ? c.slice(1) : c;
}

/**
 * Base text options applied to every string on every slide. Encoding
 * this in one place means changing the look of all slides is one edit.
 */
function baseText(language: DeckLanguage) {
  return {
    fontFace: fontForLang(language),
    color: hex(COLORS.ink),
    rtlMode: isRtl(language),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Slide master
// ─────────────────────────────────────────────────────────────────────

/**
 * Define the one master every slide inherits. Real ministerial decks
 * have minimal chrome — just an org name at the bottom and a page
 * number. No "Slide" prefix. No decorative accent rules. No tagline.
 *
 * We use the WIDE layout (13.33 × 7.5), so positioning coordinates
 * below are in inches relative to that canvas. Bottom bar sits at
 * y = 7.0–7.3.
 */
function defineMaster(pptx: PptxGenJS, language: DeckLanguage): void {
  const rtl = isRtl(language);
  pptx.defineSlideMaster({
    title: "GTEZ_MASTER",
    background: { color: hex(COLORS.pageBg) },
    objects: [
      // Thin rule along the top of the bottom bar — monochrome gray,
      // NOT a colored accent. Just a structural divider.
      {
        line: {
          x: 0.5,
          y: 7.0,
          w: 12.33,
          h: 0,
          line: { color: hex(COLORS.border), width: 0.5 },
        },
      },
      // Organization name at the bottom — plain gray, no tagline. For
      // Arabic/mixed decks we use the Arabic org name; for English-only
      // we use the English name. No "Executive Briefing" wording, ever.
      {
        text: {
          text: rtl ? BRAND.longNameAr : BRAND.longNameEn,
          options: {
            x: 0.5,
            y: 7.08,
            w: 11,
            h: 0.3,
            fontFace: fontForLang(language),
            fontSize: 9,
            color: hex(COLORS.subtle),
            rtlMode: rtl,
            align: rtl ? "right" : "left",
          },
        },
      },
    ],
    slideNumber: {
      // Opposite side from the org name so they don't collide. For
      // Arabic decks the org name is at right, so the page number goes
      // at left; for English it's mirrored.
      x: rtl ? 0.5 : 12.6,
      y: 7.08,
      w: 0.4,
      h: 0.3,
      fontFace: fontForLang(language),
      fontSize: 9,
      color: hex(COLORS.subtle),
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Individual slide layouts
// ─────────────────────────────────────────────────────────────────────

/**
 * Title slide — structured like a real Arab government cover page
 * (not a SaaS pitch deck). Centered letterhead block at the top:
 * country + organization (Arabic + optional English) + rule. Then
 * the document title left-aligned (or right-aligned for Arabic) as
 * a formal subject, date beneath. No "Executive Briefing" eyebrow.
 */
function addTitleSlide(
  pptx: PptxGenJS,
  content: PresentationContent,
): void {
  const slide = pptx.addSlide({ masterName: "GTEZ_MASTER" });
  const lang = content.language;
  const rtl = isRtl(lang);
  const showArabicBrand = lang !== "en";
  const showEnglishBrand = lang !== "ar";

  // ── Letterhead block at the top — centered ──

  // Country line (small)
  slide.addText(showArabicBrand ? BRAND.countryAr : BRAND.countryEn, {
    x: 0.5,
    y: 0.6,
    w: 12.33,
    h: 0.35,
    ...baseText(lang),
    fontSize: 12,
    color: hex(COLORS.ink),
    align: "center",
  });

  // Organization name (Arabic) — primary
  if (showArabicBrand) {
    slide.addText(BRAND.longNameAr, {
      x: 0.5,
      y: 1.0,
      w: 12.33,
      h: 0.55,
      fontFace: FONTS.arabic,
      rtlMode: true,
      fontSize: 20,
      bold: true,
      color: hex(COLORS.ink),
      align: "center",
    });
  }

  // Organization name (English) — secondary, only in mixed / english decks
  if (showEnglishBrand) {
    slide.addText(BRAND.longNameEn, {
      x: 0.5,
      y: showArabicBrand ? 1.6 : 1.0,
      w: 12.33,
      h: 0.4,
      fontFace: FONTS.body,
      fontSize: 12,
      color: hex(COLORS.subtle),
      align: "center",
    });
  }

  // Thin horizontal rule under the letterhead
  slide.addShape("line", {
    x: 2.5,
    y: 2.3,
    w: 8.33,
    h: 0,
    line: { color: hex(COLORS.border), width: 0.75 },
  });

  // ── Document title ──

  slide.addText(content.title, {
    x: 0.5,
    y: 3.0,
    w: 12.33,
    h: 1.3,
    ...baseText(lang),
    fontSize: 30,
    bold: true,
    color: hex(COLORS.ink),
    align: "center",
    valign: "top",
  });

  // Subtitle (optional) — plain line under the title
  if (content.subtitle) {
    slide.addText(content.subtitle, {
      x: 0.5,
      y: 4.2,
      w: 12.33,
      h: 0.6,
      ...baseText(lang),
      fontSize: 15,
      color: hex(COLORS.subtle),
      align: "center",
    });
  }

  // Date — centered below the title block
  const dateLine = new Date().toLocaleDateString(rtl ? "ar-EG" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  slide.addText(dateLine, {
    x: 0.5,
    y: content.subtitle ? 5.0 : 4.5,
    w: 12.33,
    h: 0.4,
    ...baseText(lang),
    fontSize: 11,
    color: hex(COLORS.subtle),
    align: "center",
  });
}

// ─────────────────────────────────────────────────────────────────────
// Shared slide helpers
// ─────────────────────────────────────────────────────────────────────
//
// Every non-title slide uses the same top structure: a plain title
// left/right-aligned for the document language, and a thin monochrome
// rule directly under it. No accent colors, no eyebrow labels, no
// decorative pills. This helper exists so all layouts stay in lockstep
// when the design changes.

function addSlideTitle(
  slide: PptxGenJS.Slide,
  title: string,
  language: DeckLanguage,
): void {
  const rtl = isRtl(language);
  slide.addText(title, {
    x: 0.5,
    y: 0.45,
    w: 12.33,
    h: 0.75,
    ...baseText(language),
    fontSize: 22,
    bold: true,
    color: hex(COLORS.ink),
    align: rtl ? "right" : "left",
  });
  // Thin gray rule — structural, not decorative. Not an accent color.
  slide.addShape("line", {
    x: 0.5,
    y: 1.2,
    w: 12.33,
    h: 0,
    line: { color: hex(COLORS.border), width: 0.75 },
  });
}

function addSectionHeader(
  pptx: PptxGenJS,
  slide: SlideContent,
  language: DeckLanguage,
): void {
  const s = pptx.addSlide({ masterName: "GTEZ_MASTER" });
  const rtl = isRtl(language);

  // Section divider slides are centered and larger — this is one
  // of the few places a visual break is legitimate in a formal deck.
  s.addText(slide.title || "", {
    x: 0.5,
    y: 2.8,
    w: 12.33,
    h: 1.2,
    ...baseText(language),
    fontSize: 32,
    bold: true,
    color: hex(COLORS.ink),
    align: "center",
  });

  if (slide.subtitle) {
    s.addText(slide.subtitle, {
      x: 0.5,
      y: 4.1,
      w: 12.33,
      h: 0.6,
      ...baseText(language),
      fontSize: 16,
      color: hex(COLORS.subtle),
      align: "center",
    });
  }
}

function addContentSlide(
  pptx: PptxGenJS,
  slide: SlideContent,
  language: DeckLanguage,
): void {
  const s = pptx.addSlide({ masterName: "GTEZ_MASTER" });
  const rtl = isRtl(language);

  addSlideTitle(s, slide.title || "", language);

  // Body: bullets or paragraph
  if (slide.bullets && slide.bullets.length > 0) {
    s.addText(
      slide.bullets.map((b) => ({ text: b, options: { bullet: { code: "2022" } } })),
      {
        x: 0.5,
        y: 1.5,
        w: 12.33,
        h: 5.3,
        ...baseText(language),
        fontSize: 16,
        color: hex(COLORS.ink),
        align: rtl ? "right" : "left",
        valign: "top",
        paraSpaceAfter: 8,
      },
    );
  } else if (slide.body) {
    s.addText(slide.body, {
      x: 0.5,
      y: 1.5,
      w: 12.33,
      h: 5.3,
      ...baseText(language),
      fontSize: 16,
      color: hex(COLORS.ink),
      align: rtl ? "right" : "left",
      valign: "top",
    });
  }
}

function addTwoColumnSlide(
  pptx: PptxGenJS,
  slide: SlideContent,
  language: DeckLanguage,
): void {
  const s = pptx.addSlide({ masterName: "GTEZ_MASTER" });
  const rtl = isRtl(language);

  addSlideTitle(s, slide.title || "", language);

  // Left column — in an RTL deck this is actually the visual-right
  // column, but pptxgenjs coordinates are always LTR page coordinates.
  s.addText(slide.left || "", {
    x: 0.5,
    y: 1.5,
    w: 5.8,
    h: 5.3,
    ...baseText(language),
    fontSize: 14,
    color: hex(COLORS.ink),
    align: rtl ? "right" : "left",
    valign: "top",
  });

  // Right column
  s.addText(slide.right || "", {
    x: 6.9,
    y: 1.5,
    w: 5.8,
    h: 5.3,
    ...baseText(language),
    fontSize: 14,
    color: hex(COLORS.ink),
    align: rtl ? "right" : "left",
    valign: "top",
  });
}

function addNumbersSlide(
  pptx: PptxGenJS,
  slide: SlideContent,
  language: DeckLanguage,
): void {
  const s = pptx.addSlide({ masterName: "GTEZ_MASTER" });

  addSlideTitle(s, slide.title || "", language);

  // Render each data point as big-number + label, evenly spaced.
  // Big numbers are INK (dark), not an accent color — keeps the deck
  // feeling like a gov document, not an infographic.
  const points = (slide.data ?? []).slice(0, 4);
  const slotWidth = 12.33 / Math.max(points.length, 1);
  points.forEach((p, i) => {
    const x = 0.5 + i * slotWidth;
    // Big number
    s.addText(p.value, {
      x,
      y: 2.2,
      w: slotWidth,
      h: 1.6,
      ...baseText(language),
      fontSize: 48,
      bold: true,
      color: hex(COLORS.ink),
      align: "center",
    });
    // Caption
    s.addText(p.label, {
      x,
      y: 3.9,
      w: slotWidth,
      h: 0.6,
      ...baseText(language),
      fontSize: 12,
      color: hex(COLORS.subtle),
      align: "center",
    });
  });
}

/**
 * Table slide — pptxgenjs `addTable` accepts a 2D array of cells where
 * each cell is either a string or `{ text, options }`. We style the
 * header row with a subtle slate fill and bold text so it reads as a
 * header without using an accent color. Rows are normalized (padded /
 * trimmed) to match header length so a malformed LLM output can't crash
 * the render.
 */
function addTableSlide(
  pptx: PptxGenJS,
  slide: SlideContent,
  language: DeckLanguage,
): void {
  const s = pptx.addSlide({ masterName: "GTEZ_MASTER" });
  const rtl = isRtl(language);
  addSlideTitle(s, slide.title || "", language);

  const table = slide.table;
  if (!table) return;

  const cols = Math.max(1, table.headers.length);
  const fontFace = fontForLang(language);
  const align = rtl ? "right" : "left";

  const headerRow = table.headers.map((h) => ({
    text: h,
    options: {
      bold: true,
      fill: { color: "F1F5F9" },
      color: hex(COLORS.ink),
      fontFace,
      fontSize: 12,
      align,
      rtlMode: rtl,
    },
  }));

  const bodyRows = table.rows.map((row) => {
    const padded = row.slice(0, cols);
    while (padded.length < cols) padded.push("");
    return padded.map((c) => ({
      text: c,
      options: {
        color: hex(COLORS.ink),
        fontFace,
        fontSize: 11,
        align,
        rtlMode: rtl,
      },
    }));
  });

  // pptxgenjs types are loose on the cell object shape; cast once here
  // so call sites stay clean.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = [headerRow, ...bodyRows] as any;

  s.addTable(rows, {
    x: 0.5,
    y: 1.5,
    w: 12.33,
    h: 5.0,
    border: { pt: 0.5, color: hex(COLORS.border) },
    fontFace,
    fontSize: 11,
    color: hex(COLORS.ink),
    rowH: 0.4,
    autoPage: false,
  });

  if (table.caption) {
    s.addText(table.caption, {
      x: 0.5,
      y: 6.55,
      w: 12.33,
      h: 0.35,
      fontFace,
      fontSize: 10,
      color: hex(COLORS.subtle),
      align,
      rtlMode: rtl,
    });
  }
}

/**
 * Chart slide — emits a real editable PowerPoint chart (not an image).
 * Monochrome palette: shades of ink + slate, no brand accent. Legend
 * appears only when there are multiple series. pptxgenjs chart type is
 * accessed via `pptx.ChartType[kind]` to keep the enum string in one
 * place.
 */
function addChartSlide(
  pptx: PptxGenJS,
  slide: SlideContent,
  language: DeckLanguage,
): void {
  const s = pptx.addSlide({ masterName: "GTEZ_MASTER" });
  const rtl = isRtl(language);
  addSlideTitle(s, slide.title || "", language);

  const chart = slide.chart;
  if (!chart) return;

  const fontFace = fontForLang(language);
  const chartData = chart.series.map((srs) => ({
    name: srs.name,
    labels: chart.categories,
    values: srs.values,
  }));

  // pptxgenjs enum lookup — "bar", "column", "line", "pie" all valid.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartType = (pptx as any).ChartType?.[chart.type] ?? chart.type;

  s.addChart(chartType, chartData, {
    x: 0.5,
    y: 1.5,
    w: 12.33,
    h: chart.caption ? 4.8 : 5.3,
    chartColors: ["0F172A", "475569", "94A3B8", "64748B", "334155", "1E293B"],
    showLegend: chart.series.length > 1,
    legendPos: "b",
    legendFontFace: fontFace,
    legendFontSize: 10,
    legendColor: hex(COLORS.subtle),
    catAxisLabelFontFace: fontFace,
    catAxisLabelFontSize: 10,
    catAxisLabelColor: hex(COLORS.subtle),
    valAxisLabelFontFace: fontFace,
    valAxisLabelFontSize: 10,
    valAxisLabelColor: hex(COLORS.subtle),
    dataLabelFontFace: fontFace,
    dataLabelFontSize: 9,
  });

  if (chart.caption) {
    s.addText(chart.caption, {
      x: 0.5,
      y: 6.4,
      w: 12.33,
      h: 0.35,
      fontFace,
      fontSize: 10,
      color: hex(COLORS.subtle),
      align: rtl ? "right" : "left",
      rtlMode: rtl,
    });
  }
}

function addConclusionSlide(
  pptx: PptxGenJS,
  slide: SlideContent,
  language: DeckLanguage,
): void {
  const s = pptx.addSlide({ masterName: "GTEZ_MASTER" });
  const rtl = isRtl(language);
  const labels = language === "en" ? EN_LABELS : AR_LABELS;

  // Use the formal section label as the title. No eyebrow pill, no
  // accent. If the slide already has its own title it overrides.
  const title = slide.title || labels.nextSteps;
  addSlideTitle(s, title, language);

  // Bullet list for action items
  if (slide.bullets && slide.bullets.length > 0) {
    s.addText(
      slide.bullets.map((b) => ({
        text: b,
        options: { bullet: { code: "2022" } },
      })),
      {
        x: 0.5,
        y: 1.5,
        w: 12.33,
        h: 5.3,
        ...baseText(language),
        fontSize: 16,
        color: hex(COLORS.ink),
        align: rtl ? "right" : "left",
        valign: "top",
        paraSpaceAfter: 10,
      },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────
// Top-level generator
// ─────────────────────────────────────────────────────────────────────

/**
 * Turn a structured presentation schema into a PPTX buffer ready to
 * upload. We use a single master for branding and dispatch each slide
 * to its layout function by `slide.layout`.
 */
export async function buildPresentationBuffer(
  content: PresentationContent,
): Promise<Buffer> {
  const pptx = new PptxGenJS();

  pptx.layout = "LAYOUT_WIDE"; // 13.33" x 7.5" — standard 16:9 widescreen
  pptx.title = content.title;
  pptx.subject = content.subtitle || "";
  // PowerPoint metadata only — decks are unsigned so there's no personal
  // author. The organization carries the identity via the slide master.
  pptx.author = BRAND.shortName;
  pptx.company = BRAND.longNameEn;

  defineMaster(pptx, content.language);

  // Always open with a title slide
  addTitleSlide(pptx, content);

  for (const slide of content.slides) {
    switch (slide.layout) {
      case "title":
        // Already added. If an explicit title is also in the slides array,
        // we still allow a second title slide — e.g. for a new chapter.
        addTitleSlide(pptx, {
          ...content,
          title: slide.title || content.title,
          subtitle: slide.subtitle ?? null,
        });
        break;
      case "section_header":
        addSectionHeader(pptx, slide, content.language);
        break;
      case "content":
        addContentSlide(pptx, slide, content.language);
        break;
      case "two_column":
        addTwoColumnSlide(pptx, slide, content.language);
        break;
      case "numbers":
        addNumbersSlide(pptx, slide, content.language);
        break;
      case "table":
        addTableSlide(pptx, slide, content.language);
        break;
      case "chart":
        addChartSlide(pptx, slide, content.language);
        break;
      case "conclusion":
        addConclusionSlide(pptx, slide, content.language);
        break;
      default:
        // Fallback: treat unknown layout as a plain content slide so the
        // document doesn't fail on a typo from the model.
        addContentSlide(pptx, slide, content.language);
    }
  }

  // pptxgenjs returns a Node Buffer when we ask for "nodebuffer".
  const result = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return result;
}
