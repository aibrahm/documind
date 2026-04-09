#!/usr/bin/env tsx
// scripts/bulk-rename-titles.ts
//
// Rewrite every existing document's title to follow the canonical
// archive convention: "{Type}: {subject in primary language}". New
// uploads already get this treatment at intake time (see
// src/lib/intake.ts) — this script backfills the rows that were in the
// database before the convention landed.
//
// Usage:
//   tsx scripts/bulk-rename-titles.ts            # dry run (prints plan)
//   tsx scripts/bulk-rename-titles.ts --commit   # actually UPDATE
//   tsx scripts/bulk-rename-titles.ts --commit --only=<doc-id>  # single doc
//
// Cost: each rename is one gpt-4o-mini call reading ~3000 chars. On a
// workspace of ~20 documents that's roughly $0.01 total. On a larger
// workspace it's still lunch-money.
//
// Safety: dry-run by default. Nothing is written to the DB unless you
// pass --commit. Failed title generations fall back to the existing
// title untouched (the script never leaves a row worse than it found
// it).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local before we import anything that touches OpenAI /
// Supabase clients, so the lazy singletons pick up real credentials.
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
import { generateCanonicalTitle } from "@/lib/title-convention";
import type { DocumentType } from "@/lib/extraction-schema";
import { DOCUMENT_TYPES } from "@/lib/extraction-schema";

const PREFIX_AR_TO_TYPE: Record<string, DocumentType> = {
  "قانون": "law",
  "قرار": "decree",
  "مذكرة تفاهم": "mou",
  "مذكرة": "memo",
  "عقد": "contract",
  "تقرير": "report",
  "سياسة": "policy",
  "خطاب": "letter",
  "مستند مالي": "financial",
  "مستند": "other",
};
const PREFIX_EN_TO_TYPE: Record<string, DocumentType> = {
  Law: "law",
  Decree: "decree",
  MoU: "mou",
  Memo: "memo",
  Contract: "contract",
  Report: "report",
  Policy: "policy",
  Letter: "letter",
  Financial: "financial",
  Document: "other",
};

// The LLM already produces a canonical subject; we trust that. But the
// PREFIX it picks (derived from the documents.type column passed in)
// can be wrong when the stored column is stale. So: look at the
// subject string for obvious type cues and override the prefix.
//
// Using plain substring checks instead of regex here because JS regex
// `\b` word-boundary is ASCII-only and fires wrong on Arabic characters
// — earlier attempts with \b failed to match "قانون" at the start of
// "قانون المناطق الاقتصادية" even though it obviously should.
function pickTypeFromSubject(
  subject: string,
  fallback: DocumentType,
): DocumentType {
  const s = subject.trim();
  const lower = s.toLowerCase();

  // ── Arabic cues (most specific first) ──
  // MoU must be checked before plain Memo because "مذكرة تفاهم" shares
  // a prefix with "مذكرة". Same for "قانون" which starts documents
  // sometimes referenced by their parent decree.
  if (s.startsWith("مذكرة تفاهم") || s.includes("مذكرة تفاهم")) return "mou";
  if (
    s.startsWith("قانون") ||
    s.startsWith("مشروع قانون") ||
    s.includes("قانون رقم") ||
    s.includes("اللائحة التنفيذية لقانون")
  ) {
    return "law";
  }
  if (
    s.startsWith("قرار") ||
    s.startsWith("مرسوم") ||
    s.includes("قرار رئيس")
  ) {
    return "decree";
  }
  if (s.startsWith("تعديل") && s.includes("قانون")) return "law"; // law amendments
  if (s.startsWith("عقد") || s.includes(" عقد ")) return "contract";
  if (
    s.startsWith("تقرير") ||
    s.startsWith("دراسة") ||
    s.includes("مخطط") ||
    s.includes("masterplan") ||
    s.startsWith("خطة عمل") ||
    s.startsWith("الخطة")
  ) {
    return "report";
  }
  if (
    s.startsWith("سياسة") ||
    s.includes("استراتيجية") ||
    s.includes("الإطار الاستراتيجي")
  ) {
    return "policy";
  }
  if (s.startsWith("خطاب")) return "letter";
  if (s.startsWith("مذكرة")) return "memo"; // after MoU check

  // ── English cues ──
  if (lower.includes("memorandum of understanding") || /\bmou\b/.test(lower)) return "mou";
  if (lower.startsWith("law ") || lower.includes("law no")) return "law";
  if (
    lower.startsWith("decree") ||
    lower.startsWith("presidential decree") ||
    lower.startsWith("ministerial decision")
  ) {
    return "decree";
  }
  if (lower.startsWith("contract") || lower.startsWith("agreement")) return "contract";
  if (lower.startsWith("policy") || lower.includes("strategy") || lower.includes("framework")) {
    return "policy";
  }
  if (
    lower.startsWith("report") ||
    lower.includes("masterplan") ||
    lower.includes("executive summary") ||
    lower.startsWith("study")
  ) {
    return "report";
  }
  if (lower.startsWith("memo") || lower.startsWith("letter")) return "memo";

  return fallback;
}

