# Architecture

**Analysis Date:** 2026-04-07

## Pattern Overview

**Overall:** Monolithic Next.js 16 App Router application with server-first rendering, SSE streaming for chat, and a multi-model AI pipeline orchestrating bilingual (Arabic/English) document intelligence.

**Key Characteristics:**
- Server Components as default; Client Components only for interactive UI
- Server-side data fetching in layouts parallelized via `Promise.all`
- SSE streaming (`ReadableStream`) for chat turn responses (`src/app/api/chat/route.ts`)
- Route groups (`(workspace)`) organize authenticated UI without affecting URLs
- Single Next.js app containing UI, API, and business logic (no separate backend)
- Multi-model orchestration: GPT-5.4 (primary chat + router), Claude Opus 4.6 (deep analysis + tools), Cohere (embeddings/rerank), Azure DI (OCR fallback), Tavily (web search)
- Domain model: Documents → Chunks → Entities → Projects → Conversations → Memory → Artifacts
- Doctrine-driven analysis: pluggable analytical frameworks (master, legal, investment, governance, negotiation) loaded from DB
- Bilingual UI with direction-aware rendering (`dir="auto"`)
- "Fail Loud, Never Fake" philosophy (`CLAUDE.md`)

## Layers

**UI Layer** (`src/components/`, `src/app/(workspace)/*/page.tsx`):
- Purpose: Render interactive workspace, chat, document viewer, project tabs
- Contains: React Server Components (data-heavy layouts) + Client Components (interactive)
- Key files:
  - `src/components/chat-input.tsx`, `src/components/chat-message.tsx`
  - `src/components/project-sidebar.tsx`, `src/components/project-sidebar-shell.tsx`
  - `src/components/project-workspace-header.tsx`, `src/components/project-tabs.tsx`
  - `src/components/nav.tsx`, `src/components/pdf-viewer-context.tsx`
  - `src/components/create-project-dialog.tsx`, `src/components/link-document-dialog.tsx`
  - `src/components/ui/*` (shadcn primitives)
- Depends on: API routes (for mutations), Server Actions (`src/lib/actions/projects.ts`), React Context (`PdfViewerProvider`)

**API / Route Handler Layer** (`src/app/api/*/route.ts`):
- Purpose: Thin HTTP endpoints — validate input, delegate to `src/lib/` services, stream/return responses
- Pattern: `async function POST(req)` → validate → call lib service → emit SSE or JSON
- `maxDuration` set on long-running routes (upload: 300, chat: 60)
- Route map (see STRUCTURE.md for full list):
  - Chat: `src/app/api/chat/route.ts`, `src/app/api/chat/[id]/route.ts`, `src/app/api/chat/[id]/messages/route.ts`
  - Conversations: `src/app/api/conversations/route.ts` + `[id]/route.ts`
  - Documents: `src/app/api/documents/route.ts` + `[id]/{route,extraction,references,delete,url}/route.ts`
  - Upload & Librarian: `src/app/api/upload/route.ts`, `src/app/api/librarian/analyze/route.ts`
  - Projects: `src/app/api/projects/route.ts` + `[id]/{route,documents,entities,conversations,memory,artifacts,companies}/route.ts`
  - Memory: `src/app/api/memory/route.ts` + `[id]/route.ts`
  - Artifacts: `src/app/api/artifacts/route.ts` + `[id]/route.ts`
  - Doctrines: `src/app/api/doctrines/route.ts` + `[id]/route.ts`
  - Picker / Attachments / Workspace Profile: `src/app/api/picker/route.ts`, `src/app/api/attachments/route.ts`, `src/app/api/workspace-profile/route.ts`

**Service / Library Layer** (`src/lib/*.ts`):
- Purpose: Business logic, AI orchestration, document processing, data access
- No repository/DAO pattern — Supabase client calls inline in services
- Core orchestrators:
  - `src/lib/chat-turn.ts` (1000+ lines) — unified streaming chat logic
  - `src/lib/librarian.ts` — pre-upload intelligence agent
  - `src/lib/document-processing.ts` — extraction → chunking → embedding → entity linking → reference resolution
  - `src/lib/intelligence-router.ts` — routes casual/search/deep + selects doctrines (uses GPT-5.4)
  - `src/lib/claude-with-tools.ts` — Claude streaming with tool-use loop + GPT-5.4 fallback
  - `src/lib/doctrine.ts` — load + build doctrine prompts (5-min in-memory cache)

