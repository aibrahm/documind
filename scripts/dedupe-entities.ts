#!/usr/bin/env tsx
// scripts/dedupe-entities.ts
//
// Merge duplicate authority-type entities that slipped past earlier
// canonicalization. The symptom you'd see in the UI (and in the Abu
// Dhabi Ports screenshot) is the same entity appearing 4× under
// slightly different OCR spellings — e.g.
//
//     الهيئة العامة للمنطقة الاقتصادية للمثلث الذهبي
//     هيئة العامة للمنطقة الاقتصادية المثلث الذهبي
//     الهيئة العامة للمنطقة الاقتصادية المثلث الذهبي
//     هيئة العامة للمنطقة الاقتصادية للمثلث الذهبي
//
// The canonicalization pass that now runs on new uploads uses an
// authority-prefix rule (first 14 normalized characters of two
// AUTHORITY/MINISTRY/INSTITUTION/GOVERNMENT/AGENCY entities equal
// each other → same entity). This script applies the same rule to
// EXISTING rows and merges the duplicates:
//
//   1. Build groups by (type, first 14 normalized chars).
//   2. Within each group of size >1, pick the OLDEST entity as the
//      canonical one (stable id, least disruptive to existing links).
//   3. UPSERT every document_entities row that points at a loser
//      entity to point at the canonical one instead (handles the
//      unique (document_id, entity_id) constraint by deduping).
//   4. DELETE the loser entities.
//
// Usage:
//   tsx scripts/dedupe-entities.ts                   # dry run
//   tsx scripts/dedupe-entities.ts --commit          # actually merge
//   tsx scripts/dedupe-entities.ts --commit --types=authority,ministry

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

try {
  const envText = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of envText.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
} catch (err) {
  console.error("Could not read .env.local:", (err as Error).message);
  process.exit(1);
}

import { supabaseAdmin } from "@/lib/supabase";
import { normalizeName } from "@/lib/entities";

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const typesArg = args.find((a) => a.startsWith("--types="));
const DEFAULT_TYPES = ["authority", "ministry", "institution", "government", "agency"];
const TYPES = typesArg
  ? typesArg.split("=", 2)[1].split(",").map((t) => t.trim().toLowerCase())
  : DEFAULT_TYPES;

// Minimum normalized length for the SHORTER (canonical candidate) of
// a pair before we allow the prefix-containment merge rule to fire.
// This guards against merging two unrelated entities that happen to
// share a common "الهيئة العامة ل" (= "General Authority for") prefix
// — we require the shorter name to be long enough to be genuinely
// distinctive before we treat a longer name as its fragment.
const MIN_CANONICAL_LENGTH = 25;

const green = "\x1b[32m";
const yellow = "\x1b[33m";
const dim = "\x1b[90m";
const reset = "\x1b[0m";

interface EntityRow {
  id: string;
  name: string;
  name_en: string | null;
  type: string;
  created_at: string | null;
}

// Cluster by prefix containment. Two same-type entities merge if the
// shorter normalized name is a strict prefix of the longer (treating
// the longer as an OCR sentence-fragment where the entity name
// leaked into the following text). The shorter name must be at least
// MIN_CANONICAL_LENGTH characters so we don't merge unrelated
// authorities that share a very common prefix.
function clusterByType(rows: EntityRow[]): EntityRow[][] {
  const byType = new Map<string, EntityRow[]>();
  for (const r of rows) {
    const t = r.type.toLowerCase();
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(r);
  }

  const clusters: EntityRow[][] = [];
  for (const typeRows of byType.values()) {
    const normalized = new Map<string, string>();
    for (const r of typeRows) normalized.set(r.id, normalizeName(r.name));

    // Union-find
    const parent = new Map<string, string>(typeRows.map((r) => [r.id, r.id]));
    const find = (id: string): string => {
      while (parent.get(id) !== id) {
        const p = parent.get(id)!;
        parent.set(id, parent.get(p) ?? p);
        id = parent.get(id)!;
      }
      return id;
    };
    const union = (a: string, b: string) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };

    for (let i = 0; i < typeRows.length; i++) {
      for (let j = i + 1; j < typeRows.length; j++) {
        const ai = typeRows[i];
        const aj = typeRows[j];
        const ni = normalized.get(ai.id)!;
        const nj = normalized.get(aj.id)!;
        // Exact normalized match — always merge.
        if (ni && ni === nj) {
          union(ai.id, aj.id);
          continue;
        }
        // Prefix containment. Pick the shorter as candidate canonical,
        // the longer as candidate fragment. Require the shorter to be
        // distinctive enough (>= MIN_CANONICAL_LENGTH normalized chars)
        // so we don't collapse unrelated authorities.
        const shorter = ni.length <= nj.length ? ni : nj;
        const longer = ni.length <= nj.length ? nj : ni;
        if (
          shorter.length >= MIN_CANONICAL_LENGTH &&
          longer.startsWith(shorter)
        ) {
          // Also require the next character after the prefix to be a
          // separator (space, punctuation) — otherwise "الصناعية" is
          // a prefix of "الصناعيةكلية" which obviously isn't the same
          // entity extended.
          const next = longer.charAt(shorter.length);
          if (next === "" || /\s|،|\.|\(|،|,|\//.test(next)) {
            union(ai.id, aj.id);
          }
        }
      }
    }

    const byRoot = new Map<string, EntityRow[]>();
    for (const r of typeRows) {
      const root = find(r.id);
      if (!byRoot.has(root)) byRoot.set(root, []);
      byRoot.get(root)!.push(r);
    }
    for (const cluster of byRoot.values()) {
      if (cluster.length > 1) clusters.push(cluster);
    }
  }

  return clusters;
}

