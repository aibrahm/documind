# External Integrations

**Analysis Date:** 2026-04-06

## APIs & External Services

**LLM — Deep Analysis (Claude):**
- **Anthropic** — Claude Opus 4.6 for deep-mode chat with autonomous `web_search` tool
  - SDK: `@anthropic-ai/sdk` ^0.80.0
  - Auth: `ANTHROPIC_API_KEY` env var
  - Used in: `src/lib/clients.ts`, `src/lib/claude-with-tools.ts`
  - Pattern: streaming with tool-use loop (max 6 rounds), forced final-answer fallback
  - Cost model (tracked in `src/lib/clients.ts`): $3/1M input, $15/1M output

**LLM — Routing / Extraction / Vision (OpenAI):**
- **OpenAI** — GPT-4o (vision/extraction) + GPT-4o-mini (routing, librarian, memory)
  - SDK: `openai` ^6.33.0
  - Auth: `OPENAI_API_KEY` env var
  - Used in: `src/lib/clients.ts`, `src/lib/extraction.ts` (GPT-4o vision on PDF page PNGs), `src/lib/intelligence-router.ts` (GPT-4o-mini JSON routing), `src/lib/librarian.ts`, `src/lib/memory.ts`
  - Cost model: GPT-4o $2.5/$10 per 1M, GPT-4o-mini $0.15/$0.60 per 1M

**Embeddings & Rerank (Cohere):**
- **Cohere** — `embed-multilingual-v3.0` (1024-dim) + rerank
  - SDK: `cohere-ai` ^7.21.0
  - Auth: `COHERE_API_KEY` env var
  - Used in: `src/lib/embeddings.ts`, `src/lib/search.ts`
  - Pattern: `search_document` input type on ingest, `search_query` on query side
  - ⚠ Reranking silently falls back to original order on failure (`src/lib/search.ts` ~131)

**Web Search (Tavily):**
- **Tavily** — Autonomous web search via Claude tool use (deep mode) or router decision (casual mode)
  - Integration: native fetch (no SDK) — `src/lib/web-search.ts`
  - Auth: `TAVILY_API_KEY` env var
  - ⚠ Silently returns `[]` if key is missing (fail-loud violation — see `CONCERNS.md`)

## Data Storage

**Database:**
- **Supabase PostgreSQL** + `pgvector` extension
  - SDK: `@supabase/supabase-js` ^2.100.1
  - Client: `src/lib/supabase.ts` (admin + browser clients, lazy init)
  - Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
  - Hybrid search RPC: `hybrid_search` (vector + FTS, 0.7 vector / 0.3 FTS default weights)
  - RLS enabled; authenticated reads, service-role writes (single user)

**Schema Tables (migrations 001–007):**
- `documents` — metadata, versioning (`version_of`, `supersedes`, `version_number`, `is_current`), classification (PRIVATE/PUBLIC/DOCTRINE), `encrypted_content` bytea for PRIVATE docs
- `chunks` — text + 1024-dim embedding + page/clause tracking, indexed for hybrid search
- `entities` — bilingual canonical entities (name, name_en, type)
- `document_entities` — link table with roles (party_a, party_b, regulator, developer, investor)
- `document_references` — detected cross-document references (laws, articles), `resolved` boolean
- `doctrines` — 5 doctrines (master, legal, investment, negotiation, governance) in AR + EN
- `conversations` — chat sessions
- `messages` — individual turns (user/assistant/system)
- `knowledge` — cross-conversation durable memories (decision/fact/recommendation/concern/preference)
- `audit_log` — action + cost tracking (⚠ underwritten — see `CONCERNS.md`)

**Migrations:**
- `supabase/migrations/001_initial_schema.sql` — core documents + chunks + hybrid search
- `supabase/migrations/002_fix_hybrid_search.sql` — RPC fix
- `supabase/migrations/003_rls_policies.sql`
- `supabase/migrations/004_conversations.sql`
- `supabase/migrations/005_knowledge_system.sql`
- `supabase/migrations/006_messages.sql`
- `supabase/migrations/007_conversation_memory.sql`
- ⚠ No 008 yet — Phase 03 will add projects schema

**File Storage:**
- Supabase Storage bucket `documents` — original PDFs
  - Path: `documents/{timestamp}_{uuid}.pdf`
  - Size limit: 50MB (enforced in `src/app/api/upload/route.ts`)
  - No retention/cleanup policy configured

**Encryption:**
- AES-256 via `crypto-js` — PRIVATE classification documents only
- Key: `ENCRYPTION_KEY` env var (hard-required, no fallback)
- Implementation: `src/lib/encryption.ts`
- Stored in: `documents.encrypted_content`

**Caching:**
- In-memory 5-min cache for doctrines (`src/lib/doctrine.ts`)
- No Redis or external cache layer

## Authentication

**Current state:** Single-user system (GTEZ Vice Chairman) — no auth enforcement in routes.
- Supabase RLS policies exist (`003_rls_policies.sql`) expecting "authenticated" role
- Service-role key used server-side for all writes
- Browser client instantiated but largely unused
- No login UI, no session management

## Monitoring & Observability

- **Error tracking:** Not detected (no Sentry, LogRocket, etc.)
- **Analytics:** Not detected
- **Logs:** `console.error` only (no structured logger) — see `CONCERNS.md`
- **Cost tracking:** Per-call cost calculation in `src/lib/clients.ts`, logged via `src/lib/audit.ts` (but audit logging is sparse — only upload route calls it)

## CI/CD & Deployment

- **Hosting:** Not configured — intended target appears to be Vercel
- **CI:** Not detected (no `.github/workflows/`)
- **Manual sharing:** ngrok tunnel (per `STATE.md`) for showing progress to the VC

## Environment Configuration

**Required env vars (all hard-required):**
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
OPENAI_API_KEY
ANTHROPIC_API_KEY
COHERE_API_KEY
TAVILY_API_KEY
ENCRYPTION_KEY
```

**Secrets location:** `.env.local` (gitignored). Template at `.env.local.example`.

**⚠ No startup validation** — missing keys fail at first call site. See `CONCERNS.md` for recommendation.

## Webhooks

- **Incoming:** None
- **Outgoing:** None

---

*Integration audit: 2026-04-06*
*Update when adding/removing external services*
