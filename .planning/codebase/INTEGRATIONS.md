# External Integrations

**Analysis Date:** 2026-04-07

## APIs & External Services

**LLM — OpenAI (GPT family):**
- Used for: primary chat + router (`gpt-5.4`), memory extraction (`gpt-4o-mini`), classification/extraction fallback (`gpt-4o`)
- SDK: `openai` v6.33.0
- Auth: `OPENAI_API_KEY`
- Singleton: `getOpenAI()` in `src/lib/clients.ts`
- Callers: `src/lib/chat-turn.ts`, `src/lib/intelligence-router.ts`, `src/lib/memory.ts`, `src/lib/librarian.ts`
- Cost tracking: `calculateCost()` in `src/lib/clients.ts` (gpt-4o $2.50/$10, gpt-4o-mini $0.15/$0.60 per 1M tokens)

**LLM — Anthropic (Claude):**
- Used for: deep analysis with autonomous tool-use (`claude-opus-4-6`); falls back to GPT-5.4 if Anthropic unavailable
- SDK: `@anthropic-ai/sdk` v0.80.0
- Auth: `ANTHROPIC_API_KEY`
- Tools exposed to Claude: `web_search` (Tavily), `fetch_url`, `financial_model`, `extract_key_terms`
- Singleton: `getAnthropic()` in `src/lib/clients.ts`
- Streaming loop: `src/lib/claude-with-tools.ts`
- Tool definitions: `src/lib/tools/fetch-url.ts`, `src/lib/tools/financial-model.ts`, `src/lib/tools/extract-key-terms.ts`, `src/lib/web-search.ts`
- Cost tracking: `src/lib/clients.ts` (claude-sonnet $3/$15 per 1M tokens)

**Embeddings + Reranking — Cohere:**
- Used for: bilingual (Arabic + English) vector embeddings and semantic reranking
- Model: `embed-multilingual-v3.0` (1024-dim), batch size 96
- SDK: `cohere-ai` v7.21.0
- Auth: `COHERE_API_KEY`
- Singleton: `getCohere()` in `src/lib/clients.ts`
- Files: `src/lib/embeddings.ts`, `src/lib/search.ts`

**OCR — Azure Document Intelligence:**
- Used for: scanned / image-only PDFs (native text layer tried first; Azure is the fallback)
- Integration: native REST API via `fetch` (no SDK)
- Model: `prebuilt-layout`, API version `2024-11-30`, text output format
- Polling: 1.5s intervals, max 120 attempts (~3 min timeout)
- Auth: `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` (or `AZURE_DOCINTEL_ENDPOINT`) + `AZURE_DOCUMENT_INTELLIGENCE_KEY` (or `AZURE_DOCINTEL_KEY`)
- Gating: `isAzureDocumentIntelligenceConfigured()` check — graceful degradation if missing
- Files: `src/lib/azure-document-intelligence.ts`, `src/lib/extraction-v2.ts`
- Cost: not currently tracked in `calculateCost()`

**Web Search — Tavily:**
- Used for: fresh public data enrichment; called autonomously by Claude via the `web_search` tool
- Integration: native REST API via `fetch` (endpoint: `https://api.tavily.com/search`)
- Auth: `TAVILY_API_KEY`
- Routing: news queries (Arabic/English keywords + "أخبار") → `topic: "news"` + `search_depth: "advanced"`; general → `basic`
- Behavior: fails loudly if key missing (throws) — per `CLAUDE.md` philosophy
- File: `src/lib/web-search.ts`

## Data Storage

**Database — Supabase PostgreSQL + pgvector:**
- Auth:
  - Browser client: `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - Server admin: `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS)
- Client: `src/lib/supabase.ts` (exports `supabase` browser + `supabaseAdmin` server singletons)
- Types: `src/lib/database.types.ts` (auto-generated)
- Extension: `pgvector` for 1024-dim embeddings
- Key tables:
  - `documents` — metadata, classification (PRIVATE/PUBLIC/DOCTRINE), language, version tracking, `encrypted_content`
  - `chunks` — text segments with `embedding vector(1024)`, page/section/clause metadata
  - `entities` + `document_entities` — bilingual named entities (`name`, `name_en`) and doc↔entity links
  - `document_references` — cross-document citations, resolved and unresolved
  - `conversations` + `messages` — chat history with mode (chat/analyze)
  - `memory_items` — durable workspace insights (kind: decision/fact/instruction/preference/risk/question; scope: thread/project/shared/institution)
  - `doctrines` — bilingual analytical frameworks (`content_ar`, `content_en`, `version`, `is_active`)
  - `projects` + `project_documents` + `project_entities` + `project_conversations` + `project_artifacts`
  - `document_artifacts` — cached extraction results (schema/classification/metadata payloads)
  - `audit_log` — action trail (queries, uploads, classifications, model calls, project events)
