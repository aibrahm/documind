"use client";

import { useState } from "react";
import { Plus, PanelLeftClose, PanelLeftOpen, MoreHorizontal, Trash2, Pencil } from "lucide-react";

interface ConversationItem {
  id: string;
  title: string;
  created_at: string;
}

interface ChatSidebarProps {
  conversations: ConversationItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename?: (id: string, title: string) => void;
  onDelete?: (id: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

type Bucket = "Today" | "Yesterday" | "Previous 7 days" | "Previous 30 days" | "Older";

function bucketFor(dateString: string): Bucket {
  const date = new Date(dateString);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((startOfToday.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "Today";
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "Previous 7 days";
  if (diffDays < 30) return "Previous 30 days";
  return "Older";
}

const BUCKET_ORDER: Bucket[] = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];

export function ChatSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  isOpen,
  onToggle,
}: ChatSidebarProps) {
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  // Group conversations by bucket, preserving sort order within each
  const grouped = new Map<Bucket, ConversationItem[]>();
  for (const c of conversations) {
    const b = bucketFor(c.created_at);
    if (!grouped.has(b)) grouped.set(b, []);
    grouped.get(b)!.push(c);
  }

  const handleRename = (c: ConversationItem) => {
    setMenuOpen(null);
    const next = window.prompt("Rename conversation", c.title);
    if (next && next.trim() && next.trim() !== c.title) {
      onRename?.(c.id, next.trim());
    }
  };

  const handleDelete = (c: ConversationItem) => {
    setMenuOpen(null);
    if (window.confirm(`Delete "${c.title}"? This cannot be undone.`)) {
      onDelete?.(c.id);
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
        <div className="flex items-center justify-between px-3 py-3 border-b border-slate-200 shrink-0">
          <button
            type="button"
            onClick={onNew}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-white border border-slate-200 rounded-md px-2.5 py-1.5 hover:bg-slate-50 transition-colors cursor-pointer shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            New chat
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

        {/* Conversation list grouped by date */}
        <div className="flex-1 overflow-y-auto py-2">
          {conversations.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-6">No conversations yet</p>
          )}
          {BUCKET_ORDER.map((bucket) => {
            const items = grouped.get(bucket);
            if (!items || items.length === 0) return null;
            return (
              <div key={bucket} className="mb-3 last:mb-0">
                <p className="px-3 mb-1 text-[10px] font-['JetBrains_Mono'] uppercase tracking-wider text-slate-400 font-semibold">
                  {bucket}
                </p>
                {items.map((convo) => {
                  const isActive = activeId === convo.id;
                  return (
                    <div
                      key={convo.id}
                      className={`group relative mx-2 rounded-md transition-colors ${
                        isActive ? "bg-slate-200/70" : "hover:bg-slate-200/40"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelect(convo.id)}
                        className="w-full text-left px-2.5 py-2 border-none cursor-pointer bg-transparent"
                      >
                        <p
                          className={`text-[13px] truncate font-['IBM_Plex_Sans_Arabic'] pr-6 ${
                            isActive ? "text-slate-900 font-medium" : "text-slate-600"
                          }`}
                          dir="auto"
                        >
                          {convo.title}
                        </p>
                      </button>
                      {/* Hover action */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpen(menuOpen === convo.id ? null : convo.id);
                        }}
                        className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-white border-none bg-transparent cursor-pointer transition-opacity ${
                          isActive || menuOpen === convo.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        }`}
                        title="More"
                      >
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </button>
                      {/* Action menu */}
                      {menuOpen === convo.id && (
                        <>
                          <div
                            className="fixed inset-0 z-20"
                            onClick={() => setMenuOpen(null)}
                          />
                          <div className="absolute right-1 top-9 z-30 bg-white border border-slate-200 rounded-md shadow-lg py-1 min-w-[140px]">
                            <button
                              type="button"
                              onClick={() => handleRename(convo)}
                              className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 border-none bg-transparent cursor-pointer"
                            >
                              <Pencil className="w-3 h-3" />
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(convo)}
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
                })}
              </div>
            );
          })}
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
    </div>
  );
}
