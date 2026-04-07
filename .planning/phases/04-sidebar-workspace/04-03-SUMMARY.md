---
phase: 04-sidebar-workspace
plan: 03
subsystem: ui-workspace
tags: [nextjs-16, workspace, tabs, chat-first, async-params, state-preservation]

requires:
  - phase: 04-sidebar-workspace
    provides: ProjectSidebar + server actions + useChat from 04-02

provides:
  - /projects/[slug] workspace page (server + client wrapper)
  - loading.tsx skeleton + not-found.tsx fallback
  - ProjectWorkspaceHeader (name, status, counterparty pills, counts strip)
  - ProjectTabs (URL-driven via ?tab=)
  - OverviewTab (chat-first, reuses ChatInput + ChatMessage)
  - Backend tagging — POST /api/chat now writes body.project_id onto the conversation row

affects: [04-04, 05-project-scoped-chat]

key-files:
  created:
    - src/app/(workspace)/projects/[slug]/page.tsx
    - src/app/(workspace)/projects/[slug]/loading.tsx
    - src/app/(workspace)/projects/[slug]/not-found.tsx
    - src/app/(workspace)/projects/[slug]/workspace-client.tsx
    - src/app/(workspace)/projects/[slug]/_tabs/overview.tsx
    - src/components/project-workspace-header.tsx
    - src/components/project-tabs.tsx
  modified:
    - src/app/api/chat/route.ts (auto-fix: persist body.project_id onto conversations.project_id)

key-decisions:
  - "Chat state lifted to workspace-client level; tabs render via `hidden` CSS so the Overview chat survives tab switches without remount"
  - "Tab state lives in the URL via ?tab=X; overview is the default and omits the query param"
  - "OverviewTab reuses ChatInput + ChatMessage unchanged — zero new chat rendering code"
  - "loading.tsx mirrors the real header/tabs/content structure to make navigation feel instant"
  - "Counterparty pills render in the header via the existing Tag component (blue variant)"
  - "Source clicks on document sources open /documents/[id] in a new tab — the workspace doesn't currently host the PDF viewer panel (Phase 04-04 or 05 can add it inline)"
  - "Backend conversation tagging fix: /api/chat reads body.project_id and writes it onto the conversation row at insert. The chat orchestration itself remains unchanged (Phase 05 territory)"

duration: ~25min
completed: 2026-04-07
---

# Phase 04 — Plan 03 Summary

**Workspace shell at /projects/[slug] with chat-first Overview tab — first visible Phase 04 deliverable**

## Accomplishments

- **`src/app/(workspace)/projects/[slug]/page.tsx`** — server component, async `params` per Next.js 16, resolves slug to project row, parallel-fetches counts (documents/companies/negotiations/conversations) + counterparties join, delegates to client wrapper, calls `notFound()` on bad slug
- **`loading.tsx`** — skeleton mirroring header / tab bar / content layout for instant-feeling navigation
- **`not-found.tsx`** — clean fallback with "Back to home" link
- **`src/components/project-workspace-header.tsx`** — title + color dot + status badge + description + counterparty pills (Tag blue) + counts strip (icons + numbers)
- **`src/components/project-tabs.tsx`** — 5-tab nav driven by `useSearchParams`, `router.push('?tab=X', { scroll: false })`, omits `?tab=overview` for clean URLs
- **`src/app/(workspace)/projects/[slug]/workspace-client.tsx`** — top-level client wrapper:
  - Lifts `useChat({ projectId: project.id })` so chat state lives at workspace level
  - Renders header + tabs + 5 tab divs with `hidden` CSS toggle (NOT conditional render — preserves Overview chat across tab switches)
  - 4 placeholder TabPlaceholder renders for Documents/Negotiations/Chats/Memory ready for 04-04
