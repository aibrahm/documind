# Technology Stack

**Analysis Date:** 2026-04-07

## Languages

**Primary:**
- TypeScript 5.x (`strict: true`) — All application code in `src/`
- React 19.2.4 JSX — UI components

**Secondary:**
- SQL (PostgreSQL + pgvector via Supabase) — `supabase/migrations/001_initial_schema.sql` through `012_workspace_profile.sql`
- Minimal JavaScript for Next.js config files (`.mjs`)

## Runtime

**Environment:**
- Node.js 20+ (inferred from `@types/node: ^20` in `package.json`; no `.nvmrc` / `engines` field present)
- Modern browser runtime for React 19 client components
- ES2017 compile target (`tsconfig.json`)

**Package Manager:**
- pnpm 9.x
- Lockfile: `pnpm-lock.yaml` (lockfileVersion 9.0)

## Frameworks

**Core:**
- Next.js 16.2.1 — App Router, Server Components, Server Actions, SSE streaming — `next.config.ts`
- React 19.2.4 + React DOM 19.2.4

**UI / Styling:**
- Tailwind CSS 4.x with `@tailwindcss/postcss` — `postcss.config.mjs`, `src/app/globals.css`
- shadcn/ui 4.1.1 (`base-nova` style) + `@base-ui/react` 1.3.0 — `src/components/ui/*`, `components.json`
- Lucide React 1.7.0 (icons), `class-variance-authority` 0.7.1, `clsx` 2.1.1, `tailwind-merge` 3.5.0
- `next-themes` 0.4.6, `sonner` 2.0.7 (toasts), `tw-animate-css` 1.4.0
- `react-markdown` 10.1.0 + `remark-gfm` 4.0.1 — chat message rendering

**Testing:**
- **None configured.** No Vitest/Jest/Playwright in `devDependencies`. No test files in `src/`. No `test` script in `package.json`.

**Build/Dev:**
- Next.js compiler (SWC) — `npm run dev` / `build` / `start`
- ESLint 9.x (flat config) with `eslint-config-next` 16.2.1 (`core-web-vitals` + `typescript`) — `eslint.config.mjs`
- TypeScript compiler (`noEmit: true`, type-only) — `tsconfig.json`

## Key Dependencies

**Critical:**
- `@anthropic-ai/sdk` ^0.80.0 — Claude (`claude-opus-4-6`) with tool-use for deep analysis — `src/lib/clients.ts`, `src/lib/claude-with-tools.ts`
- `@supabase/supabase-js` ^2.100.1 — Postgres + Auth + pgvector + Storage — `src/lib/supabase.ts`, `src/lib/database.types.ts`
- `openai` ^6.33.0 — GPT-5.4 primary chat + router, GPT-4o-mini for memory extraction — `src/lib/clients.ts`, `src/lib/intelligence-router.ts`, `src/lib/memory.ts`
- `cohere-ai` ^7.21.0 — `embed-multilingual-v3.0` (1024-dim) + reranking — `src/lib/embeddings.ts`, `src/lib/search.ts`
- `pdfjs-dist` ^5.5.207 + `pdf-parse` ^2.4.5 — Native PDF text extraction — `src/lib/pdf-text-extraction.ts`
- `crypto-js` ^4.2.0 — AES-256 encryption for PRIVATE documents at rest — `src/lib/encryption.ts` (flagged as deprecated in CONCERNS.md)

**Infrastructure:**
- Native `fetch` for Azure Document Intelligence REST API (`2024-11-30`) — `src/lib/azure-document-intelligence.ts`
- Native `fetch` for Tavily web search API — `src/lib/web-search.ts`

## Configuration

**Environment:**
- `.env.local.example` (template, committed), `.env.local` (gitignored)
- Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `COHERE_API_KEY`, `ENCRYPTION_KEY`
- Optional: `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` (or `AZURE_DOCINTEL_ENDPOINT`), `AZURE_DOCUMENT_INTELLIGENCE_KEY` (or `AZURE_DOCINTEL_KEY`), `TAVILY_API_KEY`, `DOCUMIND_LOG_DEBUG`

**Build / Compiler:**
- `next.config.ts` — `serverExternalPackages` for `canvas`, `pdfjs-dist`, `pdf-to-img`
- `tsconfig.json` — strict, path alias `@/*` → `./src/*`, `react-jsx`, ES2017 target, `bundler` module resolution
- `tailwind.config.*` (Tailwind v4 — configuration inline via PostCSS plugin)
- `eslint.config.mjs` — Next.js core-web-vitals + TypeScript (flat config, ESLint 9)
- `components.json` — shadcn registry (`base-nova` style, Lucide icons)

## Platform Requirements

**Development:**
- Any platform with Node 20+ and pnpm 9
- Modern browser (React 19)
- Optional: Supabase CLI for local migrations

**Production:**
- Vercel (implied by `.gitignore` excluding `.vercel/`) or any Next.js-compatible Node 20+ host
- Supabase project (Postgres + pgvector extension + Storage bucket `documents/`)
- Azure Document Intelligence (optional — only needed for scanned PDFs)
- API route timeouts: `maxDuration = 300` on upload, `60` on chat
- 50MB max file upload (enforced in `src/app/api/upload/route.ts`)
- No CI/CD pipeline detected (no `.github/workflows/`)

---

*Stack analysis: 2026-04-07*
*Update after major dependency changes*
