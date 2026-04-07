# Phase 07: Librarian Project Intelligence — Context

**Gathered:** 2026-04-07
**Status:** Ready for planning

<vision>
## How This Should Work

When a user drops a PDF onto `/upload`, the librarian should — in addition to its existing classification/dedup/version analysis — suggest **which project this document belongs to** and offer a one-click link.

The mechanism: entity overlap with `project_companies`. If the document mentions Elsewedy Electric and there's a project where Elsewedy is a counterparty, the librarian proposes that project.

Plus: the long-standing **31% similarity bug** gets fixed. The librarian currently samples only ONE chunk per existing document for content similarity, which breaks for multi-page documents where the first chunk is a cover page or template.

</vision>

<essential>
## What Must Be Nailed

1. **Project suggestion is additive, never blocks the upload.** If no project matches, the upload still works exactly as today.
2. **31% bug is gone.** Re-uploading an exact PDF should be classified as `duplicate`, not `new`.
3. **The user can link from the upload UI** with one click — no curl, no separate page.

</essential>

<boundaries>
## What's Out of Scope

- Auto-creating a project from an upload — defer ("create new project" remains a sidebar action; the librarian only SUGGESTS existing matches)
- Multi-project linking in one go — pick one project per upload
- Library agent retraining or prompt redesign
- Schema changes (the existing tables suffice)

</boundaries>

<specifics>
## Specific Ideas

- The `LibrarianProposal` shape gains an optional `suggestedProject` field: `{ id, slug, name, color, overlapCount, reason } | null`
- The upload page renders a small project pill below the existing recommendation card with a "Link to project" toggle (defaults to ON when confidence is high)
- The upload route accepts a new optional `linkToProject` form field; on success, it inserts a `project_documents` row alongside the document creation
- 31% bug fix: `findRelatedDocuments` samples up to 3 chunks per candidate (first, middle, last) and uses the **max** cosine similarity, not the first chunk's. Threshold for `duplicate` becomes ≥0.85 on the max.

</specifics>

<notes>
## Additional Context

The librarian is the most-touched piece of the system after chat. It's load-bearing and the user has explicitly said NOT to break the first-page extraction approach (per the codebase map). All changes should be additive.

The exact-duplicate failure case is documented in `.planning/codebase/CONCERNS.md` as the "31% similarity bug".
</notes>

---

*Phase: 07-librarian-projects*
*Context gathered: 2026-04-07*
