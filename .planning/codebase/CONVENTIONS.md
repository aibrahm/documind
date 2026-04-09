# Coding Conventions

**Analysis Date:** 2026-04-07

## Naming Patterns

**Files:**
- `kebab-case` for all source files: `chat-input.tsx`, `intelligence-router.ts`, `azure-document-intelligence.ts`
- Next.js conventions: `page.tsx`, `layout.tsx`, `route.ts`, `error.tsx`, `not-found.tsx`
- Leading underscore for private folders within a route (e.g., `_tabs/`)
- SQL migrations: zero-padded sequential (`001_initial_schema.sql` → `012_workspace_profile.sql`)

**Components:**
- Client components: `"use client"` at top; PascalCase function name
  - `export default function ChatInput(...)` — `src/components/chat-input.tsx`
- Server components: async function, no directive
  - `export default async function ProjectWorkspacePage(...)` — `src/app/(workspace)/projects/[slug]/page.tsx`
- Server actions: `"use server"` at top — `src/lib/actions/projects.ts`
- Default exports only for Next.js special files (`page.tsx`, `layout.tsx`, `error.tsx`) and top-level components
- Named exports for utility/helper modules (`src/lib/*.ts`)

**Functions & Variables:**
- `camelCase` throughout: `createLogger()`, `runChatTurn()`, `hybridSearch()`, `buildDoctrinePrompt()`
- Verb prefixes indicate intent: `build*`, `run*`, `extract*`, `create*`, `get*`, `resolve*`
- Boolean predicates: `is*` / `has*` (e.g., `isAzureDocumentIntelligenceConfigured`, `hasAnthropic`)
- Event callbacks: `on*` (e.g., `onConversationCreated`, `onSend`, `onText`)
- Constants: `ALL_CAPS_SNAKE_CASE` (`PRIMARY_CHAT_MODEL = "gpt-5.4"`, `SIMILARITY_THRESHOLD = 0.82`)

**Types & Interfaces:**
- `PascalCase`, no `I` prefix: `Logger`, `LibrarianProposal`, `ChatInputProps`, `RunChatTurnArgs`
- Discriminated unions for polymorphic types: `type Source = { type: "document"; ... } | { type: "web"; ... }` — `src/lib/types.ts`
- String literal unions for enums: `type ResponseMode = "casual" | "search" | "deep"`
- Database types imported from generated `src/lib/database.types.ts` (do not edit)

## Code Style

**Formatting:**
- **No Prettier config** — relies on ESLint + Next.js defaults
- Observed style: double quotes, semicolons required, 2-space indent, trailing commas in multi-line
- No strict line-length limit; long template strings tolerated

**Linting:**
- ESLint 9 (flat config) — `eslint.config.mjs`
- Presets: `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript`
- Global ignores: `.next/**`, `out/**`, `build/**`, `next-env.d.ts`
- No custom rule overrides
- Run: `npm run lint` / `pnpm lint`

**TypeScript:**
- `strict: true` in `tsconfig.json`
- `noEmit: true` — Next.js compiles; TSC only type-checks
- Target: ES2017; `module: esnext`; `moduleResolution: bundler`
- `jsx: "react-jsx"` (automatic JSX runtime)
- `allowJs: true`, `incremental: true`
- Path alias: `@/*` → `./src/*` (only alias)
- Plugins: `[{ name: "next" }]`

## Import Organization

**Observed order:**
1. Node built-ins: `import { createHash } from "node:crypto"`
2. External packages: `import { NextRequest } from "next/server"`, `import type Anthropic from "@anthropic-ai/sdk"`
3. Internal via path alias: `import { supabaseAdmin } from "@/lib/supabase"`
4. Type imports separated with `type` keyword: `import type { InboundAttachment } from "@/lib/chat-turn"`
5. Relative imports (rare — path alias preferred): `import type { DoctrineName } from "./doctrine"`

**Grouping:** Logical grouping by category; path alias imports preferred over relative. No barrel files — direct imports throughout.

## Error Handling

**Philosophy:** "Fail Loud, Never Fake" (from `CLAUDE.md`).

> Prefer a visible failure over a silent fallback. Never silently swallow errors to keep things "working." Surface the error. Show a banner, log a warning, annotate the output.

**Priority order:**
1. Works correctly with real data
2. Falls back visibly — signals degraded mode
3. Fails with clear error message
4. **Never** silently degrades to look "fine"

**Compliance patterns in use:**

- **Explicit error returns in API routes:**
  - `src/app/api/librarian/analyze/route.ts` — validates file, returns `{ error: "..." }` with 400/500
  - `src/app/api/projects/route.ts` — rejects invalid status with 400
  - `src/app/api/chat/route.ts` — validates message + attachments, returns SSE error event on failure

