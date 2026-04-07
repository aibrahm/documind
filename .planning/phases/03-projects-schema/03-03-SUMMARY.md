---
phase: 03-projects-schema
plan: 03
subsystem: api
tags: [rest, projects, membership, negotiations, m2m]
requires: [03-02]
provides:
  - /api/projects/[id]/documents GET POST DELETE
  - /api/projects/[id]/companies GET POST DELETE
  - /api/projects/[id]/conversations GET
  - /api/negotiations GET POST
  - /api/negotiations/[id] GET PATCH DELETE
affects: [04-sidebar, 05-project-scoped-chat, 06-negotiations, 07-librarian-projects]
completed: 2026-04-07
key-files:
  created:
    - src/app/api/projects/[id]/documents/route.ts
    - src/app/api/projects/[id]/companies/route.ts
    - src/app/api/projects/[id]/conversations/route.ts
    - src/app/api/negotiations/route.ts
    - src/app/api/negotiations/[id]/route.ts
key-decisions:
  - "M:N link operations are upsert with onConflict — idempotent and update role on re-link"
  - "project_documents GET filters out non-current document versions in JS (PostgREST join can't easily filter joined rows)"
  - "project_companies PK is (project_id, entity_id, role) — same entity can be linked twice with different roles; DELETE requires both entity_id and role"
  - "Negotiations have UUID-only routing; no slug because they're typically referenced via parent project"
  - "key_terms is intentionally schema-free JSONB; only validated as object, structure imposed by clients"
  - "Conversations endpoint is GET-only — assignment to a project happens via PATCH on the conversation itself"
---

# Phase 03 — Plan 03 Summary

## Accomplishments

Shipped the project membership + negotiation REST surface. Phase 03 (data layer + CRUD foundation) is now complete and ready for Phase 04 to build UI on top.

**5 new route files** implementing:

- **Documents membership** (`/api/projects/[id]/documents`) — link, list (joined to documents, current versions only), unlink. Idempotent upsert lets re-linking update the role without duplicating rows.
- **Companies membership** (`/api/projects/[id]/companies`) — link with roles `counterparty | consultant | partner | investor | regulator`. Same entity can be linked under multiple roles (PK includes role).
- **Project conversations** (`/api/projects/[id]/conversations`) — GET only, ordered desc, optional `?limit` capped at 200.
- **Negotiations CRUD** (`/api/negotiations` + `/api/negotiations/[id]`) — full lifecycle: create (with project verification), list (filterable by `project_id` and `status`), get, patch, soft-delete (status='withdrawn').

All endpoints reuse `resolveProjectId` from `src/lib/projects.ts` so URL params accept either UUID or slug.

## Verification

`npx tsc --noEmit` exits 0.

**Task 1 — 11 smoke tests passed:**

1. POST link doc as `primary` → 201 `{added: 1}` ✅
2. GET project documents → 1 entry, role=`primary`, joined doc title present ✅
3. POST fake doc id → 404 `Documents not found: ...` ✅
4. POST bad role → 400 `Invalid role: frobnicated` ✅
5. POST same doc with new role → 201 (idempotent upsert) ✅
5b. GET → still 1 entry, role=`reference` ✅
6. DELETE `?document_id=...` → 200 `{removed: true}` ✅
8. POST link company as `counterparty` → 201 ✅
9. GET project companies → 1 entry, joined entity name `Elsewedy Electric` ✅
10. DELETE `?entity_id=...&role=counterparty` → 200 ✅
11. GET project conversations → 200 `{conversations: []}` ✅

**Task 2 — 11 smoke tests passed:**

1. POST create negotiation with `key_terms` JSONB → 201, full row, key_terms preserved ✅
2. GET `?project_id=...` → 1 negotiation ✅
3a. GET `?status=open` → 1 ✅
3b. GET `?status=closed_won` → 0 ✅
4. GET single by id → 200 ✅
5. PATCH `{status: "active", key_terms: {...new field}}` → 200, status + key_terms updated ✅
6. PATCH `{status: "frobnicated"}` → 400 ✅
7. PATCH `{made_up: "value"}` → 400 ✅
8. DELETE → 200, `{status: "withdrawn", closed_at: <iso>}` ✅
9. GET fake UUID → 404 ✅
10. POST missing `project_id` → 400 ✅
11. POST fake `project_id` → 404 ✅

