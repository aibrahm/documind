// scripts/backfill-all.ts
//
// One-shot retroactive backfill for all existing documents + projects.
// Run with: pnpm backfill
//
// What it does (in order):
//   1. Knowledge graph extraction on any doc that doesn't have it yet
//   2. Auto-classify every document → suggest a project OR mark as reference
//      (uses: entity overlap + cosine similarity of context_card summary
//      against project.context_summary)
//   3. Pairwise similarity: propose document_references for pairs > 0.85
//   4. Generate initial context_md for projects that don't have one

// Load .env.local BEFORE any lib import — supabase.ts reads env at module scope
import "../src/mcp-env";

import { supabaseAdmin } from "@/lib/supabase";
import { extractKnowledgeGraph } from "@/lib/knowledge-graph";
import { embedQuery } from "@/lib/embeddings";

// ─────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function docSignatureText(doc: {
  title: string;
  context_card?: unknown;
}): string {
  const card = (doc.context_card ?? null) as
    | {
        summary_en?: string;
        summary_ar?: string;
        topics?: string[];
        key_parties?: string[];
      }
    | null;
  return [
    doc.title,
    card?.summary_en ?? "",
    card?.summary_ar ?? "",
    (card?.topics ?? []).join(" "),
    (card?.key_parties ?? []).join(" "),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 2000);
}