- **Result tuples in server actions:**
  - `src/lib/actions/projects.ts` — `CreateProjectResult { ok: boolean; error?: string; slug?: string }`

- **Type guards at input boundaries:**
  - `typeof value === "string" && DOCUMENT_TYPES.includes(value as DocumentType)`
  - Array filtering with type predicates

- **Loud failures at service boundaries:**
  - `src/lib/doctrine.ts` throws if DB load fails (critical to deep mode)
  - `src/lib/extraction-v2.ts` throws "scanned PDF and no Azure configured" rather than faking text
  - `src/lib/web-search.ts` throws if `TAVILY_API_KEY` missing

- **Structured error logging:**
  - `src/lib/logger.ts` `error()` method extracts `err.message` + first 5 stack lines + metadata

**Known violations** (see CONCERNS.md):
- Memory extraction + audit logging in `src/lib/chat-turn.ts` use fire-and-forget `.catch(console.error)`
- Some client-side fetches silently swallow errors with `.catch(() => {})`
- `src/lib/workspace-profile.ts` returns `null` on error without disclosing degraded mode
- `src/lib/supabase.ts` `supabaseAdmin` falls back to string `"placeholder"` if service role key missing (should throw at startup)
- `Promise.all` vs `Promise.allSettled` inconsistency across `src/lib/chat-turn.ts` and `src/lib/librarian.ts`

## Logging

**Framework:** Custom structured logger — `src/lib/logger.ts`

**Pattern:**
```ts
const log = createLogger("librarian");
log.info("analyzing upload", { fileName });
log.warn("entity overlap empty", { docId });
log.error("classification failed", err, { docId });
```

- Levels: `debug`, `info`, `warn`, `error`
- Output: stderr via `console.error()` (all levels)
- Format: ISO timestamp + `[LEVEL]` + `[namespace]` + message + JSON metadata
- `error()` auto-extracts `err.message` + first 5 stack lines
- Debug gated by `DOCUMIND_LOG_DEBUG=true`
- Legacy `console.error()` still present in some API routes (flagged for cleanup)

**Audit trail:** `logAudit(action, details, scores)` in `src/lib/audit.ts` writes to the `audit_log` table for user actions.

## Comments

**File headers:** Multi-line block comments at top of complex modules explaining purpose and philosophy:
```ts
// src/lib/logger.ts
//
// Minimal structured logger. Per CLAUDE.md "Fail Loud, Never Fake": every
// log call goes to stderr with a level + namespace prefix...
```

**Section dividers:** Decorator-style for logical sections:
```ts
// ── Project context ──
// ────────────────────────────────────────
// NORMALIZATION
// ────────────────────────────────────────
```

**JSDoc-style** for public exports in widely-reused modules (partial coverage):
```ts
/**
 * THE LIBRARIAN AGENT
 * The librarian is the intelligent layer...
 */
```

**Inline comments:** Sparse; explains *why*, not *what*.

## Function Design

**Size:** Most functions 10–100 LOC. Core orchestrators (`chat-turn.ts` ~1000 lines, `librarian.ts` ~700 lines, `ocr-normalization.ts` ~1000 lines) are large and flagged for decomposition.

**Parameters:**
- Objects preferred for 3+ params: `runChatTurn(args: RunChatTurnArgs)`
- Callback props: `emit: (eventType: string, payload: Record<string, unknown>) => void`
- Optional with defaults: `options: UseChatOptions = {}`
- Destructure in signature when passing objects

**Return values:**
- Explicit typed returns; never `Promise<any>`
- Result objects for operations with expected failures: `{ ok: boolean; error?: string; data?: T }`
- Discriminated unions over nullable results
- Nullable returns (`Promise<T | null>`) only when absence is genuinely expected
- Throw at library boundaries for critical failures

## Module Design

**Exports:**
- Named exports preferred throughout
- Default exports restricted to Next.js special files and top-level components
- No barrel files (`index.ts` re-exports)
- Type exports via `export type` / `export interface`; separated from runtime exports where clearer

**Server vs client components:**
- Server components are the default (no directive)
- `"use client"` at top of file for components using hooks, event handlers, browser APIs
- `"use server"` at top of files/functions for server actions (only in `src/lib/actions/`)
- No mixed `"use client"` / `"use server"` in the same file
- Server components parallelize data fetches with `Promise.all`

**Database access:**
- No ORM, no repository layer — direct `supabaseAdmin.from(...).select(...)` calls inline
- Type safety via generated `src/lib/database.types.ts`

**Tree-shaking:** Named exports + direct imports keep bundles lean; no barrel files means no accidental deep-imports.

---

*Convention analysis: 2026-04-07*
*Update when patterns change*
