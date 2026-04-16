import type { ExtractedPage, ExtractedSection } from "./extraction-schema";
import { looksLikeOcrNoise } from "./ocr-noise";

export interface DocumentChunk {
  content: string;
  pageNumber: number;
  sectionTitle: string | null;
  clauseNumber: string | null;
  chunkIndex: number;
  metadata: {
    type: string;
    hasOverlap: boolean;
    originalLength: number;
    /**
     * Per-section confidence aggregated from Azure word-level data. Null
     * when the source section had no real signal (synthetic blocks, table
     * cells). When tiny chunks merge, this becomes the mean of inputs.
     * Surfaced in the EXTRACTION tab as the HIGH/MED/LOW pill.
     */
    confidence: number | null;
    table?: { headers?: string[]; rows: string[][] }; // structured table if present
  };
}

const MAX_CHUNK_CHARS = 2000;
const INTRA_SECTION_OVERLAP_CHARS = 100; // small bridge when splitting one long section
const MIN_CHUNK_CHARS = 200; // tail chunks shorter than this get merged into previous

/**
 * Clause-level chunking.
 *
 * Strategy:
 * 1. Each section from extraction is its own semantic unit (clause, table, etc.).
 * 2. Sections that fit in MAX_CHUNK_CHARS become a single chunk — NO cross-section
 *    overlap (that's what was duplicating tables).
 * 3. Long sections are split at sentence boundaries with a small intra-section bridge.
 * 4. Post-process: merge any tail chunk shorter than MIN_CHUNK_CHARS into its
 *    previous neighbor on the same page (avoids 54-char scraps).
 * 5. If the section has structured table data in metadata, preserve it.
 */
export function chunkDocument(pages: ExtractedPage[]): DocumentChunk[] {
  const raw: DocumentChunk[] = [];
  let chunkIndex = 0;

  for (const page of pages) {
    for (const section of page.sections) {
      // Skip sections that look like OCR scraped from figures, maps, or
      // icon rows (single-character tokens, symbol soup). These never
      // produce useful retrieval results and only pollute the chunks
      // table + the user's extraction view. Tables are kept because a
      // table cell can be sparse but structurally real. See
      // src/lib/ocr-noise.ts for the full rule set.
      if (!section.table && looksLikeOcrNoise(section.content)) continue;

      const sectionChunks = chunkSection(section, page.pageNumber, chunkIndex);
      for (const c of sectionChunks) {
        raw.push(c);
        chunkIndex++;
      }
    }
  }

  return mergeTinyTails(raw);
}

/**
 * Chunk a single section. If it fits, return one chunk. Otherwise split at
 * sentence boundaries with a small bridge between consecutive splits of the
 * SAME section only.
 */
function chunkSection(
  section: ExtractedSection,
  pageNumber: number,
  startIndex: number,
): DocumentChunk[] {
  const content = section.content.trim();
  if (!content) return [];

  // Pull structured table from section metadata if present
  const tableMeta =
    "table" in section && section.table
      ? (section.table as { headers?: string[]; rows: string[][] })
      : undefined;

  // Single-chunk path
  if (content.length <= MAX_CHUNK_CHARS) {
    return [
      {
        content,
        pageNumber,
        sectionTitle: section.title,
        clauseNumber: section.clauseNumber,
        chunkIndex: startIndex,
        metadata: {
          type: section.type,
          hasOverlap: false,
          originalLength: content.length,
          confidence: section.confidence,
          ...(tableMeta ? { table: tableMeta } : {}),
        },
      },
    ];
  }

  // Long-section split path
  const sentences = splitIntoSentences(content);
  const chunks: DocumentChunk[] = [];
  let currentChunk = "";
  let currentIndex = startIndex;

  const flush = (withBridgeFromPrevious: boolean) => {
    if (!currentChunk) return;
    const bridge =
      withBridgeFromPrevious && chunks.length > 0
        ? getOverlapSuffix(
            chunks[chunks.length - 1].content,
            INTRA_SECTION_OVERLAP_CHARS,
          )
        : "";
    const chunkContent = bridge ? `${bridge} ${currentChunk}` : currentChunk;
    chunks.push({
      content: chunkContent,
      pageNumber,
      sectionTitle: section.title,
      clauseNumber: section.clauseNumber,
      chunkIndex: currentIndex,
      metadata: {
        type: section.type,
        hasOverlap: !!bridge,
        originalLength: currentChunk.length,
        confidence: section.confidence,
        // Only attach table to the first chunk of a split section
        ...(tableMeta && chunks.length === 0 ? { table: tableMeta } : {}),
      },
    });
    currentIndex++;
    currentChunk = "";
  };

  for (const sentence of sentences) {
    if (
      currentChunk.length + sentence.length > MAX_CHUNK_CHARS &&
      currentChunk
    ) {
      flush(true);
    }
    currentChunk += (currentChunk ? " " : "") + sentence;
  }
  flush(true);

  return chunks;
}

