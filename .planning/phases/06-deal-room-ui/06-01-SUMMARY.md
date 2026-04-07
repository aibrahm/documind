---
phase: 06-deal-room-ui
plan: 01
subsystem: ui-workspace
tags: [negotiations, timeline, expandable, deal-room]
requires:
  - phase: 04-sidebar-workspace
    provides: workspace tabs from 04-04
  - phase: 03.5-analytical-tools
    provides: extract_key_terms output that auto-populates negotiation.key_terms
provides:
  - NegotiationDetail expandable component
  - Timeline view derived from existing data (no new tables)
  - Click-to-expand UX in the Negotiations tab
  - Key facts table per negotiation
affects: [09-save-as-artifact]
key-files:
  created:
    - src/components/negotiation-detail.tsx
  modified:
    - src/app/(workspace)/projects/[slug]/_tabs/negotiations.tsx
    - src/app/(workspace)/projects/[slug]/workspace-client.tsx
key-decisions:
  - "Timeline events derived from existing data (negotiation timestamps + project_documents.added_at + conversations.created_at) — no new tables, no new endpoints"
  - "Inline expansion via Set<id> state, not a separate route — keeps URL clean within /projects/[slug]"
  - "Multiple negotiations can be expanded simultaneously"
  - "Save-as-artifact remains Phase 09 — out of scope here"
duration: ~20min
completed: 2026-04-07
---

# Phase 06 Summary

**Negotiations tab gains an expandable deal-room view: click → see timeline + key facts derived from existing data, no new tables.**

## Accomplishments

### `src/components/negotiation-detail.tsx` (new)

- Renders below an expanded negotiation card
- **Key facts table** — every key_terms field as a label/value row with locale-aware number formatting (`Math.abs(v) >= 1_000_000` → comma-separated), Arabic-friendly word-break, and a fallback "no key terms recorded yet" message that hints at the `extract_key_terms` tool from Phase 03.5
- **Timeline strip** — events derived from existing data:
  - `negotiation.opened_at` → "Negotiation opened"
  - `negotiation.updated_at` (when ≠ opened_at) → "Last updated"
  - `negotiation.closed_at` → "Closed: <status>"
  - `project_documents.added_at` → "Document linked"
  - `conversations.created_at` (project-tagged) → "Conversation"
- All sorted descending by date
- Fetches docs + conversations from existing API endpoints on mount

### `src/app/(workspace)/projects/[slug]/_tabs/negotiations.tsx`

- Each negotiation card is now a button that toggles expansion
- New `expanded: Set<string>` state allows multiple cards open at once
- ChevronRight/ChevronDown icon rotates on expand
- Collapsed state still shows the inline key_terms grid preview (max 6 fields)
- Expanded state hides the preview and renders `<NegotiationDetail/>`
- New `projectSlug` prop wired in from `workspace-client.tsx`

### `src/app/(workspace)/projects/[slug]/workspace-client.tsx`

- Passes `projectSlug={project.slug}` to `<NegotiationsTab />`

## Verification

- `npx tsc --noEmit` clean
- Live smoke test: created a project, linked a document, created a negotiation with key_terms, sent a chat to get a project conversation. All four data sources for the timeline produced events. Workspace page rendered, tab API endpoints all returned data. Cleaned up.

## Task Commit

- `23167eb` — feat(06-01): expandable deal-room view in Negotiations tab

## Decisions Made

1. **Derive timeline from existing data, no new tables** — the user's vision was a deal-room view, not a new event-sourcing system. Pulling existing timestamps gives 80% of the value with 0% schema cost.
2. **Inline expansion, not a separate page** — keeps URL clean (`/projects/[slug]?tab=negotiations`), preserves the workspace shell, plays well with the `hidden` CSS tab pattern from Phase 04.
3. **Multi-expand allowed** — different from a typical "single open accordion." For comparing scenarios side-by-side in the same view, multi-expand is the right call.
4. **Empty-state hint to `extract_key_terms`** — when a negotiation has no key_terms, the empty state mentions the tool by name. Reinforces the discovery loop: chat → extract → display.

## Deviations from Plan

None — straightforward composition.

## Issues Encountered

None.

## Next Phase Readiness

Phase 06 complete. The workspace now feels like a real deal-room: open a negotiation, see the timeline, see the structured facts, click into linked docs. Phase 09 (save-as-artifact + persistent timeline events table) is the natural follow-up.

---
*Phase: 06-deal-room-ui*
*Completed: 2026-04-07*
