# Codebase Structure

**Analysis Date:** 2026-04-06

## Directory Layout

```
gtez-intelligence/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── api/                      # API routes (thin wrappers)
│   │   │   ├── attachments/
│   │   │   ├── chat/                 # Chat turns (new + continue)
│   │   │   ├── conversations/        # Conversation CRUD
│   │   │   ├── doctrines/
│   │   │   ├── documents/
│   │   │   ├── librarian/analyze/
│   │   │   ├── picker/
│   │   │   └── upload/
│   │   ├── doctrines/                # Doctrine management page
│   │   ├── documents/                # Document browser + detail
│   │   ├── upload/                   # Upload page (librarian proposal UI)
│   │   ├── viewer/                   # ⚠ Empty dead folder
│   │   ├── layout.tsx                # Root RSC layout
│   │   ├── page.tsx                  # Main chat surface (client, ~1600 lines)
│   │   └── globals.css
│   ├── components/                   # React components
│   │   ├── chat-input.tsx            # Message input + @ picker + attachments
│   │   ├── chat-message.tsx          # Message rendering
│   │   ├── chat-sidebar.tsx          # Conversation list
│   │   ├── nav.tsx
│   │   ├── ui-system.tsx             # Custom primitives
│   │   └── ui/                       # shadcn primitives
│   └── lib/                          # Core business logic
├── supabase/
│   └── migrations/                   # 001 through 007
├── .planning/                        # GSD planning (roadmap, phases, codebase map)
├── public/                           # Static assets
├── design-system/                    # Stitch design system exports
├── CLAUDE.md                         # Error handling philosophy
├── AGENTS.md                         # Next.js 16 warning
├── package.json                      # pnpm
├── pnpm-lock.yaml
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs
├── eslint.config.mjs
├── components.json                   # shadcn config
└── .env.local                        # Secrets (gitignored)
```

## Directory Purposes

**`src/app/`** — Next.js App Router. Pages + API routes. Routes are thin; logic lives in `src/lib/`.

**`src/app/api/`** — HTTP endpoints. Pattern: parse request → delegate to `src/lib/*` → return JSON or stream SSE.

**`src/components/`** — React UI. Mix of custom chat components (`chat-*.tsx`), navigation (`nav.tsx`), custom primitives (`ui-system.tsx`), and shadcn primitives in `ui/`.

**`src/lib/`** — Core business logic. Everything non-trivial lives here. See file-by-file listing below.

**`supabase/migrations/`** — SQL migrations, numbered sequentially (not tied to phase numbers).

**`.planning/`** — GSD (Get-Shit-Done) project management: ROADMAP.md, STATE.md, phase PLAN.md files, and this codebase map.

**`design-system/`** — Stitch design system exports (consumed by components).

**`public/`** — Static assets.

## Full `src/lib/*.ts` Listing

| File | Purpose |
|------|---------|
| `audit.ts` | Lightweight audit logging (⚠ only called from upload route) |
| `chat-turn.ts` | **Main orchestrator** — unified chat turn logic for new + continuation (576 lines) |
| `chunking.ts` | Clause-level chunking, max 2000 chars, in-section overlap, tiny-tail merging |
| `claude-with-tools.ts` | Claude Opus streaming with autonomous `web_search` tool loop + forced-final-answer fallback |
| `clients.ts` | Singleton API clients (OpenAI, Anthropic, Cohere) + `calculateCost()` + `hasAnthropic()` |
| `database.types.ts` | Supabase-generated type-safe schema |
| `doctrine.ts` | Load doctrines from DB (5-min cache), `buildDoctrinePrompt()` with code-controlled OUTPUT GUIDE |
| `embeddings.ts` | Cohere multilingual embeddings (1024-dim, `search_document` vs `search_query` input types) |
| `encryption.ts` | AES-256 via `crypto-js` for PRIVATE classification documents |
| `entities.ts` | Bilingual fuzzy entity canonicalization (≥0.82 threshold) |
| `extraction.ts` | Full GPT-4o vision pipeline: classify → extract → Arabic correction → validate |
| `intelligence-router.ts` | GPT-4o-mini JSON routing — mode selection, search strategy, doctrine choice |
| `librarian.ts` | Pre-upload quick analysis → `LibrarianProposal` (new/version/duplicate/related) |
| `memory.ts` | Cross-conversation memory: extract, store, retrieve, format-for-prompt |
| `normalize.ts` | Arabic-Indic digit normalization, number/date correction |
| `references.ts` | Detect + resolve cross-document references (laws, articles, decrees) |
| `search.ts` | `hybridSearch()` — vector + FTS + optional Cohere rerank, `is_current` filter |
| `supabase.ts` | Lazy admin/browser clients + table interface definitions |
| `types.ts` | Shared UI types: `Source` (document \| web), `AttachmentMeta`, `PinnedItem` |
| `utils.ts` | Tailwind `cn()` helper |
| `web-search.ts` | Tavily integration (fetch-based, no SDK) |

