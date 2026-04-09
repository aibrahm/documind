# Codebase Structure

**Analysis Date:** 2026-04-07

## Directory Layout

```
gtez-intelligence/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── layout.tsx                # Root HTML layout (fonts, globals)
│   │   ├── error.tsx                 # Global error boundary
│   │   ├── globals.css               # Tailwind + custom styles
│   │   ├── (workspace)/              # Route group: authenticated region
│   │   │   ├── layout.tsx            # Workspace shell: parallel-fetch projects + convos
│   │   │   ├── error.tsx             # Workspace error boundary
│   │   │   ├── page.tsx              # Chat landing page
│   │   │   ├── upload/               # Document upload + librarian proposal review
│   │   │   ├── documents/            # Document list + [id]/ detail view
│   │   │   ├── doctrines/            # Doctrine browser
│   │   │   ├── settings/             # Workspace settings
│   │   │   └── projects/[slug]/      # Project workspace
│   │   │       ├── page.tsx          # Server: fetch project + participants
│   │   │       ├── workspace-client.tsx  # Client: tab state container
│   │   │       ├── not-found.tsx
│   │   │       └── _tabs/            # brief, knowledge, threads, outputs, activity
│   │   └── api/                      # HTTP + SSE endpoints (see below)
│   ├── components/                   # Shared React components
│   │   ├── ui/                       # shadcn primitives
│   │   └── *.tsx                     # chat, sidebar, dialogs, headers, pdf viewer
│   └── lib/                          # Business logic + services
│       ├── actions/                  # Server actions ("use server")
│       ├── hooks/                    # React hooks (use-chat.ts)
│       ├── tools/                    # Claude tool definitions
│       └── *.ts                      # Orchestration, extraction, search, memory, etc.
├── supabase/
│   ├── migrations/                   # 001_initial_schema → 012_workspace_profile
│   └── reset_workspace.sql
├── public/                           # Static assets
├── design-system/                    # Stitch design tokens
├── .planning/
│   └── codebase/                     # This map (STACK, ARCHITECTURE, etc.)
├── package.json
├── pnpm-lock.yaml
├── next.config.ts
├── tsconfig.json
├── components.json                   # shadcn registry
├── eslint.config.mjs
├── postcss.config.mjs
├── .env.local.example
├── CLAUDE.md                         # "Fail Loud, Never Fake" philosophy
├── AGENTS.md                         # Next.js 16 breaking-changes notice
└── README.md
```

## Directory Purposes

**`src/app/` — Next.js App Router**
- Purpose: Routing (pages + layouts), HTTP endpoints, error boundaries
- Contains: `layout.tsx`, `page.tsx`, `error.tsx`, route group `(workspace)`, dynamic routes `[id]` / `[slug]`, API routes `api/*/route.ts`
- Key entry: `src/app/layout.tsx` (root), `src/app/(workspace)/layout.tsx` (workspace shell)

**`src/app/(workspace)/` — Authenticated route group**
- Purpose: All UI pages that share the workspace sidebar + PDF viewer provider
- Note: Parentheses hide the group from the URL (no `/workspace/` prefix)
- Contains: chat home, projects, documents, doctrines, upload, settings
- Layout fetches projects + recent conversations (limit 200) in parallel via `Promise.all`

**`src/app/(workspace)/projects/[slug]/` — Project workspace**
- `page.tsx` — async server component, fetches project + participants
- `workspace-client.tsx` — client component, holds tab state and chat state
- `_tabs/` — tab views rendered inside the client; all stay mounted via CSS `hidden`
  - `brief.tsx` — project context + memory
  - `knowledge.tsx` — linked documents + entities
  - `threads.tsx` — project conversations
  - `outputs.tsx` — generated artifacts
  - `activity.tsx` — activity log
- `not-found.tsx` — 404 for missing project

