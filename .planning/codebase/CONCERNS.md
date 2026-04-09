# Codebase Concerns

**Analysis Date:** 2026-04-07

## Tech Debt

**`supabaseAdmin` falls back to literal `"placeholder"` string:**
- File: `src/lib/supabase.ts`
- Issue: If `SUPABASE_SERVICE_ROLE_KEY` is missing, `supabaseAdmin` is built with `process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder"`. Deployment with missing env var goes unnoticed until the first DB request, producing cryptic Supabase 401s instead of failing at startup.
- Impact: Deployment mistakes caught late; hard to diagnose; directly contradicts "Fail Loud, Never Fake".
- Fix: Throw at module load if the env var is missing. One line change, high value.

**Oversized files need decomposition:**
- `src/lib/chat-turn.ts` (~1000+ lines) — handles routing, retrieval, memory, doctrine prompt building, evidence packaging, streaming, audit. Worth splitting into `chat-turn-routing.ts`, `chat-turn-evidence.ts`, `chat-turn-memory.ts`, `chat-turn-system-prompt.ts`, with the main file as a <300 LOC orchestrator.
- `src/lib/ocr-normalization.ts` (~1000 lines) — can be split by source (Azure vs native text) and by section type.
- `src/lib/librarian.ts` (~700 lines) — can be split into quick-extract / classify / canonicalize / propose.
- `src/lib/extraction-schema.ts` (~770 lines) — types + enums; could split by concern.
- `src/lib/database.types.ts` (auto-generated, acceptable).
- Impact: Hard to navigate and review, especially given zero test coverage. Refactoring risk is high.
- Fix: Extract sub-modules incrementally as changes touch these files.

**Hardcoded model names scattered across files:**
- Files: `src/lib/chat-turn.ts` (`PRIMARY_CHAT_MODEL = "gpt-5.4"`), `src/lib/intelligence-router.ts` (`ROUTER_MODEL = "gpt-5.4"`), `src/lib/claude-with-tools.ts` (`claude-opus-4-6`), `src/lib/memory.ts` (`gpt-4o-mini`)
- Issue: Model IDs duplicated across modules; model retirement/migration requires touching multiple files.
- Impact: Brittle on model retirement. Easy to miss a reference.
- Fix: Create `src/lib/models.ts` exporting a single `MODELS` constant object as the source of truth.

**No pagination on documents list and recent conversations:**
- Files: `src/app/api/documents/route.ts`, `src/app/(workspace)/layout.tsx` (`.limit(200)`)
- Issue: Documents endpoint returns all docs with no limit. Conversations limited to 200 hard-coded; anything older silently disappears from the sidebar.
- Impact: Won't scale past a few hundred documents / 200 conversations. Data "vanishes" from UI without warning.
- Fix: Cursor-based pagination with `hasMore` flag; "load more" UI.

## Known Bugs / Fragile Areas

**Silent error suppression in `chat-turn.ts` fire-and-forget paths:**
- File: `src/lib/chat-turn.ts` (memory extraction + audit logging catch blocks use `.catch(console.error)`)
- Issue: Memory extraction and audit failures are logged to stderr but never surface to the user. The turn completes "successfully" while workspace memory is silently lost.
- Impact: Directly violates `CLAUDE.md` "Fail Loud, Never Fake" philosophy. Users believe memory is being captured when it may not be.
- Fix: Emit SSE `warning` events for non-fatal failures; add a `warnings[]` field to `RunChatTurnResult`; show a UI banner ("Memory indexing degraded").

**Extraction pipeline is the recurring fragility hotspot:**
- Files: `src/lib/librarian.ts`, `src/lib/extraction-v2.ts`, `src/lib/pdf-text-extraction.ts`, `src/lib/ocr-normalization.ts`, `src/lib/azure-document-intelligence.ts`
- Evidence: Recent commits repeatedly fix extraction (verbatim discipline, tighter law extraction prompt, extraction failure visibility, scanned PDF vision fallback).
- Issue: Multiple fallback paths (native text → Azure Layout), inconsistent error handling, zero tests protecting this code.
- Fix: Store the fallback chain per document (which provider was used and why); emit explicit degraded-mode warnings to UI; add regression tests with real PDF fixtures (Arabic native-text + Arabic scanned).