## Full `src/app/api/*/route.ts` Listing

| Endpoint | Method(s) | Purpose |
|----------|-----------|---------|
| `/api/chat` | POST | Create conversation + run first turn (SSE stream) |
| `/api/chat/[id]` | POST | Continue existing conversation |
| `/api/chat/[id]/messages` | GET | Retrieve message history for replay |
| `/api/conversations` | GET, POST | List / create conversations |
| `/api/conversations/[id]` | PATCH, DELETE | Rename / delete |
| `/api/documents` | GET | List documents (filters, excludes old versions by default) |
| `/api/documents/[id]` | GET, PATCH | Get / rename document |
| `/api/documents/[id]/delete` | DELETE | Soft-delete |
| `/api/documents/[id]/url` | GET | Signed storage URL for PDF viewer |
| `/api/documents/[id]/extraction` | POST | Re-run extraction (debug) |
| `/api/documents/[id]/references` | GET | Fetch cross-document references |
| `/api/doctrines` | GET | List active doctrines |
| `/api/doctrines/[id]` | GET | Full doctrine content (AR + EN) |
| `/api/librarian/analyze` | POST | Pre-upload proposal (no full extraction) |
| `/api/upload` | POST | Full pipeline: extract → chunk → embed → store → canonicalize |
| `/api/picker` | GET | Unified @ mention picker (docs + entities) |
| `/api/attachments` | POST | Ephemeral attachment handling |

## Naming Conventions

**Files:**
- `kebab-case.ts` / `kebab-case.tsx` for all source files (both lib and components)
- `route.ts` for API route handlers (Next.js convention)
- `page.tsx` / `layout.tsx` for App Router files
- shadcn primitives use their own kebab-case names: `button.tsx`, `dialog.tsx`, etc.

**Code:**
- `camelCase` for functions, variables, object keys
- `PascalCase` for React components, TS interfaces, type aliases
- `SCREAMING_SNAKE_CASE` for module-level constants (`MAX_CHUNK_CHARS`, `SIMILARITY_THRESHOLD`)
- `_privateName` prefix for module-level singletons (`_openai`, `_cohere`, `_admin`)

**Database:**
- `snake_case` table and column names (`document_id`, `is_current`, `chunk_index`)
- Classification enum values UPPER_CASE (`PRIVATE`, `PUBLIC`, `DOCTRINE`)
- Type discriminators lowercase string literals (`"document"`, `"web"`, `"user"`)

**Events / Callbacks:**
- `on*` prefix for React props (`onSend`, `onSourceClick`, `onToggle`)
- SSE event types are lowercase strings: `session`, `routing`, `sources`, `tool`, `text`, `done`, `error`

## Where to Add New Code

**New API endpoint:** `src/app/api/[feature]/route.ts` → delegate to helper in `src/lib/[feature].ts`.

**New chat behavior (routing, retrieval, prompt):** Modify `src/lib/chat-turn.ts` or add a new helper in `src/lib/*` and call from `chat-turn.ts`.

**New UI component:** `src/components/[feature].tsx` as `"use client"`, compose from `src/components/ui/*`.

**New DB schema:** Create `supabase/migrations/00X_[feature].sql`, apply, then regenerate `src/lib/database.types.ts`. Phase 03 will add migration `008_projects.sql`.

**New doctrine / analytical rule:** Update the DB `doctrines` table — **do not hardcode in code**. Loaded via `buildDoctrinePrompt()`.

**New extraction / chunking behavior:** `src/lib/extraction.ts` or `src/lib/chunking.ts`.

**New entity / reference logic:** `src/lib/entities.ts` or `src/lib/references.ts`.

**New memory behavior:** `src/lib/memory.ts`.

## Special / Dead Directories

**`src/app/viewer/`** — Empty directory. Never implemented. Safe to delete.

**`scripts/`, `pipeline/`** — Removed during phase 02 cleanup. No longer present.

---

*Structure analysis: 2026-04-06*
*Update when directory structure changes*