**`src/app/api/` — HTTP + SSE endpoints**
- Purpose: Thin wrappers over `src/lib/` services
- Route files are named `route.ts` (never `route.tsx`)
- Long-running routes set `export const maxDuration = 60..300`
- Key endpoints:
  - `api/chat/route.ts` — POST: new conversation (SSE stream)
  - `api/chat/[id]/route.ts` — POST: continue conversation (SSE stream)
  - `api/chat/[id]/messages/route.ts` — GET: message history
  - `api/conversations/route.ts` + `[id]/route.ts` — list/detail/update
  - `api/documents/route.ts` — GET list (filterable by classification/type)
  - `api/documents/[id]/{route,extraction,references,delete,url}/route.ts`
  - `api/upload/route.ts` — POST: full extraction pipeline (`maxDuration = 300`)
  - `api/librarian/analyze/route.ts` — POST: quick pre-upload proposal
  - `api/projects/route.ts` + `[id]/{route,documents,entities,conversations,memory,artifacts,companies}/route.ts`
  - `api/memory/route.ts` + `[id]/route.ts` — save / delete memory items
  - `api/artifacts/route.ts` + `[id]/route.ts` — CRUD
  - `api/doctrines/route.ts` + `[id]/route.ts` — list / detail
  - `api/picker/route.ts` — entity/document picker for @-mentions
  - `api/attachments/route.ts` — ephemeral chat attachments
  - `api/workspace-profile/route.ts` — workspace inventory summary

**`src/components/` — React components**
- Purpose: Reusable UI — chat input/message, sidebar, project header/tabs, dialogs, PDF viewer context
- Contains: Top-level components (kebab-case) + `ui/` shadcn primitives
- `"use client"` directive on interactive components

**`src/lib/` — Business logic**
- Purpose: Orchestration, LLM calls, document extraction, search, memory, entities, projects
- No repository layer — Supabase calls are inline
- Subdirs:
  - `actions/` — server actions (`projects.ts`)
  - `hooks/` — React hooks (`use-chat.ts`)
  - `tools/` — Claude tool definitions (`fetch-url.ts`, `financial-model.ts`, `extract-key-terms.ts`)

**`supabase/migrations/`**
- Purpose: Versioned SQL schema changes, RLS policies, RPC definitions
- Files: `001_initial_schema.sql` → `012_workspace_profile.sql`
- Key RPC: `hybrid_search` (`002_fix_hybrid_search.sql`)
- RLS: `003_rls_policies.sql` (single-tenant `USING (true)` — flagged)
- `reset_workspace.sql` — local dev reset script

**`design-system/`**
- Purpose: Stitch-generated visual design tokens (colors, fonts, shapes, spacing)

**`public/`**
- Purpose: Static assets served at the root URL

**`.planning/codebase/`**
- Purpose: GSD workflow artifacts — this codebase map
- Not source code; project management only

## Key File Locations

**Entry Points:**
- `src/app/layout.tsx` — Root HTML layout, fonts, metadata
- `src/app/(workspace)/layout.tsx` — Workspace shell (server component, parallel fetch)
- `src/app/(workspace)/page.tsx` — Chat landing page (client component)
- `src/app/(workspace)/projects/[slug]/page.tsx` + `workspace-client.tsx` — Project workspace

**Configuration:**
- `package.json` — Dependencies, scripts (`dev`, `build`, `start`, `lint`) — no `test`
- `next.config.ts` — `serverExternalPackages` for `canvas`, `pdfjs-dist`, `pdf-to-img`
- `tsconfig.json` — Strict mode, `@/*` → `./src/*`, ES2017, `bundler` resolution
- `eslint.config.mjs` — ESLint 9 flat config with `eslint-config-next` core-web-vitals + TypeScript
- `components.json` — shadcn/ui registry (`base-nova` style)
- `postcss.config.mjs` — Tailwind CSS 4
- `.env.local.example` — Environment variable template