**Data Access Layer** (inline, via `src/lib/supabase.ts`):
- Two clients: browser `supabase` (anon key, RLS) and `supabaseAdmin` (service role, bypass RLS)
- Type safety via generated `src/lib/database.types.ts`
- No ORM; direct `.from(...).select(...)` calls inside services and route handlers
- **Known issue:** `supabaseAdmin` falls back to the literal string `"placeholder"` when `SUPABASE_SERVICE_ROLE_KEY` is missing — see CONCERNS.md

## Data Flow

### Flow 1 — Document Upload: Librarian → Extraction → Chunking → Embedding

1. User selects PDF at `src/app/(workspace)/upload/page.tsx`
2. Client `POST /api/librarian/analyze` — `src/app/api/librarian/analyze/route.ts` → `analyzeUpload()` in `src/lib/librarian.ts`:
   - Quick native PDF text extraction via `src/lib/pdf-text-extraction.ts`
   - Deterministic classification (`suggestClassification()`)
   - Entity extraction via `src/lib/entities.ts` (`findEntitiesInText()`)
   - Related-doc search via `hybridSearch()` in `src/lib/search.ts`
   - Project suggestion by entity overlap against `project_entities`
   - Returns `LibrarianProposal` (detected metadata, related docs, recommended action: new/version/duplicate/related)
3. UI displays proposal; user confirms action
4. Client `POST /api/upload` — `src/app/api/upload/route.ts`:
   - File validation (PDF, ≤50MB)
   - Upload to Supabase Storage (`documents/` bucket)
   - Insert `documents` row with `status: "processing"`
   - Calls `processDocumentContent()` in `src/lib/document-processing.ts` (awaited, blocking):
     - `extractDocumentV2()` in `src/lib/extraction-v2.ts` — native text lane first, Azure DI fallback (throws loudly if scanned and Azure not configured)
     - `chunkDocument()` in `src/lib/chunking.ts` — section-level chunks preserving page/clause metadata
     - `canonicalizeEntities()` in `src/lib/entities.ts` — dedupe + link
     - `generateEmbeddings()` in `src/lib/embeddings.ts` — batch Cohere embed
     - `detectReferences()` + `storeAndResolveReferences()` in `src/lib/references.ts`
     - Insert chunks + `document_entities` + `document_references`
   - Set `documents.status = "ready"`, `is_current = true`; mark prior version `is_current = false` if `versionOf` provided

### Flow 2 — Chat / Analyze Turn

1. Client sends message via `src/components/chat-input.tsx` → `useChat` hook (`src/lib/hooks/use-chat.ts`)
2. `POST /api/chat` (new conversation) or `POST /api/chat/[id]` (continue) — persists user message, opens SSE stream, calls `runChatTurn()` in `src/lib/chat-turn.ts`
3. `runChatTurn()` orchestrates:
   - **Routing:** `routeMessage()` in `src/lib/intelligence-router.ts` — GPT-5.4 decides `mode` (casual / search / deep), `shouldSearch`, `shouldWebSearch`, `doctrines[]`, `searchQuery`. Emits `{ type: "routing", ... }` SSE event.
   - **Retrieval:**
     - If `shouldSearch`: `hybridSearch()` in `src/lib/search.ts` (vector + FTS merge + Cohere rerank)
     - If `shouldWebSearch`: `webSearch()` in `src/lib/web-search.ts` (Tavily)
     - Pinned doc/entity resolution
     - Emits `{ type: "sources", ... }` SSE event
   - **Memory retrieval:** `retrieveRelevantMemories()` + `formatMemoriesForPrompt()` in `src/lib/memory.ts`
   - **System prompt build:**
     - If `mode === "deep"`: `buildDoctrinePrompt()` in `src/lib/doctrine.ts` merges master + specialized doctrines, appends analytical overrides
     - Prepends workspace profile from `src/lib/workspace-profile.ts`
   - **Stream:** `runClaudeWithTools()` in `src/lib/claude-with-tools.ts` — Claude Opus 4.6 with tool rounds (web_search, fetch_url, financial_model, extract_key_terms); falls back to GPT-5.4 if Anthropic unavailable. Streams `{ type: "text" }` tokens and `{ type: "tool", status }` events.
   - **Persist:** Insert assistant message to `messages` table with metadata (mode, doctrines, sources)
   - **Post-turn (fire-and-forget):** `extractMemories()` + `storeMemories()` in `src/lib/memory.ts`, `logAudit()` in `src/lib/audit.ts`
