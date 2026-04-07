---
phase: 04-sidebar-workspace
plan: 04
subsystem: ui-workspace-tabs
tags: [nextjs-16, tabs, rest, fail-loud]

requires:
  - phase: 04-sidebar-workspace
    provides: workspace shell + Overview tab + tab placeholders from 04-03

provides:
  - DocumentsTab (project_documents joined to documents)
  - NegotiationsTab (filterable by project_id, key_terms render)
  - ChatsTab (cross-links to home chat surface via ?conversation=)
  - MemoryTab (honest empty state)
  - Complete /projects/[slug] workspace — all 5 tabs functional

affects: [05-project-scoped-chat, 06-negotiations]

key-files:
  created:
    - src/app/(workspace)/projects/[slug]/_tabs/documents.tsx
    - src/app/(workspace)/projects/[slug]/_tabs/negotiations.tsx
    - src/app/(workspace)/projects/[slug]/_tabs/chats.tsx
    - src/app/(workspace)/projects/[slug]/_tabs/memory.tsx
  modified:
    - src/app/(workspace)/projects/[slug]/workspace-client.tsx (replaced TabPlaceholder with real tabs, deleted helper)

key-decisions:
  - "Each tab client-fetches via useEffect on mount (pragmatic v1) — no SWR / React Query / server-side prefetch yet"
  - "MemoryTab is an honest 'coming in Phase 05' state, not a fake render of unrelated memories"
  - "Documents + Chats use slug-based URLs (resolveProjectId handles them); Negotiations uses project UUID (the API filters by project_id=uuid)"
  - "Every tab handles loading + empty + error + populated visibly — no silent fallbacks"
  - "Tab content keeps the `hidden` CSS pattern from 04-03 so Overview chat state survives switching"

duration: ~15min
completed: 2026-04-07
---

# Phase 04 — Plan 04 Summary

**All four remaining workspace tabs (Documents / Negotiations / Chats / Memory) wired in — Phase 04 complete**

## Accomplishments

- **`_tabs/documents.tsx`** — fetches `/api/projects/[slug]/documents`, renders each linked doc as a card row with type/classification tags, page count, link role; click navigates to `/documents/[id]`
- **`_tabs/negotiations.tsx`** — fetches `/api/negotiations?project_id=<uuid>`, status badge (blue/green/amber/red/default per state), key_terms grid (max 6 fields rendered as label/value pairs)
- **`_tabs/chats.tsx`** — fetches `/api/projects/[slug]/conversations`, each row shows title + mode + first query line + timestamp, click links to `/?conversation=<id>` which loads in the home chat surface
- **`_tabs/memory.tsx`** — pure empty state with the "coming in Phase 05" honesty (no fetch, no fake data)
- **`workspace-client.tsx`** updated:
  - Imports the four real tab components
  - Replaced all four `<TabPlaceholder />` calls with real renders
  - Removed the `TabPlaceholder` helper function
  - Tab content still uses `hidden` CSS so Overview chat survives switching
- All four tabs handle loading + error + empty + populated states visibly (fail-loud)

## Verification

- `npx tsc --noEmit` clean
- End-to-end smoke test:
  - Created a test project, linked a real document, created a negotiation with key_terms, sent a project-tagged chat
  - All 5 tab URLs returned 200 (`?tab=overview|documents|negotiations|chats|memory`)
  - Tab API endpoints returned the seeded data:
    - Documents: 1 row, title `"Memo Regarding Elsewedy Electric Proposal"`
    - Negotiations: 1 row, name `"Scenario A — baseline"`, key_terms preserved
    - Conversations: 1 row, title `"hello project"`
  - All test artifacts cleaned up via direct REST DELETE

## Task Commits

1. **Tasks 1-5: Wire 4 remaining workspace tabs** — `7646fc4` (feat)
   - Bundled into one commit because the wiring step (Task 5) requires all four tab files to exist; splitting would have left intermediate broken states.

## Files Created

- `src/app/(workspace)/projects/[slug]/_tabs/documents.tsx` (~115 lines)
- `src/app/(workspace)/projects/[slug]/_tabs/negotiations.tsx` (~125 lines)
- `src/app/(workspace)/projects/[slug]/_tabs/chats.tsx` (~115 lines)
- `src/app/(workspace)/projects/[slug]/_tabs/memory.tsx` (~20 lines)

## Files Modified

- `src/app/(workspace)/projects/[slug]/workspace-client.tsx` — imports + 4 placeholder replacements + removed `TabPlaceholder` helper

## Decisions Made

1. **Client-side fetching via `useEffect`** — Pragmatic v1. Server-side fetching with React Query would be cleaner but adds dependencies and complexity. Tab data is small and fetched once per mount; the user won't notice.
2. **Memory tab is empty + honest** — Resolved RESEARCH.md Open Question #4 with explicit Phase 05 reference. No fake data, no fetch.
3. **Documents/Chats use slug, Negotiations uses UUID** — Mirrors the underlying APIs from Phase 03. `resolveProjectId` handles slug-or-UUID at the project level; the negotiations endpoint filters by `project_id=<uuid>` directly.
4. **Bundled commit for all 5 tasks** — Tasks 1-4 create files that compile in isolation, but Task 5 (wiring) requires all four to exist. Bundling keeps git history clean.
5. **No drag-and-drop or in-tab CRUD** — Per CONTEXT.md boundaries. Documents/companies/negotiations are read-only in the workspace tabs for v1; the full deal-room UI is Phase 06 territory.

## Deviations from Plan

None — the plan executed exactly as written. No auto-fixes needed.

## Issues Encountered

None.

## Next Phase Readiness

**Phase 04 is complete.** The project-centric metaphor is fully visible:

- Sidebar lists projects with expandable conversation lists + General bucket
- Inline create-project dialog
- `/projects/[slug]` workspace with Overview / Documents / Negotiations / Chats / Memory tabs
- Chat-first Overview tab where new conversations get tagged with `project_id`
- All link operations (project_documents, project_companies, negotiations) reflect in the tabs

**Recommended next phases:**

1. **Phase 05 — Project-scoped chat behavior** (the natural follow-on): make `runChatTurn` read `conversation.project_id`, inject project `context_summary` into the system prompt, boost project documents in retrieval, scope memory to the project. Phase 04 set up the data; 05 makes it intelligent.

2. **Phase 03.5 — Tier 1 analytical tools** (alternative): the plan was already drafted for `financial_model` / `fetch_url` / `extract_key_terms` / `compare_deals`. Eliminates math errors and auto-populates negotiation key_terms.

Either phase is ready to plan / execute. 03.5 has a draft PLAN already (`.planning/phases/03.5-analytical-tools/`); Phase 05 needs `/gsd:discuss-phase 05` and `/gsd:plan-phase 05` first.

---
*Phase: 04-sidebar-workspace*
*Completed: 2026-04-07*
