# Technology Stack

**Analysis Date:** 2026-04-06

## Languages

**Primary:**
- TypeScript 5.x (strict mode) — All application code in `src/`

**Secondary:**
- JSX/TSX — React component files
- SQL — `supabase/migrations/*.sql`

## Runtime

**Environment:**
- Node.js 20.x (verified running v20.19.0)
- No `.nvmrc` — version assumed from system/CI

**Package Manager:**
- pnpm (v9.0+ lockfile format)
- Lockfile: `pnpm-lock.yaml`

## Frameworks

**Core:**
- **Next.js 16.2.1** — App Router monolith
  - ⚠ Per `AGENTS.md`: "This is NOT the Next.js you know" — breaking changes exist. Read `node_modules/next/dist/docs/` before writing version-specific code.
- React 19.2.4 + React DOM 19.2.4
- TailwindCSS 4.x — styling (`postcss.config.mjs`)

**UI Libraries:**
- shadcn 4.1.1 + `@base-ui/react` 1.3.0 — component primitives in `src/components/ui/`
- `lucide-react` 1.7.0 — icons
- `react-markdown` 10.1.0 — rendering assistant markdown responses

**Testing:**
- None configured (see `TESTING.md`)

**Build/Dev:**
- TypeScript 5 (strict, `noEmit: true`)
- ESLint 9 with `next/core-web-vitals` + TypeScript configs (`eslint.config.mjs`)
- PostCSS + TailwindCSS 4 (`postcss.config.mjs`)

## Key Dependencies

**Critical — AI/ML:**
- `@anthropic-ai/sdk` ^0.80.0 — Claude Opus 4.6 for deep mode with autonomous tool use (`src/lib/clients.ts`, `src/lib/claude-with-tools.ts`)
- `openai` ^6.33.0 — GPT-4o (extraction/vision) + GPT-4o-mini (routing, librarian, memory) (`src/lib/clients.ts`, `src/lib/extraction.ts`, `src/lib/intelligence-router.ts`, `src/lib/librarian.ts`, `src/lib/memory.ts`)
- `cohere-ai` ^7.21.0 — Multilingual embeddings (embed-multilingual-v3.0, 1024-dim) + reranking (`src/lib/embeddings.ts`, `src/lib/search.ts`)

**Critical — Data:**
- `@supabase/supabase-js` ^2.100.1 — DB + storage + auth client (`src/lib/supabase.ts`)

**Critical — PDF:**
- `pdf-parse` ^2.4.5 — Fast first-page text extraction for librarian (`src/lib/librarian.ts`)
- `pdf-to-img` ^5.0.0 — Render PDF pages to PNG for GPT-4o vision extraction (`src/lib/extraction.ts`)
- `pdfjs-dist` ^5.5.207 — underlying PDF rendering

**Critical — Security:**
- `crypto-js` ^4.2.0 — AES-256 encryption for PRIVATE classification documents (`src/lib/encryption.ts`)

## Configuration

**Environment:**
- `.env.local` (gitignored) with template at `.env.local.example`
- Required vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `COHERE_API_KEY`, `TAVILY_API_KEY`, `ENCRYPTION_KEY`
- ⚠ No startup validation — missing keys fail at first use, not boot (see `CONCERNS.md`)

**Build:**
- `tsconfig.json` — target ES2017, moduleResolution `bundler`, path alias `@/*` → `src/*`
- `next.config.ts` — `serverExternalPackages` for `pdf-to-img`, `canvas`, `pdfjs-dist`
- `postcss.config.mjs` — TailwindCSS 4 integration
- `eslint.config.mjs` — extends `next/core-web-vitals` + TS presets

## Platform Requirements

**Development:**
- Any platform with Node.js 20
- Supabase project (hosted) — no local DB tooling configured

**Production:**
- Expected target: Vercel (Next.js native) — not explicitly configured
- ngrok mentioned in `STATE.md` for sharing with the VC during active development
- Single-user deployment (no multi-tenant concerns)

---

*Stack analysis: 2026-04-06*
*Update after major dependency changes*
