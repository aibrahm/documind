// scripts/migrate-library.ts
//
// One-shot library-wide re-extraction under the new pipeline.
//
// Run with: pnpm migrate:library  (or `tsx scripts/migrate-library.ts`)
//
// Why this exists:
//
// Phase 1 rebuilt the extraction pipeline (single Azure call, real
// confidence, LLM entity extractor, embedding canonicalization). Phase 2
// shipped the document graph that consumes the pipeline's output. But
// every existing document in the library was extracted under the OLD
// pipeline — so until they're reprocessed:
//
//   - Entity rows from the regex extractor still pollute the explorer
//     (the GTEZA × 3, "وزارة المالية" × 2, prose-as-entity rows from
//     the screenshot you sent).
//   - Existing entity rows have no embedding, so the new canonicalizer
//     can't merge against them — every reprocessed doc would create
//     duplicate entities side-by-side with the old ones.
//   - Confidence on existing chunks is the hardcoded `1` from before;
//     the EXTRACTION tab still shows fake green HIGH pills.
//   - The graph view shows noisy edges (one per regex-split entity).
//
// What this script does, in order:
//
//   1. Print a cost + time estimate for the work and wait for `y`.
//   2. WIPE the derived-data tables that the new pipeline rebuilds:
//        entities, entity_relationships, entity_canonicalization_log,
//        extraction_runs.
//      Documents themselves are untouched. Chunks + document_artifacts
//      are NOT wiped here — `processDocumentContent({ replaceExisting
//      DerivedData: true })` clears them per-doc as it runs, so we don't
//      risk leaving the library inconsistent if the script crashes
//      midway.
//   3. Pull every `documents` row where `is_current = true` and
//      `file_url` is set.
//   4. Pace at MAX_CONCURRENT in-flight reruns. For each doc:
//        - Download the file from Supabase Storage.
//        - Call processDocumentContent with replaceExistingDerivedData.
//        - Print [n/N] per-doc result.
//   5. Print a summary (success / failed counts, total cost).
//
// Failure handling: per-doc failures are caught and logged but don't
// stop the script. The doc is left in `error` status (the existing
// catch in document-processing.ts marks it). User can rerun the
// script — it'll skip docs already in `ready` because of the
// idempotency guard, and retry the ones still in `error`.

import "../src/mcp-env";

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { supabaseAdmin } from "@/lib/supabase";
import { processDocumentContent } from "@/lib/document-processing";
import { AZURE_LAYOUT_USD_PER_PAGE } from "@/lib/metrics";

const MAX_CONCURRENT = 3;
const BUCKET = "documents";

// Rough per-doc add-on for LLM stages (title + context + entities + KG).
// Real numbers will land in extraction_runs; this is just for the preview.
const ESTIMATED_LLM_USD_PER_DOC = 0.005;

interface DocRow {
  id: string;
  title: string;
  file_url: string;
  page_count: number | null;
  status: string;
  classification: string;
}

interface RunResult {
  docId: string;
  title: string;
  ok: boolean;
  durationMs: number;
  errorMessage?: string;
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function fetchCurrentDocs(): Promise<DocRow[]> {
  const { data, error } = await supabaseAdmin
    .from("documents")
    .select("id, title, file_url, page_count, status, classification")
    .eq("is_current", true)
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(`Failed to load documents: ${error.message}`);
  }
  // Drop rows with no source file — nothing to re-extract from.
  return (data ?? []).filter((d): d is DocRow => Boolean(d.file_url));
}

async function wipeStaleDerivedTables(): Promise<void> {
  // Supabase rejects unfiltered DELETEs as a safety guard. We use an
  // .neq() against a sentinel UUID that no real row will ever match —
  // effectively "delete everything" while satisfying the guard.
  //
  // Order matters: child tables (those with FK references) go first so
  // we don't trip an FK violation. document_entities + canon_log + rels
  // reference entities; extraction_runs references documents (kept).
  const everyRow = "00000000-0000-0000-0000-000000000000";

  const wipe = async (label: string, fn: () => Promise<{ error: { message: string } | null }>) => {
    const { error } = await fn();
    if (error) throw new Error(`Failed to wipe ${label}: ${error.message}`);
    console.log(`  wiped ${label}`);
  };

  await wipe("entity_canonicalization_log", async () => {
    return await supabaseAdmin
      .from("entity_canonicalization_log")
      .delete()
      .neq("id", everyRow);
  });
  await wipe("entity_relationships", async () => {
    return await supabaseAdmin
      .from("entity_relationships")
      .delete()
      .neq("id", everyRow);
  });
  await wipe("extraction_runs", async () => {
    return await supabaseAdmin
      .from("extraction_runs")
      .delete()
      .neq("id", everyRow);
  });
  await wipe("document_entities", async () => {
    return await supabaseAdmin
      .from("document_entities")
      .delete()
      .neq("document_id", everyRow);
  });
  await wipe("entities", async () => {
    return await supabaseAdmin.from("entities").delete().neq("id", everyRow);
  });
}