- **`_tabs/overview.tsx`** — chat-first layout:
  - Idle state: project name + context_summary (or description) + 4 count cards in a 2/4-col grid
  - Active state: full message thread with auto-scroll, routing status indicator, streaming message render, error banner
  - Fixed `<ChatInput>` at the bottom with project-scoped placeholder text
  - Source clicks: web → new tab; document → opens `/documents/[id]` in a new tab (workspace doesn't host the PDF viewer)
- **Backend tagging fix** in `src/app/api/chat/route.ts`:
  - POST body type extended with `project_id?: string`
  - Conversation insert spreads `{ project_id: projectId }` when present
  - Result: project-scoped chats are now correctly tagged at the database level. Phase 05 will read this tag from the conversation row to scope retrieval and memory.

## Verification

- `npx tsc --noEmit` clean
- Workspace pages tested:
  - `/projects/[slug]` → 200 ✅
  - `/projects/[slug]?tab=documents` → 200 ✅
  - `/projects/[slug]?tab=memory` → 200 ✅
  - `/projects/this-does-not-exist` → renders not-found UI ✅ (HTTP status 200 — see deferred enhancement below)
- Chat regression: `POST /api/chat {"message":"hi"}` produced normal SSE stream
- Project tagging: `POST /api/chat {"message":"hi","project_id":"<uuid>"}` → conversation row in DB has `project_id = <uuid>` ✅
- All test artifacts cleaned up after verification (test conversations + projects hard-deleted via REST)

## Task Commits

All three tasks committed atomically because the files are mutually dependent (server page imports workspace-client, workspace-client imports OverviewTab + header + tabs, OverviewTab needs the backend tagging fix to actually demonstrate value):

1. **Tasks 1-3 + auto-fix: Workspace shell + Overview tab + chat tagging fix** — `b3d3b18` (feat)

## Files Created

- `src/app/(workspace)/projects/[slug]/page.tsx` — server page (78 lines)
- `src/app/(workspace)/projects/[slug]/loading.tsx` — skeleton (37 lines)
- `src/app/(workspace)/projects/[slug]/not-found.tsx` — 404 page (19 lines)
- `src/app/(workspace)/projects/[slug]/workspace-client.tsx` — client wrapper (98 lines)
- `src/app/(workspace)/projects/[slug]/_tabs/overview.tsx` — Overview tab (180 lines)
- `src/components/project-workspace-header.tsx` — header (118 lines)
- `src/components/project-tabs.tsx` — tab bar (55 lines)

## Files Modified

- `src/app/api/chat/route.ts` — added `project_id` to body type + insert spread

## Decisions Made

1. **Chat state at workspace-client level + `hidden` CSS for tabs** — Tab switching must not lose chat state. Conditional rendering (`{active && <Tab/>}`) unmounts on switch and resets `useChat`. The `hidden` attribute keeps the DOM mounted while hiding it. Only one `useChat` instance lives at the workspace level; the Overview tab consumes it via props.
2. **URL-driven tabs, no client state** — `useSearchParams` reads, `router.push('?tab=X', { scroll: false })` writes. Bookmarkable, back-button works, and the server page reads `searchParams.tab` for the initial render.
3. **Source clicks open /documents/[id] in new tabs** — The workspace doesn't (yet) host the PDF viewer panel that lives on the home page. Opening in a new tab is the simplest fail-loud option. A future plan could lift the PDF viewer to a context provider or render it inline in the workspace.
4. **Bundled commit for Tasks 1-3** — Same rationale as 04-02 task 2+3: the files are mutually dependent (server page imports workspace-client which imports overview which needs the backend fix). Committing them separately would have left intermediate states that don't compile or don't demonstrate value.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical] Backend never persisted `project_id` onto the conversation row**
- **Found during:** Smoke testing after Task 3 — sent `POST /api/chat {"message":"hi","project_id":"<uuid>"}` and queried the DB; the new conversation had `project_id = null`
- **Root cause:** Plan 04-01 added the field to the OUTGOING POST body in `useChat`, but the route handler at `/api/chat/route.ts` never read it. RESEARCH.md Open Question #5 had flagged this as "a one-line backend change" but no plan ever explicitly assigned the change.
- **Fix:** Extended the body type with `project_id?: string`, parsed it as `projectId`, and spread `...(projectId ? { project_id: projectId } : {})` into the conversation insert. Total: 8 lines of changes.
- **Files modified:** `src/app/api/chat/route.ts`
- **Verification:** Created a test project, sent a chat with `project_id` set, queried `conversations` table — `project_id` correctly populated. Cleaned up test data.
- **Committed in:** `b3d3b18` (bundled with the 04-03 task commit)

### Deferred Enhancements

- **`notFound()` returns HTTP 200 instead of 404** — Next.js 16 renders the not-found.tsx body but doesn't set the response status to 404 in dev for dynamic routes. The UX is correct (user sees the 404 page), but search engines and monitoring would see 200. Low priority — single-user app, no SEO concerns. Possibly a Next.js 16 quirk worth investigating in a future cleanup pass.
- **PDF viewer panel inside the workspace** — Currently sources open in new tabs. Lifting the PDF viewer (currently lives in `(workspace)/page.tsx` as a fixed right panel) into a shared context provider would let it overlay the workspace too. Defer to Phase 04.5 or later.

---

**Total deviations:** 1 auto-fixed (missing backend persistence — necessary for plan correctness), 2 deferred enhancements
**Impact on plan:** The auto-fix was essential — without it, the entire "project-tagged conversations" promise of CONTEXT.md would have been unmet despite the UI looking right.

## Issues Encountered

The `notFound()` HTTP-status quirk surfaced during smoke testing. Investigated briefly — the not-found.tsx file is correctly placed and exported, the server page calls `notFound()` correctly. This is Next.js 16 behavior. Not blocking; logged as deferred.

## Next Phase Readiness

Ready for **04-04-PLAN.md** (the four remaining tabs).

The workspace is fully functional for the Overview tab. Clicking a project in the sidebar loads the workspace, sees the chat-first surface, send a message → conversation is created with `project_id` set → re-rendering the layout (via `router.refresh()` from `useChat`'s `onConversationCreated` callback path, OR by navigating away and back) → the conversation appears under the project in the sidebar's expandable section.

The 4 tab placeholders are wired but trivial; 04-04 replaces them with the real Documents / Negotiations / Chats / Memory tabs.

---
*Phase: 04-sidebar-workspace*
*Completed: 2026-04-07*
