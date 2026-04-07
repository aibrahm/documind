# DocuMind — Roadmap

## Vision

A project-centric document intelligence system for the Vice Chairman of GTEZ. Each project (deal, negotiation, initiative) is a long-running workspace with its own documents, conversations, memory, and context. The chat is the interface; the project is the unit of organization. The librarian agent maintains the knowledge graph as new documents arrive.

## Phase summary

| # | Name | Status | Output |
|---|---|---|---|
| 01 | Chat experience rebuild | ✅ shipped | Multi-turn chat, intelligence routing, doctrines, autonomous web search, pinned references, librarian core, conversational upload |
| 02 | Cleanup and tech debt | ✅ shipped | Dead code removed (~3,000 LOC), chat routes deduped via `runChatTurn`, types centralized in `src/lib/types.ts`, naming normalized, 5 orphan deps removed |
| 02.1 | Junk cleanup + track all sources | ✅ shipped | Screenshots, extraction dumps, dead routes removed. Tightened `.gitignore`. Committed ~4,000 lines of previously-untracked production code across migrations, lib, api, pages, components. Working tree clean. |
| 03 | **Project schema and CRUD** | ✅ shipped | Migration `008_projects.sql` applied, REST endpoints for projects + membership + negotiations, type generation, full project lifecycle (create / list / get-with-counts / patch / soft-archive) |
| 03.5 | **Tier 1 analytical tools** | ✅ shipped | 03.5-01 — `financial_model` + `fetch_url` (zero-dep, verified end-to-end). 03.5-02 — `extract_key_terms` (project docs → structured deal facts via GPT-4o-mini, optional additive merge into `negotiation.key_terms`) + `compare_deals` (side-by-side matrix of 2-5 negotiations). Real Elsewedy memo extraction verified: all major deal facts pulled correctly. |
| 04 | **Project sidebar and workspace UI** | ✅ shipped | (workspace) route group + shared layout + useChat hook extraction (04-01); ProjectSidebar replaces chat-sidebar + CreateProjectDialog + server actions + URL conversation switching (04-02); /projects/[slug] workspace shell + chat-first Overview tab + conversation project_id tagging (04-03); Documents / Negotiations / Chats / Memory tabs (04-04). Project-centric metaphor fully visible. |
| 05 | Project-scoped chat | ⏳ planned | Chat API reads `conversation.project_id`, injects project `context_summary` into system prompt, filters/boosts retrieval to project documents, scopes memory to project first |
| 06 | Negotiations deal-room UI | ⏳ planned | Deal-room view with timeline + key facts + artifacts, librarian suggests negotiation membership |
| 07 | Librarian project intelligence | ⏳ planned | On upload, librarian proposes which project the doc belongs to (entity overlap with `project_companies`), allows quick "create new project" from upload flow, auto-creates project when no match. Also fixes the 31% similarity bug by sampling more chunks. |
| 08 | Visible model badge + manual overrides | ⏳ planned | Model chip per assistant message, `/fast` and `/deep` slash commands, "regenerate with Opus" hover action |
| 09 | Save-as-artifact + deal-room timeline | ⏳ planned | `project_artifacts` table (schema in a new migration), save important assistant responses as artifacts, project workspace shows them as deal-room timeline events |
| 10 | Tool use in casual mode | ⏳ planned | Bring autonomous web search + financial_model to gpt-4o-mini turns too, so casual queries can also retry / refine / calculate |
| 11 | Disambiguation turns + cross-project dossier | ⏳ planned | When retrieval is spread across many candidates, ask the user which one. Cross-project entity dossier view ("show me everything about Elsewedy across all my projects"). |
| 12 | Tier 2 tools: memo generator + interactive document editor | ⏳ planned | `render_memo` with Egyptian govt templates (committee briefing, board submission, executive memo, technical note, negotiation brief) → PDF. **Canvas-style interactive document editor** — new UI panel where model drafts, VC edits inline, model suggests revisions via tool calls. Biggest user-visible transformation. |
| 13 | Presentation builder + chart renderer | ⏳ planned | `presentation_builder` (deal analysis → pptx), `chart_renderer` (NPV sensitivity charts, comparison bars). For board meetings. |
| 14 | Visual graph view | ⏳ later | Force-directed knowledge graph (entities ↔ documents ↔ projects) like Obsidian's graph view |

## Out of scope (intentionally)

- Multi-user / permissions / RBAC (single user — the VC)
- Mobile app
- Email integration
- Workflow automation / approvals
- Public sharing / publishing

## Naming conventions

- Phases live in `.planning/phases/XX-name/` where `XX` is the zero-padded phase number
- Each phase has 1-N PLAN.md files numbered `XX-NN-PLAN.md`
- Plans produce SUMMARY.md when executed
- Database migrations are numbered separately (`supabase/migrations/NNN_name.sql`) and don't have to match phase numbers
