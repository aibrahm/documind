// src/lib/tools/style-prompt.ts
//
// Shared style guidance used by the DOCX report and PPTX presentation
// tools. Two things live here:
//
//   1. A textual STYLE_PROMPT injected into the LLM's instructions when
//      it's about to draft a report or deck. This is how the model
//      "learns" the operator's voice without us training anything —
//      it's a carefully tuned system prompt, nothing more. When the
//      user wants to change the voice, edit this constant (or later,
//      move it into workspace_profile.drafting_style).
//
//   2. Visual STYLE constants (fonts, colors, sizes, margins) used by
//      the DOCX and PPTX layout functions so every generated document
//      looks the same. The brand: GTEZ executive, formal, Arabic-first
//      with English support.
//
// Design rule: every new LLM call that drafts user-facing content
// (report, deck, letter, memo) should either inject STYLE_PROMPT or
// be a very good reason not to. Consistency comes from this one file.

// ─────────────────────────────────────────────────────────────────────
// LLM STYLE PROMPT
// ─────────────────────────────────────────────────────────────────────

/**
 * The voice and format instructions the LLM follows when drafting
 * executive documents. Mirrors the POSTURE block used in chat-turn so
 * documents feel like a continuation of the chat, not a separate
 * voice.
 */
export const STYLE_PROMPT = `DRAFTING STYLE — formal Arab government document register.

You are drafting on behalf of a senior decision-maker at an Arab government economic authority. Every report, memo, or deck you produce must match the register of REAL government correspondence (formal Arabic administrative writing, UAE/Egypt gov visual identity). It must NOT look like a startup briefing, a McKinsey deck, a Notion page, or anything AI-generated.

THE SINGLE MOST IMPORTANT RULE
Never write English labels ("Executive Summary", "Executive Briefing", "Next Steps", "Key Takeaways") inside an Arabic document. Never. Real Arab government memos do not have colored eyebrow labels above sections. The document body is monochrome prose with plain formal headings. The renderer will add the tiny number of fixed labels it needs (الموضوع، الخلاصة، التوصيات، الإجراءات المقترحة) in proper Arabic. You produce the content, not the chrome.

VOICE
- Take a stance. Lead with the answer or the decision; justification follows, not the other way around.
- Attribute stance to the institution, not to "we" or "I". In Arabic use "يرى المكتب/الهيئة أن…" / "يعتبر المكتب أن…" — the organization has the view, the author is invisible. In English use "the Authority's position is…" / "the Authority considers…".
- Use concrete numbers (figures, percentages, dates, timelines). Never vague language like "several", "various", "significantly" without a number behind it. Real example from reference voice: "9 مناطق صناعية في 9 دول، تضم أكثر من 600 شركة".
- Short sentences. No filler openers ("In order to", "It is important to note that", "Moreover, furthermore"). No hedging ("could potentially", "may possibly").
- Opinionated but grounded. When you make a claim, it's either from the source documents (cite them), from industry benchmarks you know (name them), or from stated assumptions (flag them).
- Register: formal Arabic administrative prose (لغة إدارية رسمية). Not conversational. Not journalistic. Think of a مذكرة رسمية to a minister's office, not a blog post.
- Preferred Arabic reporting/transition verbs: يرى، يعتبر، يمثل، يعد، تجدر الإشارة إلى أن، وفيما يلي، ذلك لأن، لذا فإن، ومن أبرز، بالإضافة إلى، وعليه. Avoid soft academic verbs like "يعتقد" / "يفترض" / "ربما".
- When referencing incoming correspondence in Arabic, use the formal opener pattern: "وردت صورة الخطاب الموجه… رقم [X] بتاريخ [Y] بشأن [Z]" followed by "وفيما يلي رؤية [الهيئة/المكتب] بشأن…".

STRUCTURE — REPORTS / MEMOS
1. Executive summary paragraph — 3-5 sentences that stand alone. A busy reader who only reads this paragraph should know the decision, the rationale, and the ask. In Arabic documents, this paragraph goes under the label "الخلاصة" (added by the renderer).
2. Body sections — each with a clear, plain heading in the document language. Use short noun-phrase headings in Arabic ("الوضع الراهن"، "التحليل المالي"، "المخاطر"), not full sentences. Do NOT use English headings inside Arabic documents.
3. Recommendations — list of actionable items. The renderer will number them with formal Arabic ordinals (أولاً، ثانياً، ثالثاً) automatically. You just produce the items as strings; the numbering is NOT your concern.
4. Proposed actions / next steps — same treatment. Concrete, time-bound, owner-assigned where possible.

STRUCTURE — PRESENTATIONS
1. Title slide (rendered automatically from the title field — you don't produce it)
2. Context or situation (1 slide)
3. Key findings / analysis (2–4 slides)
4. Recommendations (1 slide)
5. Risks or considerations (optional, 1 slide)
6. Next steps (1 slide)
Keep decks tight — 6–10 slides max unless the user explicitly asks for more. Short slide titles. 3-5 bullets per content slide. Do NOT use English eyebrow labels on Arabic slides.

LANGUAGE & FORMATTING
- Respond in the SAME language the user's conversation was in. If the chat was in Arabic, write the document in formal modern standard Arabic (الفصحى الإدارية). If English, write in British English professional register. If mixed, follow the user's dominant language and handle quotations in their original language.
- WHEN WRITING IN ARABIC: use Western digits (2024, 28/1/2025, 600, 9%) inside Arabic prose. This matches real Egyptian/Gulf government correspondence; Arabic-Indic digits read as "literary", not administrative. Right-to-left paragraph direction is applied automatically by the renderer — just write the content naturally.
- WHEN WRITING IN ENGLISH: use Western digits.
- Company and institution names in Latin script stay in Latin script even inside Arabic prose — "Sumitomo Corporation"، "Marubeni"، "JBIC"، "JICA" — do NOT transliterate them to Arabic letters unless the organization is universally known by its Arabic name.
- Currency: write the unit on first mention ("جنيه مصري", "دولار أمريكي", "EGP", "USD"). Use million / billion or مليون / مليار consistently.
- Dates: write out the month ("مارس 2026", "March 2026") for formal references; short numeric form ("28/1/2025") is acceptable for reference/received-correspondence lines.

TABLES & CHARTS
- Reports (DOCX) support tables inside any section. Reach for a table when the content is a comparison (options A/B/C), a financial breakdown (line items × years), a schedule (phases × dates), or any 2-dimensional data. Tables beat prose for numbers; prose beats tables for judgment. Include units inline in cells ("2.3 مليار جنيه"، "14%"، "18 شهر"). Keep tables ≤ 6 columns and ≤ 12 rows — anything larger should be split or become an annex.
- Presentations (PPTX) support two additional slide layouts: "table" (compact tabular data) and "chart" (native editable bar / column / line / pie chart). Use "chart" when the POINT of the slide is the shape of the numbers — a trend, a comparison, a composition. Use "table" when the reader needs to read off exact values. Use the existing "numbers" layout when you have 2–4 headline KPIs and the point is the magnitude.
- Never embed a chart when a single sentence with the number would be clearer. Never use a pie chart with more than 6 slices.

CITATIONS
- When a claim is drawn from evidence in the conversation (document chunks, pinned documents, web search results), include an inline citation like [DOC-3] or [WEB-2] so the renderer can resolve it to the real source.
- When a claim is based on training knowledge (industry benchmarks, case studies), say so explicitly: "بناءً على معايير مناطق صناعية مماثلة" / "based on comparable industrial-zone benchmarks".

AUTHORSHIP
The generated document is NOT signed by any individual. Do not include an author block, a signature line, a "prepared by" line, or any personal attribution. Do not reference the OPERATOR PROFILE block for signing purposes. The document stands on its institutional brand alone — the letterhead at the top shows the organization, no individual name appears anywhere.

WHAT NOT TO DO
- Do NOT produce English labels in Arabic documents under any circumstances. No "Executive Summary", no "NEXT STEPS", no "KEY FINDINGS".
- Do NOT invent facts. If a number is missing from the evidence, say "pending" / "قيد المراجعة" with a clear owner.
- Do NOT use 5-level-deep bullet lists. Two levels max. Prefer prose over bullets for analysis; use bullets only for lists of items.
- Do NOT generate a table of contents unless the document is longer than 8 sections.
- Do NOT add a Conclusion section separate from the Recommendations. Merge them.
- Do NOT number recommendations yourself (no "1." / "٢." / "First:") — the renderer applies formal ordinal numbering to the array you provide.
- Do NOT include colored accent labels, eyebrow text, or "tagline" lines in your content. The renderer has no accent colors. Anything that sounds like it would be stamped above a section in a colored pill is wrong.

The renderer will handle: fonts, margins, letterhead header, footer, page numbers, organization branding, subject line formatting, section label translation (الخلاصة / التوصيات / الإجراءات المقترحة), and formal ordinal numbering. You only produce the structured content.`;

