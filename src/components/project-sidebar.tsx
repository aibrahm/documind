"use client";

import {
  useState,
  useEffect,
  useTransition,
  useRef,
  useCallback,
  useMemo,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  MoreHorizontal,
  Trash2,
  Pencil,
  ChevronRight,
  ChevronDown,
  Folder,
  MessageSquarePlus,
  Search,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { CreateProjectDialog } from "@/components/create-project-dialog";
import {
  renameProjectAction,
  archiveProjectAction,
} from "@/lib/actions/projects";

// ── Types ──

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  color: string | null;
  icon: string | null;
  updated_at: string | null;
}

export interface ConversationSummary {
  id: string;
  title: string;
  project_id: string | null;
  created_at: string | null;
}

interface ProjectSidebarProps {
  projects: ProjectSummary[];
  conversations: ConversationSummary[];
  activeProjectSlug?: string | null;
  activeConversationId?: string | null;
  isOpen: boolean;
  onToggle: () => void;
}

const FOCUS_HISTORY_SEARCH_EVENT = "documind:focus-history-search";

// Minimum query length before we hit the server. Anything shorter is
// treated as "still typing." 2 chars matches the API endpoint's own
// minimum and avoids flooding for accidental key presses.
const SEARCH_MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 220;

// One match in the new server-side conversation search. Mirrors the
// shape returned by /api/conversations/search.
interface ConversationSearchResult {
  conversationId: string;
  title: string;
  projectId: string | null;
  snippet: string;
  matchedRole: "user" | "assistant" | "system";
  rank: number;
  lastMessageAt: string | null;
}

// ── Date bucketing for the General section ──

type Bucket =
  | "Today"
  | "Yesterday"
  | "Previous 7 days"
  | "Previous 30 days"
  | "Older";

