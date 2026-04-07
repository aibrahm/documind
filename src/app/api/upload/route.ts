import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { extractDocument } from "@/lib/extraction";
import { chunkDocument } from "@/lib/chunking";
import { generateEmbeddings } from "@/lib/embeddings";
import { encrypt } from "@/lib/encryption";
import { detectReferences, storeAndResolveReferences } from "@/lib/references";
import { canonicalizeEntities } from "@/lib/entities";
import { logAudit } from "@/lib/audit";

export const maxDuration = 300; // Allow up to 5 min for GPT-4o vision extraction

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const classificationOverride = formData.get("classification") as string | null;
    const versionOf = formData.get("versionOf") as string | null;
    const relatedTo = formData.get("relatedTo") as string | null;
    const titleOverride = formData.get("title") as string | null;
    const linkToProject = formData.get("linkToProject") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "Only PDF files are supported" }, { status: 400 });
    }

    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File exceeds 50MB limit" }, { status: 400 });
    }

    // Step 1: Upload file to Supabase Storage
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(fileBuffer).digest("hex");
    const filePath = `documents/${Date.now()}_${crypto.randomUUID()}.pdf`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("documents")
      .upload(filePath, fileBuffer, {
        contentType: "application/pdf",
      });

    if (uploadError) {
      console.error("File upload failed:", uploadError);
      return NextResponse.json(
        { error: "File upload failed" },
        { status: 500 }
      );
    }

    // Step 2: Create document record (status: processing).
    // Store sha256 in metadata so the librarian can short-circuit on
    // future re-uploads of the exact same file.
    const { data: doc, error: docError } = await supabaseAdmin
      .from("documents")
      .insert({
        title: file.name,
        file_url: filePath,
        file_size: fileBuffer.length,
        status: "processing",
        version_of: versionOf || null,
        metadata: { sha256 },
      })
      .select()
      .single();

    if (docError || !doc) {
      console.error("Failed to create document:", docError);
      return NextResponse.json(
        { error: "Failed to create document" },
        { status: 500 }
      );
    }

    // Process document inline — await so errors are caught and status is updated
    try {
      await processDocument(doc.id, fileBuffer, file.name, classificationOverride, versionOf, relatedTo, titleOverride);
    } catch (err) {
      console.error(`Document processing failed for ${doc.id}:`, err);
      await supabaseAdmin
        .from("documents")
        .update({ status: "error", processing_error: String(err).slice(0, 500) })
        .eq("id", doc.id);
    }

    // Phase 07: link the document to a project if requested by the user
    // (the librarian's project suggestion was accepted on the upload page)
    if (linkToProject) {
      const { error: linkErr } = await supabaseAdmin
        .from("project_documents")
        .upsert(
          {
            project_id: linkToProject,
            document_id: doc.id,
            added_by: "librarian",
          },
          { onConflict: "project_id,document_id" },
        );
      if (linkErr) {
        console.error("Failed to link uploaded doc to project:", linkErr);
      }
    }

    await logAudit("upload", {
      documentId: doc.id,
      fileName: file.name,
      fileSize: fileBuffer.length,
      ...(linkToProject ? { linkedProjectId: linkToProject } : {}),
    });

    // Get the updated document title (set during extraction)
    const { data: updatedDoc } = await supabaseAdmin
      .from("documents")
      .select("title, status")
      .eq("id", doc.id)
      .single();

    return NextResponse.json({
      id: doc.id,
      status: updatedDoc?.status || "ready",
      title: updatedDoc?.title || file.name,
      message: "Document processed successfully",
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Process document in background: extract → chunk → embed → store
 */
async function processDocument(
  docId: string,
  fileBuffer: Buffer,
  fileName: string,
  classificationOverride: string | null,
  versionOf: string | null,
  relatedTo: string | null = null,
  titleOverride: string | null = null,
) {
  // Step 1: Extract (classify → extract → correct → validate)
  const extraction = await extractDocument(fileBuffer, fileName);

  await logAudit("extraction", {
    documentId: docId,
    pagesExtracted: extraction.pages.length,
    documentType: extraction.classification.documentType,
    validationIssues: extraction.validation.issues.length,
    corrections: extraction.validation.corrections.length,
    costs: extraction.costs,
  });

  // Step 2: Chunk
  const chunks = chunkDocument(extraction.pages);

  // Step 3: Generate embeddings
  const chunkTexts = chunks.map((c) => c.content);
  const embeddings = await generateEmbeddings(chunkTexts, "search_document");

  // Step 4: Encrypt content for PRIVATE documents
  const classification = classificationOverride ?? (extraction.classification.documentType === "policy"
    ? "DOCTRINE"
    : "PRIVATE");
  const fullText = extraction.pages.flatMap((p) => p.sections.map((s) => s.content)).join("\n\n");
  const encryptedContent = classification === "PRIVATE" ? encrypt(fullText) : null;

  // Step 5: Update document record (use librarian-confirmed title if provided).
  // Preserve the sha256 we stored in metadata at insert time so the librarian
  // can keep short-circuiting future re-uploads.
  // Also surface any extraction warnings on the row so the user knows the
  // doc is partially extracted instead of silently shipping empty pages.
  const finalTitle = titleOverride?.trim() || extraction.classification.title;
  const sha256 = createHash("sha256").update(fileBuffer).digest("hex");
  const w = extraction.warnings;
  const hasWarnings =
    w.failedPages.length > 0 ||
    w.classificationFailed ||
    w.metadataFailed ||
    w.correctionBatchesFailed > 0 ||
    w.verifierMismatches.length > 0;
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
          ? `Verifier flagged ${w.verifierMismatches.length} potential extraction error${w.verifierMismatches.length === 1 ? "" : "s"} (article labels, percentages, or law references that the verifier saw on the page but the extracted text is missing)`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;
  const mergedMetadata = {
    ...(extraction.metadata || {}),
    sha256,
    ...(hasWarnings ? { extractionWarnings: w } : {}),
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
      entities: (extraction.metadata.entities || []).map(
        (e: { name: string }) => e.name
      ),
      encrypted_content: encryptedContent,
      status: "ready",
      // Surface warnings even on a "ready" doc — the user/UI can show a
      // partial-extraction chip. Empty if no warnings.
      processing_error: warningText,
    })
    .eq("id", docId);

  if (hasWarnings) {
    console.error(
      `processDocument(${docId}): partial extraction. ${warningText}`,
    );
  }

  // Step 5b: If librarian flagged this as RELATED to an existing doc, create a cross-reference
  if (relatedTo) {
    await supabaseAdmin
      .from("document_references")
      .upsert(
        {
          source_id: docId,
          target_id: relatedTo,
          reference_text: "Related document (linked at upload)",
          reference_type: "related",
          resolved: true,
        },
        { onConflict: "source_id,reference_text" },
      );
  }

  // Step 6: Insert chunks with embeddings
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

  // Insert in batches of 50
  for (let i = 0; i < chunkRecords.length; i += 50) {
    const batch = chunkRecords.slice(i, i + 50);
    await supabaseAdmin.from("chunks").insert(batch);
  }

  // Step 7: Canonicalize and store entities.
  // canonicalizeEntities() handles fuzzy bilingual matching so "Elsewedy",
  // "El Sewedy Electric", and "السويدي إلكتريك" all resolve to the same row.
  const entities = extraction.metadata.entities || [];
  if (entities.length > 0) {
    const candidates = entities.map((e) => ({
      name: e.name,
      type: e.type,
      nameEn: e.nameEn || null,
    }));
    const entityIds = await canonicalizeEntities(candidates);

    // Insert document-entity links (dedupe by id since canonicalization may
    // collapse multiple candidates to the same entity)
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

  // Step 8: Detect and store cross-references
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

  // Step 9: Handle versioning
  if (versionOf) {
    // Mark the old document as not current
    await supabaseAdmin
      .from("documents")
      .update({ is_current: false })
      .eq("id", versionOf);

    // Get the version number of the parent
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
}