- Key RPC: `hybrid_search` (vector similarity + FTS) — defined in `supabase/migrations/002_fix_hybrid_search.sql`
- Migrations: `supabase/migrations/001_initial_schema.sql` through `012_workspace_profile.sql`

**File Storage — Supabase Storage:**
- Bucket: `documents/`
- Path pattern: `documents/{timestamp}_{uuid}.pdf`
- Signed URL endpoint: `src/app/api/documents/[id]/url/route.ts`

**Caching:**
- In-process only: doctrine cache with 5-min TTL in `src/lib/doctrine.ts`
- `invalidateDoctrineCache()` for explicit invalidation
- No Redis / Memcached / distributed cache

## Authentication & Identity

**Supabase Auth (built-in):**
- Browser: JWT via `createBrowserClient()` with anon key
- Server: `supabaseAdmin` singleton with service role key (bypasses RLS)
- No OAuth providers (Google/GitHub/etc.) configured
- No middleware at `src/middleware.ts` — trust-based single-user assumption
- RLS policies in `supabase/migrations/003_rls_policies.sql` use `USING (true)` for authenticated users — single-tenant (flagged in CONCERNS.md)

## Monitoring & Observability

**Logging:**
- Custom structured logger — `src/lib/logger.ts`
- `createLogger(namespace)` factory returns `{ debug, info, warn, error }`
- Output: stderr, ISO timestamp + `[LEVEL] [namespace]` + message + JSON metadata
- `error()` auto-extracts `err.message` + first 5 stack lines
- Debug gated by `DOCUMIND_LOG_DEBUG=true`

**Audit trail:**
- Table: `audit_log` (Supabase)
- Writer: `logAudit(action, details, scores)` in `src/lib/audit.ts`
- Actions tracked: `query`, `document_access`, `upload`, `model_call`, `login`, `classification`, `extraction`, `project.*`

**Cost tracking:**
- `calculateCost()` in `src/lib/clients.ts` (per-model $/token rates)
- Computed ad-hoc; not aggregated, not alerted on (flagged in CONCERNS.md)

**External APM:**
- None (no Sentry, Datadog, OpenTelemetry)

## CI/CD & Deployment

**Hosting:**
- Vercel (implied by `.gitignore` excluding `.vercel/`, `/.next/`)
- Runs on standard Next.js runtime (Node 20+)

**CI Pipeline:**
- None detected — no `.github/workflows/`, GitLab CI, or CircleCI configs

**Scripts (`package.json`):**
- `npm run dev` — Next.js dev server
- `npm run build` — Production build
- `npm run start` — Start production server
- `npm run lint` — ESLint
- **No `test` script**

**Route timeouts:**
- `src/app/api/upload/route.ts` — `maxDuration = 300` (5 min for OCR)
- `src/app/api/chat/route.ts` — `maxDuration = 60` (1 min)

## Environment Configuration

**Development:**
- `.env.local` (gitignored); template at `.env.local.example`
- All API keys populated locally

**Staging:**
- Not detected

**Production:**
- Secrets assumed to live in Vercel environment variables
- Same env vars as dev; no per-env overrides detected

## Webhooks & Callbacks

**Incoming:**
- None detected — no `src/app/api/webhooks/` routes

**Outgoing:**
- None detected

**Async patterns in use:**
- Azure Document Intelligence — polled (not webhook-driven)
- Memory extraction + audit logging — fire-and-forget `.catch(console.error)` in `src/lib/chat-turn.ts` (flagged in CONCERNS.md)

## Encryption

- Algorithm: AES-256 via `crypto-js` ^4.2.0 (no authenticated encryption / no AEAD — flagged)
- Scope: PRIVATE documents only (classification === "PRIVATE"); PUBLIC / DOCTRINE stored plaintext
- Key: `ENCRYPTION_KEY` env var (no rotation / versioning support — flagged)
- Implementation: `src/lib/encryption.ts`

---

*Integration audit: 2026-04-07*
*Update when adding/removing external services*