function bucketFor(dateString: string | null): Bucket {
  if (!dateString) return "Older";
  const date = new Date(dateString);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor(
    (startOfToday.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "Previous 7 days";
  if (diffDays < 30) return "Previous 30 days";
  return "Older";
}

const BUCKET_ORDER: Bucket[] = [
  "Today",
  "Yesterday",
  "Previous 7 days",
  "Previous 30 days",
  "Older",
];

// ── Component ──

export function ProjectSidebar({
  projects,
  conversations,
  activeProjectSlug = null,
  activeConversationId = null,
  isOpen,
  onToggle,
}: ProjectSidebarProps) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [historyQuery, setHistoryQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ConversationSearchResult[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [, startTransition] = useTransition();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Project + conversation lookup tables for the search-result list.
  // Memoized so the useCallback below doesn't re-create itself on
  // every render — the parent passes a fresh `projects` array each
  // time, but as long as the contents are stable the maps are too.
  const projectsById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );
  const projectSlugById = useMemo(
    () => new Map(projects.map((p) => [p.id, p.slug])),
    [projects],
  );

  // Hydrate expanded-projects from localStorage on mount
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("documind:expanded-projects");
      if (stored) {
        const arr = JSON.parse(stored);
        if (Array.isArray(arr)) setExpandedProjects(new Set(arr));
      }
    } catch {
      // ignore
    }
  }, []);

  // Persist expanded-projects on change
  useEffect(() => {
    try {
      window.localStorage.setItem(
        "documind:expanded-projects",
        JSON.stringify([...expandedProjects]),
      );
    } catch {
      // ignore
    }
  }, [expandedProjects]);

  useEffect(() => {
    const focusSearch = () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };

    window.addEventListener(FOCUS_HISTORY_SEARCH_EVENT, focusSearch);
    return () => {
      window.removeEventListener(FOCUS_HISTORY_SEARCH_EVENT, focusSearch);
    };
  }, []);

  // ── Server-side conversation search (debounced) ──
  //
  // When the search box is empty, we render the existing project tree
  // unchanged. When the user types ≥2 chars, we hit the new
  // /api/conversations/search endpoint which queries the messages.content
  // FTS index added in migration 019. Each result is one conversation
  // with the highest-ranked matching message snippet (ts_headline'd).
  //
  // The 220ms debounce keeps the typing experience snappy without
  // hammering the API on every keystroke.
  useEffect(() => {
    const trimmed = historyQuery.trim();
    if (trimmed.length < SEARCH_MIN_QUERY_LENGTH) {
      setSearchResults(null);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    const handle = setTimeout(async () => {
      try {
        const url = `/api/conversations/search?q=${encodeURIComponent(trimmed)}&limit=25`;
        const res = await fetch(url);
        if (!res.ok) {
          if (!cancelled) {
            setSearchResults([]);
            setSearchLoading(false);
          }
          return;
        }
        const data = (await res.json()) as {
          results: ConversationSearchResult[];
        };
        if (!cancelled) {
          setSearchResults(data.results ?? []);
          setSearchLoading(false);
        }
      } catch {
        if (!cancelled) {
          setSearchResults([]);
          setSearchLoading(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [historyQuery]);

  // Click handler for a search result row. Navigates to the right
  // surface (project workspace if the conversation belongs to one,
  // root chat home otherwise) with ?conversation=<id> so the
  // workspace component can load it.
  const handleSearchResultClick = useCallback(
    (result: ConversationSearchResult) => {
      const slug = result.projectId
        ? projectSlugById.get(result.projectId)
        : null;
      const target = slug
        ? `/projects/${slug}?conversation=${result.conversationId}`
        : `/?conversation=${result.conversationId}`;
      router.push(target);
    },
    [projectSlugById, router],
  );

  // Group conversations by project_id
  const convosByProject = new Map<string | null, ConversationSummary[]>();
  for (const c of conversations) {
    const key = c.project_id;
    if (!convosByProject.has(key)) convosByProject.set(key, []);
    convosByProject.get(key)!.push(c);
  }
  const generalConvos = convosByProject.get(null) || [];
  const normalizedHistoryQuery = historyQuery.trim().toLowerCase();
  const matchesHistoryQuery = (value: string | null | undefined) =>
    !normalizedHistoryQuery || value?.toLowerCase().includes(normalizedHistoryQuery);

  const visibleProjects = projects.filter((project) => {
    if (matchesHistoryQuery(project.name)) return true;
    const projectConvos = convosByProject.get(project.id) || [];
    return projectConvos.some(
      (conversation) =>
        matchesHistoryQuery(conversation.title) ||
        matchesHistoryQuery(conversation.created_at),
    );
  });

  const filteredGeneralConvos = generalConvos.filter(
    (conversation) =>
      matchesHistoryQuery(conversation.title) ||
      matchesHistoryQuery(conversation.created_at),
  );

  // Group General convos into date buckets
  const generalGrouped = new Map<Bucket, ConversationSummary[]>();
  for (const c of filteredGeneralConvos) {
    const b = bucketFor(c.created_at);
    if (!generalGrouped.has(b)) generalGrouped.set(b, []);
    generalGrouped.get(b)!.push(c);
  }

  const toggleProject = (id: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRename = (p: ProjectSummary) => {
    setMenuOpen(null);
    const next = window.prompt("Rename project", p.name);
    if (!next || !next.trim() || next.trim() === p.name) return;
    startTransition(async () => {
      const result = await renameProjectAction(p.id, next.trim());
      if (!result.ok) {
        window.alert(result.error || "Failed to rename project");
      }
    });
  };

  const handleArchive = (p: ProjectSummary) => {
    setMenuOpen(null);
    if (!window.confirm(`Archive "${p.name}"? You can restore it later.`))
      return;
    startTransition(async () => {
      const result = await archiveProjectAction(p.id);
      if (!result.ok) {
        window.alert(result.error || "Failed to archive project");
      }
    });
  };

  const handleConversationRename = async (c: ConversationSummary) => {
    setMenuOpen(null);
    const next = window.prompt("Rename thread", c.title);
    if (!next || !next.trim() || next.trim() === c.title) return;
    try {
      const res = await fetch(`/api/conversations/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      window.alert(
        `Failed to rename: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }
  };

  const handleConversationDelete = async (c: ConversationSummary) => {
    setMenuOpen(null);
    if (!window.confirm(`Delete "${c.title}"? This thread cannot be recovered.`)) return;
    try {
      const res = await fetch(`/api/conversations/${c.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      window.alert(
        `Failed to delete: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }
  };

  return (
    <div className="relative flex shrink-0">
      <div
        className={`bg-slate-50 border-r border-slate-200 flex flex-col transition-all duration-200 overflow-hidden ${
          isOpen ? "w-64" : "w-0"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-1.5 px-3 py-3 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <Link
              href="/"
              className="flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-white border border-slate-200 rounded-md px-2.5 py-1.5 hover:bg-slate-50 transition-colors cursor-pointer shadow-sm no-underline"
              title="Start a new general thread"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
              New thread
            </Link>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-md p-1.5 hover:bg-slate-50 transition-colors cursor-pointer shadow-sm"
              title="New project"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={onToggle}
            className="text-slate-400 hover:text-slate-700 bg-transparent border-none cursor-pointer p-1 shrink-0"
            title="Collapse sidebar"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        <div
          className="px-3 py-2"
          style={{
            background: "var(--surface-raised)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div
            className="flex items-center gap-2 px-2 py-1.5"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
            }}
          >
            {searchLoading ? (
              <Loader2
                className="w-3.5 h-3.5 shrink-0 animate-spin"
                style={{ color: "var(--ink-faint)" }}
              />
            ) : (
              <Search
                className="w-3.5 h-3.5 shrink-0"
                style={{ color: "var(--ink-faint)" }}
                strokeWidth={1.75}
              />
            )}
            <input
              ref={searchInputRef}
              type="search"
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
              placeholder="Search messages, projects, threads"
              className="w-full border-none bg-transparent outline-none"
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "var(--text-xs)",
                color: "var(--ink)",
              }}
            />
          </div>
          {historyQuery.trim().length > 0 &&
            historyQuery.trim().length < SEARCH_MIN_QUERY_LENGTH && (
              <p
                className="mt-1.5 px-1"
                style={{
                  fontSize: "var(--text-2xs)",
                  color: "var(--ink-faint)",
                }}
              >
                Keep typing to search…
              </p>
            )}
        </div>

        {/* Scrollable list — either search results OR the project tree */}
        <div className="flex-1 overflow-y-auto py-2">
          {searchResults !== null ? (
            <SearchResultsList
              results={searchResults}
              loading={searchLoading}
              query={historyQuery.trim()}
              projectsById={projectsById}
              onResultClick={handleSearchResultClick}
            />
          ) : (
            <>
          {/* ── PROJECTS section ── */}
          <div className="mb-4">
            <p className="px-3 mb-1 text-[10px] font-['JetBrains_Mono'] uppercase tracking-wider text-slate-400 font-semibold">
              Projects
            </p>
            {visibleProjects.length === 0 && !normalizedHistoryQuery && (
              <p className="px-3 text-xs text-slate-400 py-2">
                No projects yet. Click + to create one.
              </p>
            )}
            {visibleProjects.map((p) => {
              const isExpanded = expandedProjects.has(p.id) || Boolean(normalizedHistoryQuery);
              const isActive = activeProjectSlug === p.slug;
              const projectConvos = (convosByProject.get(p.id) || []).filter(
                (conversation) =>
                  !normalizedHistoryQuery ||
                  matchesHistoryQuery(conversation.title) ||
                  matchesHistoryQuery(conversation.created_at),
              );
              return (
                <div key={p.id} className="mb-0.5">
                  {/* Project row */}
                  <div
                    className={`group relative mx-2 rounded-md transition-colors ${
                      isActive ? "bg-slate-200/70" : "hover:bg-slate-200/40"
                    }`}
                  >
                    <div className="flex items-center">
                      {/* Expand toggle */}
                      <button
                        type="button"
                        onClick={() => toggleProject(p.id)}
                        className="p-1 text-slate-400 hover:text-slate-700 bg-transparent border-none cursor-pointer ml-1"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3 h-3" />
                        ) : (
                          <ChevronRight className="w-3 h-3" />
                        )}
                      </button>
                      {/* Color dot */}
                      <span
                        className="w-2 h-2 rounded-full shrink-0 mr-1.5"
                        style={{ background: p.color || "#64748B" }}
                      />
                      {/* Name → link to workspace */}
                      <Link
                        href={`/projects/${p.slug}`}
                        className="flex-1 min-w-0 text-left py-2 pr-6 no-underline"
                        title={p.name}
                      >
                        <span
                          className={`text-[13px] truncate block font-['IBM_Plex_Sans_Arabic'] ${
                            isActive
                              ? "text-slate-900 font-medium"
                              : "text-slate-700"
                          }`}
                          dir="auto"
                        >
                          {p.name}
                        </span>
                      </Link>
                      {/* More menu */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpen(
                            menuOpen === `proj-${p.id}` ? null : `proj-${p.id}`,
                          );
                        }}
                        className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-white border-none bg-transparent cursor-pointer transition-opacity ${
                          isActive || menuOpen === `proj-${p.id}`
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100"
                        }`}
                        title="More"
                      >
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </button>
                      {menuOpen === `proj-${p.id}` && (
                        <>
                          <div
                            className="fixed inset-0 z-20"
                            onClick={() => setMenuOpen(null)}
                          />
                          <div className="absolute right-1 top-9 z-30 bg-white border border-slate-200 rounded-md shadow-lg py-1 min-w-[140px]">
                            <button
                              type="button"
                              onClick={() => handleRename(p)}
                              className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 border-none bg-transparent cursor-pointer"
                            >
                              <Pencil className="w-3 h-3" />
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => handleArchive(p)}
                              className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 border-none bg-transparent cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                              Archive
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  {/* Expanded conversations */}
                  {isExpanded && (
                    <div className="ml-7 mt-0.5 mb-1">
                      {projectConvos.length === 0 ? (
                        <p className="text-[11px] text-slate-400 px-2 py-1">
                          No threads yet
                        </p>
                      ) : (
                        projectConvos.slice(0, 10).map((c) => (
                          <ConversationRow
                            key={c.id}
                            conversation={c}
                            href={`/projects/${p.slug}?tab=threads&conversation=${c.id}`}
                            isActive={activeConversationId === c.id}
                            menuKey={`conv-${c.id}`}
                            isMenuOpen={menuOpen === `conv-${c.id}`}
                            onToggleMenu={() =>
                              setMenuOpen(
                                menuOpen === `conv-${c.id}` ? null : `conv-${c.id}`,
                              )
                            }
                            onRename={() => handleConversationRename(c)}
                            onDelete={() => handleConversationDelete(c)}
                            sizeVariant="nested"
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── GENERAL section ── */}
          <div>
            <div className="flex items-center gap-1.5 px-3 mb-1">
              <Folder className="w-3 h-3 text-slate-400" />
              <p className="text-[10px] font-['JetBrains_Mono'] uppercase tracking-wider text-slate-400 font-semibold">
                General
              </p>
            </div>
            {filteredGeneralConvos.length === 0 && !normalizedHistoryQuery && (
              <p className="px-3 text-xs text-slate-400 py-2">
                No unassigned threads
              </p>
            )}
            {BUCKET_ORDER.map((bucket) => {
              const items = generalGrouped.get(bucket);
              if (!items || items.length === 0) return null;
              return (
                <div key={bucket} className="mb-2 last:mb-0">
                  <p className="px-3 mb-0.5 text-[9px] font-['JetBrains_Mono'] uppercase tracking-wider text-slate-300">
                    {bucket}
                  </p>
                  {items.map((c) => (
                    <ConversationRow
                      key={c.id}
                      conversation={c}
                      href={`/?conversation=${c.id}`}
                      isActive={activeConversationId === c.id}
                      menuKey={`conv-${c.id}`}
                      isMenuOpen={menuOpen === `conv-${c.id}`}
                      onToggleMenu={() =>
                        setMenuOpen(
                          menuOpen === `conv-${c.id}` ? null : `conv-${c.id}`,
                        )
                      }
                      onRename={() => handleConversationRename(c)}
                      onDelete={() => handleConversationDelete(c)}
                      sizeVariant="general"
                    />
                  ))}
                </div>
              );
            })}
          </div>
            </>
          )}
        </div>
      </div>

      {/* Toggle button when closed */}
      {!isOpen && (
        <button
          type="button"
          onClick={onToggle}
          className="absolute top-2 left-2 z-10 text-slate-400 hover:text-slate-700 bg-white border border-slate-200 rounded-md p-1.5 shadow-sm cursor-pointer transition-colors"
          title="Open sidebar"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
      )}

      {/* Create project dialog */}
      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

// ── SearchResultsList — replaces the project tree when the user
//    is searching message content. Each row is a conversation with
//    a snippet of the matching message body, the project name (if
//    any), and a relative timestamp. Clicking navigates to the
//    conversation. ──

function SearchResultsList({
  results,
  loading,
  query,
  projectsById,
  onResultClick,
}: {
  results: ConversationSearchResult[];
  loading: boolean;
  query: string;
  projectsById: Map<string, ProjectSummary>;
  onResultClick: (result: ConversationSearchResult) => void;
}) {
  if (loading && results.length === 0) {
    return (
      <div
        className="px-3 py-4 flex items-center gap-2"
        style={{
          color: "var(--ink-faint)",
          fontSize: "var(--text-xs)",
        }}
      >
        <Loader2 className="w-3 h-3 animate-spin" />
        Searching messages…
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="px-3 py-4">
        <p
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--ink-faint)",
          }}
        >
          No matching messages for{" "}
          <span style={{ color: "var(--ink-muted)" }}>
            “{query.length > 40 ? `${query.slice(0, 40)}…` : query}”
          </span>
          .
        </p>
        <p
          className="mt-2"
          style={{
            fontSize: "var(--text-2xs)",
            color: "var(--ink-ghost)",
            lineHeight: "var(--leading-snug)",
          }}
        >
          Searches the body of every message in your conversation history.
          Clear the box to browse projects.
        </p>
      </div>
    );
  }

  return (
    <div className="px-2">
      <p
        className="px-2 mb-1.5"
        style={{
          fontSize: "var(--text-2xs)",
          fontWeight: 500,
          color: "var(--ink-faint)",
        }}
      >
        {results.length} match{results.length === 1 ? "" : "es"}
      </p>
      <div className="space-y-0.5">
        {results.map((r) => {
          const projectName = r.projectId
            ? (projectsById.get(r.projectId)?.name ?? null)
            : null;
          return (
            <button
              key={r.conversationId}
              type="button"
              onClick={() => onResultClick(r)}
              className="group block w-full text-start cursor-pointer transition-colors px-2 py-2 border-0"
              style={{
                background: "transparent",
                borderRadius: "var(--radius-sm)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "var(--surface-sunken)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "transparent";
              }}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <MessageSquare
                  className="w-3 h-3 shrink-0"
                  strokeWidth={1.75}
                  style={{ color: "var(--ink-ghost)" }}
                />
                <span
                  className="truncate flex-1"
                  style={{
                    fontSize: "var(--text-xs)",
                    fontWeight: 500,
                    color: "var(--ink)",
                  }}
                  dir="auto"
                >
                  {r.title}
                </span>
              </div>
              {projectName && (
                <p
                  className="ms-4 mb-0.5 truncate"
                  style={{
                    fontSize: "var(--text-2xs)",
                    color: "var(--ink-faint)",
                  }}
                  dir="auto"
                >
                  {projectName}
                </p>
              )}
              <SnippetText snippet={r.snippet} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Render a snippet returned by ts_headline. Postgres wraps matched
// terms in « ... » markers so we replace those with bold spans
// without using innerHTML or dangerouslySetInnerHTML.
function SnippetText({ snippet }: { snippet: string }) {
  if (!snippet) return null;
  const parts: Array<{ text: string; emphasis: boolean }> = [];
  let cursor = 0;
  while (cursor < snippet.length) {
    const start = snippet.indexOf("«", cursor);
    if (start === -1) {
      parts.push({ text: snippet.slice(cursor), emphasis: false });
      break;
    }
    if (start > cursor) {
      parts.push({ text: snippet.slice(cursor, start), emphasis: false });
    }
    const end = snippet.indexOf("»", start + 1);
    if (end === -1) {
      parts.push({ text: snippet.slice(start), emphasis: false });
      break;
    }
    parts.push({ text: snippet.slice(start + 1, end), emphasis: true });
    cursor = end + 1;
  }
  return (
    <p
      className="ms-4 line-clamp-2"
      style={{
        fontSize: "var(--text-2xs)",
        lineHeight: "var(--leading-snug)",
        color: "var(--ink-faint)",
      }}
      dir="auto"
    >
      {parts.map((part, i) =>
        part.emphasis ? (
          <span
            key={i}
            style={{
              color: "var(--ink-strong)",
              background: "var(--accent-bg)",
              padding: "0 0.125rem",
              borderRadius: "2px",
            }}
          >
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  );
}

// ── Conversation row with hover-revealed rename/delete menu ──

interface ConversationRowProps {
  conversation: ConversationSummary;
  href: string;
  isActive: boolean;
  menuKey: string;
  isMenuOpen: boolean;
  onToggleMenu: () => void;
  onRename: () => void;
  onDelete: () => void;
  sizeVariant: "nested" | "general";
}

function ConversationRow({
  conversation,
  href,
  isActive,
  isMenuOpen,
  onToggleMenu,
  onRename,
  onDelete,
  sizeVariant,
}: ConversationRowProps) {
  const padding = sizeVariant === "nested" ? "px-2 py-1" : "px-2.5 py-1.5";

  return (
    <div className="group relative mx-2">
      <Link
        href={href}
        className={`block ${padding} rounded text-[12px] no-underline transition-colors pr-7 truncate ${
          isActive
            ? "bg-slate-200/70 text-slate-900 font-medium"
            : "text-slate-600 hover:bg-slate-200/40"
        }`}
        dir="auto"
        title={conversation.title}
      >
        {conversation.title}
      </Link>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onToggleMenu();
        }}
        className={`absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-white border-none bg-transparent cursor-pointer transition-opacity ${
          isActive || isMenuOpen
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100"
        }`}
        title="More"
      >
        <MoreHorizontal className="w-3 h-3" />
      </button>
      {isMenuOpen && (
        <>
          <div
            className="fixed inset-0 z-20"
            onClick={onToggleMenu}
          />
          <div className="absolute right-0 top-7 z-30 bg-white border border-slate-200 rounded-md shadow-lg py-1 min-w-[120px]">
            <button
              type="button"
              onClick={onRename}
              className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 border-none bg-transparent cursor-pointer"
            >
              <Pencil className="w-3 h-3" />
              Rename
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 border-none bg-transparent cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