function projectSignatureText(proj: {
  name: string;
  description?: string | null;
  objective?: string | null;
  context_summary?: string | null;
  kind?: string | null;
}): string {
  return [
    proj.name,
    proj.description ?? "",
    proj.objective ?? "",
    proj.context_summary ?? "",
    proj.kind ?? "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 2000);
}

// ─────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("Backfill starting...\n");

  // ─── Load all documents + projects ───
  const { data: docs } = await supabaseAdmin
    .from("documents")
    .select(
      "id, title, type, classification, status, context_card, entities, is_reference",
    )
    .eq("is_current", true)
    .eq("status", "ready");

  const { data: projects } = await supabaseAdmin
    .from("projects")
    .select(
      "id, name, slug, description, objective, context_summary, kind, context_md",
    )
    .neq("status", "archived");

  const { data: existingLinks } = await supabaseAdmin
    .from("project_documents")
    .select("document_id, project_id");

  if (!docs) {
    console.error("Failed to load documents.");
    process.exit(1);
  }
  if (!projects) {
    console.error("Failed to load projects.");
    process.exit(1);
  }

  const linkedDocIds = new Set(
    (existingLinks ?? []).map((l) => l.document_id),
  );
  const linkedMap = new Map<string, string>();
  for (const l of existingLinks ?? []) linkedMap.set(l.document_id, l.project_id);

  console.log(
    `Loaded: ${docs.length} documents, ${projects.length} projects, ${existingLinks?.length ?? 0} existing links\n`,
  );

  // ─── 1. Knowledge graph extraction ───
  console.log("[1/4] Knowledge graph extraction on unprocessed docs...");
  const { data: existingObl } = await supabaseAdmin
    .from("obligations")
    .select("source_document_id");
  const hasKG = new Set(
    (existingObl ?? []).map((o) => o.source_document_id).filter(Boolean),
  );
  const toProcess = docs.filter((d) => !hasKG.has(d.id));
  let kgDone = 0;
  for (const doc of toProcess) {
    try {
      await extractKnowledgeGraph(doc.id);
      kgDone++;
      process.stdout.write(`  ${kgDone}/${toProcess.length} ✓\r`);
    } catch (err) {
      console.error(`\n  FAILED for ${doc.id}: ${(err as Error).message}`);
    }
  }
  console.log(`  Done. Extracted from ${kgDone} documents.\n`);

  // ─── 2. Auto-classify documents → project or reference ───
  console.log("[2/4] Auto-classifying documents...");

  // Embed each project signature once
  const projectEmbeddings = new Map<string, number[]>();
  for (const proj of projects) {
    try {
      const sig = projectSignatureText(proj);
      if (!sig.trim()) continue;
      const emb = await embedQuery(sig);
      projectEmbeddings.set(proj.id, emb);
    } catch (err) {
      console.error(
        `  Failed to embed project "${proj.name}": ${(err as Error).message}`,
      );
    }
  }

  let suggestedProject = 0;
  let markedReference = 0;
  let skippedAlreadyLinked = 0;

  for (const doc of docs) {
    // Skip docs already linked to a project
    if (linkedDocIds.has(doc.id)) {
      skippedAlreadyLinked++;
      continue;
    }

    const sig = docSignatureText(doc);
    if (!sig.trim()) continue;

    // Embed doc signature
    let docEmb: number[];
    try {
      docEmb = await embedQuery(sig);
    } catch {
      continue;
    }

    // Score each project
    let bestScore = 0;
    let bestProjectId: string | null = null;
    for (const [projId, projEmb] of projectEmbeddings.entries()) {
      const score = cosine(docEmb, projEmb);
      if (score > bestScore) {
        bestScore = score;
        bestProjectId = projId;
      }
    }

    // High-confidence → auto-link
    // Medium confidence → leave unassigned (user triages)
    // Low confidence → mark as reference
    const HIGH = 0.7;
    const LOW = 0.45;

    if (bestProjectId && bestScore >= HIGH) {
      const { error } = await supabaseAdmin
        .from("project_documents")
        .upsert({ project_id: bestProjectId, document_id: doc.id });
      if (!error) {
        suggestedProject++;
        const projName =
          projects.find((p) => p.id === bestProjectId)?.name ?? bestProjectId;
        console.log(
          `  → ${doc.title.slice(0, 60)} → ${projName} (${(bestScore * 100).toFixed(0)}%)`,
        );
      }
    } else if (bestScore < LOW) {
      // No project matches well — mark as reference
      const { error } = await supabaseAdmin
        .from("documents")
        .update({ is_reference: true })
        .eq("id", doc.id);
      if (!error) {
        markedReference++;
        console.log(`  ~ ${doc.title.slice(0, 60)} → reference library`);
      }
    } else {
      // Medium confidence — leave as unassigned
      console.log(
        `  ? ${doc.title.slice(0, 60)} → Unassigned (best match ${(bestScore * 100).toFixed(0)}%)`,
      );
    }
  }

  console.log(
    `\n  Linked to projects: ${suggestedProject}, reference: ${markedReference}, already linked: ${skippedAlreadyLinked}\n`,
  );

  // ─── 3. Similarity-based document_references ───
  console.log("[3/4] Pairwise similarity suggestions...");
  const docEmbCache = new Map<string, number[]>();
  for (const doc of docs) {
    const sig = docSignatureText(doc);
    if (!sig.trim()) continue;
    try {
      docEmbCache.set(doc.id, await embedQuery(sig));
    } catch {
      /* skip */
    }
  }

  const { data: existingRefs } = await supabaseAdmin
    .from("document_references")
    .select("source_id, target_id");
  const existingPairs = new Set(
    (existingRefs ?? []).map((r) => {
      const [a, b] = [r.source_id, r.target_id].sort();
      return `${a}::${b}`;
    }),
  );

  let suggestedRefs = 0;
  const docIds = Array.from(docEmbCache.keys());
  for (let i = 0; i < docIds.length; i++) {
    for (let j = i + 1; j < docIds.length; j++) {
      const a = docIds[i];
      const b = docIds[j];
      const [lo, hi] = [a, b].sort();
      if (existingPairs.has(`${lo}::${hi}`)) continue;

      const sim = cosine(docEmbCache.get(a)!, docEmbCache.get(b)!);
      if (sim < 0.85) continue;

      const { error } = await supabaseAdmin.from("document_references").insert({
        source_id: a,
        target_id: b,
        reference_type: "similar",
        reference_text: `Auto-suggested (cosine similarity ${sim.toFixed(3)})`,
        resolved: false,
        similarity: sim,
      });
      if (!error) suggestedRefs++;
    }
  }
  console.log(`  Created ${suggestedRefs} similarity suggestions.\n`);

  // ─── 4. Generate initial context_md for projects that don't have one ───
  console.log("[4/4] Generating initial project context_md...");
  let contextGenerated = 0;
  for (const proj of projects) {
    if (proj.context_md && proj.context_md.trim().length > 0) continue;

    // Fetch linked docs
    const { data: linked } = await supabaseAdmin
      .from("project_documents")
      .select("document_id, documents(title, created_at)")
      .eq("project_id", proj.id);

    const sections: string[] = [];
    sections.push("## Current State\n");
    sections.push(
      proj.context_summary ??
        proj.description ??
        `${proj.name} — project is in initial setup.`,
    );
    sections.push("\n\n## Timeline\n");

    // Timeline from linked docs
    const linkedRows = (linked ?? [])
      .map((r) => r.documents as { title: string; created_at: string } | null)
      .filter((d): d is { title: string; created_at: string } => d !== null)
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );

    for (const d of linkedRows) {
      const date = new Date(d.created_at).toISOString().slice(0, 10);
      sections.push(`${date}  Added: ${d.title}`);
    }

    if (linkedRows.length === 0) {
      sections.push("(No documents linked yet)");
    }

    const content = sections.join("\n");
    const { error } = await supabaseAdmin
      .from("projects")
      .update({ context_md: content })
      .eq("id", proj.id);
    if (!error) contextGenerated++;
  }
  console.log(`  Generated context_md for ${contextGenerated} projects.\n`);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Backfill complete!");
  console.log(`  Knowledge graphs extracted: ${kgDone}`);
  console.log(`  Documents linked to projects: ${suggestedProject}`);
  console.log(`  Documents marked as reference: ${markedReference}`);
  console.log(`  Similarity suggestions: ${suggestedRefs}`);
  console.log(`  Project contexts initialized: ${contextGenerated}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

main().catch((err) => {
  console.error("\nBackfill failed:", err);
  process.exit(1);
});