async function downloadFile(storagePath: string): Promise<Buffer> {
  const { data: blob, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .download(storagePath);
  if (error || !blob) {
    throw new Error(`storage download failed: ${error?.message ?? "no blob"}`);
  }
  return Buffer.from(await blob.arrayBuffer());
}

async function processOne(
  doc: DocRow,
  index: number,
  total: number,
): Promise<RunResult> {
  const start = Date.now();
  const tag = `[${String(index + 1).padStart(2, "0")}/${total}]`;
  try {
    const fileBuffer = await downloadFile(doc.file_url);
    const fileName = doc.title.toLowerCase().endsWith(".pdf")
      ? doc.title
      : `${doc.title}.pdf`;
    await processDocumentContent({
      docId: doc.id,
      fileBuffer,
      fileName,
      classificationOverride: doc.classification ?? null,
      versionOf: null,
      titleOverride: doc.title,
      replaceExistingDerivedData: true,
    });
    const ms = Date.now() - start;
    console.log(`${tag} ✓ ${doc.title}  (${(ms / 1000).toFixed(1)}s)`);
    return { docId: doc.id, title: doc.title, ok: true, durationMs: ms };
  } catch (err) {
    const message = (err as Error).message;
    const ms = Date.now() - start;
    console.error(`${tag} ✗ ${doc.title}  (${(ms / 1000).toFixed(1)}s): ${message}`);
    return { docId: doc.id, title: doc.title, ok: false, durationMs: ms, errorMessage: message };
  }
}

/**
 * Bounded-parallel runner. At most `limit` workers pull from the shared
 * cursor; each worker takes the next index, runs `worker(item, index)`,
 * and loops. Returns once all items have been processed.
 */
async function runPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  console.log("documind library migration\n");

  const docs = await fetchCurrentDocs();
  if (docs.length === 0) {
    console.log("No current documents to reprocess. Exiting.");
    return;
  }

  const totalPages = docs.reduce((sum, d) => sum + (d.page_count ?? 0), 0);
  const azureCost = totalPages * AZURE_LAYOUT_USD_PER_PAGE;
  const llmCost = docs.length * ESTIMATED_LLM_USD_PER_DOC;
  const totalCost = azureCost + llmCost;

  console.log(`Library size:        ${docs.length} documents`);
  console.log(`Total pages:         ${totalPages}`);
  console.log(`Estimated Azure:     $${azureCost.toFixed(2)}`);
  console.log(`Estimated LLM:       $${llmCost.toFixed(2)}`);
  console.log(`Estimated total:     $${totalCost.toFixed(2)}`);
  console.log(`Concurrency:         ${MAX_CONCURRENT} docs in flight\n`);

  console.log(
    "This will WIPE the following derived tables before reprocessing:",
  );
  console.log("  entities, document_entities, entity_relationships,");
  console.log("  entity_canonicalization_log, extraction_runs");
  console.log(
    "Documents and chunks are NOT wiped here — chunks are replaced per-doc",
  );
  console.log("by the pipeline as each document re-runs.\n");

  const ok = await confirm("Proceed? [y/N] ");
  if (!ok) {
    console.log("Aborted.");
    return;
  }

  console.log("\n— wiping stale derived data —");
  await wipeStaleDerivedTables();

  console.log(`\n— reprocessing ${docs.length} documents —`);
  const startedAt = Date.now();
  const total = docs.length;
  const results = await runPool(docs, MAX_CONCURRENT, (doc, i) =>
    processOne(doc, i, total),
  );
  const elapsedMs = Date.now() - startedAt;

  const ok_count = results.filter((r) => r.ok).length;
  const fail_count = results.filter((r) => !r.ok).length;

  console.log("\n— summary —");
  console.log(`Succeeded:           ${ok_count}/${docs.length}`);
  console.log(`Failed:              ${fail_count}`);
  console.log(`Wall time:           ${(elapsedMs / 1000 / 60).toFixed(1)} min`);
  if (fail_count > 0) {
    console.log("\nFailed documents:");
    for (const r of results) {
      if (!r.ok) console.log(`  - ${r.title}: ${r.errorMessage}`);
    }
    console.log(
      "\nRerun the script to retry — already-ready docs are skipped via the per-doc idempotency guard.",
    );
  }

  console.log("\nReal cost numbers from this run live in `extraction_runs`.");
  console.log(
    "Run: select sum(usd_cost) from extraction_runs where started_at >= now() - interval '1 hour';",
  );
}

main().catch((err) => {
  console.error("\nMigration script failed:", err);
  process.exit(1);
});
