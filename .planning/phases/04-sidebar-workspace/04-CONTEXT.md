# Phase 04: Project Sidebar and Workspace UI — Context

**Gathered:** 2026-04-07
**Status:** Ready for planning

<vision>
## How This Should Work

Phase 04 is the moment projects become visible. Right now the system has a global chat and a global document corpus; after this phase, the left rail is organized by project, and each project has its own dedicated workspace page at `/projects/[slug]`.

The sidebar **replaces** the current conversations sidebar entirely. At the top: a "+ New project" affordance that opens an inline dialog (name, description, optional color/icon) and hits `POST /api/projects`. Below: the list of active projects, ordered by recent activity. Each project expands to show its conversations. Unassigned conversations live in a "General" bucket at the bottom so the existing global chat surface keeps working.

Clicking a project takes you to `/projects/[slug]` — a dedicated workspace page. The workspace has **five tabs**: Overview, Documents, Negotiations, Chats, Memory. All five land in v1; some may be thin but they exist.

**The Overview tab is chat-first.** Opening a project is an invitation to ask about it. The top of the page is a big chat input scoped to that project. Below the input: compact cards for counts (docs / companies / negotiations / conversations), recent activity (last 5 uploads, last 5 chats), and active negotiations. The workspace header names the project and shows the counterparty pills, so you always know where you are.

Crucially, the chat input on the project page is **visually scoped** only in Phase 04. The conversation it creates gets `project_id` set so it shows up in the Chats tab, but the backend chat API still behaves globally — no retrieval scoping, no project context injection. That real behavior is Phase 05's job. Phase 04 ships the shell and the tagging; Phase 05 makes it smart.

Switching projects is instant. One click in the sidebar, new workspace loads, no page reload that loses your place. You always know which project you're in.

</vision>

<essential>
## What Must Be Nailed

All three of these matter equally:

- **Switching feels instant.** Sidebar click → workspace loads → clarity over features. No page reloads that lose your scroll. Obvious which project you're in.
- **The workspace tells the story of the deal.** Overview's counts + recent activity + counterparty pills mean that within 3 seconds of opening a project, you remember where you were. Like reopening a dossier.
- **Chat context carries silently (visually).** When you type in the project chat input, you don't have to say "about Safaga" — the page header, the pinned-project badge, and the fact that the new conversation will appear in the Chats tab all confirm you're in project mode. The *backend* scoping is Phase 05; Phase 04 just makes the UI affordance unambiguous.

</essential>

<boundaries>
## What's Out of Scope

Explicitly excluded from Phase 04:

- **Project-scoped chat backend behavior** — The chat API does NOT read `project_id`, does NOT inject `project.context_summary` into the system prompt, does NOT boost project documents in retrieval, does NOT scope memory to the project. All of that is Phase 05. Phase 04 only wires `conversation.project_id` on new conversations started from the workspace.
- **Librarian "suggest project on upload"** — Phase 07. Phase 04 does not touch the upload flow.
- **Deal-room timeline / negotiation artifacts** — Phase 06. Phase 04's Negotiations tab is a list view with basic CRUD, nothing fancy.
- **Drag-and-drop document assignment** — Defer. Assigning a document to a project happens via a button/picker inside the workspace or documents page, not DnD.

Not explicitly excluded but worth flagging:

- Memory tab may be thin in v1 — it can read from existing `conversation_memory` filtered by `project_id`, but since the backend isn't scoping memories to projects yet (Phase 05), the tab will mostly be empty. That's fine; the tab existing is what matters.

</boundaries>

<specifics>
## Specific Ideas

- **Dedicated workspace page at `/projects/[slug]`** — not a panel inside `/`, not a slide-over. A real page you can bookmark.
- **Sidebar replacement, not alongside** — the old conversations-only sidebar goes away. New sidebar is project-organized with an expandable conversations list under each project, plus a "General" bucket.
- **Inline create dialog** — not a separate page. Click + in the sidebar, small dialog appears with name / description / color / icon fields, hit Enter, project appears in the list, workspace opens.
- **Chat-first Overview tab** — the primary affordance on the Overview tab is a chat input. Everything else (counts, recent activity) is secondary context around the input.
- **Counterparty pills in the workspace header** — the project's linked companies render as small pills next to the title. You always see who's across the table.

</specifics>

<notes>
## Additional Context

The user answered "all 3" to the essential question — switching feels instant, workspace tells the story, chat context carries silently. Treat all three as equal-weight success criteria for planning.

The decision to pull only the "visual" half of chat scoping into Phase 04 (not the Phase 05 backend work) was explicit. Keep the phase boundary clean: Phase 04 is shell + tagging, Phase 05 is behavior.

The user is the Vice Chairman of GTEZ working on real deals (Elsewedy Safaga is the running example). The workspace is literal dossier-thinking: this is where you work on a deal, and you want to reopen it and immediately know where you were. Design accordingly.

Phase 04 is the first phase where the project-centric metaphor becomes visible. Before this, projects existed only in the database. This is the phase that makes the rebuild feel real.

</notes>

---

*Phase: 04-sidebar-workspace*
*Context gathered: 2026-04-07*
