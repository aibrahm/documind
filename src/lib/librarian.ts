import { createHash } from "node:crypto";
import { supabaseAdmin } from "./supabase";
import { canonicalizeEntities, normalizeName, similarity, type CanonicalEntity } from "./entities";
import { embedQuery } from "./embeddings";
import { PDFParse } from "pdf-parse";
import {
  analyzeDocumentWithAzureLayout,
  isAzureDocumentIntelligenceConfigured,
} from "@/lib/azure-document-intelligence";
import {
  buildStructuredDocumentFromNormalized,
  normalizeAzureLayoutDocument,
} from "@/lib/ocr-normalization";
import {
  analyzeDocumentWithPdfTextLayer,
  isConfidentNativeTextLaneCandidate,
} from "@/lib/pdf-text-extraction";
import { normalizeNumbers } from "@/lib/normalize";
import type { ExtractionPreferences } from "@/lib/extraction-schema";

/**
 * THE LIBRARIAN AGENT
 *
 * The librarian is the intelligent layer that sits between an upload and the
 * knowledge base. When a new document arrives, it:
 *
 * 1. Quickly extracts document text through the same OCR/text lanes as the
 *    real extraction pipeline
 * 2. Classifies the document type and language deterministically
 * 3. Extracts named entities
 * 4. Searches the existing KB for similar/related documents
 * 5. Decides what kind of upload this is:
 *    - NEW (unrelated)        → add as a fresh document
 *    - VERSION (newer)        → link as new version, supersede the old one
 *    - DUPLICATE (same)       → reject upload, point to existing
 *    - RELATED (linked)       → add as new but cross-link via reference
 * 6. Returns a structured proposal that the UI shows the user before commit
 *
 * The librarian intentionally avoids image-prompt OCR. For native PDFs it uses
 * the text layer; for scanned PDFs it uses Azure Layout when configured.
 * The full extraction pipeline still runs only after the user confirms.
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

export interface SuggestedProject {
  id: string;
  slug: string;
  name: string;
  color: string | null;
  overlapCount: number;
  reason: string;
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

  // Phase 07: project suggestion based on entity overlap with project_entities.
  // suggestedProject is the top match (back-compat); suggestedProjects is the
  // top 3 ranked list so the upload UI can offer alternates.
  suggestedProject: SuggestedProject | null;
  suggestedProjects: SuggestedProject[];
}

interface QuickExtraction {
  text: string;
  pageCount: number;
}

// ────────────────────────────────────────
// QUICK EXTRACTION / FALLBACK INSPECTION
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

interface QuickAnalysis {
  title: string;
  suggestedTitle: string;
  documentType: string;
  language: "ar" | "en" | "mixed";
  classification: "PRIVATE" | "PUBLIC" | "DOCTRINE";
  classificationReason: string;
  entities: Array<{ name: string; type: string; nameEn?: string }>;
}

function cleanSuggestedTitle(title: string, fileName: string): string {
  const fallback = fileName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
  const candidate = title.trim() || fallback;
  return candidate.replace(/\s+/g, " ");
}

function suggestClassification(
  documentType: string,
  title: string,
  fullText: string,
): Pick<QuickAnalysis, "classification" | "classificationReason"> {
  const normalizedTitle = normalizeNumbers(title);
  const normalized = normalizeNumbers(`${title}\n${fullText}`).slice(0, 12000);

  if (["memo", "letter", "contract", "financial", "presentation"].includes(documentType)) {
    return {
      classification: "PRIVATE",
      classificationReason:
        "Working-document structure detected, so this should stay in the private workspace corpus.",
    };
  }

  if (
    /المخطط العام الشامل|master plan|الإطار الاستراتيجي|الرؤية الاستراتيجية|الخطة الاستراتيجية/i.test(
      normalized,
    )
  ) {
    return {
      classification: "DOCTRINE",
      classificationReason:
        "Foundational strategic framework detected, so this should remain always-available reference context.",
    };
  }

  if (
    documentType === "law" ||
    documentType === "decree" ||
    /^(مشروع قانون|القانون رقم|قرار رئيس الجمهورية|قرار رئيس مجلس الوزراء|مرسوم)/.test(
      normalizedTitle,
    )
  ) {
    return {
      classification: "PUBLIC",
      classificationReason:
        "Published legal or regulatory text detected, so this belongs in the public reference corpus.",
    };
  }

  if (documentType === "policy" && /هيئة|المنطقة الاقتصادية|استراتيجية|إطار/.test(normalized)) {
    return {
      classification: "DOCTRINE",
      classificationReason:
        "Institutional policy or strategy document detected, so it should be treated as doctrine-level reference.",
    };
  }

  return {
    classification: "PRIVATE",
    classificationReason:
      "Operational, commercial, or working-document characteristics detected, so this should stay in the private workspace corpus.",
  };
}

async function quickAnalyzeDocument(
  fileBuffer: Buffer,
  fileName: string,
  preferences?: ExtractionPreferences,
): Promise<{
  analysis: QuickAnalysis;
  pageCount: number;
  previewText: string;
  similarityText: string;
}> {
  const nativeTextResult = await analyzeDocumentWithPdfTextLayer({
    fileBuffer,
    fileName,
    preferences,
  });

  const shouldUseNativeTextLane = isConfidentNativeTextLaneCandidate(
    nativeTextResult?.normalized,
    preferences,
  );

  let pageCount = shouldUseNativeTextLane ? nativeTextResult?.rawOcr.pageCount ?? 0 : 0;
  let normalized = shouldUseNativeTextLane ? nativeTextResult?.normalized ?? null : null;

  if (!normalized && isAzureDocumentIntelligenceConfigured()) {
    const azureResponse = await analyzeDocumentWithAzureLayout(fileBuffer);
    normalized = normalizeAzureLayoutDocument(azureResponse, fileName, preferences);
    pageCount = azureResponse.analyzeResult?.pages?.length || 0;
  }

  if (!normalized && nativeTextResult?.normalized) {
    normalized = nativeTextResult.normalized;
    pageCount = nativeTextResult.rawOcr.pageCount;
  }

  if (!normalized) {
    const fallbackExtraction = await quickExtract(fileBuffer);
    const fallbackTitle = cleanSuggestedTitle("", fileName);
    const previewText = fallbackExtraction.text.slice(0, 600);
    return {
      analysis: {
        title: fallbackTitle,
        suggestedTitle: fallbackTitle,
        documentType: "other",
        language: "ar",
        classification: "PRIVATE",
        classificationReason:
          "Text extraction was too weak for deterministic routing. Full OCR parsing will run after confirmation.",
        entities: [],
      },
      pageCount: fallbackExtraction.pageCount,
      previewText,
      similarityText: fallbackExtraction.text.slice(0, 6000),
    };
  }

  const structured = buildStructuredDocumentFromNormalized({
    normalized,
    fileName,
  });
  const title = structured.classification.title || fileName.replace(/\.pdf$/i, "");
  const classification = suggestClassification(
    structured.classification.documentType,
    title,
    normalized.fullText,
  );

  return {
    analysis: {
      title,
      suggestedTitle: cleanSuggestedTitle(title, fileName),
      documentType: structured.classification.documentType,
      language: structured.classification.language,
      classification: classification.classification,
      classificationReason: classification.classificationReason,
      entities: structured.metadata.entities || [],
    },
    pageCount,
    previewText: normalized.pages[0]?.fullText?.slice(0, 600) || normalized.fullText.slice(0, 600),
    similarityText: normalized.fullText.slice(0, 6000),
  };
}

// ────────────────────────────────────────
// FIND RELATED DOCUMENTS
// ────────────────────────────────────────

async function findRelatedDocuments(
  analysis: QuickAnalysis,
  documentTextSample: string,
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

  // Get embeddings for the new doc at multiple positions (first / middle / last
  // 2000-char windows). The deeper-31% fix: by sampling the new doc the same
  // way we sample candidates, we cover the case where the existing doc was
  // chunked at boundaries that don't align with raw pdf-parse text. Up to 3
  // embeddings, computed in parallel.
  let newEmbeddings: number[][] = [];
  try {
    const len = documentTextSample.length;
    const windows: string[] = [];
    if (len > 0) {
      windows.push(documentTextSample.slice(0, 2000));
      if (len > 4000) {
        const midStart = Math.max(0, Math.floor(len / 2) - 1000);
        windows.push(documentTextSample.slice(midStart, midStart + 2000));
      }
      if (len > 2000) {
        windows.push(documentTextSample.slice(Math.max(0, len - 2000)));
      }
    }
    const settled = await Promise.allSettled(
      windows.map((w) => embedQuery(w)),
    );
    newEmbeddings = settled
      .filter((s): s is PromiseFulfilledResult<number[]> => s.status === "fulfilled")
      .map((s) => s.value);
  } catch (err) {
    console.error("librarian: new-doc embedding batch failed:", err);
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

    // Content similarity — sample first/middle/last chunks of the candidate
    // AND first/middle/last 2k-char windows of the new doc (computed once
    // above into newEmbeddings), then take the MAX cosine across the full
    // cross-product. Up to 3 × 3 = 9 comparisons per candidate. Catches
    // exact-PDF re-uploads even when chunking pipelines disagree on cut
    // points or cover pages differ between OCR/rendering passes.
    let contentSim = 0;
    if (newEmbeddings.length > 0) {
      const { count: chunkCount } = await supabaseAdmin
        .from("chunks")
        .select("id", { count: "exact", head: true })
        .eq("document_id", doc.id);

      const totalChunks = chunkCount ?? 0;
      const sampleIndices: number[] =
        totalChunks <= 1
          ? totalChunks === 1
            ? [0]
            : []
          : totalChunks === 2
            ? [0, 1]
            : [0, Math.floor(totalChunks / 2), totalChunks - 1];

      if (sampleIndices.length > 0) {
        const { data: sampleChunks } = await supabaseAdmin
          .from("chunks")
          .select("embedding, chunk_index")
          .eq("document_id", doc.id)
          .in("chunk_index", sampleIndices);

        for (const ch of sampleChunks ?? []) {
          if (!ch.embedding) continue;
          try {
            const docEmb =
              typeof ch.embedding === "string"
                ? JSON.parse(ch.embedding)
                : ch.embedding;
            if (!Array.isArray(docEmb)) continue;
            for (const ne of newEmbeddings) {
              if (docEmb.length !== ne.length) continue;
              const sim = cosineSimilarity(ne, docEmb);
              if (sim > contentSim) contentSim = sim;
            }
          } catch {
            /* skip */
          }
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
// PROJECT SUGGESTION (Phase 07)
// ────────────────────────────────────────

