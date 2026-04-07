# Architecture

**Analysis Date:** 2026-04-06

## Pattern Overview

**Overall:** Next.js 16 App Router monolith — thin API routes delegating to thick business-logic helpers in `src/lib/`.

**Key Characteristics:**
- Server-side API routes stream SSE to a single-page client chat UI
- Client-heavy pages (chat, upload, documents) with `"use client"` directives; root layout is RSC
- Single-user system — no auth, no tenant isolation
- "Fail Loud, Never Fake" error philosophy (`CLAUDE.md`) — partially enforced (see `CONCERNS.md`)
- Multi-LLM orchestration: GPT-4o-mini routes → GPT-4o (extraction/casual) or Claude Opus (deep with tools)
- Pipeline-free: agentic chat replaces earlier multi-stage pipeline design

## Layers

**API Routes (`src/app/api/`):**
- Purpose: HTTP entry points — parse, validate, delegate
- Pattern: thin handlers that import from `src/lib/` — the real work happens in helpers
- Example: `src/app/api/chat/route.ts` (136 lines) → delegates to `runChatTurn()` in `src/lib/chat-turn.ts`

**Core Business Logic (`src/lib/`):**
- Purpose: reusable business logic, LLM orchestration, data access
- Pattern: named exports, singleton clients, transport-agnostic helpers
- Used by: API routes (primarily) and a few server components

**Components (`src/components/`):**
- Purpose: React UI — chat surface, navigation, shadcn primitives
- Pattern: client components with `"use client"`, imperative handles for chat input
- Used by: App Router pages in `src/app/`

**Database (Supabase):**
- Purpose: PostgreSQL with pgvector for hybrid search + Supabase Storage for PDFs
- Accessed via `src/lib/supabase.ts` (admin client for writes, browser for reads)

## Data Flow

### Deep-Mode Chat Turn

1. **Entry** — User posts message + optional attachments/pinned items to `POST /api/chat` (new) or `POST /api/chat/[id]` (continue)
2. **Delegate** — Route handler calls `runChatTurn(args, emit)` in `src/lib/chat-turn.ts`
3. **Route** — `routeMessage()` in `src/lib/intelligence-router.ts` (GPT-4o-mini JSON) → mode (casual/deep/search), doctrines, `shouldSearch`, `shouldWebSearch`
4. **Retrieval (parallel)**:
   - Pinned entities → name-based `hybridSearch()` + entity link resolution
   - Pinned documents → fetch ALL chunks (user was explicit)
   - Mentioned entities → auto-detect via `findEntitiesInText()`, restrict retrieval
   - Document search → `hybridSearch()` (vector + FTS, optional Cohere rerank)
   - Cross-conversation memory → `retrieveRelevantMemories()` from `src/lib/memory.ts`
5. **Evidence assembly** — Priority: pinned first (with `[PINNED-N]` citations), then search docs, then ephemeral attachments, then web
6. **Prompt build**:
   - Deep mode → `buildDoctrinePrompt()` from `src/lib/doctrine.ts` (master + specialized doctrines from DB, 5-min cached, code-controlled OUTPUT GUIDE)
   - Casual/search → inlined system prompt with language rules + doc inventory
7. **LLM call**:
   - Deep + Anthropic available → `runClaudeWithTools()` in `src/lib/claude-with-tools.ts` — Claude Opus streams, loops on `tool_use` blocks for Tavily web search, max 6 rounds, forced final-text fallback
   - Fallback → GPT-4o streaming (no tools)
   - Casual → GPT-4o-mini streaming
8. **Stream to UI** — SSE events: `session` → `routing` → `sources` → `tool` → `text` (deltas) → `done` | `error`
9. **Persistence** — Save assistant message with `mode`/`doctrines`/`model`/`sources`, fire-and-forget memory extraction via `.catch(console.error)`

### Document Upload

1. **Pre-analysis** — `POST /api/librarian/analyze`
   - `pdf-parse` first-page text → GPT-4o-mini classification + entity extraction
   - Optional Cohere embedding of first 2000 chars
   - `hybridSearch()` against KB → 3–5 related docs
   - Similarity scoring → action recommendation (`new` / `version` / `duplicate` / `related`)
   - Return `LibrarianProposal` for user confirmation
2. **Full pipeline** — `POST /api/upload` after user confirms
   - Supabase Storage upload → `file_url`
   - Create `documents` row (`status: processing`)
   - `extractDocument()` in `src/lib/extraction.ts`: render pages → classify → parallel batch extract (5 pages/batch) → Arabic correction → validation
   - `chunkDocument()` in `src/lib/chunking.ts`: clause-level, ≤2000 chars, in-section overlap, merge tiny tails
   - Cohere embeddings (batched)
   - AES encrypt if classification is PRIVATE
   - Insert chunks (50/batch)
   - Entity canonicalization via `src/lib/entities.ts` (bilingual fuzzy match, ≥0.82 similarity)
   - Reference detection/resolution via `src/lib/references.ts`
   - Version handling — if `versionOf` set, mark old doc `is_current=false`, bump `version_number`
   - Update `documents.status = ready`

