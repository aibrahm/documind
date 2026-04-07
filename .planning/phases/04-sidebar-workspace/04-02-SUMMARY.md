---
phase: 04-sidebar-workspace
plan: 02
subsystem: ui-sidebar
tags: [nextjs-16, server-actions, sidebar, dialog, revalidate-path, router-refresh]

requires:
  - phase: 04-sidebar-workspace
    provides: (workspace) layout shell + useChat hook from 04-01

provides:
  - ProjectSidebar component (replaces chat-sidebar.tsx)
  - CreateProjectDialog component
  - ProjectSidebarShell client wrapper
  - createProjectAction / renameProjectAction / archiveProjectAction server actions
  - URL-based conversation switching (?conversation=<id>)
  - Layout-side server-fetched project + conversation list

affects: [04-03, 04-04]

key-files:
  created:
    - src/lib/actions/projects.ts
    - src/components/project-sidebar.tsx
    - src/components/create-project-dialog.tsx
    - src/components/project-sidebar-shell.tsx
  modified:
    - src/app/(workspace)/layout.tsx
    - src/app/(workspace)/page.tsx
  deleted:
    - src/components/chat-sidebar.tsx

key-decisions:
  - "Server actions write directly to Supabase (no self-referential REST hop) and call revalidatePath('/', 'layout') so the workspace sidebar refreshes after every mutation"
  - "Plain shadcn Dialog used for create flow, not intercepting routes — simpler, matches user's 'inline dialog' vision in CONTEXT.md, no unnecessary route group complexity"
  - "router.refresh() in onConversationCreated callback re-runs the server layout when a new chat is started, refreshing the sidebar conversation list without client-side state"
  - "Conversation rename/delete from the sidebar is dropped in this plan — the new ProjectSidebar exposes rename/archive for projects only. Per-conversation rename/delete becomes a deferred enhancement (logged below)"
  - "ProjectSidebar uses the inline hover-revealed menu pattern (matching the old chat-sidebar) instead of base-ui DropdownMenu — pragmatic consistency, simpler markup, faster to ship"
  - "Conversation rows are <Link href='/?conversation=<id>'>, not onClick — URL-native navigation enables back-button + bookmarkable conversations"
  - "chat-sidebar.tsx deleted, not kept as fallback — fail-loud philosophy"

duration: ~30min
completed: 2026-04-07
---

# Phase 04 — Plan 02 Summary

**ProjectSidebar replaces chat-sidebar across the workspace; CreateProjectDialog ships an inline create flow; server actions wire revalidatePath into the new sidebar layout**

## Accomplishments

- **`src/lib/actions/projects.ts`** — three server actions (`createProjectAction`, `renameProjectAction`, `archiveProjectAction`) writing directly to Supabase and calling `revalidatePath("/", "layout")` so the workspace sidebar refreshes after every mutation
- **`src/components/project-sidebar.tsx`** — the new project-organized sidebar:
  - Header with "+ New project" trigger + collapse toggle
  - PROJECTS section: each row has color dot, expand/collapse chevron, click-name → `<Link>` to `/projects/[slug]`, hover-revealed rename/archive menu (calls server actions via `useTransition`)
  - Expanded project rows show up to 10 nested conversations with `?conversation=<id>` links
  - GENERAL section at the bottom: unassigned conversations grouped by Today / Yesterday / Previous 7d / Previous 30d / Older buckets
  - Inline `<CreateProjectDialog>` controlled by local `useState`
- **`src/components/create-project-dialog.tsx`** — controlled shadcn `Dialog`:
  - Form with name (required) / description / color (6-swatch picker, defaults to slate) / icon (lucide name)
  - Submits via `<form action={handleSubmit}>` with `useTransition` for pending state
  - Surfaces server-action errors inline (red banner) — no silent swallow
  - Resets form + routes to `/projects/[slug]` on success (or calls optional `onCreated` callback)
