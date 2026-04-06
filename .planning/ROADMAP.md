# DocuMind — Roadmap

## Vision

A project-centric document intelligence system for the Vice Chairman of GTEZ. Each project (deal, negotiation, initiative) is a long-running workspace with its own documents, conversations, memory, and context. The chat is the interface; the project is the unit of organization. The librarian agent maintains the knowledge graph as new documents arrive.

## Phase summary

| # | Name | Status | Output |
|---|---|---|---|
| 01 | Chat experience rebuild | ✅ shipped | Multi-turn chat, intelligence routing, doctrines, autonomous web search, pinned references, librarian core, conversational upload |
| 02 | **Cleanup and tech debt** | 📋 planning | Dead code removed, routes deduped, naming normalized, types unified, dead `pipeline/` deleted, `query/` route deleted, audit log cleanup |
| 03 | Project schema and CRUD | ⏳ next | Migration `008_projects.sql`, REST endpoints for projects, type generation, basic project lifecycle |
| 04 | Project sidebar and workspace UI | ⏳ planned | Sidebar with project list, `/projects/[slug]` workspace page with Overview/Documents/Negotiations/Chats/Memory tabs, project context badge in chat input |
| 05 | Project-scoped chat | ⏳ planned | Chat API reads `conversation.project_id`, injects project `context_summary` into system prompt, filters/boosts retrieval to project documents, scopes memory to project first |
| 06 | Negotiations | ⏳ planned | `negotiations` schema, deal-room view with timeline + key facts, librarian suggests negotiation membership |
| 07 | Librarian project intelligence | ⏳ planned | On upload, librarian proposes which project the doc belongs to (entity overlap with `project_companies`), allows quick "create new project" from upload flow |
| 08 | Visible model badge + manual model overrides | ⏳ planned | Model chip per assistant message, `/fast` and `/deep` slash commands, "regenerate with Opus" hover action |
| 09 | Save-as-artifact + deal-room timeline | ⏳ planned | Save important assistant responses as `project_artifacts`, project workspace shows them as deal-room timeline events |
| 10 | Tool use in casual mode | ⏳ planned | Bring autonomous web search to gpt-4o-mini turns too, so casual queries can also retry / refine |
| 11 | Visual graph view | ⏳ later | Force-directed knowledge graph (entities ↔ documents ↔ projects) like Obsidian's graph view |

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
