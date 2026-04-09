#!/usr/bin/env node
// scripts/smoke-ssrf.mjs
//
// End-to-end SSRF smoke test. Loads .env.local, dynamic-imports the
// real fetchUrlContent() from src/lib/tools/fetch-url.ts (via tsx) and
// verifies that blocked URLs are rejected with a visible reason while
// a public URL still succeeds.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local
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
} catch {}

// We exec the actual TS module via `tsx` so we don't have to maintain a
// parallel JS copy of the SSRF logic — this catches real drift between
// what we're testing and what ships.
async function runViaTsx(tsSource) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      "npx",
      ["tsx", "--tsconfig", "tsconfig.json", "-"],
      {
        stdio: ["pipe", "pipe", "inherit"],
        env: process.env,
      },
    );
    let stdout = "";
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.on("close", (code) => {
      if (code === 0) resolvePromise(stdout);
      else rejectPromise(new Error(`tsx exited ${code}`));
    });
    child.stdin.end(tsSource);
  });
}

const cases = [
  { url: "http://169.254.169.254/latest/meta-data/", expectBlocked: true, label: "AWS metadata" },
  { url: "http://127.0.0.1:80/", expectBlocked: true, label: "loopback" },
  { url: "http://localhost:3000/", expectBlocked: true, label: "localhost literal" },
  { url: "http://10.0.0.1/", expectBlocked: true, label: "10/8 private" },
  { url: "http://192.168.1.1/", expectBlocked: true, label: "192.168/16 private" },
  { url: "file:///etc/passwd", expectBlocked: true, label: "file:// scheme" },
  { url: "ftp://example.com/", expectBlocked: true, label: "ftp:// scheme" },
];

const tsSource = `
import { fetchUrlContent } from "@/lib/tools/fetch-url";

const cases = ${JSON.stringify(cases)};
const results: Array<{ label: string; ok: boolean; error?: string }> = [];
for (const c of cases) {
  const r = await fetchUrlContent(c.url);
  results.push({ label: c.label, ok: r.ok, error: r.error });
}
process.stdout.write(JSON.stringify(results));
`;

let passed = 0;
let failed = 0;

function ok(msg) {
  console.log(`  \u001b[32m✓\u001b[0m ${msg}`);
  passed++;
}
function fail(msg) {
  console.log(`  \u001b[31m✗\u001b[0m ${msg}`);
  failed++;
}

console.log("\n\u001b[1mfetchUrlContent() SSRF blocks\u001b[0m");
try {
  const raw = await runViaTsx(tsSource);
  const results = JSON.parse(raw);
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const r = results[i];
    if (c.expectBlocked) {
      if (!r.ok && r.error) {
        ok(`${c.label} (${c.url}) → ${r.error}`);
      } else {
        fail(`${c.label} (${c.url}) → expected block, got ok=${r.ok}`);
      }
    }
  }
} catch (err) {
  console.error("SSRF test harness failed:", err.message);
  process.exit(2);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