const TYPE_PREFIX_AR: Record<DocumentType, string> = {
  memo: "مذكرة",
  letter: "خطاب",
  contract: "عقد",
  mou: "مذكرة تفاهم",
  report: "تقرير",
  law: "قانون",
  decree: "قرار",
  policy: "سياسة",
  financial: "مستند مالي",
  other: "مستند",
};
const TYPE_PREFIX_EN: Record<DocumentType, string> = {
  memo: "Memo",
  letter: "Letter",
  contract: "Contract",
  mou: "MoU",
  report: "Report",
  law: "Law",
  decree: "Decree",
  policy: "Policy",
  financial: "Financial",
  other: "Document",
};

/**
 * Given a freshly-generated "{Prefix}: {subject}" title, figure out
 * the best type from the subject string itself, and return a possibly-
 * corrected "{Prefix}: {subject}" with the right prefix. Returns the
 * corrected type alongside so we can also update documents.type.
 */
function correctTitleTypePrefix(
  title: string,
  language: "ar" | "en" | "mixed",
  fallbackType: DocumentType,
): { title: string; type: DocumentType } {
  // Split on the first ": " — the title convention guarantees this
  // separator exists. If it doesn't, fall back.
  const splitIdx = title.indexOf(":");
  if (splitIdx === -1) {
    return { title, type: fallbackType };
  }
  const rawPrefix = title.slice(0, splitIdx).trim();
  const subject = title.slice(splitIdx + 1).trim();
  if (!subject) return { title, type: fallbackType };

  // Map the rawPrefix back to a type (so we know what the generator
  // used) — falls back to the passed-in fallback.
  const prefixToType =
    language === "en" ? PREFIX_EN_TO_TYPE : PREFIX_AR_TO_TYPE;
  const prefixDerivedType = prefixToType[rawPrefix] ?? fallbackType;

  // Check the subject for better cues.
  const detectedType = pickTypeFromSubject(subject, prefixDerivedType);
  if (detectedType === prefixDerivedType) {
    return { title, type: detectedType };
  }

  // Rebuild with the corrected prefix in the same language.
  const newPrefix =
    language === "en"
      ? TYPE_PREFIX_EN[detectedType]
      : TYPE_PREFIX_AR[detectedType];
  return { title: `${newPrefix}: ${subject}`, type: detectedType };
}

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const onlyArg = args.find((a) => a.startsWith("--only="));
const ONLY_ID = onlyArg ? onlyArg.split("=", 2)[1] : null;

const green = "\x1b[32m";
const yellow = "\x1b[33m";
const dim = "\x1b[90m";
const reset = "\x1b[0m";

function isDocumentType(v: string | null | undefined): v is DocumentType {
  return typeof v === "string" && DOCUMENT_TYPES.includes(v as DocumentType);
}

function inferLanguage(text: string): "ar" | "en" | "mixed" {
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const latinChars = (text.match(/[A-Za-z]/g) || []).length;
  if (arabicChars > 0 && latinChars > 0) return "mixed";
  if (arabicChars > 0) return "ar";
  return "en";
}

