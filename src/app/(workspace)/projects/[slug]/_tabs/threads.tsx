"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Database } from "@/lib/database.types";
import type { UseChatResult } from "@/lib/hooks/use-chat";
import { ChatInput, type ChatInputHandle } from "@/components/chat-input";
import { ChatMessage } from "@/components/chat-message";
import { usePdfViewer } from "@/components/pdf-viewer-context";
import type { Source } from "@/lib/types";
import { FileText, Building2, MessageSquare } from "lucide-react";

type Project = Database["public"]["Tables"]["projects"]["Row"];

interface ThreadsTabProps {
  project: Project;
  counts: {
    documents: number;
    entities: number;
    threads: number;
  };
  chat: UseChatResult;
}

export function ThreadsTab({ project, counts, chat }: ThreadsTabProps) {
  const inputRef = useRef<ChatInputHandle>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { openDocument } = usePdfViewer();
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    conversationId,
    messages,
    streaming,
    streamingContent,
    routingStatus,
    error,
    send,
    newChat,
    loadConversation,
  } = chat;

  const isIdle = messages.length === 0 && !streaming;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // When the Chats tab (or any external trigger) sends us here with a
  // fresh `?new=<ts>` query param, reset the chat state once and then strip
  // the param so future renders don't loop. Each distinct `new` value
  // triggers exactly one reset.
  const newParam = searchParams.get("new");
  const requestedConversationId = searchParams.get("conversation");
  const lastHandledNewParam = useRef<string | null>(null);
  useEffect(() => {
    if (!newParam) return;
    if (lastHandledNewParam.current === newParam) return;
    lastHandledNewParam.current = newParam;
    newChat();
    // Strip the `new` param from the URL without triggering a navigation spinner
    const next = new URLSearchParams(searchParams.toString());
    next.delete("new");
    const queryString = next.toString();
    router.replace(
      `/projects/${project.slug}${queryString ? `?${queryString}` : ""}`,
      { scroll: false },
    );
  }, [newParam, newChat, router, searchParams, project.slug]);

  useEffect(() => {
    if (!requestedConversationId) return;
    if (requestedConversationId === conversationId) return;
    void loadConversation(requestedConversationId);
  }, [requestedConversationId, conversationId, loadConversation]);

  // Source pills: web sources open in a new tab; document sources open
  // the workspace-side PDF viewer panel via the PdfViewerProvider context.
  const handleSourceClick = (source: Source) => {
    if (source.type === "web") {
      window.open(source.url, "_blank", "noopener,noreferrer");
    } else {
      openDocument(source.documentId, source.pageNumber, source.title);
    }
  };

  const handleSaveMemory = async (payload: {
    text: string;
    kind: "decision" | "fact" | "instruction" | "preference" | "risk" | "question";
    scopeType: "project" | "shared";
  }) => {
    const response = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: payload.text,
        kind: payload.kind,
        scopeType: payload.scopeType,
        scopeId: payload.scopeType === "project" ? project.id : null,
        sourceConversationId: conversationId,
        importance: payload.scopeType === "project" ? 0.8 : 0.7,
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Failed to save memory");
    }
    window.dispatchEvent(
      new CustomEvent("workspace-memory-updated", {
        detail: { projectId: project.id, scopeType: payload.scopeType },
      }),
    );
  };

  const handleSaveArtifact = async (payload: {
    title: string;
    kind: "email" | "memo" | "brief" | "deck" | "note" | "talking_points" | "meeting_prep";
    content: string;
  }) => {
    const response = await fetch("/api/artifacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        conversationId,
        title: payload.title,
        kind: payload.kind,
        content: payload.content,
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Failed to save output");
    }
    window.dispatchEvent(
      new CustomEvent("workspace-artifacts-updated", {
        detail: { projectId: project.id },
      }),
    );
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
                  memoryScopes={
                    msg.role === "assistant"
                      ? [
                          { id: "project", label: "Save to project memory" },
                          { id: "shared", label: "Save to shared memory" },
                        ]
                      : []
                  }
                  onSaveMemory={msg.role === "assistant" ? handleSaveMemory : undefined}
                  onSaveArtifact={msg.role === "assistant" ? handleSaveArtifact : undefined}
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
            This thread prioritizes documents linked to this project. Use `@` to pin a specific document or entity.
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
  counts: ThreadsTabProps["counts"];
}) {
  return (
    <div className="space-y-8">
      {/* Greeting */}
      <div>
        <h2
          className="text-[28px] font-semibold text-slate-900 tracking-tight"
          dir="auto"
        >
          Start a thread
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
            Ask a focused question, draft something, or open a saved thread from Activity.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <CountCard icon={FileText} label="Documents" value={counts.documents} />
        <CountCard icon={Building2} label="Participants" value={counts.entities} />
        <CountCard icon={MessageSquare} label="Threads" value={counts.threads} />
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