/**
 * Given the entities detected on the new document, find the projects (up to
 * 3) with the highest entity-overlap counts via project_entities. Returns
 * empty array if no overlap exists.
 */
async function suggestProjects(
  detectedEntities: Array<{ name: string; type: string; nameEn?: string }>,
): Promise<SuggestedProject[]> {
  if (detectedEntities.length === 0) return [];

  // Canonicalize the detected entities to get their IDs in the entities table.
  // canonicalizeEntities also creates new entities — harmless because they'll
  // be re-used during the full upload pipeline anyway.
  const entityIds = await canonicalizeEntities(detectedEntities);
  const uniqueIds = [...new Set(entityIds)];
  if (uniqueIds.length === 0) return [];

  // Find all project_entities rows that match any of these entities,
  // joined to projects (filter out archived projects).
  const { data: links } = await supabaseAdmin
    .from("project_entities")
    .select(
      `
      project_id,
      entity_id,
      project:projects ( id, slug, name, color, status )
    `,
    )
    .in("entity_id", uniqueIds);

  if (!links || links.length === 0) return [];

  // Tally overlap per project (skip archived)
  type ProjectMeta = {
    id: string;
    slug: string;
    name: string;
    color: string | null;
    overlapEntityIds: Set<string>;
  };
  const byProject = new Map<string, ProjectMeta>();
  for (const link of links) {
    const project = link.project as
      | { id: string; slug: string; name: string; color: string | null; status: string }
      | null;
    if (!project || project.status === "archived") continue;
    if (!byProject.has(project.id)) {
      byProject.set(project.id, {
        id: project.id,
        slug: project.slug,
        name: project.name,
        color: project.color,
        overlapEntityIds: new Set(),
      });
    }
    byProject.get(project.id)!.overlapEntityIds.add(link.entity_id as string);
  }

  if (byProject.size === 0) return [];

  // Rank by overlap count, return top 3
  return [...byProject.values()]
    .filter((p) => p.overlapEntityIds.size > 0)
    .sort((a, b) => b.overlapEntityIds.size - a.overlapEntityIds.size)
    .slice(0, 3)
    .map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      color: p.color,
      overlapCount: p.overlapEntityIds.size,
      reason:
        p.overlapEntityIds.size === 1
          ? `1 entity matches a linked participant in this project`
          : `${p.overlapEntityIds.size} entities match linked participants in this project`,
    }));
}