async function main() {
  console.log(
    `${dim}${COMMIT ? "COMMIT mode" : "DRY RUN — no writes"} · types: ${TYPES.join(", ")}${reset}`,
  );

  const { data: entities, error } = await supabaseAdmin
    .from("entities")
    .select("id, name, name_en, type, created_at")
    .in("type", TYPES);
  if (error) {
    console.error("Failed to load entities:", error.message);
    process.exit(1);
  }
  if (!entities || entities.length === 0) {
    console.log("No entities of the requested types.");
    return;
  }
  console.log(`${dim}Scanning ${entities.length} entities…${reset}\n`);

  const clusters = clusterByType(entities as EntityRow[]);

  let mergedGroups = 0;
  let deletedCount = 0;
  let relinkedCount = 0;

  for (const rows of clusters) {
    // Canonical = SHORTEST name, tie-broken by oldest created_at.
    // Short names are cleaner ("الهيئة العامة للمنطقة الاقتصادية
    // للمثلث الذهبي") while long ones are usually OCR'd sentence
    // fragments that captured context following the entity name. We
    // always want the loser to be the fragment, the keeper to be the
    // canonical short form.
    rows.sort((a, b) => {
      const lenDiff = a.name.length - b.name.length;
      if (lenDiff !== 0) return lenDiff;
      const at = a.created_at ? Date.parse(a.created_at) : Number.POSITIVE_INFINITY;
      const bt = b.created_at ? Date.parse(b.created_at) : Number.POSITIVE_INFINITY;
      return at - bt;
    });
    const canonical = rows[0];
    const losers = rows.slice(1);

    console.log(`${green}MERGE${reset} ${dim}${canonical.type}${reset}`);
    console.log(`  keep   ${canonical.id.slice(0, 8)}  "${canonical.name}"`);
    for (const l of losers) {
      console.log(`  ${yellow}→${reset}     ${l.id.slice(0, 8)}  "${l.name}"`);
    }

    if (!COMMIT) {
      mergedGroups++;
      continue;
    }

    // Re-point document_entities: for every row pointing at a loser,
    // update it to point at the canonical. If the (document_id,
    // canonical_id) pair already exists, DELETE the loser row instead
    // to respect the unique constraint.
    for (const loser of losers) {
      const { data: links } = await supabaseAdmin
        .from("document_entities")
        .select("document_id, role")
        .eq("entity_id", loser.id);
      for (const link of links ?? []) {
        const docId = link.document_id as string;
        const role = (link.role as string | null) ?? null;

        // Does a (doc, canonical, role) row already exist?
        let existingQuery = supabaseAdmin
          .from("document_entities")
          .select("document_id")
          .eq("document_id", docId)
          .eq("entity_id", canonical.id);
        if (role !== null) existingQuery = existingQuery.eq("role", role);
        const { data: existing } = await existingQuery;
        if ((existing ?? []).length > 0) {
          // Canonical already linked — drop the loser row.
          await supabaseAdmin
            .from("document_entities")
            .delete()
            .eq("document_id", docId)
            .eq("entity_id", loser.id);
        } else {
          // Re-point the loser row at canonical.
          await supabaseAdmin
            .from("document_entities")
            .update({ entity_id: canonical.id })
            .eq("document_id", docId)
            .eq("entity_id", loser.id);
          relinkedCount++;
        }
      }

      // Delete any remaining rows pointing at the loser (defensive).
      await supabaseAdmin
        .from("document_entities")
        .delete()
        .eq("entity_id", loser.id);

      // Delete the loser entity itself.
      const { error: delErr } = await supabaseAdmin
        .from("entities")
        .delete()
        .eq("id", loser.id);
      if (delErr) {
        console.error(
          `    ${yellow}delete failed for ${loser.id.slice(0, 8)}:${reset} ${delErr.message}`,
        );
        continue;
      }
      deletedCount++;
    }
    mergedGroups++;
  }

  console.log();
  console.log(`${dim}────────────────────────────${reset}`);
  if (COMMIT) {
    console.log(
      `${green}${mergedGroups}${reset} groups merged  ${dim}·${reset}  ${deletedCount} entities deleted  ${dim}·${reset}  ${relinkedCount} links re-pointed`,
    );
  } else {
    console.log(
      `${green}${mergedGroups}${reset} groups would be merged (dry run — pass --commit to apply)`,
    );
  }
}

main().catch((err) => {
  console.error("Script crashed:", err);
  process.exit(1);
});
