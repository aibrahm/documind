#!/usr/bin/env node
// scripts/diagnose-search.mjs
//
// Quick diagnostic for the new hybrid_search RPC + conversation
// title rewriter. Runs both against the live database so we can
// see which one is actually broken in production.

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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
} catch (err) {
  console.error("Could not read .env.local:", err.message);
  process.exit(1);
}

const { createClient } = await import("@supabase/supabase-js");
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const CohereClient = (await import("cohere-ai")).CohereClient;
const cohere = new CohereClient({ token: process.env.COHERE_API_KEY });

function ok(label, detail) {
  console.log(`\x1b[32m✓\x1b[0m ${label}${detail ? `  \x1b[90m${detail}\x1b[0m` : ""}`);
}
function fail(label, err) {
  console.log(`\x1b[31m✗\x1b[0m ${label}`);
  if (err) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err);
    console.log(`   \x1b[31m${msg}\x1b[0m`);
  }
}

console.log("\n\x1b[1mhybrid_search RPC\x1b[0m");

// 1. Embed a test query
let embedding;
try {
  const res = await cohere.embed({
    texts: ["Abu Dhabi Ports commitments"],
    model: "embed-multilingual-v3.0",
    inputType: "search_query",
    embeddingTypes: ["float"],
  });
  embedding = res.embeddings.float[0];
  ok("cohere embed", `1024-dim vector`);
} catch (err) {
  fail("cohere embed", err);
  process.exit(1);
}

// 2. Call hybrid_search with minimum args
try {
  const { data, error } = await supabase.rpc("hybrid_search", {
    query_embedding: embedding,
    query_text: "Abu Dhabi Ports commitments",
    match_count: 8,
  });
  if (error) {
    fail("hybrid_search (minimum args)", error);
  } else {
    ok("hybrid_search (minimum args)", `${data?.length ?? 0} rows`);
    if (data && data.length > 0) {
      console.log(`   top: score=${data[0].combined_score?.toFixed(3)}  doc=${data[0].document_id?.slice(0, 8)}`);
    }
  }
} catch (err) {
  fail("hybrid_search (minimum args) — threw", err);
}

// 3. Call hybrid_search with all new params
try {
  const { data, error } = await supabase.rpc("hybrid_search", {
    query_embedding: embedding,
    query_text: "Abu Dhabi Ports commitments",
    match_count: 8,
    filter_classification: null,
    filter_document_id: null,
    included_doc_ids: null,
    excluded_doc_ids: null,
    max_per_document: 2,
  });
  if (error) {
    fail("hybrid_search (full args)", error);
  } else {
    ok("hybrid_search (full args)", `${data?.length ?? 0} rows`);
  }
} catch (err) {
  fail("hybrid_search (full args) — threw", err);
}

// 4. Call with an actual excluded_doc_ids array
try {
  const fakeUuid = "00000000-0000-0000-0000-000000000000";
  const { data, error } = await supabase.rpc("hybrid_search", {
    query_embedding: embedding,
    query_text: "test",
    match_count: 4,
    excluded_doc_ids: [fakeUuid],
  });
  if (error) {
    fail("hybrid_search (excluded_doc_ids array)", error);
  } else {
    ok("hybrid_search (excluded_doc_ids array)", `${data?.length ?? 0} rows`);
  }
} catch (err) {
  fail("hybrid_search (excluded_doc_ids array) — threw", err);
}

console.log("\n\x1b[1msearch_conversations RPC\x1b[0m");
try {
  const { data, error } = await supabase.rpc("search_conversations", {
    query_text: "موانئ",
    match_count: 10,
  });
  if (error) {
    fail("search_conversations", error);
  } else {
    ok("search_conversations", `${data?.length ?? 0} matches`);
    if (data && data.length > 0) {
      console.log(`   top: "${data[0].conversation_title}"  snippet: ${data[0].snippet?.slice(0, 80)}`);
    }
  }
} catch (err) {
  fail("search_conversations — threw", err);
}
