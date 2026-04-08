import type {
  DocumentType,
  ExtractedPage,
  ExtractedSection,
  ValidationIssue,
  ValidationResult,
} from "@/lib/extraction-schema";

interface RepetitionProblem {
  sectionIndex: number;
  sample: string;
  count: number;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncatePreview(text: string, maxLength = 80): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function extractSectionText(section: ExtractedSection): string {
  return collapseWhitespace(
    [section.clauseNumber, section.title, section.content, ...section.subItems]
      .filter(Boolean)
      .join(" "),
  );
}

function detectRepeatedSegments(text: string): Array<{ sample: string; count: number }> {
  const segments = text
    .split(/[\n\r]+|[،,؛;:.!?؟]+/)
    .map((segment) => collapseWhitespace(segment))
    .filter((segment) => segment.length >= 30 && segment.split(/\s+/).length >= 5);
  if (segments.length < 4) return [];

  const counts = new Map<string, number>();
  for (const segment of segments) {
    counts.set(segment, (counts.get(segment) || 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 4)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 2)
    .map(([sample, count]) => ({ sample, count }));
}

function detectRepeatedWordWindows(text: string): Array<{ sample: string; count: number }> {
  const words = collapseWhitespace(text)
    .split(/\s+/)
    .filter((word) => word.length > 1);
  if (words.length < 80) return [];

  const windowSize = 10;
  const counts = new Map<string, number>();
  for (let i = 0; i <= words.length - windowSize; i++) {
    const sample = words.slice(i, i + windowSize).join(" ");
    if (sample.length < 40) continue;
    counts.set(sample, (counts.get(sample) || 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 6)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 1)
    .map(([sample, count]) => ({ sample, count }));
}

function detectPageRepetitionProblems(page: ExtractedPage): RepetitionProblem[] {
  return page.sections.flatMap((section, sectionIndex) => {
    const text = extractSectionText(section);
    if (text.length < 160) return [];

    const repeatedSegments = detectRepeatedSegments(text);
    if (repeatedSegments.length > 0) {
      return repeatedSegments.map((problem) => ({
        sectionIndex,
        sample: problem.sample,
        count: problem.count,
      }));
    }

    return detectRepeatedWordWindows(text).map((problem) => ({
      sectionIndex,
      sample: problem.sample,
      count: problem.count,
    }));
  });
}

function formatRepetitionProblem(problem: RepetitionProblem): string {
  return `section ${problem.sectionIndex}: repeated long phrase "${truncatePreview(problem.sample)}" appears ${problem.count} times`;
}

function checkSubItemOrder(items: string[]): boolean {
  const arabicOrder = "أبتثجحخدذرزسشصضطظعغفقكلمنهوي";
  const latinOrder = "abcdefghijklmnopqrstuvwxyz";

  const extracted = items.map((item) => {
    const arabicMatch = item.match(/^\s*\(?\s*([أ-ي])\s*\)?/);
    if (arabicMatch) return { type: "ar" as const, char: arabicMatch[1] };
    const latinMatch = item.match(/^\s*\(?\s*([a-z])\s*\)?/i);
    if (latinMatch) return { type: "la" as const, char: latinMatch[1].toLowerCase() };
    return null;
  });

  if (extracted.some((entry) => entry === null)) return true;

  for (let i = 1; i < extracted.length; i++) {
    const prev = extracted[i - 1]!;
    const curr = extracted[i]!;
    if (prev.type !== curr.type) return true;
    const order = prev.type === "ar" ? arabicOrder : latinOrder;
    if (order.indexOf(curr.char) <= order.indexOf(prev.char)) return false;
  }

  return true;
}

export function validateExtraction(
  pages: ExtractedPage[],
  documentType: DocumentType,
): ValidationResult {
  void documentType;
  const issues: ValidationIssue[] = [];
  const seenClauses = new Set<string>();

  for (const page of pages) {
    const repetitionProblems = detectPageRepetitionProblems(page);
    for (const problem of repetitionProblems) {
      issues.push({
        type: "degenerate_repetition",
        message: `Page ${page.pageNumber}, ${formatRepetitionProblem(problem)} — likely degenerate OCR/model loop`,
        sectionIndex: problem.sectionIndex,
        severity: "error",
      });
    }

    if (page.pageType === "body") {
      const totalContentLength = page.sections.reduce(
        (sum, section) => sum + section.content.length + section.subItems.join("").length,
        0,
      );

      if (totalContentLength < 50) {
        issues.push({
          type: "empty_content",
          message: `Page ${page.pageNumber}: body page with almost no content (${totalContentLength} chars) — likely missing text`,
          sectionIndex: -1,
          severity: "error",
        });
      } else if (totalContentLength < 200 && page.sections.length <= 2) {
        issues.push({
          type: "empty_content",
          message: `Page ${page.pageNumber}: suspiciously little content (${totalContentLength} chars, ${page.sections.length} sections) — may be incomplete`,
          sectionIndex: -1,
          severity: "warning",
        });
      }
    }

    if (page.header && page.header.length > 200) {
      issues.push({
        type: "empty_content",
        message: `Page ${page.pageNumber}: header is ${page.header.length} chars — likely contains body text that should be in sections`,
        sectionIndex: -1,
        severity: "error",
      });
    }

    if (page.footer && page.footer.length > 200) {
      issues.push({
        type: "empty_content",
        message: `Page ${page.pageNumber}: footer is ${page.footer.length} chars — likely contains body text that should be in sections`,
        sectionIndex: -1,
        severity: "error",
      });
    }

    if (page.pageType === "cover") {
      for (let sectionIndex = 0; sectionIndex < page.sections.length; sectionIndex++) {
        if (
          ["introduction", "findings", "body", "recommendation"].includes(
            page.sections[sectionIndex].type,
          )
        ) {
          issues.push({
            type: "empty_content",
            message: `Page ${page.pageNumber}: cover page has "${page.sections[sectionIndex].type}" section — likely misclassified page or misassigned content`,
            sectionIndex,
            severity: "warning",
          });
        }
      }
    }

    for (let sectionIndex = 0; sectionIndex < page.sections.length; sectionIndex++) {
      const section = page.sections[sectionIndex];

      if (section.type === "introduction" && section.content) {
        const looksLikeMetadata = /^\s*(رقم العقد|Contract No|Reference|Date:|التاريخ)/i.test(
          section.content.trim(),
        );
        if (looksLikeMetadata) {
          issues.push({
            type: "empty_content",
            message: `Page ${page.pageNumber}, section ${sectionIndex}: "${section.type}" contains metadata instead of introduction text`,
            sectionIndex,
            severity: "error",
          });
        }
      }

      if (["article", "clause"].includes(section.type) && !section.clauseNumber) {
        issues.push({
          type: "missing_clause_number",
          message: `Page ${page.pageNumber}, section ${sectionIndex}: ${section.type} without clause number`,
          sectionIndex,
          severity: "error",
        });
      }

      if (!section.content || section.content.trim().length < 5) {
        issues.push({
          type: "empty_content",
          message: `Page ${page.pageNumber}, section ${sectionIndex}: empty or near-empty content`,
          sectionIndex,
          severity: "warning",
        });
      }

      if (section.clauseNumber) {
        const key = `${section.clauseNumber}`;
        if (seenClauses.has(key)) {
          issues.push({
            type: "duplicate_clause",
            message: `Page ${page.pageNumber}: duplicate clause "${section.clauseNumber}"`,
            sectionIndex,
            severity: "warning",
          });
        }
        seenClauses.add(key);
      }

      if (section.subItems.length > 1 && !checkSubItemOrder(section.subItems)) {
        issues.push({
          type: "unordered_items",
          message: `Page ${page.pageNumber}, clause "${section.clauseNumber}": sub-items may be out of order`,
          sectionIndex,
          severity: "warning",
        });
      }
    }
  }

  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    issues,
    corrections: [],
  };
}
