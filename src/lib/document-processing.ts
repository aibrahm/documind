import { createHash } from "node:crypto";
import { logAudit } from "@/lib/audit";
import { chunkDocument } from "@/lib/chunking";
import { generateContextCard, loadProjectHints } from "@/lib/context-card";
import { generateEmbeddings } from "@/lib/embeddings";
import { encrypt } from "@/lib/encryption";
import { canonicalizeEntities } from "@/lib/entities";
import { extractEntitiesFromDocument } from "@/lib/entity-extraction-llm";
import { writeExtractionArtifact } from "@/lib/extraction-artifacts";
import type {
  ExtractionArtifact,
  ExtractionPreferences,
} from "@/lib/extraction-schema";
import { extractDocumentV2 } from "@/lib/extraction-v2";
import { extractKnowledgeGraph } from "@/lib/knowledge-graph";
import { costForLlmUsage, withMetric } from "@/lib/metrics";
import { UTILITY_MODEL } from "@/lib/models";
import { detectReferences, storeAndResolveReferences } from "@/lib/references";
import { withRetry } from "@/lib/retry";
import { supabaseAdmin } from "@/lib/supabase";
import { generateCanonicalTitle } from "@/lib/title-convention";

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

async function loadPreservedRelatedReferences(
  docId: string,
): Promise<PreservedReference[]> {
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
  await supabaseAdmin
    .from("document_entities")
    .delete()
    .eq("document_id", docId);
  await supabaseAdmin
    .from("document_references")
    .delete()
    .eq("source_id", docId);
}

