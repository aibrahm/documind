# DocuMind — Project State

**Last updated:** 2026-04-07

## Current position

We have shipped the chat experience rebuild (Phase 01) plus a series of major iterative improvements that were not originally scoped:

- **Multi-turn chat with fluid intelligence routing** (casual / deep)
- **Autonomous web search via Claude Opus 4.6 tool use** — model decides when to call Tavily, results stream back as additional sources
- **Conversational UI rebuild** — single-column layout, real avatar, hover actions, source pills with favicons + domains, Arabic-Indic numerals when responding in Arabic
- **5 doctrines rewritten as flexible knowledge bodies** (master / legal / investment / negotiation / governance) with concrete benchmarks (KIZAD, JAFZA, Tangier MED, SCZone, Sokhna), creativity license, and explicit instruction to use training knowledge
- **Cross-conversation memory layer** — distilled facts/decisions/recommendations persisted and re-injected
- **Document attachments** in chat (ephemeral, per-turn) via `pdf-parse` + chips above input
- **`@` mention picker** for documents and entities — entities resolve to documents via name search even when not formally linked
- **Pinned documents and pinned entities** flow through the chat API as primary evidence with explicit `[PINNED-N]` citations
- **Entity canonicalization on upload** — fuzzy bilingual matching collapses "Elsewedy" / "El Sewedy Electric" / "السويدي إلكتريك" into one canonical row
- **Entity-aware retrieval** — when a query mentions a known entity, retrieval pre-filters to documents linked to it
- **`is_current = true` filter** on hybrid search and document lists — old versions hidden by default
- **Smart upload page** — librarian agent analyzes new documents quickly, proposes action (new / version / duplicate / related) before running the full extraction pipeline
- **Librarian core** (`src/lib/librarian.ts`) — entity extraction, KB similarity scoring, action recommendation
- **Conversation-aware web search queries** — router rebuilds search query from conversation topic when follow-up message is short ("retry", "this is old data")
- **Document picker, attachments, and pins** all dedupe and link properly to the entity graph
- **Tables stored as structured rows** in chunk metadata (not JSON strings)
- **Arabic-Indic digit normalization** in extraction post-processing (fixes the "2026 → 2023" date OCR bug)
- **ngrok tunnel** ready for sharing with the Vice Chairman

## What's working well

- Real analytical responses with NPV calculations, industry benchmarks, and concrete renegotiation proposals
- Autonomous web search rounds (15+ sources pulled per analytical query)
- Pinned entities resolve to relevant docs even when the entity has no formal link-table entry
- Inline `[PINNED-N]` citations are clickable and matched to source pills
- Memory layer carries insights across conversations
- The model can identify a public figure from an entity pin AND cite where they appear in the KB
- 02-01 cleanup complete: dead RAG pipeline removed, orphan deps cleaned
- 02-02 cleanup complete: shared types centralized in src/lib/types.ts, source variable naming normalized
- 02-03 cleanup complete: chat routes deduped via shared runChatTurn helper, ~800 lines of duplication eliminated

## Known debt and rough edges

Phase 02 (cleanup) addressed items 1-3 below; remaining debt:

1. ~~**Stale code from earlier iterations**~~ — resolved in 02-01
2. ~~**Two parallel chat routes**~~ — resolved in 02-03 (both delegate to runChatTurn)
3. ~~**Inconsistent naming**~~ — resolved in 02-02
4. **Console.error left throughout** — should be a proper logger or removed
5. **Type imports not normalized** — some files import types from `database.types.ts`, others define inline
6. **Long route handlers** — `/api/chat/route.ts` is now ~400 lines and doing too much; should be split
7. **Unused fields** — `audit_log` table exists but is barely written
8. **The `references` table** is created but the references-page UI never landed
9. **Migration numbers vs phase numbers diverged** — `supabase/migrations/007_conversation_memory.sql` exists but no `008` for projects yet
10. **The 31% similarity bug** — librarian recommends "new" for an exact-duplicate PDF because content sim only samples 1 chunk
11. **Stale `viewer/` route** that never landed in the new design
12. **`scripts/` directory** with one-off helper scripts that should be either moved to `tools/` or deleted
13. **`pipeline/` directory** (`adversarial-review.ts`, `deep-analysis.ts`, etc) is from an old multi-stage pipeline design that was replaced by the agentic chat — currently dead code
14. **Documents page** still has minor issues (filter UX, classification picker)

## What to NOT touch

- Any of the doctrine bodies in the database (just shipped, validated)
- The chat UI / chat-message component (just got the polish pass and the user is happy with it)
- The autonomous web search loop in `claude-with-tools.ts` (working correctly with the forced final-answer fallback)
- The librarian's first-page extraction approach (the right architecture)
- The entity canonicalization logic (just verified working)

## Decisions that have been made

- **Models**: Claude Opus 4.6 for deep mode (with tool use), GPT-4o-mini for casual mode (no tools), GPT-4o-mini for routing
- **Doctrine output format**: code-controlled via `doctrine.ts::buildDoctrinePrompt`, NOT in DB; DB doctrine bodies are knowledge only
- **Numeral handling**: extraction stores Western digits (search consistency), output uses Arabic-Indic digits when responding in Arabic
- **Pinned entities**: name-based corpus search runs in addition to link-table lookup, so unlinked entities still find related docs
- **Web search**: autonomous via Claude tool use in deep mode; router-decided one-shot in casual mode
- **Recent versions**: `is_current = true` filter is the default on documents listing and hybrid search

## Active session
2026-04-07 — phase 03 COMPLETE; phase 04 in progress (2/4 plans landed). 04-01: (workspace) route group + page migration + useChat extraction. 04-02: ProjectSidebar replaces chat-sidebar, CreateProjectDialog + server actions, URL-based conversation switching, layout server-fetches sidebar data. Next: 04-03 (workspace shell + chat-first Overview tab — first visible deliverable). Roadmap: ~~02~~ → ~~03~~ → 04 sidebar+workspace (2/4) → 05 project-scoped chat → 06 negotiations → 07 librarian project intelligence
