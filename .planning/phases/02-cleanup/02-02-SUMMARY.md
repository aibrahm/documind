---
phase: 02-cleanup
plan: 02
subsystem: infra
tags: [refactor, types, naming, chat]

# Dependency graph
requires:
  - phase: 02-01
    provides: [clean codebase after dead RAG pipeline removal]
provides:
  - centralized shared types in src/lib/types.ts
  - normalized source variable naming in chat routes
  - normalized pendingAttachment naming in chat-input
affects: [02-03, 03-projects, 04-sidebar]

# Tech tracking
tech-stack:
  added: []
  patterns: ["shared types live in src/lib/types.ts, not in page/component files"]

key-files:
  created:
    - src/lib/types.ts
  modified:
    - src/app/page.tsx
    - src/components/chat-input.tsx
    - src/components/chat-message.tsx
    - src/app/api/chat/route.ts
    - src/app/api/chat/[id]/route.ts

key-decisions:
  - "Source is a discriminated union by type field (document | web)"
  - "Direct imports from @/lib/types preferred over re-exports for clarity"
  - "Mirrored exact field shapes from page.tsx — did NOT add sectionTitle to the public Source type even though the route payload carries it, to avoid shape drift"

patterns-established:
  - "UI components import shared types from @/lib/types, never from page or other components"
  - "Per-task atomic commits with replace_all for mechanical renames, grep verification after"

issues-created: []

# Metrics
duration: ~12min
completed: 2026-04-06
---

# Phase 02 Plan 02: Centralize types and normalize naming Summary

**Shared `Source` / `AttachmentMeta` / `PinnedItem` types live in `src/lib/types.ts`. Chat input uses `pendingAttachment` naming. Chat routes use `documentEvidence` / `pinnedEvidence` / `webEvidence` / `evidenceSources` / `pinnedSourcePills` instead of the old mixed vocabulary.**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-04-06
- **Tasks:** 2
- **Files created:** 1
- **Files modified:** 5

## Accomplishments
- Created `src/lib/types.ts` exporting `Source`, `AttachmentMeta`, `PinnedItem` with the exact field shapes they had in `page.tsx` / `chat-input.tsx`
- Updated all UI consumers (`page.tsx`, `chat-input.tsx`, `chat-message.tsx`) to import from `@/lib/types` instead of from each other — broke the page-as-type-source antipattern
- Renamed `PendingFile` → `PendingAttachment`, `pending` state → `pendingAttachments`, `setPending` → `setPendingAttachments` throughout `chat-input.tsx`
- Renamed source variables in both chat routes: `docSources` → `documentEvidence`, `pinnedDocSources` → `pinnedEvidence`, `webSources` → `webEvidence`, `allSources` → `evidenceSources`, `pinnedDocPills` → `pinnedSourcePills`
- Kept `additionalWebSources` name (it's a separate temporary list in the Claude tool-use closure — preserving it matched plan guidance)
- `npx tsc --noEmit` exits 0 after every rename

## Task Commits

1. **Task 1: Centralize Source, AttachmentMeta, PinnedItem types** - `8070b92` (refactor)
2. **Task 2: Normalize naming in chat input and chat routes** - `bf14e68` (refactor)

**Plan metadata:** (this commit)

## Files Created/Modified

### Created
- `src/lib/types.ts` — shared type module with `Source` (discriminated union by `type`), `AttachmentMeta`, `PinnedItem`

### Modified
- `src/app/page.tsx` — imports `Source`, `AttachmentMeta`, `PinnedItem` from `@/lib/types`; removed local exports of `Source` and `AttachmentMeta`; removed `PinnedItem` from the `chat-input` import
- `src/components/chat-input.tsx` — removed local `PinnedItem` export, added `import type { PinnedItem } from "@/lib/types"`; renamed `PendingFile` → `PendingAttachment`, `pending` → `pendingAttachments`, `setPending` → `setPendingAttachments`
- `src/components/chat-message.tsx` — single import `Source, AttachmentMeta, PinnedItem` from `@/lib/types` (replaces two bad imports from `@/app/page` and `@/components/chat-input`)
- `src/app/api/chat/route.ts` — source variable renames (see above)
- `src/app/api/chat/[id]/route.ts` — source variable renames (see above)

## Decisions Made

- **Preferred direct import over re-export.** Plan offered either re-exporting `PinnedItem` from `chat-input.tsx` for backward compat, or updating consumers to import from `@/lib/types` directly. Picked direct imports — cleaner long-term and there were only two consumers (`page.tsx`, `chat-message.tsx`). `chat-input.tsx` no longer exports `PinnedItem` at all.
- **Did NOT add `sectionTitle` to the public `Source.document` variant.** The original `Source` type in `page.tsx` does not include `sectionTitle`, even though the chat route's SSE payload ships it. Mirrored the original shape exactly per plan instruction — shape changes are out of scope for this refactor and would cascade.
- **Kept `additionalWebSources` intact.** Plan explicitly noted this is a temporary list inside the Claude tool-use closure that gets merged into `webEvidence` later. Its name is local and clear in context, so no rename. Verified `replace_all: webSources → webEvidence` did not touch `additionalWebSources` because the substring match is case-sensitive on the leading `w`.

## Deviations from Plan

None — plan executed exactly as written. Verification greps after each step returned the expected zero-match results.

## Issues Encountered

None. One cosmetic hiccup: the zsh glob expansion required quoting `src/app/api/chat/[id]/route.ts` when passing to `git add`, which was a shell-quoting issue not a code issue.

## Next Phase Readiness

Ready for `02-03-PLAN.md` (extract shared chat-turn helper). The two chat routes now use identical variable names, so the dedupe work in 02-03 can mechanically lift the shared body into a helper without further rename noise.

---
*Phase: 02-cleanup*
*Completed: 2026-04-06*