/**
 * Merge any chunk shorter than MIN_CHUNK_CHARS into its predecessor on the
 * same page. This avoids the 54-char scraps we used to emit when a section
 * just barely overflowed MAX_CHUNK_CHARS.
 */
function mergeTinyTails(chunks: DocumentChunk[]): DocumentChunk[] {
  if (chunks.length <= 1) return chunks;
  const merged: DocumentChunk[] = [];

  for (const c of chunks) {
    const last = merged[merged.length - 1];
    const tooSmall = c.metadata.originalLength < MIN_CHUNK_CHARS;
    const samePage = last && last.pageNumber === c.pageNumber;
    const wouldStillFit =
      last &&
      last.content.length + c.content.length + 1 <= MAX_CHUNK_CHARS * 1.2;

    if (tooSmall && samePage && wouldStillFit && last) {
      // Merge into previous
      last.content = `${last.content}\n${c.content}`.trim();
      // Confidence becomes a length-weighted mean: longer source contributes
      // more to the merged chunk's signal. If either side is null we fall
      // back to whichever has a real number — one informed signal is better
      // than averaging it away with `null`.
      const mergedConfidence = weightedMeanConfidence(
        last.metadata.confidence,
        last.metadata.originalLength,
        c.metadata.confidence,
        c.metadata.originalLength,
      );
      last.metadata = {
        ...last.metadata,
        originalLength:
          last.metadata.originalLength + c.metadata.originalLength,
        confidence: mergedConfidence,
      };
      // Adopt section/clause title only if previous didn't have one
      if (!last.sectionTitle && c.sectionTitle)
        last.sectionTitle = c.sectionTitle;
      if (!last.clauseNumber && c.clauseNumber)
        last.clauseNumber = c.clauseNumber;
      // Adopt table metadata if previous didn't have one
      if (!last.metadata.table && c.metadata.table) {
        last.metadata.table = c.metadata.table;
      }
      continue;
    }

    merged.push({ ...c });
  }

  // Re-index after merging
  return merged.map((c, i) => ({ ...c, chunkIndex: i }));
}

function weightedMeanConfidence(
  a: number | null,
  aWeight: number,
  b: number | null,
  bWeight: number,
): number | null {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  const total = aWeight + bWeight;
  if (total <= 0) return (a + b) / 2;
  return (a * aWeight + b * bWeight) / total;
}

/**
 * Split text into sentences, handling both Arabic and English conventions.
 * Arabic sentences often end with: ؟ ؛ . ! and newlines.
 */
function splitIntoSentences(text: string): string[] {
  const sentenceEnders = /(?<=[.!?؟؛。\n])\s+/g;
  const sentences = text.split(sentenceEnders).filter((s) => s.trim());
  if (sentences.length <= 1) {
    return text.split(/\n+/).filter((s) => s.trim());
  }
  return sentences;
}

/**
 * Get the last N characters of text for an overlap bridge.
 * Tries to break at a word boundary so the bridge isn't a partial word.
 */
function getOverlapSuffix(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const suffix = text.slice(-maxChars);
  const spaceIndex = suffix.indexOf(" ");
  if (spaceIndex > 0 && spaceIndex < maxChars / 2) {
    return suffix.slice(spaceIndex + 1);
  }
  return suffix;
}
