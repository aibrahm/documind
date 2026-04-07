# Codebase Concerns

**Analysis Date:** 2026-04-06

## Tech Debt

**Console.error scatter (no structured logger):**
- Issue: 17+ files use raw `console.error` — violates "Fail Loud, Never Fake" because errors aren't surfaced to the user
- Files: `src/lib/chat-turn.ts`, `src/lib/memory.ts`, `src/app/api/chat/route.ts`, `src/app/api/upload/route.ts`, `src/app/api/documents/route.ts`, `src/app/api/librarian/analyze/route.ts`, and more
- Why: No logger infrastructure ever built
- Impact: Errors only visible in server console — user sees either a generic failure or nothing at all
- Fix approach: Create `src/lib/logger.ts`. For user-affecting failures, emit via SSE `error` events or toast. Reserve `console.error` for unreachable paths.

**`chat-turn.ts` is the new long file:**
- Issue: `src/lib/chat-turn.ts` is ~576 lines and does routing + retrieval + entity resolution + pinning + evidence packaging + LLM calls + streaming + persistence + memory extraction
- Why: Phase 02 consolidated two duplicate chat routes here
- Impact: Hard to modify safely; high blast radius for changes
- Fix approach: Extract `buildEvidencePack()`, `handleLlmStream()`, `persistTurn()` into separate helpers; keep `runChatTurn` as a coordinator

**`audit_log` table underutilized:**
- Issue: Only `src/app/api/upload/route.ts` calls `logAudit()` (`src/lib/audit.ts`)
- Impact: No observability on chat turns, routing decisions, cost tracking per conversation, memory operations, or error events
- Fix approach: Add audit events on chat turns (mode, doctrines, cost), memory operations, classification changes. Build a simple admin page to browse `audit_log`.

**`document_references` table underutilized:**
- Issue: Detection + storage work (`src/lib/references.ts`, called from `src/app/api/upload/route.ts`), but no UI to browse, search, or manually link unresolved references
- Impact: Known cross-document links exist but are invisible to the user; unresolved references silently accumulate
- Fix approach: Build a references viewer page per document and a global unresolved-references queue

**Relative vs absolute import inconsistency:**
- Issue: Most files use `@/lib/*`, but e.g. `src/lib/librarian.ts` still imports `from "./supabase"` (and similar)
- Fix approach: Normalize to `@/lib/*` everywhere; add ESLint rule `import/no-relative-parent-imports` or similar

## Resolved (verified)

- ✅ Long route handlers — `/api/chat/route.ts` now 136 lines (was ~400), delegates to `runChatTurn`
- ✅ Duplicate chat routes — both route handlers delegate to `runChatTurn` in `src/lib/chat-turn.ts`
- ✅ Type imports normalized — spot-check of `src/lib/types.ts` and consumers is clean
- ✅ `scripts/` directory — no longer present
- ✅ `pipeline/` dead code (adversarial-review.ts, deep-analysis.ts, etc.) — no longer present

## Known Bugs

**Librarian 31% similarity false-negative for duplicates:**
- Symptoms: Bit-identical PDF re-upload gets classified `new` or `related` instead of `duplicate`, so both documents enter the KB and compete in retrieval
- Location: `src/lib/librarian.ts` — `findRelatedDocuments` (~line 226–249)
- Root cause: Content similarity only embeds the **first chunk** of each candidate (`chunk_index ASC LIMIT 1`). For a 100-page contract, the cover page varies with OCR/rendering and tanks the cosine similarity. Composite weighting then pulls the total to ~0.3.
- Impact: User ends up with duplicate documents silently indexed; retrieval accuracy degrades
- Fix: Sample multiple chunks per candidate (first + middle + last) and use the **max** cosine similarity. Or require ≥0.85 on ≥2 sampled chunks for `duplicate`. Also bump title-match weight.

**Empty `viewer/` route:**
- Location: `src/app/viewer/` (empty directory)
- Symptoms: Dead directory from an abandoned design
- Fix: Delete the directory

## Security Considerations

**No startup env validation:**
- Risk: `process.env.X!` non-null assertions on all API keys + `ENCRYPTION_KEY`; missing keys crash at first use, not at boot
- Files: `src/lib/encryption.ts`, `src/lib/clients.ts`, `src/lib/supabase.ts`
- Impact: Operator may not notice a missing PRIVATE `ENCRYPTION_KEY` until the first private doc arrives and silently fails
- Recommendation: Add `validateEnv()` at module load or in a startup hook; fail loudly at boot if any required key is missing. Include a 256-bit format check on `ENCRYPTION_KEY`.

