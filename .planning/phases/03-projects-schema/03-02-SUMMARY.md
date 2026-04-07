---
phase: 03-projects-schema
plan: 02
subsystem: api
tags: [rest, projects, crud, slug-resolution]
requires: [03-01]
provides:
  - /api/projects GET (list, optional ?status filter)
  - /api/projects POST (create with slug auto-gen)
  - /api/projects/[id] GET (with parallel membership counts)
  - /api/projects/[id] PATCH (whitelisted fields)
  - /api/projects/[id] DELETE (soft archive)
  - slug auto-generation with Arabic-only fallback
  - id-or-slug resolver
affects: [03-03, 04-sidebar, 05-project-scoped-chat]
completed: 2026-04-07
key-files:
  created:
    - src/lib/projects.ts
    - src/app/api/projects/route.ts
    - src/app/api/projects/[id]/route.ts
  modified:
    - src/lib/audit.ts
key-decisions:
  - "Slug fallback for all-Arabic names is a timestamp-based identifier; user can edit via PATCH"
  - "DELETE is soft (status=archived + closed_at) — no hard-delete API exposed"
  - "GET /api/projects (no filter) returns all statuses; clients filter via ?status=active"
  - "Counts are computed per-request via parallel COUNT(*) queries — fast enough at this scale, no caching"
  - "Extended AuditAction with project.create/update/archive — necessary deviation, audit.ts type union didn't anticipate the new actions"
---

# Phase 03 — Plan 02 Summary

## Accomplishments

Shipped the project CRUD API surface that Phase 04's sidebar and workspace UI will consume. The full lifecycle is now testable via REST: create → list → get-with-counts → update → soft-archive.

- 3 new files: `src/lib/projects.ts` (helper module) + 2 route files
- 1 modified file: `src/lib/audit.ts` (extended `AuditAction` union)
- Slug auto-generation: English → kebab-case, Arabic-only → `project-{base36}` timestamp fallback
- Slug clash auto-resolves with numeric suffix (`-2`, `-3`, ...) via `uniqueSlug()` pre-check + 23505 backstop
- ID-or-slug URL resolution via `resolveProjectId()` so `/projects/elsewedy-safaga` works alongside `/projects/{uuid}`
- Membership counts (documents, companies, negotiations, conversations) computed in parallel via 4 `count: "exact", head: true` queries
- Soft-delete only — DELETE sets `status=archived, closed_at=now()`; no hard-delete API exists
- Field-whitelist validation on POST and PATCH rejects unknown fields with 400
- Status enum validated against `{active, on_hold, closed, archived}`
- Audit log entries written for create/update/archive (fire-and-forget with `.catch(console.error)` per existing pattern)

## Verification

`npx tsc --noEmit` exits 0.

All 11 smoke tests passed against the running dev server on `:3004`:

1. POST create → 201, slug `el-sewedy-safaga-industrial-zone` ✅
2. GET list → 200, returns the project ✅
3. GET by slug → 200, includes counts `{documents: 0, companies: 0, negotiations: 0, conversations: 0}` ✅
4. GET by id (UUID) → 200, same shape ✅
5. PATCH `{description: "Updated"}` → 200, description updated, `updated_at` bumped ✅
6. PATCH `{status: "frobnicated"}` → 400 `Invalid status value` ✅
7. PATCH `{made_up: "value"}` → 400 `Unknown or read-only fields: made_up` ✅
8. POST same name → 201, slug auto-suffixed to `el-sewedy-safaga-industrial-zone-2` ✅
9. DELETE the clone → 200, `{status: "archived", closed_at: <iso>}` ✅
10a. GET `?status=active` → 1 result (active only) ✅
10b. GET `/api/projects` → 2 results (both statuses) ✅
11. GET `/api/projects/does-not-exist` → 404 ✅

Existing chat regression check passed: `POST /api/chat {"message":"hello"}` produced normal SSE stream with `session`/`routing`/`text` events.

Smoke-test rows were hard-deleted from the DB after verification (via direct REST DELETE) so the projects table is empty again, ready for real use.

## Task Commits

- `f4066b4` — feat(api): project CRUD endpoints

## Files Created

- `src/lib/projects.ts` (118 lines) — `isUuid`, `slugify`, `uniqueSlug`, `resolveProjectId`, `CREATE_FIELDS`, `UPDATE_FIELDS`
- `src/app/api/projects/route.ts` (101 lines) — GET list + POST create
- `src/app/api/projects/[id]/route.ts` (146 lines) — GET (with counts) + PATCH + DELETE (soft)

## Files Modified

- `src/lib/audit.ts` — added `"project.create" | "project.update" | "project.archive"` to `AuditAction` union

## Decisions Made

1. **Slug fallback for non-Latin names** — `slugify()` strips everything outside `[a-z0-9]`, so all-Arabic names collapse to empty. The fallback is `project-{Date.now().toString(36)}`, and the user can rename via PATCH. Avoids any complex Arabic-to-Latin transliteration logic.
2. **No hard-delete API** — DELETE always soft-archives. If a project ever needs to be truly removed, it can be done at the DB level via direct REST/SQL. This protects against accidental loss of historical context.
3. **Counts on per-request, no cache** — Four parallel `count: "exact", head: true` queries on the GET endpoint. At single-user scale this is well under the latency budget; revisit if it shows up in profiling.
4. **No `select("*")` in list endpoint** — Explicit column list to avoid leaking future sensitive columns and to keep payloads predictable.
5. **Field whitelists in `projects.ts`** — Both `CREATE_FIELDS` and `UPDATE_FIELDS` are exported `as const` arrays. Centralizing them in the helper module makes Phase 03-03 (and any future endpoints) reuse the same source of truth.

## Deviations from Plan

1. **`AuditAction` type extension required** — The plan called for `logAudit("project.create", ...)` etc., but `src/lib/audit.ts` defines `AuditAction` as a strict string-literal union that didn't include the new actions. Added `"project.create" | "project.update" | "project.archive"` to the union. Minor scope creep that the plan didn't anticipate, but unavoidable for type-correct code.
2. **Type cast on insertRow status** — Plan body had `filtered.status ?? "active"`, which TypeScript flagged because `filtered.status` is typed `unknown` in the validated record. Changed to `(filtered.status as string | undefined) ?? "active"`. The runtime check directly above (`typeof === "string" && ALLOWED_STATUS.has(...)`) makes the cast safe.
3. **Smoke-test cleanup** — After all 11 tests passed, hard-deleted both test rows from the DB via direct REST `DELETE` (not via the API, which would only soft-archive). Wanted to leave the table empty for real-world first use.

## Issues Encountered

None. The plan was thorough and all smoke tests passed on first run after fixing the two TypeScript issues above.

## Next Phase Readiness

Ready for **03-03-PLAN.md** (project membership and negotiation endpoints). Phase 03-03 will build on `src/lib/projects.ts` (`resolveProjectId` is already general-purpose) and the new tables `project_documents`, `project_companies`, `negotiations`, `negotiation_documents`. The auth/error/audit patterns established here are ready to be reused.
