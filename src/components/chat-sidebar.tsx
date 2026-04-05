"use client";

import { Plus, PanelLeftClose, PanelLeftOpen } from "lucide-react";

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
  isOpen: boolean;
  onToggle: () => void;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ChatSidebar({ conversations, activeId, onSelect, onNew, isOpen, onToggle }: ChatSidebarProps) {
  return (
    <div className="relative flex shrink-0">
      {/* Sidebar panel */}
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
            className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 bg-white border border-slate-200 rounded-md px-2.5 py-1.5 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            New chat
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="text-slate-400 hover:text-slate-600 bg-transparent border-none cursor-pointer p-1"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto py-1">
          {conversations.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-6">No conversations yet</p>
          )}
          {conversations.map((convo) => (
            <button
              key={convo.id}
              type="button"
              onClick={() => onSelect(convo.id)}
              className={`w-full text-left px-3 py-2.5 border-none cursor-pointer transition-colors ${
                activeId === convo.id
                  ? "bg-slate-100"
                  : "bg-transparent hover:bg-slate-100/50"
              }`}
            >
              <p
                className="text-sm text-slate-700 truncate font-['IBM_Plex_Sans_Arabic']"
                dir="auto"
              >
                {convo.title}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5 font-['JetBrains_Mono']">
                {formatDate(convo.created_at)}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Toggle button when closed */}
      {!isOpen && (
        <button
          type="button"
          onClick={onToggle}
          className="absolute top-2 left-2 z-10 text-slate-400 hover:text-slate-600 bg-white border border-slate-200 rounded-md p-1.5 shadow-sm cursor-pointer transition-colors"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