**Chat regression check:** `POST /api/chat {"message":"hi"}` produced normal SSE stream with `session` and `routing` events.

**Cleanup:** All test rows (1 project, 1 negotiation, 0 link rows) hard-deleted from DB after verification — projects and negotiations tables are empty again.

## Task Commits

- `606bea3` — feat(api): project membership + negotiation endpoints

## Files Created

- `src/app/api/projects/[id]/documents/route.ts` (146 lines) — GET, POST, DELETE
- `src/app/api/projects/[id]/companies/route.ts` (132 lines) — GET, POST, DELETE
- `src/app/api/projects/[id]/conversations/route.ts` (32 lines) — GET only
- `src/app/api/negotiations/route.ts` (102 lines) — GET, POST
- `src/app/api/negotiations/[id]/route.ts` (98 lines) — GET, PATCH, DELETE

## Decisions Made

1. **`is_current` filter is JS-side, not in the join** — PostgREST embedded resource filters are awkward when the embedded row may be null. Filtering in JS after the query is simpler and the project document count is small enough to make it negligible.
2. **Companies role is part of the PK** — Lets the same entity be linked as both `consultant` and `partner` to one project (real scenario for advisory firms that also co-invest). DELETE therefore requires both `entity_id` and `role`.
3. **Conversations endpoint is GET-only** — Assignment of a conversation to a project will happen via the existing conversation PATCH endpoint (next phase). Keeps the surface area minimal here.
4. **Negotiations have no slug** — They're not the kind of thing you bookmark by URL the way you bookmark a project. The parent project's slug + a UUID is enough. Avoids slug-collision logic and the all-Arabic fallback case.
5. **`key_terms` validated as object only** — No sub-schema. The plan is to let the structure emerge from real usage; the financial-model tool in Phase 03.5 will be the first systematic writer.
6. **Reused `resolveProjectId`** — Both URL params (UUID and slug) work everywhere, exactly as Phase 04's URL bar will need.

## Deviations from Plan

1. **`Database['public']['Tables']['negotiations']['Insert']` typing required** — The plan's `Record<string, unknown>` insert object failed strict-mode TypeScript because Supabase's generated types now enforce required fields (`name`, `project_id`). Imported the strict `NegotiationInsert` type from `@/lib/database.types` and used it directly. Required `key_terms` to also be cast `as Json` after the runtime validation (since `typeof === "object"` narrows to `object`, not `Json`).
2. **Companies PK insight clarified in code** — The plan mentioned that the PK includes role. The DELETE handler validates the role param against the same `ALLOWED_ROLES` set as POST, returning 400 on mismatch — small extra protection the plan didn't explicitly require but matches the defensive style.

## Issues Encountered

- One TypeScript error round on `negotiations` POST. Fixed by importing the proper Supabase Insert type and casting `key_terms` as `Json`. Total ~2 minutes.
- No runtime issues. All 22 smoke tests passed on first run after the type fix.

## Next Phase Readiness

**Phase 03 (project schema + CRUD foundation) complete.** Ready for Phase 04 (project sidebar + workspace UI).

Phase 04 can now consume:
- `GET /api/projects?status=active` — sidebar list
- `GET /api/projects/[slug]` — project workspace header (with counts)
- `GET /api/projects/[slug]/documents | companies | conversations` — workspace tabs
- `GET /api/negotiations?project_id=...` — negotiations tab
- All mutation endpoints for the workspace edit affordances

`src/lib/projects.ts` exposes `slugify`, `uniqueSlug`, and `resolveProjectId` for any UI helpers (e.g., live-validating a slug as the user types a project name).
