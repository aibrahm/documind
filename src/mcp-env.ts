// Side-effect module: loads .env.local into process.env BEFORE any
// other module evaluates. Import this as the FIRST line in mcp-server.ts.
// Without it, supabase.ts throws "NEXT_PUBLIC_SUPABASE_URL is not set"
// because it calls requireEnv() at module scope.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

try {
  const envPath = resolve(process.cwd(), ".env.local");
  const envText = readFileSync(envPath, "utf8");
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
} catch {
  // .env.local not found — that's fine on deployed environments
  // (Railway, Docker) where env vars are injected directly.
  // Only a problem if the vars are actually missing, which
  // supabase.ts will catch at import time.
}