4. Client `useChat` consumes SSE stream, renders incrementally

### Flow 3 — Doctrine-Driven Deep Analysis

1. User types `/analyze ...` or router infers `mode: "deep"` from keywords
2. `intelligenceRouter` returns `doctrines: ["legal", "investment", ...]`
3. `buildDoctrinePrompt()` loads master + specialized doctrines from `doctrines` table (5-min cache), combines with analytical override section (NPV/IRR discipline, industry benchmarks, KNOW/INFER/ESTIMATE framing)
4. Enhanced retrieval: `hybridSearch()` + high-importance memories + recent conversation history
5. Claude streams analysis with autonomous tool use (financial_model for arithmetic, fetch_url for external context)
6. High-importance memories (importance ≥ 0.7) extracted and persisted with scope `project` or `shared`

**State Management:**
- Server: stateless between requests; all state in Postgres
- Client: React hooks (`useChat`, `usePdfViewer`) for transient UI state only
- PDF viewer shared via `PdfViewerProvider` Context across workspace

## Key Abstractions

**Document** (`src/lib/supabase.ts`, `src/lib/database.types.ts`):
- PDF metadata with classification (PRIVATE / PUBLIC / DOCTRINE), knowledge_scope, language (ar/en/mixed), versioning via `version_of` + `is_current`, status (pending/processing/ready/error), optional `encrypted_content` for PRIVATE

**Chunk** (`src/lib/chunking.ts`, `src/lib/extraction-v2.ts`):
- Section-level searchable unit with 1024-dim pgvector embedding; preserves table metadata and page/section/clause references

**Entity** (`src/lib/entities.ts`):
- Canonical named entity (company, ministry, project, person, authority) with Arabic + English variants (`name`, `name_en`); Levenshtein-based dedup; linked to documents via `document_entities` with a `role` field

**Doctrine** (`src/lib/doctrine.ts`):
- Bilingual analytical framework (`content_ar`, `content_en`, `version`) injected into system prompts; names: master, legal, investment, governance, negotiation; cached 5 min in-process

**Conversation + Message** (`src/app/api/conversations/`, `src/app/api/chat/`):
- Conversations have `mode`, `query`, `title`, and optional `project_id`; messages stored separately with role + attachments + metadata (routing, sources, doctrines)

**Memory Item** (`src/lib/memory.ts`):
- Durable workspace insight; `kind` ∈ {decision, fact, instruction, preference, risk, question}; `scope` ∈ {thread, project, shared, institution}; `importance` 0.0–1.0; linked entities for recall

**Project** (`src/lib/projects.ts`, `src/app/(workspace)/projects/[slug]/`):
- Workspace container linking documents, entities (participants), conversations, memory, artifacts; status (active/on_hold/closed/archived); slug-based routing with bilingual handling

**Artifact** (`src/app/api/artifacts/`, `src/lib/extraction-artifacts.ts`):
- Generated output (summary/matrix/table/memo/comparison/email/brief/deck/note) with citations and status (draft/review/final); scoped to conversation/project/entity

**Librarian** (`src/lib/librarian.ts`):
- Pre-upload intelligence agent returning `LibrarianProposal` (action: new/version/duplicate/related, confidence, related docs, suggested project, detected metadata)

**IntelligenceRouter** (`src/lib/intelligence-router.ts`):
- GPT-5.4-driven routing: `mode` (casual/search/deep), `shouldSearch`, `shouldWebSearch`, `doctrines[]`, `searchQuery`; handles explicit commands (`/search`, `/analyze`, `/web`) and implicit cues

**ChatTurn** (`src/lib/chat-turn.ts`):
- Transport-agnostic unified streaming orchestrator; emits events consumed by the SSE route handlers; hardcoded `PRIMARY_CHAT_MODEL = "gpt-5.4"` (flagged — move to `models.ts`)

## Entry Points

**Root HTML:** `src/app/layout.tsx` — fonts (DM Sans, IBM Plex Sans Arabic, JetBrains Mono), global CSS, metadata

