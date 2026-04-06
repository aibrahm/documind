---
phase: 02-cleanup
plan: 03
subsystem: infra
tags: [refactor, dedup, chat, streaming]

# Dependency graph
requires:
  - phase: 02-02
    provides: [centralized types in src/lib/types.ts, normalized source variable naming across both chat routes]
provides:
  - runChatTurn unified helper
  - slimmed chat routes
  - ~800 lines duplication eliminated
affects: [03-projects, 04-sidebar, 05-project-scoped-chat, 06-negotiations, 07-librarian-projects]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "transport-agnostic stream helpers communicate via emit callback, not by holding the SSE controller directly"

key-files:
  created:
    - src/lib/chat-turn.ts
  modified:
    - src/app/api/chat/route.ts
    - src/app/api/chat/[id]/route.ts

key-decisions:
  - "emit callback signature keeps chat-turn.ts transport-agnostic — no SSE machinery in the helper"
  - "User message persistence stays in the route layer so it survives streaming failures"
  - "Assistant message persistence and memory extraction move into runChatTurn (single source of truth)"
  - "session event is only emitted by the new-conversation route, not by runChatTurn"

patterns-established:
  - "Transport-agnostic stream helpers: the helper emits typed events via a callback; the route layer wraps it in SSE"

issues-created: []

# Metrics
duration: ~18min
completed: 2026-04-06
---

# Phase 02 Plan 03: Extract shared chat-turn helper Summary

**Both chat routes now delegate to `runChatTurn`. ~800 lines of duplication eliminated — Phase 03+ project-scoped chat work will land in one place, not two.**

## Performance

- **Duration:** ~18 min
- **Completed:** 2026-04-06
- **Tasks:** 2
- **Files created:** 1
- **Files modified:** 2

## Accomplishments
- Created `src/lib/chat-turn.ts` with `runChatTurn(args)` — the unified streaming chat-turn flow (routing, entity detection, pinned doc/entity resolution with name-based search fallback, evidence package, system prompt, Claude tool-use loop with GPT-4o fallback, assistant message persistence, fire-and-forget memory extraction)
- Both `/api/chat/route.ts` and `/api/chat/[id]/route.ts` are now thin wrappers (~135 lines each, down from 587 and 545)
- Wire format unchanged — verified by curl smoke tests against the live dev server
- `session` event continues to be emitted only by the new-conversation route (runChatTurn never emits it)
- History loading stays in the `[id]` route; the new route passes `history: []`
- User message persistence stays in each route (so it survives streaming failures); assistant persistence moves into runChatTurn
- `npx tsc --noEmit` exits 0 at every step

## Task Commits

1. **Task 1: Create src/lib/chat-turn.ts** - `ebd9333` (refactor)
2. **Task 2: Slim both chat routes into thin wrappers** - `af622d9` (refactor)

## Files Created/Modified

### Created
- `src/lib/chat-turn.ts` (576 lines — large because of the ~100-line casual-mode system prompt literal, not logic)
  - Exports `runChatTurn(args: RunChatTurnArgs): Promise<RunChatTurnResult>`
  - Exports `InboundAttachment`, `RunChatTurnArgs`, `RunChatTurnResult`

### Modified
- `src/app/api/chat/route.ts` — 587 → 136 lines (thin wrapper: parse body, create convo row, persist user message, emit `session`, delegate to runChatTurn, logAudit)
- `src/app/api/chat/[id]/route.ts` — 545 → 141 lines (thin wrapper: parse body, load history, persist user message, update title if first follow-up, delegate to runChatTurn)

## Decisions Made

### emit callback signature keeps the helper transport-agnostic
`runChatTurn` takes an `emit(type, payload)` callback and never touches `ReadableStream`/`TextEncoder`/`controller` directly. The route layer wraps emit in SSE serialization. This means the same helper could be reused by a WebSocket transport or a test harness in the future — zero coupling to the HTTP response machinery.

### User message persistence stays in the route layer
Both routes insert the user message into the `messages` table BEFORE calling `runChatTurn`. This preserves the prior behavior: even if streaming fails mid-turn, the conversation remains queryable with the user's message visible.

### Assistant message persistence and memory extraction move into runChatTurn
These happen after streaming completes, so moving them into the helper yields a single source of truth. The fire-and-forget `extractMemories().then(storeMemories).catch(...)` pattern is preserved — nothing awaits it, nothing blocks `controller.close()`.

### `session` event is route-only
Only the new-conversation route emits `session` (because only the new route knows the newly-created conversation id). `runChatTurn` never emits `session` — the [id] route doesn't need it, and the new route sends it explicitly before calling runChatTurn.

### history parameter replaces the route-local `messages` array
The [id] route used to load history via a separate SQL call and thread it into routeMessage + llmMessages. Now history is loaded in the route and passed in as `args.history`. runChatTurn uses `history.slice(-10)` to build llmMessages (same truncation as before) and passes the full history to `routeMessage` (same signature as the old [id] route call). For the new-conversation route `history` is `[]`, which routeMessage handles identically to the old behavior.

## Deviations from Plan

**Route files are 136/141 lines, not the 80-120 the plan suggested.** The plan's target was aspirational; the full body-validation block (20 lines), the conversation resolution, and the user-message persistence plus the stream wrapper add up to ~135 lines each. There's no duplication left to extract — any further slimming would involve pulling body validation into a helper, which is out of scope. The important metric is the 1132 → 277 delta (76% reduction) and zero code duplication between the two files.

## Issues Encountered

None. All three curl smoke tests passed on the first post-refactor invocation.

## Smoke Test Results

1. **Casual question (new conversation)**:
   `curl POST /api/chat {"message":"what documents do I have?"}` →
   `session`, `routing` (mode: casual), `text` stream. OK.

2. **Pinned entity (Wood Mackenzie)**:
   `curl POST /api/chat {"message":"what is this?","pinnedEntityIds":["15ff51c5-..."]}` →
   `session`, `routing`, `sources` (document entries), `text`, `done`. OK.

3. **Continue conversation**:
   `curl POST /api/chat/<id> {"message":"thanks"}` →
   `routing`, 19×`text`, `done`. No `session` event (correct). OK.

## Next Phase Readiness

Phase 02 (cleanup) complete. Ready for Phase 03 (project schema and CRUD).

---
*Phase: 02-cleanup*
*Completed: 2026-04-06*
