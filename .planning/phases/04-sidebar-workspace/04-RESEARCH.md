# Phase 04: Project Sidebar and Workspace UI — Research

**Researched:** 2026-04-07
**Domain:** Next.js 16.2.1 App Router + existing DocuMind UI refactor
**Confidence:** HIGH (Next.js findings cross-verified against `node_modules/next/dist/docs/`; codebase findings from direct file reads)

<research_summary>
## Summary

Phase 04 is not a niche-domain problem — it's Next.js App Router work — but two unknowns forced a research pass: (1) Next.js 16.2.1 has breaking changes from 15 that the AGENTS.md explicitly warns about, and (2) the existing `src/app/page.tsx` is ~1600 lines with conversation state held locally and no shared layout shell, so "just add a sidebar" is architecturally non-trivial.

**Key findings:**

1. **Next.js 16 layouts are the answer to "instant switching."** When you navigate between routes that share a layout, the shared layout **stays mounted** and only the page segment re-renders. Combined with `loading.tsx` skeletons and `Link`'s automatic prefetch on viewport/hover, this gives the "no page-reload jank" the user asked for — without any additional state management library or caching layer.

2. **`params` and `searchParams` are Promise-wrapped at the page level too**, not just in route handlers. The existing API routes already do this correctly, but pages I write for Phase 04 must also `await params` or use React's `use()` hook in client components.

3. **The current codebase has no route groups and no nested layouts.** Every page (`/`, `/documents`, `/upload`, `/doctrines`) manually renders `<Nav>`. Conversation switching is entirely state-based inside `page.tsx` — there's no `/chat/[id]` URL. To get instant project switching, we need to introduce a route group `(workspace)` with a shared `layout.tsx` that hosts the new `ProjectSidebar` + `<Nav>` persistently.

4. **`chat-input.tsx` and `chat-message.tsx` are already fully reusable.** Both are standalone, prop-driven, with no dependency on parent state. Drop them into the workspace Overview tab unchanged. This is the biggest cost-saver for the phase.

5. **All shadcn primitives Phase 04 needs already exist** in `src/components/ui/`: Dialog, Tabs, Button, Input, Textarea, Card, ScrollArea, Badge, DropdownMenu. Zero primitive additions required.

6. **Parallel + intercepting routes** (`@modal/(.)new/page.tsx`) are supported and stable in 16.2.1 — the canonical pattern for a create-project dialog that also has a direct-link fallback.

**Primary recommendation:** Introduce a `(workspace)` route group with a shared layout that renders `<Nav>` + `<ProjectSidebar>`. Move `/`, `/documents`, `/upload`, `/doctrines`, and the new `/projects/[slug]` into it. Extract a `useChat(projectId?)` hook from `page.tsx` to share SSE logic. Use `searchParams` for workspace tab state. Use a server action + `revalidatePath` for create-project. Add `loading.tsx` at `/projects/[slug]/loading.tsx` for instant-feeling navigation.
</research_summary>

<standard_stack>
## Standard Stack

Everything needed is already installed. No new dependencies.

### Core (already installed)
| Library | Version | Purpose | Source |
|---|---|---|---|
| `next` | 16.2.1 | App Router, server actions, parallel/intercepting routes | `node_modules/next/package.json` |
| `react` | 19.2.4 | `use()` hook, `<Activity>`, transitions | `node_modules/react/package.json` |
| `@base-ui/react` | 1.3.0 | Primitive for shadcn components | `package.json` |
| `lucide-react` | 1.7.0 | Icons | `package.json` |
| `react-markdown` | 10.1.0 | Message rendering (already used in `chat-message.tsx`) | `package.json` |
| Tailwind CSS | 4.x | Styling + design tokens | `postcss.config.mjs` |

### shadcn primitives verified present
| File | Primitive | Phase 04 use |
|---|---|---|
| `src/components/ui/dialog.tsx` | Dialog | Create-project modal |
| `src/components/ui/tabs.tsx` | Tabs | Workspace 5-tab bar |
| `src/components/ui/button.tsx` | Button | Everywhere |
| `src/components/ui/input.tsx` | Input | Dialog fields |
| `src/components/ui/textarea.tsx` | Textarea | Description / context_summary fields |
| `src/components/ui/card.tsx` | Card | Overview tab cards |
| `src/components/ui/scroll-area.tsx` | ScrollArea | Sidebar list, conversation list |
| `src/components/ui/badge.tsx` | Badge | Counterparty pills, status chips |
| `src/components/ui/dropdown-menu.tsx` | DropdownMenu | Project context menu (rename/archive) |
| `src/components/ui/separator.tsx` | Separator | Dividers |
| `src/components/ui/sonner.tsx` | Toast | Optional — success/error notifications |

