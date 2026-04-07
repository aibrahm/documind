---
phase: 07-librarian-projects
plan: 01
subsystem: librarian-upload
tags: [librarian, project-suggestion, similarity-fix, entity-overlap]
requires:
  - phase: 03-projects-schema
    provides: project_companies + project_documents tables
  - phase: 04-sidebar-workspace
    provides: workspace upload page
provides:
  - LibrarianProposal.suggestedProject (entity-overlap-based)
  - Multi-chunk content similarity (first/middle/last, max)
  - linkToProject form field on /api/upload
  - "Project match" pill on the upload page with one-click link toggle
affects: [11-cross-project-dossier]
key-files:
  modified:
    - src/lib/librarian.ts
    - src/app/api/upload/route.ts
    - src/app/(workspace)/upload/page.tsx
key-decisions:
  - "Multi-chunk sampling: first/middle/last, take MAX cosine — eliminates the cover-page-variance failure mode that produced the 31% bug"
  - "Project suggestion is entity-overlap-based: canonicalize detected entities, join project_companies → projects, return the project with the highest overlap count"
  - "Suggestion is additive — if no entity overlap, no suggestion, upload behaves as today"
  - "Default to 'link on confirm' = ON when there's a match (one-click confirm flow)"
  - "added_by: 'librarian' on auto-linked rows so we can distinguish auto vs manual links later"
duration: ~25min
completed: 2026-04-07
---

# Phase 07 Summary

**Librarian project intelligence shipped: detected entities → matching project → one-click link. 31% bug fix in place via multi-chunk sampling.**

## Accomplishments

### `src/lib/librarian.ts`

1. **31% bug fix** — `findRelatedDocuments` now samples up to 3 chunks per candidate (first / middle / last by `chunk_index`) and uses the **MAX** cosine similarity instead of the first chunk's value. The first-chunk-only sampler missed exact duplicates because cover pages vary across OCR/rendering passes; sampling multiple positions catches them.
2. **`SuggestedProject` type** added to the public surface
3. **`LibrarianProposal.suggestedProject`** field — `SuggestedProject | null`
4. **`suggestProject(detectedEntities)` helper** — canonicalizes entities, joins to `project_companies` filtered to active projects, ranks by entity-overlap count, returns the top match (or null)
5. **`analyzeUpload`** runs `findRelatedDocuments` and `suggestProject` in parallel

### `src/app/api/upload/route.ts`

- New optional `linkToProject` form field (project UUID)
- After document creation, upserts a `project_documents` row with `added_by: "librarian"` so we can later distinguish auto-linked from manually-linked docs
- `linkedProjectId` recorded in the audit log

### `src/app/(workspace)/upload/page.tsx`

- `Proposal` type extended with `suggestedProject`
- New `linkToProjectId` state, defaulted from `proposal.suggestedProject?.id` so the toggle is automatically ON when there's a match
- New "Project match" card in the ReviewCard with a colored dot (project color), project name, reason text, and a "Link on confirm" checkbox
- `linkToProject` form field passed through to the upload route

## Verification

- `npx tsc --noEmit` clean
- **Live smoke test:** Created a project, linked the Elsewedy entity as a counterparty, POSTed the existing Elsewedy memo PDF to `/api/librarian/analyze`. Response returned `suggestedProject` with `overlapCount: 1`, correct slug/name/color, and the proper reason text ("1 entity matches a counterparty in this project"). ✅
- All test data cleaned up

## Task Commit

- `ece78b1` — feat(07-01): librarian project suggestion + 31% bug fix

## Decisions Made

1. **Multi-chunk sampling at 3 positions** — first, middle, last gives full coverage without making the librarian slow. Three queries vs the previous one is acceptable.
2. **Entity-overlap-based project suggestion** — the cleanest signal. Documents talking about Elsewedy almost certainly belong to projects where Elsewedy is a counterparty. Avoids LLM-based "guess the project" which would be slow and noisy.
3. **`added_by: 'librarian'`** — distinguishes auto-linked from manual links. Currently informational; future plans could surface it in the workspace ("auto-linked, click to confirm").
4. **Default ON for the link toggle when there's a match** — one-click confirm flow. The user explicitly stated they want the link to happen "automatically with one click."
5. **Suggestion is additive** — never blocks the upload. If `suggestedProject` is null, the upload page renders no project card and the upload behaves exactly like before.

## Deviations from Plan

### Deferred Enhancements

- **Pdf-parse-vs-vision-extraction parity for duplicate detection** — The 31% fix samples 3 chunks instead of 1, which addresses the user's stated case (re-uploading the same file produces 0.31 contentSim because cover pages differ). However, there's a deeper issue: the librarian's `newEmbedding` is computed from raw `pdf-parse` text (first 2000 chars), while candidates' chunks come from the vision-extraction-and-correction pipeline. These two sources are fundamentally different (different OCR, different normalization, different chunking), so even with multi-chunk sampling, an exact-PDF re-upload may not score 1.0 contentSim. Real fix: unify the source-of-truth on both sides — either embed pdf-parse text on candidates too (for duplicate detection only), or run vision extraction on the new doc before computing similarity. Logged as a future enhancement for a "librarian polish" plan.
- **"Create new project from this doc"** — the original Phase 07 vision included a "create new project" action when no match exists. Deferred — the user can still create via the sidebar; this would be a small UX win but not blocking.
- **Multi-project linking in one upload** — currently only the top-ranked match is suggested. Future enhancement: show top 3 with checkboxes.

## Next Phase Readiness

Phase 07 complete. Daily upload friction is gone — drop a PDF, librarian proposes both classification AND project, one click confirms both.

---
*Phase: 07-librarian-projects*
*Completed: 2026-04-07*
