"use client";

import { useEffect, useRef } from "react";
import type { Database } from "@/lib/database.types";
import type { UseChatResult } from "@/lib/hooks/use-chat";
import { ChatInput, type ChatInputHandle } from "@/components/chat-input";
import { ChatMessage } from "@/components/chat-message";
import type { Source } from "@/lib/types";
import { FileText, Building2, Handshake, MessageSquare } from "lucide-react";

type Project = Database["public"]["Tables"]["projects"]["Row"];

interface OverviewTabProps {
  project: Project;
  counts: {
    documents: number;
    companies: number;
    negotiations: number;
    conversations: number;
  };
  chat: UseChatResult;
}

export function OverviewTab({ project, counts, chat }: OverviewTabProps) {
  const inputRef = useRef<ChatInputHandle>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const {
    messages,
    streaming,
    streamingContent,
    routingStatus,
    error,
    send,
  } = chat;

  const isIdle = messages.length === 0 && !streaming;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // Source pills currently open in a new tab for web sources;
  // document sources do nothing in the workspace overview (the
  // dedicated document viewer lives at /documents/[id]).
  const handleSourceClick = (source: Source) => {
    if (source.type === "web") {
      window.open(source.url, "_blank", "noopener,noreferrer");
    } else {
      window.open(`/documents/${source.documentId}`, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">
          {isIdle ? (
            <IdleState project={project} counts={counts} />
          ) : (
            <div className="space-y-8">
              {messages.map((msg, i) => (
                <ChatMessage
                  key={msg.id || `msg-${i}`}
                  role={msg.role}
                  content={msg.content}
                  metadata={msg.metadata}
                  onSourceClick={handleSourceClick}
                />
              ))}
              {streaming && !streamingContent && routingStatus && (
                <div className="flex gap-4">
                  <div className="shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-slate-800 to-slate-600 flex items-center justify-center">
                    <span className="inline-block w-2 h-2 bg-white rounded-full animate-pulse" />
                  </div>
                  <div className="flex items-center text-[13px] text-slate-400">
                    {routingStatus}
                  </div>
                </div>
              )}
              {streaming && streamingContent && (
                <ChatMessage
                  role="assistant"
                  content={streamingContent}
                  isStreaming
                />
              )}
              {error && (
                <div className="flex justify-center">
                  <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-2 max-w-md">
                    {error}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Fixed chat input at the bottom */}
      <div className="shrink-0 bg-gradient-to-t from-white via-white to-transparent pt-4 pb-6 px-6 border-t border-slate-100">
        <div className="max-w-3xl mx-auto">
          <ChatInput
            ref={inputRef}
            onSend={send}
            disabled={streaming}
            placeholder={`Ask about ${project.name}… (type @ to mention)`}
          />
          <p className="text-center text-[10px] text-slate-400 mt-2 font-['JetBrains_Mono']">
            Project-scoped retrieval lands in Phase 05. For now, the model still searches your full KB.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Idle state ──

function IdleState({
  project,
  counts,
}: {
  project: Project;
  counts: OverviewTabProps["counts"];
}) {
  return (
    <div className="space-y-8">
      {/* Greeting */}
      <div>
        <h2
          className="text-[28px] font-semibold text-slate-900 tracking-tight"
          dir="auto"
        >
          {project.name}
        </h2>
        {project.context_summary ? (
          <p
            className="mt-2 text-[14px] text-slate-500 leading-relaxed"
            dir="auto"
          >
            {project.context_summary}
          </p>
        ) : project.description ? (
          <p
            className="mt-2 text-[14px] text-slate-500 leading-relaxed"
            dir="auto"
          >
            {project.description}
          </p>
        ) : (
          <p className="mt-2 text-[13px] text-slate-400">
            No description yet. Ask anything to get started.
          </p>
        )}
      </div>

      {/* Count cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <CountCard icon={FileText} label="Documents" value={counts.documents} />
        <CountCard icon={Building2} label="Companies" value={counts.companies} />
        <CountCard icon={Handshake} label="Negotiations" value={counts.negotiations} />
        <CountCard icon={MessageSquare} label="Conversations" value={counts.conversations} />
      </div>
    </div>
  );
}

function CountCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="border border-slate-200 rounded-lg px-4 py-3 bg-white">
      <div className="flex items-center gap-2 text-[10px] text-slate-400 font-['JetBrains_Mono'] uppercase tracking-wider">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className="mt-1 text-[22px] font-semibold text-slate-900">{value}</div>
    </div>
  );
}
