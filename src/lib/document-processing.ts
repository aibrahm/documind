import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { extractDocumentV2 } from "@/lib/extraction-v2";
import type { ExtractionArtifact, ExtractionPreferences } from "@/lib/extraction-schema";
import { chunkDocument } from "@/lib/chunking";
import { generateEmbeddings } from "@/lib/embeddings";
import { withRetry } from "@/lib/retry";
import { generateCanonicalTitle } from "@/lib/title-convention";
import { invalidateBriefingCache } from "@/lib/daily-briefing";
import { encrypt } from "@/lib/encryption";
import { writeExtractionArtifact } from "@/lib/extraction-artifacts";
import { detectReferences, storeAndResolveReferences } from "@/lib/references";
import { canonicalizeEntities } from "@/lib/entities";
import { logAudit } from "@/lib/audit";
import { generateContextCard, loadProjectHints } from "@/lib/context-card";

interface ProcessDocumentInput {
  docId: string;
  fileBuffer: Buffer;
  fileName: string;
  classificationOverride: string | null;
  extractionPreferences?: ExtractionPreferences | null;
  versionOf: string | null;
  relatedTo?: string | null;
  titleOverride?: string | null;
  replaceExistingDerivedData?: boolean;
}

interface PreservedReference {
  target_id: string | null;
  reference_text: string;
  reference_type: string;
  resolved: boolean;
}

function buildRelatedReference(targetId: string) {
  return {
    target_id: targetId,
    reference_text: "Related document (linked at upload)",
    reference_type: "related",
    resolved: true,
  };
}

async function loadPreservedRelatedReferences(docId: string): Promise<PreservedReference[]> {
  const { data, error } = await supabaseAdmin
    .from("document_references")
    .select("target_id, reference_text, reference_type, resolved")
    .eq("source_id", docId)
    .eq("reference_type", "related");

  if (error) {
    console.error("Failed to load preserved related references:", error);
    return [];
  }

  return (data || []).map((ref) => ({
    target_id: ref.target_id,
    reference_text: ref.reference_text,
    reference_type: ref.reference_type,
    resolved: ref.resolved === true,
  }));
}

async function clearDerivedDocumentData(docId: string) {
  await supabaseAdmin.from("chunks").delete().eq("document_id", docId);
  await supabaseAdmin.from("document_entities").delete().eq("document_id", docId);
  await supabaseAdmin.from("document_references").delete().eq("source_id", docId);
}

async function restoreRelatedReferences(docId: string, references: PreservedReference[]) {
  if (references.length === 0) return;

  await supabaseAdmin.from("document_references").upsert(
    references.map((ref) => ({
      source_id: docId,
      target_id: ref.target_id,
      reference_text: ref.reference_text,
      reference_type: ref.reference_type,
      resolved: ref.resolved,
    })),
    { onConflict: "source_id,reference_text" },
  );
}