async function main() {
  console.log(
    `${dim}${COMMIT ? "COMMIT mode — updates will be written" : "DRY RUN — no writes, pass --commit to apply"}${reset}`,
  );

  let query = supabaseAdmin
    .from("documents")
    .select("id, title, type, language, classification, status")
    .eq("status", "ready")
    .order("created_at", { ascending: false });
  if (ONLY_ID) query = query.eq("id", ONLY_ID);

  const { data: docs, error } = await query;
  if (error) {
    console.error("Failed to fetch documents:", error.message);
    process.exit(1);
  }
  if (!docs || docs.length === 0) {
    console.log("No ready documents found.");
    return;
  }

  console.log(`${dim}Scanning ${docs.length} document(s)…${reset}\n`);

  let renamed = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of docs) {
    const id = doc.id as string;
    const oldTitle = (doc.title as string) || "";
    const rawType = doc.type as string | null | undefined;
    const storedType: DocumentType = isDocumentType(rawType) ? rawType : "other";

    // Pull the first ~20 chunks for this document. We sort by
    // chunk_index (primary ordering) and use the concatenated content
    // as the sample the title generator reads.
    const { data: chunks } = await supabaseAdmin
      .from("chunks")
      .select("content, page_number, chunk_index")
      .eq("document_id", id)
      .order("chunk_index", { ascending: true })
      .limit(20);
    const fullText = (chunks ?? [])
      .map((c) => (c.content as string) || "")
      .join("\n\n")
      .slice(0, 6000);

    if (!fullText.trim()) {
      console.log(
        `${yellow}SKIP${reset} ${id.slice(0, 8)}  (no chunk content)  "${oldTitle.slice(0, 60)}"`,
      );
      skipped++;
      continue;
    }

    const rawLang = (doc.language as string) || inferLanguage(fullText);
    const language: "ar" | "en" | "mixed" =
      rawLang === "ar" || rawLang === "en" || rawLang === "mixed"
        ? rawLang
        : inferLanguage(fullText);

    let rawTitle: string;
    try {
      rawTitle = await generateCanonicalTitle({
        fullText,
        documentType: storedType,
        language,
        fileName: oldTitle.endsWith(".pdf") ? oldTitle : `${oldTitle}.pdf`,
      });
    } catch (err) {
      console.log(
        `${yellow}FAIL${reset} ${id.slice(0, 8)}  (${(err as Error).message.slice(0, 60)})`,
      );
      failed++;
      continue;
    }

    // Post-process: pick the right type/prefix based on the subject the
    // LLM generated, not the stored type column (which can be stale).
    const corrected = correctTitleTypePrefix(rawTitle, language, storedType);
    const newTitle = corrected.title;
    const documentType = corrected.type;
    const typeChanged = documentType !== storedType;

    if (newTitle.trim() === oldTitle.trim() && !typeChanged) {
      console.log(`${dim}OK  ${reset}${id.slice(0, 8)}  (already canonical)`);
      skipped++;
      continue;
    }

    const typeNote = typeChanged
      ? `${dim} [type: ${storedType} → ${documentType}]${reset}`
      : "";
    console.log(
      `${green}REN${reset} ${id.slice(0, 8)}${typeNote}\n    from: ${oldTitle}\n    to:   ${newTitle}`,
    );

    if (COMMIT) {
      const updates: Record<string, unknown> = { title: newTitle };
      if (typeChanged) updates.type = documentType;
      const { error: updateErr } = await supabaseAdmin
        .from("documents")
        .update(updates)
        .eq("id", id);
      if (updateErr) {
        console.error(`    ${yellow}UPDATE FAILED:${reset} ${updateErr.message}`);
        failed++;
        continue;
      }
    }
    renamed++;
  }

  console.log();
  console.log(`${dim}────────────────────────────${reset}`);
  console.log(
    `${green}${renamed}${reset} ${COMMIT ? "renamed" : "would rename"}  ${dim}·${reset}  ${skipped} skipped  ${dim}·${reset}  ${failed} failed`,
  );
}

main().catch((err) => {
  console.error("Script crashed:", err);
  process.exit(1);
});