**Core Logic (`src/lib/`):**
- `chat-turn.ts` — Unified streaming chat orchestration (routing → retrieval → prompt → stream → memory)
- `librarian.ts` — Pre-upload intelligence agent
- `intelligence-router.ts` — Casual/search/deep routing (GPT-5.4)
- `claude-with-tools.ts` — Claude streaming with tool-use loop; GPT-5.4 fallback
- `doctrine.ts` — Load + build doctrine prompts (5-min cache)
- `search.ts` — Hybrid search (vector + FTS + Cohere rerank)
- `memory.ts` — Memory retrieval + extraction + storage
- `document-processing.ts` — Extraction → chunking → embedding → entity linking orchestration
- `extraction-v2.ts` — Extraction pipeline selector (native vs Azure)
- `extraction-schema.ts`, `extraction-v2-schema.ts`, `extraction-validation.ts`, `extraction-artifacts.ts`, `extraction-inspection.ts`
- `chunking.ts` — Section-level semantic chunking
- `pdf-text-extraction.ts` — Native PDF text layer via pdfjs-dist
- `azure-document-intelligence.ts` — Azure DI REST wrapper
- `ocr-normalization.ts` — Normalize Azure/PDF output to canonical structure
- `embeddings.ts` — Cohere batch embedding
- `entities.ts` — Entity extraction + canonicalization + similarity
- `references.ts` — Cross-document reference detection + resolution
- `normalize.ts` — Arabic diacritic/number/Unicode folding
- `document-knowledge.ts` — Classification, access level, knowledge scope
- `workspace-profile.ts` — Workspace summary builder
- `query-resolution.ts` — Resolve user references to documents
- `web-search.ts` — Tavily wrapper
- `encryption.ts` — AES-256 for PRIVATE docs (flagged: crypto-js)
- `audit.ts` — Audit trail writer
- `logger.ts` — Structured stderr logger
- `projects.ts` — Project helpers (slugify, uniqueSlug)
- `utils.ts` — Misc utilities
- `supabase.ts` — Browser + admin clients
- `database.types.ts` — Generated TypeScript types
- `clients.ts` — OpenAI / Anthropic / Cohere singletons + `calculateCost()`
- `types.ts` — Shared types (`Source`, `AttachmentMeta`, `PinnedItem`)

**Server Actions:**
- `src/lib/actions/projects.ts` — `createProjectAction`, `renameProjectAction`, `archiveProjectAction`

**Hooks:**
- `src/lib/hooks/use-chat.ts` — Chat state + SSE parsing

**Claude Tools:**
- `src/lib/tools/fetch-url.ts`, `src/lib/tools/financial-model.ts`, `src/lib/tools/extract-key-terms.ts`
- (web_search is defined directly in `src/lib/web-search.ts`)

**Components:**
- `src/components/nav.tsx`, `src/components/chat-input.tsx`, `src/components/chat-message.tsx`
- `src/components/project-sidebar.tsx`, `src/components/project-sidebar-shell.tsx`
- `src/components/project-workspace-header.tsx`, `src/components/project-tabs.tsx`
- `src/components/pdf-viewer-context.tsx` — React Context for PDF viewer
- `src/components/create-project-dialog.tsx`, `src/components/link-document-dialog.tsx`
- `src/components/ui/*` — shadcn primitives

**Database:**
- `src/lib/supabase.ts` — Browser + admin clients
- `src/lib/database.types.ts` — Generated TypeScript types
- `supabase/migrations/*.sql` — Schema + RLS + RPCs

**Testing:**
- **None.** No test files, no test runner, no test config.

**Documentation:**
- `CLAUDE.md` — "Fail Loud, Never Fake" philosophy
- `AGENTS.md` — Next.js 16 breaking changes notice
- `README.md` — Project overview
- `.planning/codebase/` — This codebase map

## Naming Conventions

**Files:**
- `kebab-case.ts` / `kebab-case.tsx` for source files (e.g., `chat-input.tsx`, `intelligence-router.ts`)
- `route.ts` — API route handlers (never `route.tsx`)
- `page.tsx` / `layout.tsx` / `error.tsx` / `not-found.tsx` — Next.js conventions
- `_tabs/` — Leading underscore for private directories within a route
- SQL migrations: `NNN_description.sql` (zero-padded, sequential)