### Reusable existing components
| File | Reusable | Notes |
|---|---|---|
| `src/components/chat-input.tsx` (620 lines) | **YES, unchanged** | Standalone, has its own picker/attachment state, uses `forwardRef` for `addFiles` imperative handle. Drop it into the workspace Overview tab. |
| `src/components/chat-message.tsx` (282 lines) | **YES, unchanged** | Prop-driven, `onSourceClick` callback lets parent handle PDF viewer. |
| `src/components/ui-system.tsx` — `Tag`, `Skeleton` | YES | Use `Tag` for project pills, `Skeleton` in `loading.tsx` |
| `src/components/nav.tsx` | YES with minor addition | Add breadcrumb / project context chip when on workspace route. Optional for v1. |
| `src/components/chat-sidebar.tsx` (200 lines) | **NO — being replaced** | Gets deleted at the end of Phase 04 once the new ProjectSidebar covers its features (conversation list under each project + General bucket). |

### Dependencies NOT needed
- **No Zustand / Jotai / React Query** — shared layouts + `useChat` hook are enough. If we ever need global state, revisit.
- **No SWR** — fetch inside server components or in a lightweight hook. Phase 04 data is small (project list + single workspace).
- **No headless-ui / radix directly** — base-ui + shadcn already cover it.

</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended directory structure

```
src/app/
├── layout.tsx                          # Root RSC (fonts, globals) — UNCHANGED
├── (workspace)/                        # NEW route group
│   ├── layout.tsx                      # NEW — renders Nav + ProjectSidebar, wraps all workspace pages
│   ├── page.tsx                        # MOVED from src/app/page.tsx, refactored to use useChat
│   ├── documents/
│   │   ├── page.tsx                    # MOVED (no changes needed except removing its own Nav)
│   │   └── [id]/page.tsx               # MOVED
│   ├── upload/page.tsx                 # MOVED
│   ├── doctrines/page.tsx              # MOVED
│   └── projects/
│       ├── [slug]/
│       │   ├── page.tsx                # NEW — workspace page with tabs
│       │   ├── loading.tsx             # NEW — instant-nav skeleton
│       │   └── not-found.tsx           # NEW — 404 when slug doesn't resolve
│       └── @modal/                     # NEW parallel route slot
│           ├── default.tsx             # NEW — empty fallback
│           └── (.)new/                 # NEW intercepting route
│               └── page.tsx            # NEW — create-project dialog (direct link = full page fallback)
└── api/                                # UNCHANGED (all existing routes stay put)

src/components/
├── project-sidebar.tsx                 # NEW — replaces chat-sidebar.tsx
├── project-workspace-header.tsx        # NEW — title + counterparty pills + counts strip
├── project-tabs.tsx                    # NEW — tab bar driven by ?tab= searchParam
├── create-project-dialog.tsx           # NEW — Dialog + form, calls server action
├── chat-input.tsx                      # UNCHANGED
├── chat-message.tsx                    # UNCHANGED
├── nav.tsx                             # Minor: breadcrumb for project context
└── chat-sidebar.tsx                    # DELETED at end of phase

src/lib/
├── hooks/
│   └── use-chat.ts                     # NEW — extracts SSE/conversation logic from page.tsx
└── actions/
    └── projects.ts                     # NEW — server actions for create/rename/archive
```

### Pattern 1: Shared layout for instant project switching

**What:** The `(workspace)/layout.tsx` renders Nav + ProjectSidebar as siblings of `{children}`. Because Next.js 16 keeps shared layouts mounted across navigations, switching projects re-renders only the page segment — the sidebar stays put, scroll position persists, no reload jank.

**Why it matters:** The user's #1 essential was "switching feels instant." This pattern gives it for free, without Zustand or Cache Components.

**Example:**

