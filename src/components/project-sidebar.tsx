"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
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
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [, startTransition] = useTransition();

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

  // Group conversations by project_id
  const convosByProject = new Map<string | null, ConversationSummary[]>();
  for (const c of conversations) {
    const key = c.project_id;
    if (!convosByProject.has(key)) convosByProject.set(key, []);
    convosByProject.get(key)!.push(c);
  }
  const generalConvos = convosByProject.get(null) || [];

  // Group General convos into date buckets
  const generalGrouped = new Map<Bucket, ConversationSummary[]>();
  for (const c of generalConvos) {
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

  return (
    <div className="relative flex shrink-0">
      <div
        className={`bg-slate-50 border-r border-slate-200 flex flex-col transition-all duration-200 overflow-hidden ${
          isOpen ? "w-64" : "w-0"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-3 border-b border-slate-200 shrink-0">
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-white border border-slate-200 rounded-md px-2.5 py-1.5 hover:bg-slate-50 transition-colors cursor-pointer shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            New project
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="text-slate-400 hover:text-slate-700 bg-transparent border-none cursor-pointer p-1"
            title="Collapse sidebar"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto py-2">
          {/* ── PROJECTS section ── */}
          <div className="mb-4">
            <p className="px-3 mb-1 text-[10px] font-['JetBrains_Mono'] uppercase tracking-wider text-slate-400 font-semibold">
              Projects
            </p>
            {projects.length === 0 && (
              <p className="px-3 text-xs text-slate-400 py-2">
                No projects yet. Click + to create one.
              </p>
            )}
            {projects.map((p) => {
              const isExpanded = expandedProjects.has(p.id);
              const isActive = activeProjectSlug === p.slug;
              const projectConvos = convosByProject.get(p.id) || [];
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
                          No conversations yet
                        </p>
                      ) : (
                        projectConvos.slice(0, 10).map((c) => {
                          const active = activeConversationId === c.id;
                          return (
                            <Link
                              key={c.id}
                              href={`/?conversation=${c.id}`}
                              className={`block mx-2 px-2 py-1 rounded text-[12px] truncate no-underline transition-colors ${
                                active
                                  ? "bg-slate-200/70 text-slate-900 font-medium"
                                  : "text-slate-600 hover:bg-slate-200/40"
                              }`}
                              dir="auto"
                            >
                              {c.title}
                            </Link>
                          );
                        })
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
            {generalConvos.length === 0 && (
              <p className="px-3 text-xs text-slate-400 py-2">
                No unassigned conversations
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
                  {items.map((c) => {
                    const active = activeConversationId === c.id;
                    return (
                      <Link
                        key={c.id}
                        href={`/?conversation=${c.id}`}
                        className={`block mx-2 px-2.5 py-1.5 rounded text-[12px] truncate no-underline transition-colors ${
                          active
                            ? "bg-slate-200/70 text-slate-900 font-medium"
                            : "text-slate-600 hover:bg-slate-200/40"
                        }`}
                        dir="auto"
                      >
                        {c.title}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </div>
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