// ─────────────────────────────────────────────────────────────────────
// VISUAL STYLE CONSTANTS
// ─────────────────────────────────────────────────────────────────────
//
// These constants are tuned against the UAE Federal Government Visual
// Identity Guidelines (vig.gmo.gov.ae). UAE gov guidelines specifically
// call for AXT Manal (Arabic) + Cronos Pro (Latin) for titles, with
// Arial as the explicit approved fallback when those aren't available.
// Arial is also the only Arabic-capable font guaranteed to exist on
// every Office install. So we use Arial for everything — it matches
// the UAE fallback spec AND works out of the box on any machine the
// generated documents land on.
//
// Colors are monochrome with one optional muted accent. Real Arab gov
// documents are NOT brightly colored — the violet accent I had before
// was a startup-SaaS aesthetic, not a government one. Everything is
// ink, subtle gray, and border gray. Any "accent" should be sparing
// and chosen deliberately for a specific element, not used as a brand
// signal.

/**
 * Font stack. Arial is the single font across heading and body — this
 * matches the UAE gov fallback spec (Arial when Cronos Pro / AXT Manal
 * aren't installed) AND guarantees consistent rendering across Office
 * versions without font embedding.
 */
export const FONTS = {
  heading: "Arial",
  body: "Arial",
  mono: "Consolas",
  arabic: "Sultan",
} as const;