**Librarian silent fallback when extraction is weak:**
- File: `src/lib/librarian.ts`
- Issue: If text extraction fails on both native PDF and Azure, the librarian returns `classification: "PRIVATE"` with reason `"Text extraction was too weak for deterministic routing..."`. The user sees this as a confident proposal.
- Impact: User may accept wrong classification. Disclosure is in a field the UI may not surface prominently.
- Fix: Add `confidence: "low"` to the proposal; UI shows a prominent warning: "Couldn't reliably extract text — please verify classification before confirming."

**`Promise.all` vs `Promise.allSettled` inconsistency:**
- Files: `src/lib/chat-turn.ts`, `src/lib/librarian.ts`
- Issue: Critical and optional parallel calls use the same primitive inconsistently. Optional enrichment failures can crash the whole turn, or silently disappear.
- Fix: Convention: `Promise.all` for critical reads, `Promise.allSettled` for optional enrichment; document per call site.

**In-memory doctrine cache not invalidated across instances:**
- File: `src/lib/doctrine.ts`
- Issue: 5-min in-process TTL cache. If a doctrine is updated in the DB, other server instances continue serving stale content until their cache expires.
- Impact: In a multi-instance deployment (Vercel serverless or horizontally scaled node), users on different instances see inconsistent doctrine content.
- Fix: Publish a Supabase Realtime / Redis pub-sub event on doctrine update; listen for invalidation across instances.

**Extraction validation marks "valid: true" even with error-severity issues:**
- File: `src/lib/extraction-validation.ts`
- Issue: Validation returns a list of issues with severities but still sets `valid: true` for error-level issues. Processing continues, document marked `status: ready`, `processing_error` field set but easy to overlook.
- Fix: Separate `errors` from `warnings`; introduce `status: "ready_with_errors"` or `"degraded"`; surface a "⚠️ Extraction Issues" badge in the UI.

## Security Considerations

**Single-tenant RLS policies (`USING (true)` for all authenticated users):**
- File: `supabase/migrations/003_rls_policies.sql`
- Risk: Every authenticated user sees every document/project/conversation/memory. No ownership, no workspace boundaries, no project isolation. PRIVATE documents are only "private" in the UI — all users can query them.
- Mitigation: Assumes single-user/trusted deployment. Brittle the moment a second user is added.
- Fix: Add `workspace_id` (nullable, backward-compat) to `documents`, `projects`, `conversations`, `memory_items`; rewrite policies as `USING (workspace_id = auth.uid() OR workspace_id IS NULL)`; add `workspace_members` table for team support.

**`crypto-js` used for PRIVATE document encryption — no AEAD, deprecated library:**
- Files: `src/lib/encryption.ts`, `package.json` (`crypto-js ^4.2.0`)
- Risk: `crypto-js` is not actively maintained and has been flagged by security audits. AES-256 via `crypto-js` lacks authenticated encryption (no HMAC/AEAD) — ciphertexts can be tampered without detection.
- Fix: Replace with Node.js built-in `crypto` module using `aes-256-gcm` (AEAD); proper random IV per encryption; add auth tag verification.

**No encryption key rotation or versioning:**
- File: `src/lib/encryption.ts`
- Risk: Single static `ENCRYPTION_KEY` env var. Key compromise means all PRIVATE documents are permanently exposed; no migration path.
- Fix: Add `key_version` to encrypted payloads (`{ v: 1, iv, ciphertext, tag }`); support multiple active keys during rotation; background job to re-encrypt with new key.

