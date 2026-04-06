import { supabaseAdmin } from "./supabase";
import { getOpenAI } from "./clients";
import { canonicalizeEntities, normalizeName, similarity, type CanonicalEntity } from "./entities";
import { embedQuery } from "./embeddings";
import { PDFParse } from "pdf-parse";

/**
 * THE LIBRARIAN AGENT
 *
 * The librarian is the intelligent layer that sits between an upload and the
 * knowledge base. When a new document arrives, it:
 *
 * 1. Quickly extracts the first page (no full vision pipeline yet)
 * 2. Classifies the document type and language
 * 3. Extracts named entities
 * 4. Searches the existing KB for similar/related documents
 * 5. Decides what kind of upload this is:
 *    - NEW (unrelated)        → add as a fresh document
 *    - VERSION (newer)        → link as new version, supersede the old one
 *    - DUPLICATE (same)       → reject upload, point to existing
 *    - RELATED (linked)       → add as new but cross-link via reference
 * 6. Returns a structured proposal that the UI shows the user before commit
 *
 * The librarian is intentionally a *fast* analysis (no expensive vision calls).
 * The full extraction pipeline runs only after the user confirms the action.
 */

export type LibrarianAction = "new" | "version" | "duplicate" | "related";

export interface LibrarianRelated {
  documentId: string;
  title: string;
  type: string;
  classification: string;
  createdAt: string;
  similarity: number; // 0..1
  reason: string; // human-readable why this is similar
  isCurrent: boolean;
  versionNumber: number;
}

export interface LibrarianProposal {
  // What we detected about the new document
  detected: {
    title: string;
    suggestedTitle: string; // cleaned-up version
    documentType: string; // "memo" | "contract" | "report" | etc
    language: "ar" | "en" | "mixed";
    pageCount: number;
    fileSize: number;
    suggestedClassification: "PRIVATE" | "PUBLIC" | "DOCTRINE";
    classificationReason: string;
    entities: Array<{ name: string; type: string; nameEn?: string }>;
    firstPagePreview: string; // first ~500 chars for the user to preview
  };

  // Related documents found in the KB
  related: LibrarianRelated[];

  // The librarian's recommended action
  recommendation: {
    action: LibrarianAction;
    reason: string;
    targetDocumentId?: string; // for version/duplicate
    confidence: "high" | "medium" | "low";
  };
}

interface QuickExtraction {
  text: string;
  pageCount: number;
}

// ────────────────────────────────────────
// QUICK EXTRACTION (no vision)
// ────────────────────────────────────────

async function quickExtract(buffer: Buffer): Promise<QuickExtraction> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return {
      text: result.text || "",
      pageCount: result.total || result.pages.length || 0,
    };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

// ────────────────────────────────────────
// CLASSIFICATION + ENTITY EXTRACTION (one LLM call)
// ────────────────────────────────────────

interface QuickAnalysis {
  title: string;
  suggestedTitle: string;
  documentType: string;
  language: "ar" | "en" | "mixed";
  classification: "PRIVATE" | "PUBLIC" | "DOCTRINE";
  classificationReason: string;
  entities: Array<{ name: string; type: string; nameEn?: string }>;
}

