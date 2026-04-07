---
phase: 04-sidebar-workspace
plan: 01
subsystem: ui-foundation
tags: [nextjs-16, route-groups, layout, refactor, hook-extraction]

requires:
  - phase: 03-projects-schema
    provides: projects + negotiations schema and CRUD endpoints (Phase 04 wires these into the UI)

provides:
  - (workspace) route group with shared layout owning Nav
  - useChat hook in src/lib/hooks/use-chat.ts
  - 5 pages migrated under (workspace)/
  - project_id forward-compat field on POST /api/chat body (unused in 04-01)

affects: [04-02, 04-03, 04-04]

key-files:
  created:
    - src/app/(workspace)/layout.tsx
    - src/lib/hooks/use-chat.ts
  modified:
    - src/app/(workspace)/page.tsx (moved from src/app/page.tsx, Nav stripped, refactored to useChat)
    - src/app/(workspace)/documents/page.tsx (moved, Nav stripped)
    - src/app/(workspace)/documents/[id]/page.tsx (moved, Nav stripped from 3 render paths)
    - src/app/(workspace)/upload/page.tsx (moved, Nav stripped)
    - src/app/(workspace)/doctrines/page.tsx (moved, Nav stripped)

key-decisions:
  - "Used Next.js 16 route group (workspace) so layout.tsx wraps every workspace page without affecting URLs"
  - "Stripped inline Nav from all 5 pages in one go — no inconsistency between pages that use the layout and pages that don't"
  - "useChat is a faithful direct extraction (not a redesign) — same SSE parsing, same state shape, same payload — proven by manual smoke test"
  - "project_id added to POST /api/chat body as optional forward-compat for 04-03; no backend change needed because the route handler ignores unknown fields"
  - "loadConversation + newChat wrapped in -AndClearPdf variants to keep PDF viewer reset on conversation switch (the only behavior the hook doesn't own)"
  - "useChat exposes setError for rename/delete failures in the host page"

duration: ~25min
completed: 2026-04-07
---

# Phase 04 — Plan 01 Summary

**Foundation refactor: (workspace) route group with shared Nav layout, all 5 pages migrated, useChat hook extracted from the 670-line home page**

## Accomplishments