**No input validation schema at API boundary:**
- Risk: All API routes do manual `Array.isArray` / `typeof` checks — no Zod, no schema validation
- Files: most routes under `src/app/api/*/route.ts`
- Impact: Malformed requests may reach deep into `chat-turn.ts` before failing, producing confusing error messages
- Recommendation: Add Zod schemas per endpoint; validate at the top of each route handler

**Heavy `as` type assertions on DB reads:**
- Risk: `docMetaMap.get(c.document_id as string)`-style casts across lib code bypass type safety
- Impact: Runtime shape mismatches if schema drifts from `database.types.ts`
- Recommendation: Regenerate types after every migration; consider a thin validation layer at the Supabase boundary

**RLS policies unexercised:**
- Risk: `003_rls_policies.sql` expects an `authenticated` role, but routes all use service-role key (bypasses RLS). There's no login flow at all.
- Impact: Policies are aspirational, not enforced. Fine for single-user, but any future multi-user work must confront this.

## Fail-Loud Violations

These all conflict with the explicit policy just added to `CLAUDE.md`:

1. **Tavily returns `[]` on missing key** — `src/lib/web-search.ts`. Should warn at startup or emit a UI banner.
2. **Intelligence router defaults to `casual` on JSON parse failure** — `src/lib/intelligence-router.ts` around line 150. Should log + optionally emit a degraded-mode indicator.
3. **Memory extraction swallows errors** — `src/lib/memory.ts` ~line 100 returns `[]` on catch. User is unaware future conversations will lack context.
4. **Cohere rerank silently falls back to original order** — `src/lib/search.ts` ~line 131. Should emit a warning and annotate search results as "unreranked".
5. **Librarian embedding silently optional** — `src/lib/librarian.ts` ~line 194. Justified by inline comment but still invisible to the user.
6. **Claude → GPT-4o fallback** — `src/lib/chat-turn.ts` ~line 503. User only sees `console.error`; should surface "Degraded to GPT-4o" in UI.

## Performance Concerns

**N+1 pinned-entity search:**
- Location: `src/lib/chat-turn.ts` ~line 147–156
- Problem: Loops over pinned entities and runs one `hybridSearch` per entity
- Impact: 5 pinned entities = 5 sequential search queries (each with Cohere rerank)
- Fix: Pre-resolve all entity → document links in one query, then one batched search

**Unbounded first-message chat page:**
- Location: `src/app/page.tsx` — ~1600 lines of client code for the chat surface
- Impact: Long bundle, harder to reason about, risk of render perf issues once history grows
- Fix: Split into smaller components (history list, composer, stream viewer, pinned-item tray)

**No cost tracking on chat turns:**
- Location: `src/lib/chat-turn.ts` / `src/lib/clients.ts`
- Impact: `calculateCost` exists but isn't wired into audit log for chat
- Fix: Accumulate cost in `runChatTurn` and `logAudit` it at turn end

## Fragile Areas

**Language detection defaults to Arabic:**
- Location: `src/lib/librarian.ts` ~line 157, `src/lib/memory.ts` ~line 56
- Why fragile: `parsed.language || "ar"` — if the LLM omits the field, English docs get mis-tagged as Arabic, degrading retrieval
- Fix: Fall back to a heuristic (character set detection) before defaulting

**Silent Cohere rerank fallback:**
- Location: `src/lib/search.ts` ~line 131
- Why fragile: Hides Cohere outages; downstream LLM gets worse context without anyone noticing
- Fix: Log + mark results as unreranked

**References resolution:**
- Location: `src/lib/references.ts` ~line 63–90
- Why fragile: Unresolved references pile up silently; no retry or surfacing
- Fix: Count unresolved on the document detail page, add a re-resolution action

## Dead Code

- `src/app/viewer/` — empty directory
- Unused `CanonicalEntity` import in `src/lib/librarian.ts:5` (only re-exported, not consumed locally). Low priority.

## Missing Features (blocking / soon-blocking)

- **Project schema (Phase 03)** — migration `008_projects.sql` doesn't exist yet; blocks phases 04 → 07
- **References viewer page** — table populated, no UI
- **Audit log dashboard** — table exists, no UI, sparsely written
- **React error boundaries** — no `error.tsx` files anywhere; a single component throw crashes the page
- **Structured logger** — prerequisite for fully honoring "Fail Loud, Never Fake"

## Test Coverage

**0% — no tests, no framework, no CI.** See `TESTING.md` for full discussion and recommended starting points. The 31% librarian bug is exactly the kind of regression a minimal unit test suite would have caught.

---

*Concerns audit: 2026-04-06*
*Update as issues are fixed or new ones discovered*
