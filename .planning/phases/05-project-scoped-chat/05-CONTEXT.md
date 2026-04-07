# Phase 05: Project-Scoped Chat — Context

**Gathered:** 2026-04-07
**Status:** Ready for planning

<vision>
## How This Should Work

When the user is chatting inside a project, the model should:

1. **Always know which project it's in** — `project.context_summary` gets injected into the system prompt up front
2. **Always have access to the project's documents** — they're seeded into the evidence pack as DOC-1..DOC-N before any retrieval happens
3. **Still see general legal context** — laws, decrees, doctrines, and any PUBLIC/DOCTRINE-classified documents remain available globally
4. **Not see other projects' private material** — PRIVATE documents linked to OTHER projects are excluded (no cross-deal leakage)
5. **Pull memory from the project first** — project-scoped memories rank above global ones
</vision>

<essential>
## What Must Be Nailed

The **additive retrieval rule**:

| Document classification | Linked to THIS project | Linked to ANOTHER project | Unlinked |
|---|---|---|---|
| `DOCTRINE` | Always included | Always included | Always included |
| `PUBLIC` | Always included | Always included | Always included |
| `PRIVATE` | Always included (boosted) | **Excluded** | Available, down-weighted |

This is the rule the user explicitly stated: project context is **additive**, not exclusionary. Universal legal docs (laws, amendments, decrees) and the doctrines stay available no matter which project you're in. Only private material from OTHER projects is hidden.

</essential>

<boundaries>
## What's Out of Scope

- Schema changes — `conversation_memory.project_id` already exists from Phase 03-01
- New tables — none needed
- Re-routing the model selection — Phase 05 keeps Opus deep / GPT-4o-mini casual
- A "switch project" UI — Phase 04's sidebar already handles that
- New tool — the existing 5 tools still work; they just see project context now via the system prompt
- Memory `project_id` backfill — old memories stay `project_id = NULL` (global pool); new memories created in a project get tagged

</boundaries>

<specifics>
## Specific Ideas

- **`runChatTurn` reads `conversation.project_id` at the top** — both the new-conversation and continue-conversation routes already write/read this field, so the helper can fetch it once and use it throughout
- **Project documents become the first evidence block** — labeled `PROJECT-DOC-N` (matching the use scenario the user described), distinct from general retrieval `DOC-N`
- **Exclusion is post-filter on hybridSearch results**, not a SQL change to the `hybrid_search` RPC function (avoids a migration)
- **Memory retrieval gets a `projectId` parameter** — if set, project-tagged memories rank above global ones; both pools merged into the final 8
- **New memories inherit the conversation's project_id** — `storeMemories` reads from the conversation row

</specifics>

<notes>
## Additional Context

The `project_id` field is already on the `conversations` table (added in Phase 03-01) and is correctly populated by the chat API (Phase 04-03 fix). `runChatTurn` just doesn't read it yet. This phase plumbs that one field through the orchestration.

The biggest risk is regression on the global chat flow (no project). Solution: when `project_id` is null, behavior is identical to the current global mode. The new code paths only activate when `project_id` is set.
</notes>

---

*Phase: 05-project-scoped-chat*
*Context gathered: 2026-04-07*