async function restoreRelatedReferences(
  docId: string,
  references: PreservedReference[],
) {
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
}: ProcessDocumentInput): Promise<{
  title: string;
  warningText: string | null;
}> {
  const totalStart = Date.now();
  const sha256 = createHash("sha256").update(fileBuffer).digest("hex");

  // ── Per-doc idempotency ──
  // Background workers + manual reprocess can race. If the doc already
  // landed in `ready`, skip everything unless the caller explicitly asked
  // to replace derived data (the `replaceExistingDerivedData` flag is set
  // by /api/documents/[id]/extraction's POST handler).
  if (!replaceExistingDerivedData) {
    const { data: existingDoc } = await supabaseAdmin
      .from("documents")
      .select("status, title")
      .eq("id", docId)
      .maybeSingle();
    if (existingDoc?.status === "ready") {
      console.warn(
        `processDocument(${docId}): already ready, skipping. Pass replaceExistingDerivedData=true to force re-extract.`,
      );
      return { title: existingDoc.title, warningText: null };
    }
  }

  // ── OCR + normalize ──
  // The withMetric wrappers inside extractDocumentV2 itself record the
  // ocr + normalize stages so we get real per-stage timing in
  // extraction_runs. We just pass docId through.
  const extraction = await extractDocumentV2(
    fileBuffer,
    fileName,
    extractionPreferences || undefined,
    docId,
  );

  await logAudit("extraction", {
    documentId: docId,
    pagesExtracted: extraction.pages.length,
    documentType: extraction.classification.documentType,
    validationIssues: extraction.validation.issues.length,
    corrections: extraction.validation.corrections.length,
  });

  // ── Chunk ──
  const chunks = await withMetric(
    { stage: "chunk", documentId: docId },
    async () => chunkDocument(extraction.pages),
  );
  const chunkTexts = chunks.map((c) => c.content);

  // ── Embed ──
  // generateEmbeddings is itself wrapped in Cohere retry; we add the
  // metric row here so the dashboard gets one row per embed batch
  // grouped under one stage.
  const embeddings = await withMetric(
    {
      stage: "embed",
      documentId: docId,
      modelVersion: "embed-multilingual-v3.0",
      // Embeddings are ~$0.0001/1K tokens. We approximate by chunk count
      // (typical chunk ~500 tokens) since Cohere's API doesn't return
      // per-call usage in the same shape as OpenAI.
      extractUsage: () => ({
        usdCost: chunks.length * 0.5 * 0.0001,
      }),
    },
    async () => generateEmbeddings(chunkTexts, "search_document"),
  );

  // Default to PRIVATE for any new upload unless the caller overrode it.
  const classification = classificationOverride ?? "PRIVATE";
  const fullText = extraction.pages
    .flatMap((p) => p.sections.map((s) => s.content))
    .join("\n\n");
  const encryptedContent =
    classification === "PRIVATE" ? encrypt(fullText) : null;

  // ── Title (LLM, optional) ──
  let finalTitle = titleOverride?.trim() || "";
  if (!finalTitle) {
    try {
      finalTitle = await withMetric(
        {
          stage: "llm_title",
          documentId: docId,
          modelVersion: UTILITY_MODEL,
        },
        async () =>
          generateCanonicalTitle({
            fullText:
              extraction.pages
                .flatMap((p) => p.sections.map((s) => s.content))
                .join("\n\n")
                .slice(0, 6000) || extraction.classification.title,
            documentType: extraction.classification.documentType,
            language: extraction.classification.language,
            fileName,
          }),
      );
    } catch (err) {
      console.error("title-convention generation failed:", err);
      finalTitle = extraction.classification.title || fileName;
    }
  }

  // ── LLM entity extraction (replaces the old regex pipeline) ──
  // Failure here doesn't kill the document — entities just stay empty
  // until the user reprocesses. Logged loud per CLAUDE.md fail-loud rule.
  let llmEntities: Awaited<
    ReturnType<typeof extractEntitiesFromDocument>
  >["entities"] = [];
  let entityExtractionFailed = false;
  try {
    const result = await extractEntitiesFromDocument({
      fullText,
      language: extraction.classification.language,
      documentId: docId,
    });
    llmEntities = result.entities;
  } catch (err) {
    entityExtractionFailed = true;
    console.error(
      `processDocument(${docId}): LLM entity extraction failed:`,
      (err as Error).message,
    );
  }

  // ── Canonicalize against existing entities (embedding-based) ──
  let canonicalEntityIds: string[] = [];
  if (llmEntities.length > 0) {
    try {
      const candidates = llmEntities.map((e) => ({
        name: e.name,
        type: e.type,
        nameEn: e.nameEn,
        aliases: e.aliases,
      }));
      canonicalEntityIds = await canonicalizeEntities(candidates, docId);
    } catch (err) {
      console.error(
        `processDocument(${docId}): entity canonicalization failed:`,
        (err as Error).message,
      );
    }
  }

  const w = extraction.warnings;
  const validationErrorCount = extraction.validation.issues.filter(
    (issue) => issue.severity === "error",
  ).length;

  // ── Build the artifact (now includes the full Azure analyzeResult) ──
  const artifact: ExtractionArtifact = {
    version: 1,
    storedAt: new Date().toISOString(),
    classification: extraction.classification,
    pages: extraction.pages,
    referencedLaws: extraction.referencedLaws,
    validation: extraction.validation,
    metadata: {
      ...extraction.metadata,
      // Surface the LLM entities (with confidence + aliases) into the
      // artifact metadata so the reconstructed payload path keeps them
      // available even if the chunks table is wiped.
      entities: llmEntities.map((e) => ({
        name: e.name,
        type: e.type,
        nameEn: e.nameEn || undefined,
      })),
    },
    warnings: extraction.warnings,
    verifier: extraction.verifier,
    costs: extraction.costs,
    pipeline: extraction.pipeline,
    rawOcr: extraction.rawOcr as unknown as Record<string, unknown>,
    normalized: extraction.normalized as unknown as Record<string, unknown>,
    raw: extraction.azureRaw as unknown as Record<string, unknown> | null,
  };

  const preservedRelatedReferences = replaceExistingDerivedData
    ? await loadPreservedRelatedReferences(docId)
    : [];
  if (replaceExistingDerivedData) {
    await clearDerivedDocumentData(docId);
  }

  // ── Persist chunks ──
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

  await withMetric({ stage: "persist", documentId: docId }, async () => {
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
    return null;
  });

  // ── Link canonical entities to this document ──
  const uniqueEntityIds = [...new Set(canonicalEntityIds)];
  if (uniqueEntityIds.length > 0) {
    const links = uniqueEntityIds.map((eid) => ({
      document_id: docId,
      entity_id: eid,
    }));
    await supabaseAdmin
      .from("document_entities")
      .upsert(links, { onConflict: "document_id,entity_id" });
  }

  // ── References (regex from full text + structured from extraction) ──
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

  const { error: extractionArtifactError } = await writeExtractionArtifact(
    docId,
    artifact,
  );
  if (extractionArtifactError) {
    console.error(
      "Failed to persist extraction artifact:",
      extractionArtifactError,
    );
  }

  // ── Context card (semantic contextualizer pass) ──
  // Wrapped in withMetric so the dashboard sees the cost + duration.
  // Failure → null card + warning, document still goes to ready (per
  // existing behavior — the audit flagged this as a silent fallback,
  // and Phase 4 surfaces a banner; for Phase 1 we just keep the existing
  // semantics so the migration doesn't regress).
  const projectHints = await loadProjectHints();
  const entityNames = llmEntities.map((e) => e.name);
  let contextCard: Awaited<ReturnType<typeof generateContextCard>> = null;
  try {
    contextCard = await withMetric(
      {
        stage: "llm_context",
        documentId: docId,
        modelVersion: UTILITY_MODEL,
        // generateContextCard internally calculates a cost via
        // calculateCost(); we approximate here by passing a fixed cost
        // estimate based on the ~3K input + ~600 output token typical.
        extractUsage: () => ({
          usdCost: costForLlmUsage(UTILITY_MODEL, {
            prompt_tokens: 3000,
            completion_tokens: 600,
          }),
        }),
      },
      async () =>
        generateContextCard({
          title: finalTitle,
          documentType: extraction.classification.documentType,
          classification: classificationOverride || classification,
          language: extraction.classification.language,
          fullText,
          entities: entityNames,
          knownProjects: projectHints,
        }),
    );
  } catch (err) {
    console.error(
      `processDocument(${docId}): context card stage failed:`,
      (err as Error).message,
    );
  }
  const contextCardMissing = contextCard === null;

  const hasWarnings =
    w.failedPages.length > 0 ||
    w.classificationFailed ||
    w.metadataFailed ||
    w.correctionBatchesFailed > 0 ||
    w.verifierMismatches.length > 0 ||
    w.schemaWarnings.length > 0 ||
    validationErrorCount > 0 ||
    Boolean(extractionArtifactError) ||
    entityExtractionFailed;
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
        extractionArtifactError
          ? "Full extraction artifact could not be persisted"
          : null,
        entityExtractionFailed
          ? "Entity extraction (LLM) failed — entities will be empty"
          : null,
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
            skipClassification:
              extractionPreferences.skipClassification === true,
          },
        }
      : {}),
    ...(hasWarnings
      ? {
          extractionWarnings: {
            ...w,
            artifactPersistFailed: Boolean(extractionArtifactError),
            entityExtractionFailed,
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
      // The string[] entities column on `documents` is the quick-filter
      // index used by the library list; it mirrors the canonical
      // entity names emitted by the LLM extractor (deduped client-side).
      entities: [...new Set(llmEntities.map((e) => e.name))],
      encrypted_content: encryptedContent,
      // Cast through `unknown` — supabase-js treats JSONB as its generated
      // Json recursive type which doesn't match our structured card type.
      context_card: contextCard as unknown as never,
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
    console.error(
      `processDocument(${docId}): partial extraction. ${warningText}`,
    );
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

  // Knowledge graph extraction — relationships, obligations, fact versions.
  // Fire-and-forget so a failure doesn't block the document from being ready.
  // Wrapped in withMetric so the cost still hits the dashboard even though
  // we don't await success.
  void withMetric(
    {
      stage: "llm_graph",
      documentId: docId,
      modelVersion: UTILITY_MODEL,
      extractUsage: () => ({
        usdCost: costForLlmUsage(UTILITY_MODEL, {
          prompt_tokens: 4000,
          completion_tokens: 1000,
        }),
      }),
    },
    async () => extractKnowledgeGraph(docId),
  ).catch((err) => {
    console.error(
      `processDocument(${docId}): knowledge graph extraction failed:`,
      (err as Error).message,
    );
  });

  // Final aggregate metric — total wall time end-to-end, no per-stage cost.
  // Lets the dashboard answer "how long did this document take?" without
  // summing all stage rows.
  await supabaseAdmin.from("extraction_runs").insert({
    document_id: docId,
    stage: "total",
    duration_ms: Date.now() - totalStart,
    ok: !hasWarnings,
    error_message: warningText,
    model_version: null,
    usd_cost: 0,
  });

  return {
    title: finalTitle,
    warningText,
  };
}