// ────────────────────────────────────────
// MAIN ENTRYPOINT
// ────────────────────────────────────────

export async function analyzeUpload(
  fileBuffer: Buffer,
  fileName: string,
  preferences?: ExtractionPreferences,
): Promise<LibrarianProposal> {
  // Step 0: SHA256 short-circuit. If a document with the exact same hash
  // exists, this is a bit-for-bit duplicate — return "duplicate" immediately
  // without running the (slow + flaky) embedding/title/entity heuristics.
  // Embedding similarity caps below 1.0 because pdf-parse text vs vision-
  // extracted chunks never align perfectly, so the heuristic path can't
  // reliably catch exact re-uploads. Hash matching is bulletproof.
  const sha256 = createHash("sha256").update(fileBuffer).digest("hex");

  const { data: hashMatches } = await supabaseAdmin
    .from("documents")
    .select("id, title, type, classification, created_at, version_number, is_current, metadata")
    .filter("metadata->>sha256", "eq", sha256)
    .limit(1);

  if (hashMatches && hashMatches.length > 0) {
    const existing = hashMatches[0];
    return {
      detected: {
        title: existing.title || fileName.replace(/\.pdf$/i, ""),
        suggestedTitle: existing.title || fileName.replace(/\.pdf$/i, ""),
        documentType: existing.type || "memo",
        language: "ar",
        pageCount: 0,
        fileSize: fileBuffer.length,
        suggestedClassification:
          (existing.classification as "PRIVATE" | "PUBLIC" | "DOCTRINE") ||
          "PRIVATE",
        classificationReason: "Existing classification preserved (exact-hash match).",
        entities: [],
        firstPagePreview: "",
      },
      related: [
        {
          documentId: existing.id,
          title: existing.title || "Unknown",
          type: existing.type || "memo",
          classification: existing.classification || "PRIVATE",
          createdAt: existing.created_at || "",
          similarity: 1.0,
          reason: "exact SHA256 match — bit-for-bit identical file",
          isCurrent: existing.is_current ?? true,
          versionNumber: existing.version_number ?? 1,
        },
      ],
      recommendation: {
        action: "duplicate",
        reason: `This is a bit-for-bit duplicate of "${existing.title}" (uploaded ${formatRelativeShort(existing.created_at || "")}). The SHA256 hash matches exactly.`,
        targetDocumentId: existing.id,
        confidence: "high",
      },
      suggestedProject: null,
      suggestedProjects: [],
    };
  }

  // Step 1: Fast deterministic analysis using the same OCR/text lanes as the
  // real extraction pipeline. Native PDFs stay cheap; scanned PDFs use Azure
  // OCR when configured instead of an image-prompt fallback.
  const {
    analysis,
    pageCount,
    previewText,
    similarityText,
  } = await quickAnalyzeDocument(fileBuffer, fileName, preferences);

  // Step 3: Find related documents + suggest projects (parallel)
  const [related, projectSuggestions] = await Promise.all([
    findRelatedDocuments(analysis, similarityText),
    suggestProjects(analysis.entities),
  ]);

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
      firstPagePreview: previewText,
    },
    related,
    recommendation,
    suggestedProject: projectSuggestions[0] ?? null,
    suggestedProjects: projectSuggestions,
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