**Workspace Shell:** `src/app/(workspace)/layout.tsx` — server component; parallel-fetches projects + recent conversations (limit 200); wraps in `PdfViewerProvider` + `ProjectSidebarShell` + `Nav`

**Workspace Home:** `src/app/(workspace)/page.tsx` — client component; chat landing, empty state, drag-drop upload, `useChat` hook

**Project Workspace:** `src/app/(workspace)/projects/[slug]/page.tsx` (server) → `workspace-client.tsx` (client tab router) → `_tabs/{brief,knowledge,threads,outputs,activity}.tsx` (tabs kept mounted via CSS `hidden`)

**Middleware:** None — `src/middleware.ts` not present

**Error Boundaries:**
- `src/app/error.tsx` (global)
- `src/app/(workspace)/error.tsx` (workspace)
- `src/app/(workspace)/projects/[slug]/not-found.tsx` (missing project)

## Error Handling

**Strategy:** "Fail Loud, Never Fake" (per `CLAUDE.md`):
1. Works correctly with real data
2. Falls back visibly (banner, annotation, logged warning)
3. Fails with clear error message
4. **Never** silently degrades to look "fine"

**Patterns:**
- Route handlers return `NextResponse.json({ error: "..." }, { status: 4xx/5xx })`
- Server actions return result tuples: `{ ok: boolean; error?: string; ... }` — `src/lib/actions/projects.ts`
- Type guards at input boundaries (e.g., `DOCUMENT_TYPES.includes(value as DocumentType)`)
- SSE errors emitted as `{ type: "error", message }` events
- Structured errors logged via `src/lib/logger.ts` (auto-captures stack)
- Extraction throws loudly if Azure is unconfigured for scanned PDFs (no silent fake text)
- Tavily throws if key missing rather than returning empty results
- Doctrine load throws on DB failure (critical to deep mode)

**Known violations** (see CONCERNS.md):
- Memory extraction + audit logging use fire-and-forget `.catch(console.error)` in `src/lib/chat-turn.ts`
- `supabaseAdmin` falls back to string `"placeholder"` if env var missing — cryptic downstream errors
- Some client-side fetches use `.catch(() => {})` (e.g., `src/app/(workspace)/page.tsx` doc load on mount)
- `workspace-profile.ts` returns `null` on error without disclosing degraded mode to caller
- `Promise.all` vs `Promise.allSettled` inconsistency between `src/lib/chat-turn.ts` and `src/lib/librarian.ts`

## Cross-Cutting Concerns

**Logging:**
- Custom structured logger in `src/lib/logger.ts` — namespaced, stderr-only, ISO timestamps + JSON metadata
- `createLogger(namespace)` per-module; levels debug/info/warn/error
- Audit trail writes to `audit_log` table via `src/lib/audit.ts` (`logAudit(action, details, scores)`)

**Validation:**
- Manual type guards and array normalization in route handlers (no Zod/Valibot)
- `src/lib/extraction-validation.ts` validates extracted structure (page completeness, section validity, repetition detection, language consistency) — returns `issues[]` with severity levels
- Supabase constraints enforce DB-level invariants
- **Weak:** No file magic-byte validation on upload (only extension + size) — flagged

**Authentication / Authorization:**
- Supabase Auth (JWT); RLS currently single-tenant (`USING (true)`) in `supabase/migrations/003_rls_policies.sql`
- Server routes bypass RLS via `supabaseAdmin`; no ownership checks in update endpoints
- No middleware, no rate limiting

**Caching:**
- Doctrine cache: 5-min in-memory TTL in `src/lib/doctrine.ts` (`invalidateDoctrineCache()` for manual invalidation)
- Embeddings persisted in `chunks.embedding`; no recomputation
- No Redis, no distributed cache — cache is per-process only (flagged for multi-instance deployments)

**Normalization:**
- Arabic diacritic/number/Unicode folding in `src/lib/normalize.ts`
- OCR output normalization in `src/lib/ocr-normalization.ts`
- Entity canonicalization in `src/lib/entities.ts` (dedupe via similarity threshold 0.82 — hardcoded)

**Encryption:**
- `src/lib/encryption.ts` uses `crypto-js` AES-256 for PRIVATE documents at rest
- No AEAD/HMAC, no key rotation, no key versioning — flagged in CONCERNS.md

---

*Architecture analysis: 2026-04-07*
*Update when major patterns change*
