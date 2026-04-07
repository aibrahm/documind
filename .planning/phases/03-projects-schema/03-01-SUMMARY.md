---
phase: 03-projects-schema
plan: 01
subsystem: database
tags: [postgres, supabase, migration, schema, projects]
requires: [02-cleanup]
provides:
  - projects table
  - project_documents M:N
  - project_companies M:N
  - negotiations table
  - negotiation_documents M:N
  - conversations.project_id
  - conversation_memory.project_id
  - regenerated TS types
affects: [03-02, 03-03, 04-sidebar, 05-project-scoped-chat, 06-negotiations, 07-librarian-projects]
completed: 2026-04-06
key-files:
  created:
    - supabase/migrations/008_projects.sql
  modified:
    - src/lib/database.types.ts
key-decisions:
  - "Negotiations are first-class child tables of projects (1:N), not embedded in project metadata"
  - "conversation.project_id and conversation_memory.project_id are nullable — NULL = general/ephemeral pool"
  - "Project DELETE will be soft (status='archived') at the API layer; no schema-level soft-delete column"
  - "key_terms is a free-form JSONB on negotiations — extracted facts go here without a sub-schema"
  - "RLS not added — single-user, server-side service role only"
---

# Phase 03 — Plan 01 Summary

## Accomplishments

Landed the data foundation for the project-centric rebuild. Phases 04–07 can now import stable types for `projects`, `negotiations`, and the new M:N link tables.

- 5 new tables: `projects`, `project_documents`, `project_companies`, `negotiations`, `negotiation_documents`
- 2 ALTER statements adding nullable `project_id` to `conversations` and `conversation_memory`
- 10 indexes (matches migration body; the plan's verify-step comment said 11 but its own SQL had 10 — no functional issue)
- Migration applied to remote Supabase DB via `supabase db push --linked`
- All 5 new tables verified queryable via REST (returned `[]`)
- Existing conversations + memory rows confirmed to have `project_id: null` after the ALTER
- `src/lib/database.types.ts` regenerated from the live schema
- `npx tsc --noEmit` exited clean

## Task Commits

- `fe2b5ec` — feat(db): add projects + negotiations schema (008)

## Files Created

- `supabase/migrations/008_projects.sql` (104 lines)

## Files Modified

- `src/lib/database.types.ts` (regenerated; now includes all 5 new tables + new columns)

## Decisions Made

1. **Negotiations are first-class child tables (1:N)** — A project can own multiple negotiation threads (e.g. "Scenario 1 — Developer + Partnership" vs "Scenario 2 — Developer Only") with the same counterparty. Embedding in project metadata would have forced a single-scenario-per-project model.
2. **Nullable `project_id` on conversations and conversation_memory** — Preserves a "general / ephemeral" pool so the existing chat surface keeps working without assigning every turn to a project. Phase 05 will wire optional project injection.
3. **Soft-delete at API layer, not schema** — `projects.status` already has `archived` as a valid value. Avoiding a separate `deleted_at` column keeps the schema lean; the Phase 03 Plan 02 API will treat `archived` as "deleted".
4. **`key_terms` is free-form JSONB** — Extracted deal facts (tenor, ROU, equity split, etc.) go into a single JSONB column. Sub-schema can be added later if/when it stabilizes.
5. **No RLS** — Single-user system; all writes go through the service-role key. Matches the rest of the codebase.

## Deviations from Plan

- **Index count:** The plan's `<verify>` block said "returns 11" but the migration body itself defined 10 indexes. Kept 10; matches the actual SQL in the plan.
- **Type regen noise-stripping:** Not needed. Supabase CLI v2.48.3 already writes the banner to stderr, so `> /tmp/dbtypes.ts` captured only the clean TypeScript. Skipped the `sed` step.

## Issues Encountered

None. Clean run.

## Next Phase Readiness

Ready for **03-02-PLAN.md** (project CRUD endpoints). The type system now exposes `Database['public']['Tables']['projects']`, etc., so the next plan can lift types directly from `src/lib/database.types.ts` without hand-rolling shapes.