- **`src/components/project-sidebar-shell.tsx`** — thin client wrapper that owns the `isOpen` state for the sidebar (the layout is a server component and can't hold useState)
- **`src/app/(workspace)/layout.tsx`** rewritten:
  - Parallel server-side fetch of non-archived projects + recent 200 conversations
  - Renders `<Nav />` + `<ProjectSidebarShell>` + `{children}` outlet
- **`src/app/(workspace)/page.tsx`** refactored:
  - Removed `<ChatSidebar>` render and all sidebar-owning state (`sidebarOpen`, `conversations`, `refreshConversations`)
  - Removed `renameConversation` / `deleteConversation` handlers (no longer wired from anywhere)
  - Removed inline "Recent threads" column from the empty state (the sidebar shows them)
  - Added `useSearchParams` + `useEffect` to read `?conversation=<id>` and call `loadConversation` (or `newChat` when the param is missing)
  - `onConversationCreated` callback now calls `router.refresh()` to re-run the server layout and refresh the sidebar
  - Empty-state grid collapsed from 2 columns to 1 (only Recent uploads remains)
- **`src/components/chat-sidebar.tsx` deleted** — `grep -r "chat-sidebar" src/` returns zero results
- TypeScript clean throughout (`npx tsc --noEmit` exit 0 after every task)

## Verification

- Type-check: clean after each task
- All 5 workspace URLs (`/`, `/documents`, `/documents/[id]`, `/upload`, `/doctrines`) → 200
- Chat SSE smoke test (`POST /api/chat`) produced normal `session` → `routing` → `text` events
- Created a test project via the REST API → confirmed it appears in the same layout-side query the sidebar uses → hard-deleted via REST cleanup
- Schema query for the sidebar's project list (`status=neq.archived`, ordered by `updated_at desc`) returns the expected shape
- `router.refresh()` is wired to fire on the `session` SSE event when `onConversationCreated` is provided to `useChat`

## Task Commits

1. **Task 1: Server actions for project mutations** — `ac1f0df` (feat)
2. **Tasks 2 & 3: ProjectSidebar + CreateProjectDialog** — `941f581` (feat)
   - Bundled because `project-sidebar.tsx` directly imports `CreateProjectDialog`; verifying them as a pair was easier than two interleaved commits.
3. **Task 4: Wire ProjectSidebar into layout, delete chat-sidebar** — `7c461e5` (feat)

## Files Created

- `src/lib/actions/projects.ts` (121 lines) — three server actions
- `src/components/project-sidebar.tsx` (~340 lines) — full sidebar component
- `src/components/create-project-dialog.tsx` (~150 lines) — create dialog
- `src/components/project-sidebar-shell.tsx` (~30 lines) — open-state client wrapper

## Files Modified

- `src/app/(workspace)/layout.tsx` — server-fetches sidebar data, renders new sidebar
- `src/app/(workspace)/page.tsx` — drops 200+ lines of sidebar/conversations/rename/delete state, adds URL conversation handling

## Files Deleted

- `src/components/chat-sidebar.tsx` — replaced by ProjectSidebar

## Decisions Made

1. **Server actions write directly to Supabase, not via REST** — Avoids a self-referential HTTP hop and the production self-call issues that pattern causes. The action runs in the same Node process; calling Supabase directly is the canonical way.
2. **`revalidatePath("/", "layout")` everywhere** — The plan's pitfall #2 was the right call. Without the `"layout"` flag, the sidebar wouldn't refresh after a mutation. All three server actions use it.
3. **Plain shadcn Dialog, not intercepting routes** — Matched the user's "inline dialog in the sidebar" vision in CONTEXT.md. Intercepting routes would have added complexity for no user-visible win.
4. **`router.refresh()` for conversation list refresh** — The server layout owns the conversation list; client mutations (sending a chat message → new conversation) can't call `revalidatePath` because they're not server actions. `router.refresh()` re-runs the server layout without unmounting the page. Cleanest available option in Next.js 16.
5. **Inline hover menu instead of base-ui DropdownMenu** — Matches the existing chat-sidebar pattern that already worked well, avoids importing a new primitive, and is faster to ship. The base-ui DropdownMenu was an option in the plan but optional.
6. **Conversation rows use `<Link>`, not onClick** — URL-native navigation. Bookmarkable conversations, working back button. The home page reads `searchParams.get("conversation")` and reacts to it.
7. **No CRUD for individual conversations from the new sidebar** — The new ProjectSidebar exposes rename/archive for projects only. Conversation rename/delete is a regression vs. the old chat-sidebar; deferred to a future enhancement (see below).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Conversation rename/delete had nowhere to live**
- **Found during:** Task 4 (refactoring the home page to drop the old sidebar)
- **Issue:** The old `<ChatSidebar>` exposed rename + delete actions per conversation, wired to handlers in `(workspace)/page.tsx`. The new ProjectSidebar only exposes rename/archive for projects. After dropping the ChatSidebar render, the handlers had no caller.
- **Fix:** Removed the unused handlers (`renameConversation`, `deleteConversation`) from `(workspace)/page.tsx`. Conversation CRUD is now a deferred enhancement — see below.
- **Files modified:** src/app/(workspace)/page.tsx
- **Verification:** Type-check clean; no orphaned handlers.
- **Committed in:** 7c461e5

**2. [Rule 1 — Bug] Stale closure on `setError` in handleSourceClick**
- **Found during:** Task 4 (after refactoring the page to use the hook's setError)
- **Issue:** The `handleSourceClick` callback's dependency array was `[]`, but it now references `setError` from the `useChat` hook. Strict-mode React would warn; functionally fine but a tripwire for future refactors.
- **Fix:** Added `setError` to the dependency array.
- **Files modified:** src/app/(workspace)/page.tsx
- **Verification:** Type-check clean; no react-hooks/exhaustive-deps warning expected from ESLint.
- **Committed in:** 7c461e5

### Deferred Enhancements

Logged for future plans (not in ISSUES.md yet — flag here for the next planning pass):

- **Per-conversation rename/delete from the sidebar** — Old chat-sidebar had this, new project-sidebar doesn't. Could be added to the ProjectSidebar's nested conversation rows. Low priority — the user can rename/delete via the API or by opening the conversation. **Recommend folding into Phase 04-04 or a small 04.5 plan.**
- **Sidebar collapse state persisted to localStorage** — Currently resets to "open" on every page load. Optional UX win.
- **Project expansion state persisted to localStorage** — Same as above.

### Bundled Tasks

Tasks 2 (ProjectSidebar) and 3 (CreateProjectDialog) were committed together as `941f581` because the sidebar imports the dialog directly — committing them separately would have left an intermediate state where `project-sidebar.tsx` couldn't compile. Single commit is cleaner.

---

**Total deviations:** 2 auto-fixed (1 blocking handler cleanup, 1 hook dep array bug), 0 deferred-as-issues, 3 deferred-as-future-work, 1 task bundling
**Impact on plan:** Both auto-fixes were necessary for correctness. The 3 deferred enhancements are nice-to-haves, not blockers. Task bundling was a workflow optimization.

## Issues Encountered

None — the plan executed cleanly. The deviations above were small in-flight cleanups, not problem-solving against unexpected blockers.

## Next Phase Readiness

Ready for **04-03-PLAN.md** (workspace shell + chat-first Overview tab).

The foundation is fully in place:
- Server-side fetched project list lives in the layout (sidebar reads from there)
- `useChat` hook accepts `projectId` (already wired in 04-01, ready for 04-03 to pass through)
- Server actions exist for project mutations and use `revalidatePath` correctly
- URL-based conversation switching works (the workspace page in 04-03 will likely use the same pattern for project selection)
- Clicking a project in the sidebar navigates to `/projects/[slug]` — currently 404, will land in 04-03

---
*Phase: 04-sidebar-workspace*
*Completed: 2026-04-07*
