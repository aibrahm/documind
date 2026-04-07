# Coding Conventions

**Analysis Date:** 2026-04-06

## Naming Patterns

**Files:**
- `kebab-case.ts` / `kebab-case.tsx` for lib and component files
- Examples: `src/lib/chat-turn.ts`, `src/lib/claude-with-tools.ts`, `src/components/chat-input.tsx`
- shadcn primitives follow their library's kebab-case: `src/components/ui/tabs.tsx`, `src/components/ui/dialog.tsx`
- Next.js conventions: `route.ts`, `page.tsx`, `layout.tsx`

**Functions:**
- camelCase throughout: `runChatTurn()`, `analyzeUpload()`, `hybridSearch()`, `findRelatedDocuments()`, `buildDoctrinePrompt()`
- Private helpers co-located and not exported: `quickExtract()`, `quickAnalyze()`, `decideAction()` inside `src/lib/librarian.ts`

**Variables:**
- camelCase for locals and parameters
- `SCREAMING_SNAKE_CASE` for module-level constants (`MAX_CHUNK_CHARS`, `BATCH_SIZE`, `SIMILARITY_THRESHOLD`)
- `_privatePrefix` for module-level singleton caches (`_openai`, `_cohere`, `_admin`)

**Types:**
- **`interface`** for object shapes: `RunChatTurnArgs`, `LibrarianProposal`, `QuickExtraction`, `AttachmentMeta`
- **`type`** for discriminated unions and string literals: `type LibrarianAction = "new" | "version" | "duplicate" | "related"`, `type DoctrineName = "master" | "legal" | "investment" | "negotiation" | "governance"`, `type Source = { type: "document"; ... } | { type: "web"; ... }`
- PascalCase for both, no `I` prefix on interfaces

## Code Style

**Formatting:**
- Spaces, not tabs
- Double quotes for strings (`"═══ RETRIEVED DOCUMENTS ═══\n\n"`)
- Semicolons present
- No `.prettierrc` committed — defaults inferred from actual files
- Line length is variable; no strict max

**Linting:**
- ESLint 9 via `eslint.config.mjs`
- Extends `next/core-web-vitals` + TypeScript presets
- No custom rule overrides observed
- Run: `pnpm lint`

**Type checking:**
- `tsconfig.json`: strict mode, `noEmit: true`
- No `pnpm typecheck` script — not enforced in CI (there is no CI)

## Import Organization

**Path aliases:**
- `@/*` → `src/*` (from `tsconfig.json`)
- Absolute imports via `@/lib/...` and `@/components/...` are the norm
- ⚠ Some files still use relative imports (e.g., `src/lib/librarian.ts` has `from "./supabase"`) — inconsistency worth flagging

**Order observed:**
1. External packages (Next.js, SDKs)
2. Internal `@/lib/*` imports
3. Relative imports (rare)
4. Type-only imports inline with `import type` or grouped

**Type imports:**
- Explicit `type` keyword when importing types alongside runtime symbols:
  ```ts
  import { runChatTurn, type InboundAttachment } from "@/lib/chat-turn";
  import { canonicalizeEntities, type CanonicalEntity } from "@/lib/entities";
  ```

## Error Handling

**Stated philosophy** (`CLAUDE.md`): **Fail Loud, Never Fake.**
1. Works correctly with real data
2. Falls back visibly (banner/log/annotation)
3. Fails with a clear error message
4. Never silently degrades

**Observed patterns:**
- Try/catch at route entry points with structured HTTP error responses
- Fire-and-forget tasks logged via `.catch((err) => console.error(...))`
- Status fields (`status: "processing" | "ready" | "error"`) on documents
- Fallback chains (Claude → GPT-4o on Anthropic failure)
- Intentional silent catches **with inline justification comments**:
  - `src/lib/chat-turn.ts` around line 165: `/* swallow — name search is best-effort */`
  - `src/lib/librarian.ts` around line 194: `/* embedding is optional */`

**⚠ Unjustified silent fallbacks** (violating fail-loud — see `CONCERNS.md`):
- `src/lib/web-search.ts` returns `[]` when `TAVILY_API_KEY` missing
- `src/lib/intelligence-router.ts` silently defaults to `casual` on JSON parse failure
- `src/lib/memory.ts` returns `[]` from `extractMemories` on error
- `src/lib/search.ts` Cohere rerank silently falls back to original ordering

## Logging

- **No structured logger** — raw `console.error()` only
- `console.error` used across 17+ files
- `logAudit()` exists in `src/lib/audit.ts` but is only invoked from `src/app/api/upload/route.ts`
- No levels (debug/info/warn) — only errors are logged

**Known debt:** replace `console.error` with a proper logger and emit to SSE/UI where user-visible (see `CONCERNS.md`).

## Comments

**File headers:**
- Multi-line block comments at the top of major lib files explaining design
- `src/lib/chat-turn.ts` lines 1–20: explains transport-agnostic callback architecture
- `src/lib/librarian.ts` lines 7–26: numbered analysis pipeline
- `src/lib/doctrine.ts` lines 55–62: prompt composition strategy

**Inline:**
- Explain *why*, not *what*
- Visual section dividers: `// ── section name ──` (used throughout `chat-turn.ts`, `librarian.ts`)
- Silent-catch justifications: `/* embedding is optional */`, `/* swallow — best-effort */`

**JSDoc:**
- Minimal usage — one-liners for top-level exports when signature isn't obvious
- Rarely uses full `@param`/`@returns` tags

## Module Exports

- **Named exports only** — no default exports in `src/lib/*`
- Private helpers live at module scope without export
- Re-exports used for public types: `export type { CanonicalEntity }` from librarian (re-exports from entities)
- React components likewise named exports (shadcn primitives follow their own convention)

## React Conventions

**Server vs client:**
- Root `layout.tsx` is RSC
- Pages (`page.tsx`, `upload/page.tsx`, `documents/page.tsx`, etc.) declare `"use client"` at the top
- Components in `src/components/*.tsx` are client components
- API routes in `src/app/api/*/route.ts` are server-only (never have `"use client"`)

**Hooks:**
- Standard React hooks: `useState`, `useRef`, `useCallback`, `useImperativeHandle`
- Chat input exposes imperative handle via `forwardRef` + `useImperativeHandle`

**Component props:**
- Props interface suffixed with `Props` (e.g., `ChatInputProps`, `ChatMessageProps`)
- Imperative handles suffixed with `Handle` (`ChatInputHandle`)
- Event props prefixed with `on` (`onSend`, `onSourceClick`, `onRegenerate`)

## Async Patterns

- `async`/`await` throughout — no `.then()` chains
- Parallelism via `Promise.all()` (e.g., `src/lib/chat-turn.ts` runs routing + memory retrieval in parallel)
- Streaming via `for await (const chunk of llmStream)`
- Fire-and-forget with `.catch(console.error)` for non-blocking side effects (memory extraction, audit logging)

## Known Inconsistencies

1. **Mixed import styles** — most files use `@/lib/*`, a few use relative `./supabase`
2. **Inconsistent error handling** — some try/catches justified with comments, others silent without justification
3. **Heavy `as` type assertions** on database reads (e.g., `docMetaMap.get(c.document_id as string)`) instead of schema validation
4. **No central error handler or error boundaries** — each route handles errors locally
5. **`audit.ts` exists but barely called** — logging is aspirational rather than systematic

---

*Convention analysis: 2026-04-06*
*Update when patterns change*