```typescript
// src/app/(workspace)/layout.tsx
import { Nav } from "@/components/nav";
import { ProjectSidebar } from "@/components/project-sidebar";

export default async function WorkspaceLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;  // parallel route slot
}) {
  return (
    <div className="h-screen flex flex-col">
      <Nav />
      <div className="flex-1 flex min-h-0">
        <ProjectSidebar />
        <main className="flex-1 min-w-0 overflow-hidden">
          {children}
        </main>
      </div>
      {modal}
    </div>
  );
}
```

**Source:** `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md` lines 152–161 ("shared layouts stay in the DOM. Only the page segment is replaced. Client state... is preserved").

### Pattern 2: Promise-wrapped params in page components

**What:** In Next.js 16.2.1, `params` on server components is `Promise<{...}>`, not a plain object. Must `await` it (or use React's `use()` hook in client components).

**Example (server component):**

```typescript
// src/app/(workspace)/projects/[slug]/page.tsx
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";

export default async function ProjectWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug } = await params;
  const { tab = "overview" } = await searchParams;

  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (!project) notFound();

  return <ProjectWorkspaceClient project={project} initialTab={tab} />;
}
```

**Source:** `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` lines 13–50.

### Pattern 3: Tab state via searchParams

**What:** Workspace tab selection lives in the URL (`?tab=documents`). Bookmarkable, back-button works, no tab state management. Use `router.push('?tab=X', { scroll: false })` for silent updates.

**Example:**

```typescript
// src/components/project-tabs.tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";

const TABS = ["overview", "documents", "negotiations", "chats", "memory"] as const;

export function ProjectTabs({ defaultTab = "overview" }: { defaultTab?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const active = searchParams.get("tab") || defaultTab;

  return (
    <nav className="flex gap-1 border-b">
      {TABS.map((tab) => (
        <button
          key={tab}
          onClick={() => router.push(`?tab=${tab}`, { scroll: false })}
          className={active === tab ? "border-b-2 border-ink" : "text-ink-muted"}
        >
          {tab[0].toUpperCase() + tab.slice(1)}
        </button>
      ))}
    </nav>
  );
}
```

**Source:** `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md` line 44 (`scroll: false` option).

### Pattern 4: Intercepting route for create-project dialog

**What:** `(workspace)/projects/@modal/(.)new/page.tsx` intercepts client-side navigation to `/projects/new` and renders it as a modal while keeping the previous page visible. Direct URL access or refresh falls through to a full page (which we can make a 404 or a bigger create form).

**Why:** This is the Next.js-native pattern for "clicking + opens a dialog without losing your place." Cleaner than manual overlay state management.

**Example:**

```typescript
// src/app/(workspace)/projects/@modal/default.tsx
export default function Default() {
  return null;
}
```

```typescript
// src/app/(workspace)/projects/@modal/(.)new/page.tsx
"use client";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CreateProjectForm } from "@/components/create-project-dialog";

export default function NewProjectModal() {
  const router = useRouter();
  return (
    <Dialog open onOpenChange={(open) => !open && router.back()}>
      <DialogContent>
        <CreateProjectForm onSuccess={(slug) => router.push(`/projects/${slug}`)} />
      </DialogContent>
    </Dialog>
  );
}
```

**Source:** `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/intercepting-routes.md` lines 33–80 and `parallel-routes.md` lines 20–56.

**Decision to defer if it adds complexity:** We can alternatively use a plain `useState` + `<Dialog>` inside the sidebar. The intercepting-route approach is nicer but optional. See Open Questions.

### Pattern 5: Server action for mutations

**What:** Use a `'use server'` function that hits the existing REST API or Supabase directly, then calls `revalidatePath('/projects')` or `revalidateTag('projects')` to refresh the sidebar.

**Why:** Server actions pair naturally with `<form action={...}>` from a client component, and `revalidatePath` is the canonical way to invalidate server-fetched data after a mutation in Next.js 16.

**Example:**

```typescript
// src/lib/actions/projects.ts
"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { slugify, uniqueSlug } from "@/lib/projects";

export async function createProjectAction(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  if (!name) return { error: "Name is required" };

  const description = String(formData.get("description") || "") || null;
  const color = String(formData.get("color") || "") || null;
  const icon = String(formData.get("icon") || "") || null;

  const slug = await uniqueSlug(slugify(name));

  const { data, error } = await supabaseAdmin
    .from("projects")
    .insert({ name, slug, description, color, icon, status: "active" })
    .select("slug")
    .single();

  if (error) return { error: "Failed to create project" };

  revalidatePath("/", "layout");  // refreshes sidebar in the shared workspace layout
  return { slug: data.slug };
}
```

**Source:** `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md` lines 35–101.

### Pattern 6: `loading.tsx` for instant-feeling navigation on dynamic routes

**What:** Dynamic routes without `generateStaticParams` can't be prefetched fully, which makes navigation feel slow. Dropping a `loading.tsx` next to the dynamic page triggers a React Suspense boundary — the skeleton renders instantly on click while the server response streams.

**Example:**

```typescript
// src/app/(workspace)/projects/[slug]/loading.tsx
import { Skeleton } from "@/components/ui-system";

export default function Loading() {
  return (
    <div className="p-6 space-y-4">
      <Skeleton className="h-8 w-48" />       {/* title */}
      <Skeleton className="h-4 w-96" />       {/* subtitle */}
      <div className="flex gap-2">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-6 w-24" />
      </div>
      <Skeleton className="h-32 w-full" />    {/* chat input placeholder */}
    </div>
  );
}
```

**Source:** `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md` lines 169–186.

### Pattern 7: Extract chat logic into `useChat(projectId?)` hook

**What:** `src/app/page.tsx` currently holds ~12 useState hooks plus SSE parsing plus conversation fetching. That's fine as a single surface but becomes duplication as soon as the workspace page needs its own chat. Extract into `src/lib/hooks/use-chat.ts`.

**Shape:**

```typescript
// src/lib/hooks/use-chat.ts
"use client";
import { useState, useCallback, useRef } from "react";
import type { Source } from "@/lib/types";

interface UseChatOptions {
  projectId?: string;
  initialConversationId?: string | null;
}

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: { mode?: string; doctrines?: string[]; sources?: Source[]; model?: string };
}

export function useChat({ projectId, initialConversationId = null }: UseChatOptions = {}) {
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [routingStatus, setRoutingStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(async (message: string, attachments: unknown[], pinned: unknown[]) => {
    // SSE parsing identical to existing page.tsx logic
    // Critically: pass projectId in the request body so conversation.project_id is set server-side
    // The backend chat API doesn't USE projectId yet (Phase 05) — it's just tagged
  }, [projectId, conversationId]);

  const loadConversation = useCallback(async (id: string) => {
    // Identical to existing logic
  }, []);

  const newChat = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    setError(null);
  }, []);

  return {
    conversationId,
    messages,
    streaming,
    streamingContent,
    routingStatus,
    error,
    send,
    loadConversation,
    newChat,
  };
}
```

`src/app/(workspace)/page.tsx` calls `useChat()` with no projectId (General pool). The workspace Overview tab calls `useChat({ projectId: project.id })`.

### Anti-patterns to avoid

- **Don't copy the SSE parsing into the workspace page.** Extract `useChat` first.
- **Don't create a global chat store (Zustand/Jotai).** The two call sites (home + workspace) each own their own `useChat` instance. If they needed to share state, reconsider, but they don't — they represent different conversations.
- **Don't use React state for tab selection.** Use `searchParams`. Back button + deep links matter.
- **Don't manually build a modal overlay.** Use either intercepting routes or shadcn's `<Dialog>`.
- **Don't skip `loading.tsx`.** The dynamic route will feel slow without it.
- **Don't migrate `/api/chat/route.ts`.** Phase 05 wires project scoping into the chat API. Phase 04 only sets `conversation.project_id` when creating a new conversation from the workspace.

</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Message input with attachments + @ picker | Re-implement the picker / drag-drop / pinned chips | **`src/components/chat-input.tsx` as-is** | Already 620 lines of tested code, fully standalone. Just pass a different `onSend` callback. |
| Assistant message renderer with sources + markdown | Write a minimal markdown viewer | **`src/components/chat-message.tsx` as-is** | Already handles streaming, doctrine tags, source pills, onSourceClick. |
| SSE parser for the chat turn stream | Copy 200 lines of SSE parsing into workspace page | **Extract to `useChat` hook once** | Dedup between home and workspace. One place to maintain. |
| Tab selection state | `useState` + manual active class logic | **`useSearchParams` + `router.push('?tab=X', { scroll: false })`** | URL-native, back-button works, deep linking works. |
| Create-project modal overlay | Manually manage `isOpen` state + portal + focus trap | **`src/components/ui/dialog.tsx` (base-ui Dialog)** — optionally with intercepting routes | Accessibility + focus handled by base-ui. |
| Sidebar scroll + active highlight | Custom scroll behavior | **`src/components/ui/scroll-area.tsx` + simple conditional Tailwind class** | Standard pattern, already in use in `chat-sidebar.tsx`. |
| Project slug generation + uniqueness | Inline slug logic in the sidebar or form | **`src/lib/projects.ts` (`slugify` + `uniqueSlug`)** — already shipped in Phase 03 Plan 02 | Existing helper, used by the POST endpoint too — single source of truth. |
| Preserving sidebar scroll across project switches | Manual scroll save/restore | **Just use a shared `layout.tsx`** | Next.js 16 keeps shared layouts mounted automatically. Zero code. |
| Fetching project list for the sidebar | Client-side `useEffect` + fetch | **Fetch in the workspace layout (RSC), pass as prop to client sidebar** | Server-side fetch is faster on first load and re-runs on `revalidatePath`. |

**Key insight:** 80% of Phase 04 is composition of existing components + Next.js primitives. The new code is: one layout.tsx, one workspace page.tsx, one ProjectSidebar, one CreateProjectDialog, one `useChat` extraction, and a few tab content components. Everything else is reuse.

</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Forgetting to `await params` in pages

**What goes wrong:** In Next.js 15, `params.slug` worked synchronously in page components. In 16.2.1, `params` is `Promise<{slug:string}>` and must be awaited. Forgetting to await returns a Promise object and produces cryptic runtime errors.

**Why it happens:** Muscle memory from Next.js 13/14/15.

**How to avoid:** Always type `params: Promise<{...}>` in the page signature and `await params` before destructuring. Use `next typegen` to get the `PageProps<'/projects/[slug]'>` helper type for autocompletion.

**Warning sign:** `"slug" is not defined` or `[object Promise]` in logs.

**Source:** `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md` lines 294–306.

### Pitfall 2: Shared layout invalidated by wrong `revalidatePath` scope

**What goes wrong:** After creating a project with a server action, calling `revalidatePath("/projects")` revalidates only the `/projects` page, not the workspace layout that hosts the sidebar. The sidebar doesn't show the new project until a hard refresh.

**Why it happens:** `revalidatePath(path)` only revalidates that page by default. To revalidate a layout shared across routes, pass `"layout"` as the second argument: `revalidatePath("/", "layout")`.

**How to avoid:** In `createProjectAction`, use `revalidatePath("/", "layout")` — this re-runs the `(workspace)/layout.tsx` and refetches the project list.

**Warning sign:** Sidebar doesn't update after a mutation without a page refresh.

**Source:** Verified via `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`.

### Pitfall 3: Nav rendered twice after moving pages into `(workspace)` group

**What goes wrong:** The existing pages `/documents`, `/upload`, `/doctrines` each manually render `<Nav />` at the top. When moved into `(workspace)/layout.tsx` which ALSO renders `<Nav />`, you get two nav bars stacked.

**Why it happens:** Route-group layouts wrap children — they don't replace what children already render.

**How to avoid:** As part of moving each page into `(workspace)/`, strip out its inline `<Nav />` render. The layout provides it.

**Warning sign:** Double navigation bar at the top of migrated pages.

### Pitfall 4: `chat-input.tsx` has a hardcoded POST path

**What goes wrong:** If `ChatInput` internally calls `fetch("/api/chat", ...)` with no way to change the URL, the workspace version will POST to the global endpoint instead of a project-tagged one.

**Why it happens:** Inherited shape from when there was only one chat surface.

**How to avoid:** Audit `chat-input.tsx` during Task 1 of the plan. If it posts directly, either: (a) lift the `onSend` responsibility back to the parent page (the current shape — parent calls fetch, not the input), or (b) pass a `postPath` prop. Verify this before Phase 04 execution — this is the single biggest "chat-input is reusable" assumption.

**Warning sign:** Workspace messages show up in the general conversations pool.

**Note:** The research inventory agent reported `chat-input.tsx` does NOT fetch `/api/chat` directly — it calls an `onSend` prop. So this pitfall is pre-defused. Re-verify during planning by reading the file top-to-bottom.

### Pitfall 5: `loading.tsx` skeleton looks jarringly different from the real content

**What goes wrong:** A generic Skeleton grid doesn't match the real workspace layout, so the page "jumps" when content loads.

**How to avoid:** Mirror the real layout in the skeleton — same grid, same card sizes, same spacing. Use actual placeholder widths that roughly match real text lengths.

### Pitfall 6: Conversation state inside workspace doesn't survive a tab switch

**What goes wrong:** User starts typing in the Overview tab chat input, switches to Documents, switches back — input is empty, messages are gone.

**Why it happens:** If tab content is rendered with `{activeTab === "overview" && <OverviewTab />}`, React unmounts `OverviewTab` on every switch and `useChat` state resets.

**How to avoid:** Either: (a) render all tabs always and toggle visibility with CSS (`hidden` class on inactive), which keeps them mounted; or (b) lift `useChat` to the workspace page level so it outlives tab switches; or (c) accept the reset for tabs that don't need persistence.

**Recommendation:** Lift `useChat` to `<ProjectWorkspaceClient>` (the top-level client component inside `projects/[slug]/page.tsx`). Tabs become pure render functions that consume the shared state via props or context.

### Pitfall 7: Intercepting routes in non-App-Router directories

**What goes wrong:** `(.)new`, `(..)new`, etc. only work inside App Router (`src/app/`). They're also sensitive to exact folder depth — `(..)` means "one level up" relative to the intercepting file.

**How to avoid:** Put the intercepting route at the right depth. For `/projects/new` intercepted from `/projects`: `src/app/(workspace)/projects/@modal/(.)new/page.tsx` (the `(.)` means "same segment").

**Fallback if it gets confusing:** Skip intercepting routes entirely and use plain `<Dialog>` with `useState`. The vision in CONTEXT.md doesn't require the intercept pattern — it just said "inline dialog."

</common_pitfalls>

<code_examples>
## Code Examples

### Minimal workspace page + client wrapper

```typescript
// src/app/(workspace)/projects/[slug]/page.tsx (SERVER)
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { ProjectWorkspaceClient } from "./workspace-client";

export default async function ProjectWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug } = await params;
  const { tab = "overview" } = await searchParams;

  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (!project) notFound();

  const [docCount, companyCount, negCount, convoCount] = await Promise.all([
    supabaseAdmin.from("project_documents").select("project_id", { count: "exact", head: true }).eq("project_id", project.id),
    supabaseAdmin.from("project_companies").select("project_id", { count: "exact", head: true }).eq("project_id", project.id),
    supabaseAdmin.from("negotiations").select("id", { count: "exact", head: true }).eq("project_id", project.id),
    supabaseAdmin.from("conversations").select("id", { count: "exact", head: true }).eq("project_id", project.id),
  ]);

  return (
    <ProjectWorkspaceClient
      project={project}
      initialTab={tab}
      counts={{
        documents: docCount.count || 0,
        companies: companyCount.count || 0,
        negotiations: negCount.count || 0,
        conversations: convoCount.count || 0,
      }}
    />
  );
}
```

```typescript
// src/app/(workspace)/projects/[slug]/workspace-client.tsx (CLIENT)
"use client";
import { ProjectWorkspaceHeader } from "@/components/project-workspace-header";
import { ProjectTabs } from "@/components/project-tabs";
import { OverviewTab } from "./_tabs/overview";
import { DocumentsTab } from "./_tabs/documents";
import { NegotiationsTab } from "./_tabs/negotiations";
import { ChatsTab } from "./_tabs/chats";
import { MemoryTab } from "./_tabs/memory";
import { useChat } from "@/lib/hooks/use-chat";
import type { Database } from "@/lib/database.types";

type Project = Database["public"]["Tables"]["projects"]["Row"];

export function ProjectWorkspaceClient({
  project,
  initialTab,
  counts,
}: {
  project: Project;
  initialTab: string;
  counts: { documents: number; companies: number; negotiations: number; conversations: number };
}) {
  // Chat state lifted to workspace level so tabs don't remount it
  const chat = useChat({ projectId: project.id });

  return (
    <div className="h-full flex flex-col">
      <ProjectWorkspaceHeader project={project} counts={counts} />
      <ProjectTabs defaultTab={initialTab} />
      <div className="flex-1 overflow-auto">
        <OverviewTab hidden={initialTab !== "overview"} project={project} counts={counts} chat={chat} />
        <DocumentsTab hidden={initialTab !== "documents"} project={project} />
        <NegotiationsTab hidden={initialTab !== "negotiations"} project={project} />
        <ChatsTab hidden={initialTab !== "chats"} project={project} />
        <MemoryTab hidden={initialTab !== "memory"} project={project} />
      </div>
    </div>
  );
}
```

Note: Tabs use `hidden` prop + CSS `display: none` rather than conditional rendering — that's how we keep state alive across tab switches (Pitfall 6).

### Project sidebar data fetch from layout

```typescript
// src/app/(workspace)/layout.tsx (SERVER)
import { supabaseAdmin } from "@/lib/supabase";
import { Nav } from "@/components/nav";
import { ProjectSidebar } from "@/components/project-sidebar";

export default async function WorkspaceLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  const { data: projects } = await supabaseAdmin
    .from("projects")
    .select("id, name, slug, status, color, icon, updated_at")
    .neq("status", "archived")
    .order("updated_at", { ascending: false });

  return (
    <div className="h-screen flex flex-col">
      <Nav />
      <div className="flex-1 flex min-h-0">
        <ProjectSidebar projects={projects ?? []} />
        <main className="flex-1 min-w-0 overflow-hidden">{children}</main>
      </div>
      {modal}
    </div>
  );
}
```

</code_examples>

<sota_updates>
## State of the Art (Next.js 15 → 16)

Changes that affect Phase 04:

| Old (Next.js 15) | New (Next.js 16.2.1) | Impact on Phase 04 |
|---|---|---|
| `params: { slug: string }` sync in pages | `params: Promise<{ slug: string }>` must be awaited | All new page components must use the Promise shape. Route handlers in this codebase already do. |
| `--turbopack` flag to opt in | Turbopack is the default for `next dev` and `next build` | Cosmetic — no action needed unless there's a custom webpack config. |
| Middleware convention (`middleware.ts`) | Deprecated — use `proxy` convention | Not relevant to Phase 04 (no auth/middleware work). |
| `experimental.turbopack` | Top-level `turbopack` in next.config | Cosmetic. |
| Server actions marked experimental in old docs | Stable | Use `"use server"` freely. |
| No built-in type helper for page params | `PageProps<'/route/[param]'>` via `next typegen` | Optional ergonomic improvement. |

**New things worth considering (optional, not required for Phase 04):**

- **`<Activity>`** (React 19.2): Can hide components without unmounting. Useful for the "keep tabs alive across switches" problem — an alternative to the `hidden` CSS approach.
- **Cache Components + `unstable_instant`**: True instant navigation with a static shell. Overkill for Phase 04 — shared layout + `loading.tsx` is enough.
- **`useActionState`**: Cleaner form handling for the create-project dialog than `useTransition` + manual pending state.

**Deprecated / don't use:**

- `next/router` — use `next/navigation`. (The existing codebase already does.)
- Sync `cookies()`, `headers()`, `draftMode()` — all async now. Not hit in Phase 04 anyway.

</sota_updates>

<open_questions>
## Open Questions

These need resolution during planning or early execution.

1. **Intercepting route for the create dialog vs. plain `<Dialog>` + `useState`?**
   - What we know: Both work. Intercepting routes are the "Next.js-native" pattern. Plain dialog is simpler and matches the existing shadcn usage in the codebase.
   - What's unclear: Whether the extra complexity is worth it for a single dialog.
   - **Recommendation for planning:** Start with **plain `<Dialog>` + `useState` inside `ProjectSidebar`**. If we later add a dedicated `/projects/new` full-page create flow, we can add the intercept layer. Ship simple first.

2. **Should all existing pages (`/documents`, `/upload`, `/doctrines`, `/`) migrate into `(workspace)` in Phase 04, or only the home page + the new `/projects/[slug]`?**
   - What we know: Moving them all gives a single shared layout and consistent Nav. Moving only some means the Nav is rendered both inline (on non-migrated pages) and from the layout (on migrated pages).
   - What's unclear: Risk vs reward. Moving all pages touches more code; leaving them exposes an inconsistency.
   - **Recommendation for planning:** Migrate all four in one plan (a dedicated "move pages into (workspace) group and strip inline Nav" task). The move is mechanical, and leaving inconsistency is worse than a bigger plan.

3. **Does the Chats tab show project conversations using the existing `ChatMessage` renderer in a read-only thread view, or is it just a list with "open conversation" buttons?**
   - What we know: CONTEXT.md doesn't specify. The user said "chat-first Overview" so chat lives there. The Chats tab is separate.
   - **Recommendation for planning:** Show a list (title / date / first line / model badge) with click-to-open in a drawer. Full threaded view is Phase 06 territory. Ask the user only if ambiguous after planning.

4. **Memory tab with empty data — is an "empty state" enough, or does it need explanatory copy?**
   - What we know: Phase 05 is where memories get project-scoped. Until then, the tab will mostly be empty.
   - **Recommendation:** Ship with an empty state that reads "Memories for this project will appear here once you start chatting in project-scoped mode (coming in Phase 05)." Honest and informative. Keeps the fail-loud philosophy.

5. **Does the chat input in the Overview tab POST to `/api/chat` with a `projectId` in the body, or to a new `/api/projects/[id]/chat` endpoint?**
   - What we know: CONTEXT.md says Phase 04 is visual-only — backend doesn't scope. But the `project_id` still needs to land on the new conversation row.
   - **Recommendation for planning:** Extend the existing `POST /api/chat` request body to accept an optional `project_id` field, and write it to `conversation.project_id` on conversation creation. One-line change in the existing route. No new endpoint needed, and no Phase 05 work pulled forward.

</open_questions>

<sources>
## Sources

### Primary (HIGH confidence — Next.js official docs in `node_modules`)

- `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md` — version 16 breaking changes, async params mandate, Turbopack default
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` — Promise-wrapped params for pages
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` — route handler params shape
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md` — client component `use()` hook for params
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/parallel-routes.md` — `@slot` convention
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/intercepting-routes.md` — `(.)folder` convention
- `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md` — shared layout mounting, prefetch, `loading.tsx`
- `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md` — server actions with `'use server'`
- `node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md` — state preservation semantics
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md` — `scroll: false` option

### Primary (HIGH confidence — direct code reads of this repo)

- `src/app/page.tsx` (~1600 lines) — chat surface, state shape, SSE parsing, sidebar integration
- `src/app/layout.tsx` — root layout (minimal, single root layout in the repo)
- `src/components/chat-sidebar.tsx` (200 lines) — the component being replaced
- `src/components/chat-input.tsx` (620 lines) — **verified reusable** — no direct fetch to `/api/chat`, uses `onSend` prop
- `src/components/chat-message.tsx` (282 lines) — **verified reusable**
- `src/components/nav.tsx` (92 lines) — top nav, works with migrated pages
- `src/components/ui-system.tsx` — `Tag`, `Skeleton` primitives
- `src/components/ui/*` — shadcn inventory, all required primitives present
- `src/app/globals.css` — design tokens, typography classes
- `src/app/documents/page.tsx`, `upload/page.tsx`, `doctrines/page.tsx` — each renders its own Nav inline
- `src/lib/projects.ts` — `slugify`, `uniqueSlug`, `resolveProjectId` already shipped in Phase 03
- `src/lib/database.types.ts` — includes all new project tables

### Tertiary (not consulted — not needed)

- WebSearch / Context7: skipped. The `node_modules/next/dist/docs/` content is authoritative and current for this exact version, and the codebase read is authoritative for existing shape. Adding WebSearch would introduce noise without increasing signal.

</sources>

<metadata>
## Metadata

**Research scope:**
- Next.js 16.2.1 App Router specifics (breaking changes, params, navigation, parallel/intercepting routes, server actions)
- Existing DocuMind UI architecture (layouts, state management, component reuse, design tokens)

**Confidence breakdown:**
- Next.js 16 API surface: HIGH — read directly from `node_modules/next/dist/docs/`, file paths cited for every claim
- Existing codebase shape: HIGH — direct file reads with absolute paths
- Architecture recommendations: MEDIUM–HIGH — follow from verified facts, but some tradeoffs (intercepting routes vs plain dialog, migrate-all-pages vs migrate-some) are judgment calls flagged in Open Questions
- Don't-hand-roll list: HIGH — each item backed by a confirmed existing component or Next.js primitive
- Pitfalls: HIGH for Pitfalls 1–3 (documented in Next.js upgrade guide), MEDIUM for 4–7 (derived from codebase shape, worth verifying during execution)

**Research date:** 2026-04-07
**Valid until:** Until Next.js 16.x minor bumps or major codebase restructure (likely 30+ days)

</metadata>

---

*Phase: 04-sidebar-workspace*
*Research completed: 2026-04-07*
*Ready for planning: yes*