## Key Abstractions

**`runChatTurn(args, emit)`** — `src/lib/chat-turn.ts` (576 lines)
- Unified streaming chat orchestrator
- Transport-agnostic: caller provides `emit(type, payload)` callback
- Used by both `/api/chat/route.ts` and `/api/chat/[id]/route.ts`
- Handles: routing, retrieval, evidence assembly, prompt construction, LLM call, streaming, persistence, memory extraction
- ⚠ Now the longest "smart" file in the codebase (post phase-02 consolidation) — candidate for splitting

**`buildDoctrinePrompt(names, language)`** — `src/lib/doctrine.ts`
- Loads master + named specialized doctrines from DB (5-min cache)
- Prepends code-controlled OUTPUT GUIDE (overrides any rigid templates in DB doctrine bodies)
- Injects language-specific rules (Arabic-Indic digits, currency conventions)

**`analyzeUpload(buffer, fileName)`** — `src/lib/librarian.ts`
- Fast pre-upload analysis (no full extraction)
- Returns `LibrarianProposal` with classification, entities, related docs, recommended action

**`canonicalizeEntities(candidates)`** — `src/lib/entities.ts`
- Bilingual fuzzy matching (AR diacritics + letter variants + suffixes normalized)
- Similarity ≥0.82 → collapse to existing canonical row
- Returns canonical entity IDs

**`hybridSearch(options)`** — `src/lib/search.ts`
- Vector + FTS via `hybrid_search` RPC
- Optional Cohere rerank (silent fallback to original order on failure)
- `is_current=true` filter by default
- Supports entity-scoped and doc-id-restricted queries

**`runClaudeWithTools(opts)`** — `src/lib/claude-with-tools.ts`
- Claude Opus streaming with autonomous `web_search` tool loop
- Max 6 rounds, forces final text-only answer if tool rounds exhausted
- Emits `onToolStart`/`onToolEnd` for UI status indicators
- Returns final text + discovered web sources

## Entry Points

**HTTP API** (`src/app/api/*/route.ts`):
- Chat: `/api/chat`, `/api/chat/[id]`, `/api/chat/[id]/messages`
- Conversations: `/api/conversations`, `/api/conversations/[id]`
- Documents: `/api/documents`, `/api/documents/[id]` (+ `/delete`, `/url`, `/extraction`, `/references`)
- Doctrines: `/api/doctrines`, `/api/doctrines/[id]`
- Upload: `/api/upload`, `/api/librarian/analyze`
- Picker: `/api/picker` (unified @ mention search)
- Attachments: `/api/attachments`

**UI Pages** (`src/app/`):
- `/` → `page.tsx` — main chat surface (client component, SSE consumer)
- `/upload` — librarian proposal + upload
- `/documents`, `/documents/[id]` — document browser/detail
- `/doctrines` — doctrine management
- `layout.tsx` — root RSC layout with fonts + metadata

## Error Handling

**Stated philosophy** (`CLAUDE.md`): Fail Loud, Never Fake.

**Observed patterns:**
- Request validation at route entry (manual type checks, `Array.isArray`, `.filter()`)
- Named error states in HTTP responses (`{ error: "..." }` + appropriate status)
- Streaming errors emitted as SSE `error` event
- Fallback chains (Claude → GPT-4o on failure)
- Fire-and-forget background tasks use `.catch(console.error)`
- Status fields on documents (`pending`/`processing`/`ready`/`error`) with `processing_error` truncated to 500 chars

**⚠ Known violations of fail-loud** (see `CONCERNS.md`):
- Tavily returns `[]` silently on missing key
- Intelligence router silently defaults to `casual` on JSON parse failure
- Memory extraction returns `[]` on error (user unaware)
- Cohere rerank silently falls back to original ordering
- Librarian embedding silently optional

## Cross-Cutting Concerns

**Logging:**
- `console.error` only — no structured logger
- `logAudit()` exists in `src/lib/audit.ts` but only called from upload route

**Validation:**
- Manual type checks at route boundaries — no Zod or schema library
- Extraction pipeline has internal validation (clause structure, orphaned items, duplicates)
- Supabase types auto-generated to `src/lib/database.types.ts`

**Bilingualism (AR/EN):**
- Per-page language detection during extraction
- Language-specific prompt rules (Arabic-Indic digits on output, Western digits in storage)
- Bilingual entity canonicalization with diacritic/letter-variant normalization
- Responses adapt to message language

**Cost tracking:**
- Per-call cost calculation in `src/lib/clients.ts` (`calculateCost`)
- Captured in audit log for upload only; chat turns not yet tracked

**Versioning:**
- Documents carry `version_of`/`supersedes`/`version_number`/`is_current`
- Default queries exclude non-current versions

**Authentication:**
- None (single user) — Supabase RLS exists but not exercised

---

*Architecture analysis: 2026-04-06*
*Update when major patterns change*