**Directories:**
- `kebab-case` for all directories
- `(parentheses)` for route groups (invisible in URL)
- `[bracket]` for single dynamic segment (`[id]`, `[slug]`)

**Components & Types:**
- `PascalCase` for React components and exports (`ChatInput`, `ProjectSidebar`)
- `PascalCase` for types/interfaces, no `I` prefix (`LibrarianProposal`, `ChatInputProps`, `RunChatTurnArgs`)
- `camelCase` for functions, variables, hooks
- `ALL_CAPS_SNAKE_CASE` for constants (e.g., `PRIMARY_CHAT_MODEL`, `SIMILARITY_THRESHOLD`)
- Database tables: `snake_case` (documents, chunks, memory_items, document_entities)
- API routes: `kebab-case` path segments

**Path Alias:**
- `@/*` → `./src/*` (defined in `tsconfig.json`)

## Where to Add New Code

**New API route:**
- Create `src/app/api/{domain}/route.ts` (or `[id]/route.ts` for dynamic segments)
- Export `async function GET/POST/DELETE/PATCH(request: NextRequest)`
- Set `export const maxDuration = N` if long-running
- Validate input → call `src/lib/` service → return `NextResponse.json(...)` or SSE stream

**New page:**
- Create `src/app/(workspace)/{route}/page.tsx`
- Server component for data fetching (parallelize with `Promise.all`)
- Wrap interactive parts in a client component (`"use client"`)
- Add link in `src/components/nav.tsx` or `src/components/project-sidebar.tsx`

**New lib module:**
- Create `src/lib/{module-name}.ts`
- Named exports preferred (default exports only for React components / Next.js special files)
- Use `createLogger("{namespace}")` from `src/lib/logger.ts`
- Import `supabaseAdmin` from `src/lib/supabase.ts` for server-side DB access

**New Claude tool:**
- Create `src/lib/tools/{tool-name}.ts`
- Export `Anthropic.Tool` definition + async handler
- Register in `src/lib/claude-with-tools.ts` `TOOLS` array + tool_use dispatch

**New server action:**
- Create or edit file in `src/lib/actions/`
- `"use server"` at top
- Return result objects: `{ ok: boolean; error?: string; ... }`
- Call `revalidatePath(...)` after mutations

**New React component:**
- Create `src/components/{name}.tsx`
- `"use client"` if it uses hooks or event handlers
- Import shadcn primitives from `@/components/ui/*`

**New project tab:**
- Create `src/app/(workspace)/projects/[slug]/_tabs/{tab-name}.tsx`
- Register in `workspace-client.tsx` tab switcher
- Add entry to `src/components/project-tabs.tsx` navigation

**New database migration:**
- Create `supabase/migrations/{NNN}_{description}.sql` (next sequence number)
- Write `CREATE TABLE` / `CREATE INDEX` / `CREATE POLICY` / `CREATE FUNCTION`
- Do not edit existing migrations; always add new ones
- Apply locally: `supabase migration up`

**New shared hook:**
- Create `src/lib/hooks/use-{name}.ts`
- Follows existing pattern in `src/lib/hooks/use-chat.ts`

## Special Directories

**`.planning/codebase/`**
- Purpose: GSD codebase map (this directory)
- Source: Agent-generated via `gsd:map-codebase`
- Committed: Yes

**`src/app/(workspace)/`**
- Purpose: Route group — shares layout without adding path segment
- Committed: Yes

**`src/app/(workspace)/projects/[slug]/_tabs/`**
- Purpose: Private tab components mounted by `workspace-client.tsx`
- Leading underscore prevents them from being treated as Next.js route segments

**`supabase/migrations/`**
- Purpose: Versioned schema changes, RLS, RPCs
- Source: Authored manually, applied via Supabase CLI
- Committed: Yes

**`design-system/`**
- Purpose: Stitch visual design tokens
- Committed: Yes

**`.next/`**
- Purpose: Next.js build output + cache
- Committed: No (gitignored)

---

*Structure analysis: 2026-04-07*
*Update when directory structure changes*
