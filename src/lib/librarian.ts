import { createHash } from "node:crypto";
import { supabaseAdmin } from "./supabase";
import { getOpenAI } from "./clients";
import { canonicalizeEntities, normalizeName, similarity, type CanonicalEntity } from "./entities";
import { embedQuery } from "./embeddings";
import { PDFParse } from "pdf-parse";
import { pdf as pdfToImg } from "pdf-to-img";

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

  // Phase 07: project suggestion based on entity overlap with project_companies.
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

  const rawContent = res.choices[0].message.content || "{}";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    console.error("librarian.quickAnalyze: JSON.parse failed:", (err as Error).message);
    parsed = {};
  }
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

/**
 * Vision-based variant of quickAnalyze for scanned/image-only PDFs where
 * pdf-parse returns no usable text. Renders the first page to PNG and uses
 * GPT-4o vision for the same JSON output schema. Slightly slower (~3s) and
 * costs ~$0.001 more per upload, but it actually classifies scanned legal
 * docs correctly instead of falling back to "other".
 */
async function quickAnalyzeFromImage(
  fileBuffer: Buffer,
  fileName: string,
): Promise<QuickAnalysis> {
  // Render only the first page (cheap)
  let firstPageBase64: string | null = null;
  try {
    for await (const page of await pdfToImg(fileBuffer, { scale: 2 })) {
      firstPageBase64 = Buffer.from(page).toString("base64");
      break; // Only need the first page
    }
  } catch (err) {
    console.error("librarian.quickAnalyzeFromImage: pdf-to-img failed:", (err as Error).message);
  }

  if (!firstPageBase64) {
    // Even rendering failed — return the dumb fallback
    return {
      title: fileName.replace(/\.pdf$/i, ""),
      suggestedTitle: fileName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " "),
      documentType: "other",
      language: "ar",
      classification: "PRIVATE",
      classificationReason:
        "Could not render PDF for vision analysis. Full extraction will run on confirm.",
      entities: [],
    };
  }

  const openai = getOpenAI();
  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    max_tokens: 2000,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are the librarian for a government economic authority's document intelligence system. You analyze the FIRST PAGE IMAGE of a new document (the PDF was image-only / scanned, so we couldn't extract text directly) to help organize the knowledge base.

Return JSON:
{
  "title": "exact title as shown on the page, in original language",
  "suggestedTitle": "cleaned-up canonical title",
  "documentType": "memo | contract | mou | law | decree | report | presentation | letter | financial | policy | other",
  "language": "ar | en | mixed",
  "classification": "PRIVATE | PUBLIC | DOCTRINE",
  "classificationReason": "one sentence why",
  "entities": [
    {"name": "entity name", "type": "company|organization|authority|ministry|person|place|project|law", "nameEn": "English name if Arabic original"}
  ]
}

CLASSIFICATION GUIDE:
- PRIVATE: internal memos, drafts, financial proposals, negotiations
- PUBLIC: published laws (مشروع قانون / قانون رقم), decrees (قرار / مرسوم), official reports, public studies
- DOCTRINE: foundational policy documents (rare)

DOCUMENT TYPE HINTS (Arabic):
- "مشروع قانون" / "قانون رقم" → law
- "قرار رقم" / "مرسوم" → decree
- "مذكرة" → memo
- "عقد" → contract
- "اتفاقية" → mou
- "تقرير" → report
- "خطة" / "دراسة" → report or policy

Arabic legal documents that mention تعديل (amendment), أحكام (provisions), or refer to existing law numbers are typically classification=PUBLIC, type=law.

Be precise. This is a fast analysis pass.`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `File name: ${fileName}\n\nClassify this document from its first page. Return JSON.`,
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${firstPageBase64}`,
              detail: "high",
            },
          },
        ],
      },
    ],
  });

  const rawContent = res.choices[0].message.content || "{}";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    console.error("librarian.quickAnalyzeFromImage: JSON.parse failed:", (err as Error).message);
    parsed = {};
  }

  return {
    title: parsed.title || fileName.replace(/\.pdf$/i, ""),
    suggestedTitle:
      parsed.suggestedTitle || parsed.title || fileName.replace(/\.pdf$/i, ""),
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

  // Get embeddings for the new doc at multiple positions (first / middle / last
  // 2000-char windows). The deeper-31% fix: by sampling the new doc the same
  // way we sample candidates, we cover the case where the existing doc was
  // chunked at boundaries that don't align with raw pdf-parse text. Up to 3
  // embeddings, computed in parallel.
  let newEmbeddings: number[][] = [];
  try {
    const len = firstPageText.length;
    const windows: string[] = [];
    if (len > 0) {
      windows.push(firstPageText.slice(0, 2000));
      if (len > 4000) {
        const midStart = Math.max(0, Math.floor(len / 2) - 1000);
        windows.push(firstPageText.slice(midStart, midStart + 2000));
      }
      if (len > 2000) {
        windows.push(firstPageText.slice(Math.max(0, len - 2000)));
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
  const newEmbedding = newEmbeddings[0] || null; // legacy reference (kept for any cosine-sim path)

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
 * 3) with the highest entity-overlap counts via project_companies. Returns
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

  // Find all project_companies rows that match any of these entities,
  // joined to projects (filter out archived projects).
  const { data: links } = await supabaseAdmin
    .from("project_companies")
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
          ? `1 entity matches a counterparty in this project`
          : `${p.overlapEntityIds.size} entities match counterparties in this project`,
    }));
}

// ────────────────────────────────────────
// MAIN ENTRYPOINT
// ────────────────────────────────────────

export async function analyzeUpload(
  fileBuffer: Buffer,
  fileName: string,
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

  // Step 1: Quick extract (no vision, just pdf-parse)
  const { text, pageCount } = await quickExtract(fileBuffer);

  // If pdf-parse returned no real content, the file is likely scanned/image-
  // only. Fall back to vision-based quick analysis. We check the
  // post-stripped length: pdf-parse injects "-- N of M --" page markers even
  // for fully image-only PDFs, so a naive length check (>= 100) was passing
  // junk input through to the text path and producing garbage classifications
  // ("type=other, no entities, classificationReason: appears to be an
  // internal file with no clear public content").
  const stripped = text
    .replace(/--\s*\d+\s*of\s*\d+\s*--/g, " ") // page markers from pdf-parse
    .replace(/\s+/g, " ")
    .trim();
  const usableText = stripped.length >= 100 ? text : "";

  // Step 2: Quick analyze — text path is one cheap GPT-4o-mini call;
  // image path is one ~3s GPT-4o vision call. The image path eliminates
  // the "type=other, lang=ar, no entities" failure mode for scanned PDFs.
  let analysis: QuickAnalysis;
  if (usableText) {
    analysis = await quickAnalyze(usableText, fileName);
  } else {
    analysis = await quickAnalyzeFromImage(fileBuffer, fileName);
  }

  // Step 3: Find related documents + suggest projects (parallel)
  const [related, projectSuggestions] = await Promise.all([
    findRelatedDocuments(analysis, usableText),
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
      firstPagePreview: usableText.slice(0, 600),
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
