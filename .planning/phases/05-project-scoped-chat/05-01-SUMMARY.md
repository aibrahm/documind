---
phase: 05-project-scoped-chat
plan: 01
subsystem: chat-backend
tags: [retrieval, prompt-injection, memory, additive-rule]
requires:
  - phase: 04-sidebar-workspace
    provides: workspace + project_id tagging on conversations
  - phase: 03-projects-schema
    provides: project_documents + project_companies + conversation_memory.project_id
provides:
  - runChatTurn reads conversation.project_id
  - PROJECT-DOC-N evidence block (top of pack)
  - System prompt prefix with project context + counterparties
  - Hybrid search results filtered to exclude OTHER projects' PRIVATE docs
  - Document inventory filtered (no title leakage)
  - retrieveRelevantMemories accepts projectId for boosting
  - storeMemories writes project_id on new memories
affects: [06-deal-room-ui, 07-librarian-projects, 11-cross-project-dossier]
key-files:
  modified:
    - src/lib/chat-turn.ts
    - src/lib/memory.ts
key-decisions:
  - "Additive retrieval rule (per CONTEXT.md): project docs always boosted, PUBLIC and DOCTRINE always available globally, only OTHER projects' PRIVATE docs are excluded. Universal legal context (laws, decrees, doctrines) stays accessible no matter which project you're in."
  - "Exclusion is post-filter on hybridSearch results, not a SQL change to the hybrid_search RPC — avoids a migration"
  - "Document inventory also filtered to hide titles of excluded docs (closes the leak where the model could see another project's PRIVATE doc title)"
  - "Memory uses score boost (+3 same-project) and penalty (-2 other-project), not hard restriction. Global memories stay neutral so cross-cutting context like 'VC won't go below 18% rev share' still surfaces."
  - "New code paths gated on `if (projectId)` — global path (no project) is behaviorally unchanged"
duration: ~30min
completed: 2026-04-07
---

# Phase 05 Summary

**Project-scoped chat with additive retrieval — chat inside a project sees its docs first, keeps universal legal/doctrine context, and excludes other projects' private material**

## Accomplishments

`runChatTurn` now reads `conversation.project_id` and, when set:

1. **Loads project context** — `name`, `description`, `context_summary`, `color` + counterparty names from `project_companies`
2. **Computes excludedDocIds** — PRIVATE docs linked to OTHER projects (joins through `project_documents` then filters by `documents.classification`)
3. **Pre-fetches project-doc evidence** — runs an additional `hybridSearch(documentIds: projectDocIds)` and labels results `PROJECT-DOC-N` as the FIRST evidence block in the user message
4. **Filters global hybridSearch results** to exclude `excludedDocIds`
5. **De-dupes** global results against project-doc results so the same chunk doesn't appear twice
6. **Filters the document inventory** to hide titles of excluded docs (closes a leak where the model could see another project's PRIVATE doc title even though it couldn't read the chunks)
7. **Injects PROJECT CONTEXT block** into BOTH deep and casual system prompts: project name, description, context_summary, counterparties, and a citation hint
8. **Memory** — `retrieveRelevantMemories` boosts project-tagged memories by +3, penalizes other-project memories by -2, and `storeMemories` tags new memories with the conversation's project_id

## Verification

- `npx tsc --noEmit` clean
- **Negative test:** Linked the Elsewedy memo to project B, sent a chat tagged with project A — the model couldn't read the memo's content. Exclusion confirmed.
- **Positive test:** Linked the Elsewedy memo to project A, sent a deep-mode chat — `PROJECT-DOC-1` appeared in the sources event, model identified the Safaga deal from `context_summary` without being told, deep mode triggered correctly, web_search still fired for KIZAD benchmarks (PUBLIC corpus available).
- **Inventory leak test:** After fix, the casual prompt's DOCUMENT INVENTORY hides excluded titles.
- All test data cleaned up.

## Task Commit

- `3a7aebf` — feat(05-01): project-scoped chat with additive retrieval

## Decisions Made

1. **Additive over exclusionary** — per the user's explicit design call. The model still sees laws, decrees, and the doctrines globally; only other projects' PRIVATE material is hidden. This was the load-bearing design call for Phase 05.
2. **Post-filter, not SQL filter** — the hybrid_search RPC stays untouched. Filtering happens in TypeScript right after the call. Avoids a schema migration and keeps the SQL function reusable from any context.
3. **Memory score adjustment, not hard restriction** — global memories (project_id IS NULL) stay neutral so cross-cutting context surfaces in any project. Project-tagged memories rank above. Other-project memories rank below but aren't hidden (in case a relevant insight crosses deals).
4. **Inventory filter as a leak closure** — discovered during smoke test 1 that the model could still see titles of excluded docs in the inventory even though it couldn't read content. Fixed in the same plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Document inventory leaked excluded titles**
- **Found during:** First negative smoke test — model said "the document is titled 'Memo Regarding Elsewedy Electric Proposal'" then hallucinated [PINNED-1] as a citation, even though the Elsewedy memo was linked to a different project.
- **Root cause:** The casual-mode system prompt embeds a DOCUMENT INVENTORY listing all `status=ready` docs. The exclusion filter only applied to hybrid search results, not the inventory list.
- **Fix:** Added a `visibleDocs` filter that strips `excludedDocIds` from the inventory when in a project. Both the inventory listing and the count metadata in the prompt header use the filtered list.
- **Files modified:** src/lib/chat-turn.ts
- **Verification:** Type-check clean; the inventory length and content now reflect the project-filtered set when in a project.
- **Committed in:** 3a7aebf

### Deferred Enhancements

- **Project-doc / global-doc dedupe across DOC-N labels** — when a doc is linked to the project AND surfaces in global retrieval, it currently appears twice (once as PROJECT-DOC-N, once as DOC-N). The de-dupe is on chunk identity, not document identity. Cosmetic; the model still cites correctly.
- **Memory context_summary regeneration** — `project.context_summary` is set manually at create-time. A future plan could auto-update it as conversations accumulate. Phase 09/10 territory.

## Next Phase Readiness

Project-scoped chat is live. Ready for Phase 06 / 07 / 09 — all of which assume project-aware chat as the foundation.

---
*Phase: 05-project-scoped-chat*
*Completed: 2026-04-07*