async function quickAnalyze(text: string, fileName: string): Promise<QuickAnalysis> {
  const openai = getOpenAI();
  // Use only first ~3000 chars to keep this cheap and fast
  const sample = text.slice(0, 3000);

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are the librarian for a government economic authority's document intelligence system. You analyze new documents quickly to help organize the knowledge base.

Given the first page of a document, return JSON:
{
  "title": "exact title as it appears in the document, or fileName-derived if no clear title",
  "suggestedTitle": "cleaned-up canonical title (proper case, no file-extension cruft)",
  "documentType": "memo | contract | mou | law | decree | report | presentation | letter | financial | policy | other",
  "language": "ar | en | mixed",
  "classification": "PRIVATE | PUBLIC | DOCTRINE",
  "classificationReason": "one sentence why",
  "entities": [
    {"name": "entity name", "type": "company|organization|authority|ministry|person|place|project|law", "nameEn": "English name if Arabic original"}
  ]
}

CLASSIFICATION GUIDE:
- PRIVATE: internal memos, draft contracts, financial proposals, negotiations, sensitive analysis
- PUBLIC: published laws, decrees, official government reports, public studies
- DOCTRINE: foundational policy documents that should ALWAYS be in context (rare; typically only for the master plan, founding decrees, key strategic frameworks)

ENTITY EXTRACTION:
- Be conservative — only extract clearly named entities
- For Arabic entities, also provide name_en if you can confidently translate
- Skip generic terms like "the company" or "the authority" — only specific named ones
- Common types: company (شركة), organization, authority (هيئة), ministry (وزارة), person (شخص), place (مكان), project (مشروع), law (قانون)

Be precise and concise. This is a fast analysis pass.`,
      },
      {
        role: "user",
        content: `File name: ${fileName}\n\nFirst page text:\n${sample}`,
      },
    ],
  });

  const parsed = JSON.parse(res.choices[0].message.content || "{}");
  return {
    title: parsed.title || fileName.replace(/\.pdf$/i, ""),
    suggestedTitle: parsed.suggestedTitle || parsed.title || fileName.replace(/\.pdf$/i, ""),
    documentType: parsed.documentType || "other",
    language: parsed.language || "ar",
    classification: parsed.classification || "PRIVATE",
    classificationReason: parsed.classificationReason || "",
    entities: Array.isArray(parsed.entities) ? parsed.entities : [],
  };
}

// ────────────────────────────────────────
// FIND RELATED DOCUMENTS
// ────────────────────────────────────────

async function findRelatedDocuments(
  analysis: QuickAnalysis,
  firstPageText: string,
): Promise<LibrarianRelated[]> {
  // Strategy: combine three signals
  // (1) title fuzzy match
  // (2) entity overlap (canonicalize the new entities, count link-table overlap)
  // (3) embedding similarity of the first chunk against existing chunks

  // Pull all current docs (small enough at this scale)
  const { data: allDocs } = await supabaseAdmin
    .from("documents")
    .select("id, title, type, classification, created_at, is_current, version_number, entities")
    .eq("status", "ready");
  if (!allDocs || allDocs.length === 0) return [];

  const newTitleNormalized = normalizeName(analysis.suggestedTitle);
  const newEntityNames = new Set(
    analysis.entities.map((e) => normalizeName(e.name)).filter(Boolean),
  );

  // Get embedding for the new doc's first page (one call)
  let newEmbedding: number[] | null = null;
  try {
    newEmbedding = await embedQuery(firstPageText.slice(0, 2000));
  } catch {
    /* embedding is optional */
  }

  // Score each existing doc
  type Scored = {
    doc: typeof allDocs[number];
    titleSim: number;
    entityOverlap: number;
    contentSim: number;
    composite: number;
    reason: string;
  };

  const scored: Scored[] = [];

  for (const doc of allDocs) {
    const docTitleNorm = normalizeName(doc.title || "");
    const titleSim = similarity(newTitleNormalized, docTitleNorm);

    // Entity overlap from the documents.entities text array
    const docEntitySet = new Set(
      ((doc.entities as string[]) || []).map((e) => normalizeName(e)).filter(Boolean),
    );
    let overlapCount = 0;
    for (const e of newEntityNames) {
      if (docEntitySet.has(e)) overlapCount++;
    }
    const entityOverlap =
      newEntityNames.size === 0 || docEntitySet.size === 0
        ? 0
        : overlapCount / Math.max(newEntityNames.size, docEntitySet.size);

    // Content similarity (cheap heuristic — sample one chunk per doc)
    let contentSim = 0;
    if (newEmbedding) {
      const { data: oneChunk } = await supabaseAdmin
        .from("chunks")
        .select("embedding")
        .eq("document_id", doc.id)
        .order("chunk_index", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (oneChunk?.embedding) {
        try {
          const docEmb =
            typeof oneChunk.embedding === "string"
              ? JSON.parse(oneChunk.embedding)
              : oneChunk.embedding;
          if (Array.isArray(docEmb) && docEmb.length === newEmbedding.length) {
            contentSim = cosineSimilarity(newEmbedding, docEmb);
          }
        } catch {
          /* skip */
        }
      }
    }

    // Composite score: title weighs heavily (filename matches),
    // entity overlap is the strongest signal of "same project",
    // content similarity catches semantic duplicates with different titles.
    const composite = 0.35 * titleSim + 0.4 * entityOverlap + 0.25 * contentSim;

    if (composite < 0.25) continue; // not similar enough to surface

    // Build a human reason
    const reasonParts: string[] = [];
    if (titleSim > 0.7) reasonParts.push(`very similar title (${(titleSim * 100).toFixed(0)}%)`);
    else if (titleSim > 0.4) reasonParts.push(`similar title`);
    if (overlapCount > 0)
      reasonParts.push(`${overlapCount} shared entit${overlapCount === 1 ? "y" : "ies"}`);
    if (contentSim > 0.85) reasonParts.push(`high content similarity`);
    else if (contentSim > 0.7) reasonParts.push(`moderate content similarity`);
    const reason = reasonParts.join(" · ") || "weak match";

    scored.push({ doc, titleSim, entityOverlap, contentSim, composite, reason });
  }

  scored.sort((a, b) => b.composite - a.composite);

  return scored.slice(0, 5).map((s) => ({
    documentId: s.doc.id,
    title: s.doc.title,
    type: s.doc.type,
    classification: s.doc.classification,
    createdAt: s.doc.created_at || "",
    similarity: s.composite,
    reason: s.reason,
    isCurrent: s.doc.is_current ?? true,
    versionNumber: s.doc.version_number ?? 1,
  }));
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ────────────────────────────────────────
// DECIDE THE ACTION
// ────────────────────────────────────────

function decideAction(
  analysis: QuickAnalysis,
  related: LibrarianRelated[],
): LibrarianProposal["recommendation"] {
  if (related.length === 0) {
    return {
      action: "new",
      reason: "No similar documents found in your knowledge base. This appears to be a new addition.",
      confidence: "high",
    };
  }

  const top = related[0];

  // Very high similarity → likely duplicate or new version
  if (top.similarity >= 0.7) {
    // If the new doc has the same suggested title and very high content sim → duplicate
    if (top.similarity >= 0.85) {
      return {
        action: "duplicate",
        reason: `This appears to be a duplicate of "${top.title}" (uploaded ${formatRelativeShort(top.createdAt)}). ${top.reason}.`,
        targetDocumentId: top.documentId,
        confidence: "high",
      };
    }
    // High but not perfect → likely a new version
    return {
      action: "version",
      reason: `This looks like a newer version of "${top.title}" (currently v${top.versionNumber}). ${top.reason}. Linking as a new version will mark the previous version as superseded.`,
      targetDocumentId: top.documentId,
      confidence: "medium",
    };
  }

  // Moderate similarity → related but distinct
  if (top.similarity >= 0.4) {
    return {
      action: "related",
      reason: `This is related to "${top.title}" (${top.reason}) but appears to be a distinct document. Adding as new and creating a cross-reference.`,
      targetDocumentId: top.documentId,
      confidence: "medium",
    };
  }

  // Weak match → just add as new
  return {
    action: "new",
    reason: "Some loosely similar documents exist but this appears to be a distinct new addition.",
    confidence: "high",
  };
}

function formatRelativeShort(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ────────────────────────────────────────
// MAIN ENTRYPOINT
// ────────────────────────────────────────

export async function analyzeUpload(
  fileBuffer: Buffer,
  fileName: string,
): Promise<LibrarianProposal> {
  // Step 1: Quick extract (no vision, just pdf-parse)
  const { text, pageCount } = await quickExtract(fileBuffer);

  // If pdf-parse returned nothing, the file is likely scanned. We still want
  // to give the user something to confirm — fall back to filename-derived data.
  const usableText = text.trim().length >= 100 ? text : "";

  // Step 2: Quick analyze (one LLM call) — title, type, language, classification, entities
  let analysis: QuickAnalysis;
  if (usableText) {
    analysis = await quickAnalyze(usableText, fileName);
  } else {
    // Fallback for image-only PDFs
    analysis = {
      title: fileName.replace(/\.pdf$/i, ""),
      suggestedTitle: fileName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " "),
      documentType: "other",
      language: "ar",
      classification: "PRIVATE",
      classificationReason: "Unable to read PDF text — assuming PRIVATE by default. Full vision extraction will run on confirm.",
      entities: [],
    };
  }

  // Step 3: Find related documents in the KB
  const related = await findRelatedDocuments(analysis, usableText);

  // Step 4: Decide the action
  const recommendation = decideAction(analysis, related);

  return {
    detected: {
      title: analysis.title,
      suggestedTitle: analysis.suggestedTitle,
      documentType: analysis.documentType,
      language: analysis.language,
      pageCount,
      fileSize: fileBuffer.length,
      suggestedClassification: analysis.classification,
      classificationReason: analysis.classificationReason,
      entities: analysis.entities,
      firstPagePreview: usableText.slice(0, 600),
    },
    related,
    recommendation,
  };
}

// ────────────────────────────────────────
// ALSO EXPOSED: canonicalize-and-link helper for the upload route
// ────────────────────────────────────────

export async function linkDocumentToCanonicalEntities(
  documentId: string,
  entities: Array<{ name: string; type: string; nameEn?: string | null }>,
): Promise<void> {
  if (entities.length === 0) return;
  const ids = await canonicalizeEntities(entities);
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const links = unique.map((eid) => ({
    document_id: documentId,
    entity_id: eid,
  }));
  await supabaseAdmin.from("document_entities").upsert(links, { onConflict: "document_id,entity_id" });
}

// Re-export for completeness
export type { CanonicalEntity };