export async function processDocumentContent({
  docId,
  fileBuffer,
  fileName,
  classificationOverride,
  extractionPreferences = null,
  versionOf,
  relatedTo = null,
  titleOverride = null,
  replaceExistingDerivedData = false,
}: ProcessDocumentInput): Promise<{ title: string; warningText: string | null }> {
  const extraction = await extractDocumentV2(
    fileBuffer,
    fileName,
    extractionPreferences || undefined,
  );

  await logAudit("extraction", {
    documentId: docId,
    pagesExtracted: extraction.pages.length,
    documentType: extraction.classification.documentType,
    validationIssues: extraction.validation.issues.length,
    corrections: extraction.validation.corrections.length,
    costs: extraction.costs,
  });

  const chunks = chunkDocument(extraction.pages);
  const chunkTexts = chunks.map((c) => c.content);
  const embeddings = await generateEmbeddings(chunkTexts, "search_document");

  // Default to PRIVATE for any new upload unless the caller overrode it.
  // The old code had a "policy → DOCTRINE" branch that is removed: policy
  // documents now get PRIVATE by default and are bumped to PUBLIC by the
  // librarian heuristics in src/lib/intake.ts when appropriate.
  const classification = classificationOverride ?? "PRIVATE";
  const fullText = extraction.pages.flatMap((p) => p.sections.map((s) => s.content)).join("\n\n");
  const encryptedContent = classification === "PRIVATE" ? encrypt(fullText) : null;

  // Title precedence:
  //   1. Explicit override from the caller (user typed one / librarian passed
  //      one from the intake flow) — trust it verbatim.
  //   2. Canonical LLM-generated title following the archive convention
  //      "{Type}: {subject}". Reads the first ~3000 chars and produces
  //      a clean bilingual title. See src/lib/title-convention.ts.
  //   3. Whatever the OCR pipeline put in classification.title as a last
  //      resort (almost always a letterhead, so this is a fallback only).
  let finalTitle = titleOverride?.trim() || "";
  if (!finalTitle) {
    try {
      finalTitle = await generateCanonicalTitle({
        fullText:
          extraction.pages
            .flatMap((p) => p.sections.map((s) => s.content))
            .join("\n\n")
            .slice(0, 6000) ||
          extraction.classification.title,
        documentType: extraction.classification.documentType,
        language: extraction.classification.language,
        fileName,
      });
    } catch (err) {
      console.error("title-convention generation failed:", err);
      finalTitle = extraction.classification.title || fileName;
    }
  }
  const sha256 = createHash("sha256").update(fileBuffer).digest("hex");
  const w = extraction.warnings;
  const validationErrorCount = extraction.validation.issues.filter(
    (issue) => issue.severity === "error",
  ).length;

  const artifact: ExtractionArtifact = {
    version: 1,
    storedAt: new Date().toISOString(),
    classification: extraction.classification,
    pages: extraction.pages,
    referencedLaws: extraction.referencedLaws,
    validation: extraction.validation,
    metadata: extraction.metadata,
    warnings: extraction.warnings,
    verifier: extraction.verifier,
    costs: extraction.costs,
    pipeline: extraction.pipeline,
    rawOcr: extraction.rawOcr as unknown as Record<string, unknown>,
    normalized: extraction.normalized as unknown as Record<string, unknown>,
  };

  const preservedRelatedReferences = replaceExistingDerivedData
    ? await loadPreservedRelatedReferences(docId)
    : [];
  if (replaceExistingDerivedData) {
    await clearDerivedDocumentData(docId);
  }

  const chunkRecords = chunks.map((chunk, i) => ({
    document_id: docId,
    content: chunk.content,
    embedding: embeddings[i] ? `[${embeddings[i].join(",")}]` : null,
    page_number: chunk.pageNumber,
    section_title: chunk.sectionTitle,
    clause_number: chunk.clauseNumber,
    chunk_index: chunk.chunkIndex,
    metadata: chunk.metadata,
  }));

  // Wrap each batch in exponential backoff so a transient Supabase error
  // doesn't silently lose part of the corpus. On final failure we throw
  // — the outer handler in /api/upload/route.ts catches the throw and
  // marks the document status as "error" so the user sees a loud failure
  // instead of a document that looks ready but returns partial search
  // hits forever. See CONCERNS.md B1.
  for (let i = 0; i < chunkRecords.length; i += 50) {
    const batch = chunkRecords.slice(i, i + 50);
    await withRetry(
      async () => {
        const { error } = await supabaseAdmin.from("chunks").insert(batch);
        if (error) throw new Error(error.message);
      },
      {
        maxAttempts: 4,
        initialDelayMs: 250,
        label: `chunk batch insert[${i}..${i + batch.length}]`,
      },
    );
  }

  const entities = extraction.metadata.entities || [];
  if (entities.length > 0) {
    const candidates = entities.map((e) => ({
      name: e.name,
      type: e.type,
      nameEn: e.nameEn || null,
    }));
    const entityIds = await canonicalizeEntities(candidates);
    const uniqueIds = [...new Set(entityIds)];
    if (uniqueIds.length > 0) {
      const links = uniqueIds.map((eid) => ({
        document_id: docId,
        entity_id: eid,
      }));
      await supabaseAdmin
        .from("document_entities")
        .upsert(links, { onConflict: "document_id,entity_id" });
    }
  }

  const references = detectReferences(fullText);
  if (extraction.metadata.references) {
    for (const ref of extraction.metadata.references) {
      references.push({
        text: ref.text,
        type: ref.type as "law" | "article" | "decree" | "regulation",
      });
    }
  }
  await storeAndResolveReferences(docId, references);
  await restoreRelatedReferences(docId, preservedRelatedReferences);
  if (relatedTo) {
    await restoreRelatedReferences(docId, [buildRelatedReference(relatedTo)]);
  }

  const { error: extractionArtifactError } = await writeExtractionArtifact(docId, artifact);
  if (extractionArtifactError) {
    console.error("Failed to persist extraction artifact:", extractionArtifactError);
  }

  // ── Context card (semantic contextualizer pass) ──
  // One gpt-4o-mini call that reads a sample of the document + the user's
  // project landscape and produces a structured "where does this fit" card.
  // Stored on documents.context_card and later injected into chat system
  // prompts when the document is in scope. Fails loud — if generation
  // fails we log and continue; the document is still usable without a card.
  const projectHints = await loadProjectHints();
  const entityNames = (extraction.metadata.entities || []).map((e) => e.name);
  const contextCard = await generateContextCard({
    title: finalTitle,
    documentType: extraction.classification.documentType,
    classification: classificationOverride || classification,
    language: extraction.classification.language,
    fullText,
    entities: entityNames,
    knownProjects: projectHints,
  });
  const contextCardMissing = contextCard === null;

  const hasWarnings =
    w.failedPages.length > 0 ||
    w.classificationFailed ||
    w.metadataFailed ||
    w.correctionBatchesFailed > 0 ||
    w.verifierMismatches.length > 0 ||
    w.schemaWarnings.length > 0 ||
    validationErrorCount > 0 ||
    Boolean(extractionArtifactError);
  const warningText = hasWarnings
    ? [
        w.failedPages.length > 0
          ? `Pages with extraction failures: ${w.failedPages.join(", ")} of ${extraction.pages.length}`
          : null,
        w.classificationFailed ? "Classification call failed" : null,
        w.metadataFailed ? "Metadata extraction call failed" : null,
        w.correctionBatchesFailed > 0
          ? `${w.correctionBatchesFailed} Arabic-correction batch(es) failed`
          : null,
        w.verifierMismatches.length > 0
          ? `Verifier flagged ${w.verifierMismatches.length} potential extraction error${w.verifierMismatches.length === 1 ? "" : "s"}`
          : null,
        w.schemaWarnings.length > 0
          ? `${w.schemaWarnings.length} schema validation warning${w.schemaWarnings.length === 1 ? "" : "s"} handled during extraction`
          : null,
        validationErrorCount > 0
          ? `${validationErrorCount} validation error${validationErrorCount === 1 ? "" : "s"} detected in extracted content`
          : null,
        extractionArtifactError ? "Full extraction artifact could not be persisted" : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  const mergedMetadata = {
    ...(extraction.metadata || {}),
    sha256,
    ...(extractionPreferences
      ? {
          extractionPreferences: {
            documentTypeHint: extractionPreferences.documentTypeHint || null,
            languageHint: extractionPreferences.languageHint || null,
            titleHint: extractionPreferences.titleHint || null,
            skipClassification: extractionPreferences.skipClassification === true,
          },
        }
      : {}),
    ...(hasWarnings
      ? {
          extractionWarnings: {
            ...w,
            artifactPersistFailed: Boolean(extractionArtifactError),
          },
        }
      : {}),
  };

  await supabaseAdmin
    .from("documents")
    .update({
      title: finalTitle,
      type: extraction.classification.documentType,
      classification: classificationOverride || classification,
      language: extraction.classification.language,
      page_count: extraction.pages.length,
      metadata: mergedMetadata,
      entities: (extraction.metadata.entities || []).map((e: { name: string }) => e.name),
      encrypted_content: encryptedContent,
      // Cast through `unknown` — supabase-js treats JSONB as its generated
      // Json recursive type which doesn't match our structured card type.
      // The DB accepts any JSON-serializable object here.
      context_card: (contextCard as unknown) as never,
      status: "ready",
      processing_error: warningText,
    })
    .eq("id", docId);

  if (contextCardMissing) {
    console.warn(
      `processDocument(${docId}): context card generation failed. Document is usable but lacks semantic summary for retrieval.`,
    );
  }

  if (hasWarnings) {
    console.error(`processDocument(${docId}): partial extraction. ${warningText}`);
  }

  if (versionOf) {
    await supabaseAdmin
      .from("documents")
      .update({ is_current: false })
      .eq("id", versionOf);

    const { data: parent } = await supabaseAdmin
      .from("documents")
      .select("version_number")
      .eq("id", versionOf)
      .single();

    await supabaseAdmin
      .from("documents")
      .update({
        version_of: versionOf,
        supersedes: versionOf,
        version_number: (parent?.version_number || 1) + 1,
      })
      .eq("id", docId);
  }

  // Bust the landing-page briefing cache so the next app load doesn't
  // serve a briefing that was generated before this document existed.
  // Fire-and-forget — a failure to bust the cache just means the VC
  // sees the old briefing for up to the normal 1-hour TTL, which is
  // the pre-invalidation behavior and strictly better than nothing.
  void invalidateBriefingCache().catch(() => {});

  return {
    title: finalTitle,
    warningText,
  };
}