- New `src/app/(workspace)/` route group with `layout.tsx` rendering Nav + `{children}`
- All 5 existing pages (`/`, `/documents`, `/documents/[id]`, `/upload`, `/doctrines`) migrated into `(workspace)/`
- Inline `<Nav />` import + JSX stripped from each migrated page (4 pages × 1 strip; the documents detail page had 3 render paths × 1 strip each)
- Outer wrapper changed `h-screen flex flex-col bg-white overflow-hidden` → `flex flex-1 flex-col bg-white overflow-hidden` so each page fills the row the layout provides
- `src/lib/hooks/use-chat.ts` created — exports `useChat(options, callbacks)` with full SSE parsing, conversationId/messages/streaming/error state, send/loadConversation/newChat functions
- Home page (`(workspace)/page.tsx`) refactored to consume `useChat` — dropped ~250 lines of state + SSE code
- `useChat` exposes `onConversationCreated` callback so the home page can refresh its sidebar conversation list when a brand-new conversation gets a session id
- `loadConversationAndClearPdf` / `newChatAndClearPdf` wrappers in the page so the PDF viewer resets on conversation switch (the only behavior the hook intentionally doesn't own)
- Added `project_id: projectId` to the POST `/api/chat` request body when `projectId` is set in `useChat` options (forward-compat for 04-03; sent as `undefined` from the home page so the existing route handler ignores it)
- TypeScript clean throughout (`npx tsc --noEmit` exit 0 after each task)

## Verification

- After Task 1: `curl /` → 200, single Nav bar visible
- After Task 2: all five URLs (`/`, `/documents`, `/documents/[id]`, `/upload`, `/doctrines`) → 200, single Nav bar
- After Task 3: chat SSE smoke test against `/api/chat` produced normal `session` → `routing` → `text` events; home page rendered the conversation correctly

## Task Commits

1. **Task 1: Create (workspace) route group, migrate home page** — `cd188e5` (refactor)
2. **Task 2: Migrate documents/upload/doctrines into (workspace)** — `bc6879c` (refactor)
   - Follow-up: stage page deletes left over from `mv` — `600a778` (refactor)
3. **Task 3: Extract useChat hook from home page** — `ed3650d` (refactor)

## Files Created

- `src/app/(workspace)/layout.tsx` — server component, renders Nav + `{children}`
- `src/lib/hooks/use-chat.ts` — `useChat` hook with full chat orchestration (327 lines)

## Files Moved

- `src/app/page.tsx` → `src/app/(workspace)/page.tsx`
- `src/app/documents/page.tsx` → `src/app/(workspace)/documents/page.tsx`
- `src/app/documents/[id]/page.tsx` → `src/app/(workspace)/documents/[id]/page.tsx`
- `src/app/upload/page.tsx` → `src/app/(workspace)/upload/page.tsx`
- `src/app/doctrines/page.tsx` → `src/app/(workspace)/doctrines/page.tsx`

## Files Modified

- 5 migrated pages: stripped inline Nav, adjusted root wrapper from `h-screen` → `flex-1`
- `src/app/(workspace)/page.tsx`: refactored to consume `useChat`, dropped local SSE parser, wrapped loadConversation/newChat for PDF reset

## Decisions Made

1. **Migrate all 5 pages in one plan, not just home + new** — Resolved RESEARCH.md Open Question #2 in favor of moving everything. Leaving inconsistency (some pages render their own Nav, some get it from layout) is worse than a slightly bigger plan.
2. **`useChat` is a direct extraction, not a redesign** — Same SSE parser logic, same state shape, same API payload. Only behavioral change: optional `project_id` field in the POST body, gated on `projectId` being set in options. Smoke-tested before commit.
3. **PDF reset stays in the page, not the hook** — The hook doesn't know about the PDF viewer (which is page-specific). Wrapped `loadConversation`/`newChat` with `-AndClearPdf` variants in the page; the wrapping is 8 lines and keeps the hook's surface clean for the workspace page in 04-03.
4. **`onConversationCreated` callback instead of pushing the conversation list into the hook** — The hook stays focused on a single conversation's lifecycle; sidebar list ownership stays with whichever component renders the sidebar. Prevents the hook from growing into a "manage everything" abstraction.
5. **Outer page wrappers use `flex-1`, not `h-screen`** — Children of a flex column layout fill the available row via `flex-1`, not by re-asserting `h-screen`. The layout owns the screen height.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Page deletes weren't staged after `mv`**
- **Found during:** Task 2 commit
- **Issue:** `mv` doesn't tell git about the move; `git add "src/app/(workspace)/"` only staged the new files. The old paths showed as unstaged deletes after the commit.
- **Fix:** Added a follow-up commit `600a778` staging the deletions explicitly with `git add -u`. Git now records the rename across the two commits.
- **Files modified:** removed src/app/{documents,upload,doctrines}/page.tsx and src/app/documents/[id]/page.tsx
- **Verification:** `git status` clean for those paths; `git log --follow` traces the history correctly.
- **Committed in:** 600a778

**2. [Rule 2 — Missing critical] `setError` exposed from useChat**
- **Found during:** Task 3 (refactoring the page to use the hook)
- **Issue:** The page's `renameConversation`/`deleteConversation` functions called `setError` directly when the rename/delete fetch failed. After moving error state into the hook, these functions had no way to surface errors.
- **Fix:** Added `setError` to the `UseChatResult` shape and returned it from the hook. Page consumers can still set errors on rename/delete failures.
- **Files modified:** src/lib/hooks/use-chat.ts, src/app/(workspace)/page.tsx
- **Verification:** Type-check clean; rename/delete handlers in the page compile against the new return shape.
- **Committed in:** ed3650d (part of the Task 3 commit)

### Deferred Enhancements

None — this was a refactor-only plan; no new features to defer.

---

**Total deviations:** 2 auto-fixed (1 git workflow, 1 missing critical), 0 deferred
**Impact on plan:** Both auto-fixes were necessary for correctness. No scope creep.

## Issues Encountered

None — the plan executed cleanly. The two deviations above were small fix-ups during execution, not problem-solving against unexpected blockers.

## Next Phase Readiness

Ready for **04-02-PLAN.md** (ProjectSidebar + CreateProjectDialog + server actions). The `(workspace)/layout.tsx` is the home for the new sidebar; `useChat` is ready to be used by the workspace page in 04-03 with `projectId` set. The existing chat-sidebar.tsx is still in place — it gets deleted in 04-02 when the new ProjectSidebar replaces it.

---
*Phase: 04-sidebar-workspace*
*Completed: 2026-04-07*