**Missing ownership validation on document update:**
- File: `src/app/api/documents/[id]/route.ts`
- Risk: PATCH handler updates documents filtered only by `id`, no workspace/owner check. If RLS is ever disabled or bypassed, any authenticated user can modify any document.
- Fix: Add `.eq("workspace_id", userWorkspaceId)` filter; require workspace context in the API.

**No file magic-byte validation on upload:**
- File: `src/app/api/upload/route.ts`
- Risk: Only extension (`.pdf`) and size (≤50MB) are checked. Malicious or malformed files disguised as PDFs could crash pdf-parse or downstream OCR.
- Fix: Validate the leading `%PDF-` magic bytes before extraction; reject with a clear error otherwise.

**Pinned document/entity access not validated:**
- Files: `src/app/api/chat/route.ts`, `src/lib/chat-turn.ts`
- Risk: Pinned document/entity IDs from the client are used without verifying the user has access. Pinned refs bypass search filters.
- Fix: Verify pinned IDs exist and are accessible (workspace match, classification honored); silently drop invalid pins; log in audit trail.

## Performance Bottlenecks

**Batch chunk inserts have no retry logic:**
- File: `src/lib/document-processing.ts`
- Issue: Chunks inserted in batches of 50 with a single `await supabaseAdmin.from("chunks").insert(batch)` — no retry on transient errors. A 100-page document (>5000 chunks) can silently lose batches on network blips.
- Impact: Document marked `ready` with partial chunks → search misses content → quality degradation invisible to user.
- Fix: Wrap each batch in exponential backoff (3 retries, 200ms + jitter). Throw on final failure. Set `status: "error"` if any batch fails.

**Embeddings generated as a single large batch per document:**
- File: `src/lib/document-processing.ts` → `src/lib/embeddings.ts`
- Issue: `generateEmbeddings()` is called once with all chunk texts; no per-chunk retry. Large documents (50+ chunks) risk timeouts mid-batch leaving the document half-embedded.
- Fix: Sub-batch into groups of 10–20 with exponential backoff; persist embedding status per chunk so retries are idempotent.

**Hybrid search filters applied after RPC returns, requiring over-fetch:**
- File: `src/lib/search.ts`
- Issue: `hybrid_search` RPC returns candidates before `is_current` / document-set / classification filters are applied in application code. Uses an "over-fetch multiplier" to compensate — unpredictable and wasteful.
- Fix: Push filters into a new version of the `hybrid_search` SQL RPC in `supabase/migrations/`.

**Doctrine cache is per-process, not distributed:**
- File: `src/lib/doctrine.ts`
- Issue: Every serverless cold start / new instance = fresh DB hit. On Vercel, cold starts are frequent.
- Fix: Pre-load at server init, or move to Upstash Redis for shared cache across instances.

**No LLM cost observability:**
- Files: `src/lib/chat-turn.ts`, `src/lib/memory.ts`, `src/lib/claude-with-tools.ts`, `src/lib/librarian.ts`
- Issue: `calculateCost()` exists in `src/lib/clients.ts` but is not called consistently. No aggregation, no budget alerts, no per-user quotas. High-volume usage could inflate spend silently.
- Fix: Log every LLM call with model + tokens + cost to an `llm_usage` table; expose `/api/admin/costs`; emit per-turn cost in SSE stream so UI can show it; add monthly budget alerts.

**Memory extraction runs on every turn without opt-out:**
- File: `src/lib/memory.ts`
- Issue: GPT-4o-mini called per turn for memory extraction, no cost tracking, no skip flag.
- Fix: Add `skip_memory_extraction` option for cost-sensitive scenarios; log cost per call.

## Fragile Areas

**Chunking strategy undocumented:**
- File: `src/lib/chunking.ts`
- Why fragile: Complex rules (max chunk size, overlap, min chunk, table preservation, section boundaries, Arabic sentence splitting) with no header comment explaining trade-offs. Prior "table duplication bug" shows tuning one parameter can break another.
- Fix: Add a design comment at the top of the file explaining the strategy + add fixture-based tests.