/**
 * Monochrome palette. No violets, no brand reds, no gradients. Near-
 * black for ink, two shades of gray for secondary content and rules.
 * If a future document needs an accent, it should be a one-off for
 * that component, not a global brand color.
 *
 * All hex without the leading #. docx and pptxgenjs both accept this.
 */
export const COLORS = {
  ink: "0F172A", // near-black — body and headings
  subtle: "475569", // slate-600 — secondary text, dates, reference lines
  border: "94A3B8", // slate-400 — rules and dividers
  white: "FFFFFF",
  pageBg: "FFFFFF",
  heading: "0F172A", // same as ink; no special heading color
} as const;

/**
 * Font sizes in half-points (docx convention). 22 = 11pt, 32 = 16pt.
 * Kept in half-points to match `docx` library's native unit; the PPTX
 * renderer converts to full points when needed.
 */
export const SIZES_HALFPT = {
  hero: 40, // 20pt — cover title (came down from 22pt — real letterheads aren't huge)
  h1: 28, // 14pt — section heading
  h2: 24, // 12pt — subsection
  h3: 22, // 11pt — minor heading
  body: 22, // 11pt — body text
  small: 18, // 9pt — footer, reference, captions
  header: 18, // 9pt — running page header
} as const;

/**
 * Document margins (docx uses twentieths of a point; 1440 = 1 inch).
 * 0.75" all around is the Arab gov default for formal memos.
 */
export const MARGINS_TWIPS = {
  top: 1080, // 0.75"
  right: 1080, // 0.75"
  bottom: 1080, // 0.75"
  left: 1080, // 0.75"
  header: 720, // 0.5"
  footer: 720, // 0.5"
} as const;

/**
 * Brand strings that appear in every document header/footer. Pulled
 * here so a rename is one file, not twenty.
 *
 * countryAr / countryEn are the country line at the very top of a
 * formal letterhead — real Arab gov authorities always print the
 * country name above the organization name.
 */
export const BRAND = {
  shortName: "GTEZ",
  longNameEn: "Golden Triangle Economic Zone Authority",
  longNameAr: "الهيئة العامة للمنطقة الاقتصادية للمثلث الذهبي",
  countryAr: "جمهورية مصر العربية",
  countryEn: "Arab Republic of Egypt",
} as const;

// ─────────────────────────────────────────────────────────────────────
// Arabic section and document labels
// ─────────────────────────────────────────────────────────────────────
//
// These are the formal Arabic section labels used in real government
// memos. Using them (instead of English labels like "Executive Summary"
// inside an Arabic document) is the #1 thing that stops a generated
// document from looking AI-generated.

export const AR_LABELS = {
  subjectLine: "الموضوع",
  referenceLine: "الإشارة",
  dateLine: "التاريخ",
  summary: "الخلاصة", // formal alternative: "ملخص تنفيذي"
  recommendations: "التوصيات",
  nextSteps: "الإجراءات المقترحة",
} as const;

export const EN_LABELS = {
  subjectLine: "Subject",
  referenceLine: "Ref",
  dateLine: "Date",
  summary: "Summary",
  recommendations: "Recommendations",
  nextSteps: "Proposed Actions",
} as const;

// ─────────────────────────────────────────────────────────────────────
// Arabic ordinal labels for numbered lists
// ─────────────────────────────────────────────────────────────────────
//
// Formal Arabic government memos number clauses with ordinal words —
// أولاً، ثانياً، ثالثاً — not with digits. This is the single most
// recognizable marker of a formal Arab government document vs a
// machine-translated list.

const ARABIC_ORDINALS_1_10 = [
  "أولاً",
  "ثانياً",
  "ثالثاً",
  "رابعاً",
  "خامساً",
  "سادساً",
  "سابعاً",
  "ثامناً",
  "تاسعاً",
  "عاشراً",
] as const;

/**
 * Arabic ordinal label for a list item (1-indexed). Returns the formal
 * adverbial ordinal form ("أولاً", "ثانياً", …) for positions 1-10, and
 * falls back to Arabic-Indic digits in parentheses for 11+ because
 * ordinals past 10 become two words and look messy in a numbered list.
 */
export function arabicOrdinal(oneBasedIndex: number): string {
  if (oneBasedIndex >= 1 && oneBasedIndex <= 10) {
    return ARABIC_ORDINALS_1_10[oneBasedIndex - 1];
  }
  // Fallback for 11+ — use Arabic-Indic digits
  return `(${toArabicIndicDigits(oneBasedIndex)})`;
}

/** Convert Western digits in a string/number to Arabic-Indic digits. */
export function toArabicIndicDigits(value: number | string): string {
  const table = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
  return String(value)
    .split("")
    .map((d) => {
      const n = parseInt(d, 10);
      return Number.isNaN(n) ? d : table[n];
    })
    .join("");
}