**`ocr-normalization.ts` is a black box:**
- File: `src/lib/ocr-normalization.ts` (~1000 lines)
- Why fragile: Core "Rosetta Stone" between Azure/PDF output and canonical schema; no README, no tests, no comments on the normalization rules.
- Fix: Split by extraction source; add a design doc explaining the invariants; add golden-file tests comparing input PDFs to expected canonical output.

**Extraction decision tree undocumented:**
- Files: `src/lib/extraction-v2.ts`, `src/lib/ocr-normalization.ts`, `src/lib/azure-document-intelligence.ts`
- Issue: Undocumented assumptions: when to use native PDF vs Azure, confidence thresholds and their rationale, Arabic normalization edge cases, failure/recovery modes.
- Fix: Create `src/lib/extraction/README.md` documenting the decision tree, thresholds, expected outputs, and failure modes.

## Scaling Limits

**No async job queue — all extraction is synchronous in the HTTP request:**
- Files: `src/app/api/upload/route.ts` (`maxDuration = 300`), `src/lib/document-processing.ts`
- Current: Upload handler awaits the full extraction → chunking → embedding pipeline inline.
- Limit: ~5-minute Vercel function timeout; no retries; no progress visibility; single-request concurrency.
- Symptoms: Vercel 504s on large documents; users think upload succeeded but extraction silently failed.
- Fix: Move extraction to a queue (Supabase queues / Upstash QStash / BullMQ); track `documents.status` as `queued → processing → ready|failed`; emit progress events via Supabase Realtime.

## Dependencies at Risk

**`crypto-js` ^4.2.0** — deprecated, no AEAD support, security risk. Replace with `node:crypto` AEAD (covered in Security section).

**`pdf-parse` ^2.4.5** — older library; check if `pdfjs-dist` alone can replace it.

**No `npm audit` / Dependabot / Renovate configured:**
- Risk: No process for catching new CVEs in `@anthropic-ai/sdk`, `openai`, `@supabase/supabase-js`, etc.
- Fix: Enable Dependabot or Renovate on the repo.

## Missing Critical Features

**No test suite at all (see TESTING.md):**
- Priority: **Critical** given the fragility of the extraction pipeline and the "Fail Loud" error handling that needs invariant protection.
- Suggested start: Vitest + unit tests for `chunking.ts`, `entities.ts`, `normalize.ts`, `extraction-validation.ts`, `intelligence-router.ts`.

**No observability beyond stderr logs:**
- No Sentry (error tracking), no Datadog/OpenTelemetry, no uptime monitoring, no LLM cost dashboard.
- Fix: Add Sentry for error tracking as a first step; add structured LLM usage logging (see performance section).

**No extraction pipeline or chunking documentation:**
- Files: `src/lib/extraction-v2.ts`, `src/lib/chunking.ts`, `src/lib/ocr-normalization.ts`
- Fix: `src/lib/extraction/README.md` + design comments at the top of each file.

**No rate limiting:**
- Files: All `src/app/api/**/route.ts`
- Risk: Abuse vector for LLM cost / DB load.
- Fix: Add middleware-level rate limiting (Upstash Ratelimit or Vercel KV).

## Test Coverage Gaps

**Everything** (see TESTING.md for the full tiered list). Highest-priority gaps:

- **Extraction pipeline** — highest regression risk per commit history
- **Chat turn orchestration** — most complex single module, 1000+ lines
- **Entity canonicalization** — bilingual + normalization logic, easy to break silently
- **Chunking** — complex rules, prior bug history
- **Hybrid search ranking** — rerank weight changes affect recall/precision unpredictably
- **Memory extraction** — already fire-and-forget; tests would verify logic works when invoked

---

*Concerns audit: 2026-04-07*
*Update as issues are fixed or new ones discovered*
