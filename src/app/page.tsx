"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Nav } from "@/components/nav";
import { ChatMessage } from "@/components/chat-message";
import {
  ChatInput,
  type Attachment,
  type ChatInputHandle,
} from "@/components/chat-input";
import { ChatSidebar } from "@/components/chat-sidebar";
import { X, FileText, Upload as UploadIcon, MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Source, AttachmentMeta, PinnedItem } from "@/lib/types";

// ── Types ──

interface MessageMeta {
  mode?: string;
  doctrines?: string[];
  sources?: Source[];
  attachments?: AttachmentMeta[];
  pinned?: PinnedItem[];
}

interface ChatMsg {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: MessageMeta;
}

interface Conversation {
  id: string;
  title: string;
  created_at: string;
}

interface PdfState {
  url: string;
  page: number;
  title: string;
}

interface RecentDoc {
  id: string;
  title: string;
  type: string;
  classification: string;
  page_count: number;
  status: string;
}

// ── Helpers ──

function routingLabel(mode: string, doctrines?: string[]): string {
  if (mode === "search") return "Searching documents...";
  if (mode === "casual") return "Thinking...";
  if (mode === "deep" && doctrines && doctrines.length > 0) {
    return `Analyzing with ${doctrines.join(" + ")} doctrines...`;
  }
  return "Analyzing...";
}

// ── Main Component ──

export default function Home() {
  const router = useRouter();
  // Core state
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [routingStatus, setRoutingStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sidebar
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);

  // Empty state data
  const [recentDocs, setRecentDocs] = useState<RecentDoc[]>([]);
  const [docCount, setDocCount] = useState<number>(0);

  // PDF viewer
  const [pdf, setPdf] = useState<PdfState | null>(null);

  // Drag-drop attachments onto the chat area
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<ChatInputHandle>(null);
  const idleInputRef = useRef<ChatInputHandle>(null);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Load conversations on mount ──

  useEffect(() => {
    fetch("/api/conversations")
      .then((r) => r.json())
      .then((data) => {
        if (data.conversations) setConversations(data.conversations);
      })
      .catch(() => {});

    fetch("/api/documents")
      .then((r) => r.json())
      .then((data) => {
        const docs: RecentDoc[] = data.documents || [];
        setDocCount(docs.length);
        setRecentDocs(docs.filter(d => d.status === "ready").slice(0, 4));
      })
      .catch(() => {});
  }, []);

  // ── Auto-scroll ──

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // ── Parse SSE stream ──

  const parseSSE = useCallback(
    async (response: Response, isNew: boolean) => {
      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";
      let pendingSources: Source[] = [];
      let pendingMode = "";
      let pendingDoctrines: string[] = [];
      let accumulated = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6);

            let event: Record<string, unknown>;
            try {
              event = JSON.parse(jsonStr);
            } catch {
              continue;
            }

            switch (event.type) {
              case "session": {
                const sessionId = event.id as string;
                setConversationId(sessionId);
                break;
              }
              case "routing": {
                pendingMode = (event.mode as string) || "";
                pendingDoctrines = (event.doctrines as string[]) || [];
                setRoutingStatus(routingLabel(pendingMode, pendingDoctrines));
                break;
              }
              case "sources": {
                // Tool-discovered web sources are appended (deduped by id)
                const newSources = (event.sources as Source[]) || [];
                const existingIds = new Set(pendingSources.map((s) => s.id));
                pendingSources = [
                  ...pendingSources,
                  ...newSources.filter((s) => !existingIds.has(s.id)),
                ];
                break;
              }
              case "tool": {
                // Autonomous tool call from Claude (e.g. web_search)
                if (event.status === "start") {
                  setRoutingStatus(`🔍 Searching the web: ${event.query}`);
                } else if (event.status === "end") {
                  setRoutingStatus(null);
                }
                break;
              }
              case "text": {
                accumulated += event.content as string;
                setStreamingContent(accumulated);
                setRoutingStatus(null);
                break;
              }
              case "done": {
                // Finalize assistant message
                setMessages((prev) => [
                  ...prev,
                  {
                    role: "assistant",
                    content: accumulated,
                    metadata: {
                      mode: pendingMode,
                      doctrines: pendingDoctrines.length > 0 ? pendingDoctrines : undefined,
                      sources: pendingSources.length > 0 ? pendingSources : undefined,
                    },
                  },
                ]);
                setStreamingContent("");
                setRoutingStatus(null);
                setStreaming(false);
                break;
              }
              case "error": {
                setError((event.message as string) || "Something went wrong");
                setStreaming(false);
                setStreamingContent("");
                setRoutingStatus(null);
                break;
              }
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError("Connection lost. Please try again.");
          setStreaming(false);
          setStreamingContent("");
        }
      }

      // Refresh sidebar after new conversation
      if (isNew) {
        fetch("/api/conversations")
          .then((r) => r.json())
          .then((data) => {
            if (data.conversations) setConversations(data.conversations);
          })
          .catch(() => {});
      }
    },
    []
  );

  // ── Send message ──

  const sendMessage = useCallback(
    async (text: string, attachments: Attachment[] = [], pinned: PinnedItem[] = []) => {
      setError(null);

      const attachmentMeta: AttachmentMeta[] = attachments.map((a) => ({
        title: a.title,
        pageCount: a.pageCount,
        size: a.size,
      }));

      // Add user message (with attachment + pinned meta for rendering chips)
      setMessages((prev) => [
        ...prev,
        {
          role: "user",
          content: text,
          metadata: {
            ...(attachmentMeta.length > 0 ? { attachments: attachmentMeta } : {}),
            ...(pinned.length > 0 ? { pinned } : {}),
          },
        },
      ]);
      setStreaming(true);
      setStreamingContent("");
      setRoutingStatus(null);

      // Abort any existing request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const isNew = !conversationId;
        const url = conversationId ? `/api/chat/${conversationId}` : "/api/chat";

        const pinnedDocumentIds = pinned
          .filter((p) => p.kind === "document")
          .map((p) => p.id);
        const pinnedEntityIds = pinned
          .filter((p) => p.kind === "entity")
          .map((p) => p.id);

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            attachments: attachments.map((a) => ({
              title: a.title,
              content: a.content,
              pageCount: a.pageCount,
              size: a.size,
            })),
            pinnedDocumentIds,
            pinnedEntityIds,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error((errData as Record<string, string>).error || "Request failed");
        }

        await parseSSE(response, isNew);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError((err as Error).message || "Something went wrong");
          setStreaming(false);
          setStreamingContent("");
          setRoutingStatus(null);
        }
      }
    },
    [conversationId, parseSSE],
  );

  // ── Load conversation from sidebar ──

  const loadConversation = useCallback(async (id: string) => {
    setError(null);
    setStreaming(false);
    setStreamingContent("");
    setRoutingStatus(null);
    setPdf(null);

    try {
      const response = await fetch(`/api/chat/${id}/messages`);
      const data = await response.json();

      if (data.messages) {
        const loaded: ChatMsg[] = data.messages.map(
          (m: { id: string; role: string; content: string; metadata?: MessageMeta }) => ({
            id: m.id,
            role: m.role as "user" | "assistant" | "system",
            content: m.content,
            metadata: m.metadata || undefined,
          })
        );
        setMessages(loaded);
        setConversationId(id);
      }
    } catch {
      setError("Failed to load conversation");
    }
  }, []);

  // ── New chat ──

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setConversationId(null);
    setMessages([]);
    setStreaming(false);
    setStreamingContent("");
    setRoutingStatus(null);
    setError(null);
    setPdf(null);
  }, []);

  // ── Rename / delete conversations ──

  const renameConversation = useCallback(async (id: string, title: string) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
    try {
      await fetch(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
    } catch {
      setError("Failed to rename");
    }
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (conversationId === id) {
      setConversationId(null);
      setMessages([]);
      setStreamingContent("");
      setStreaming(false);
    }
    try {
      await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    } catch {
      setError("Failed to delete");
    }
  }, [conversationId]);

  // ── Source click → open PDF (document) or new tab (web) ──

  const handleSourceClick = useCallback(async (source: Source) => {
    if (source.type === "web") {
      window.open(source.url, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      const response = await fetch(`/api/documents/${source.documentId}/url`);
      const data = await response.json();
      if (data.url) {
        setPdf({ url: data.url, page: source.pageNumber, title: source.title });
      }
    } catch {
      setError("Failed to load document");
    }
  }, []);

  // ── Determine UI state ──
  const isIdle = messages.length === 0 && !streaming;

  return (
    <div className="flex flex-col h-screen bg-white">
      <Nav />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <ChatSidebar
          conversations={conversations}
          activeId={conversationId}
          onSelect={loadConversation}
          onNew={newChat}
          onRename={renameConversation}
          onDelete={deleteConversation}
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen((prev) => !prev)}
        />

        {/* Chat area */}
        <div
          className="flex-1 flex flex-col min-w-0 bg-white relative"
          onDragEnter={(e) => {
            if (e.dataTransfer?.types.includes("Files")) {
              e.preventDefault();
              setDragOver(true);
            }
          }}
          onDragOver={(e) => {
            if (e.dataTransfer?.types.includes("Files")) {
              e.preventDefault();
            }
          }}
          onDragLeave={(e) => {
            // Only clear when leaving the actual container, not children
            if (e.currentTarget === e.target) setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const files = Array.from(e.dataTransfer.files);
            const target = isIdle ? idleInputRef.current : inputRef.current;
            target?.addFiles(files);
          }}
        >
          {/* Drag-drop overlay */}
          {dragOver && (
            <div className="absolute inset-0 z-20 bg-slate-900/5 backdrop-blur-sm border-2 border-dashed border-slate-400 rounded-lg m-3 flex items-center justify-center pointer-events-none">
              <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-6 py-4 flex items-center gap-3">
                <UploadIcon className="w-5 h-5 text-slate-500" />
                <div>
                  <p className="text-[14px] font-medium text-slate-900">Drop PDFs to attach</p>
                  <p className="text-[12px] text-slate-500">Files become context for this conversation only</p>
                </div>
              </div>
            </div>
          )}
          {isIdle ? (
            /* ── Smart empty state ── */
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-2xl mx-auto px-6 pt-20 pb-10">
                {/* Greeting */}
                <h1 className="text-[32px] font-semibold text-slate-900 tracking-tight mb-1.5">
                  Good to see you.
                </h1>
                <p className="text-[15px] text-slate-500 mb-10">
                  {docCount > 0
                    ? `${docCount} document${docCount === 1 ? "" : "s"} indexed and ready to query.`
                    : "Upload your first document to get started."}
                </p>

                {/* Input */}
                <div className="mb-10">
                  <ChatInput ref={idleInputRef} onSend={sendMessage} disabled={streaming} />
                </div>

                {/* Two columns: recent docs / recent threads */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Recent documents */}
                  {recentDocs.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <p className="font-['JetBrains_Mono'] text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          Recent uploads
                        </p>
                        <button
                          type="button"
                          onClick={() => router.push("/documents")}
                          className="text-[11px] text-slate-400 hover:text-slate-700 bg-transparent border-none cursor-pointer"
                        >
                          View all →
                        </button>
                      </div>
                      <div className="space-y-1">
                        {recentDocs.map((doc) => (
                          <button
                            key={doc.id}
                            type="button"
                            onClick={() => router.push(`/documents/${doc.id}`)}
                            className="w-full flex items-center gap-2.5 text-left bg-transparent hover:bg-slate-50 border border-transparent hover:border-slate-200 rounded-lg px-2.5 py-2 transition-all cursor-pointer"
                          >
                            <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span
                              className="text-[13px] text-slate-700 truncate flex-1"
                              dir="auto"
                            >
                              {doc.title}
                            </span>
                            <span className="font-['JetBrains_Mono'] text-[9px] text-slate-400 uppercase shrink-0">
                              {doc.classification}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recent threads */}
                  {conversations.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <p className="font-['JetBrains_Mono'] text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          Recent threads
                        </p>
                      </div>
                      <div className="space-y-1">
                        {conversations.slice(0, 4).map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => loadConversation(c.id)}
                            className="w-full flex items-center gap-2.5 text-left bg-transparent hover:bg-slate-50 border border-transparent hover:border-slate-200 rounded-lg px-2.5 py-2 transition-all cursor-pointer"
                          >
                            <MessageSquare className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span
                              className="text-[13px] text-slate-700 truncate flex-1"
                              dir="auto"
                            >
                              {c.title}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Empty: no docs at all */}
                {docCount === 0 && (
                  <div className="mt-8 border border-dashed border-slate-200 rounded-lg p-8 text-center">
                    <UploadIcon className="w-6 h-6 text-slate-300 mx-auto mb-2" />
                    <p className="text-[13px] text-slate-500 mb-3">
                      Your knowledge base is empty.
                    </p>
                    <button
                      type="button"
                      onClick={() => router.push("/upload")}
                      className="text-[12px] font-medium text-white bg-slate-900 hover:bg-slate-800 border-none rounded-md px-3 py-1.5 cursor-pointer transition-colors"
                    >
                      Upload your first document
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* ── Active state: messages + input ── */
            <>
              {/* Messages area */}
              <div className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
                  {messages.map((msg, i) => (
                    <ChatMessage
                      key={msg.id || `msg-${i}`}
                      role={msg.role}
                      content={msg.content}
                      metadata={msg.metadata}
                      onSourceClick={handleSourceClick}
                    />
                  ))}

                  {/* Routing status (visible only until first text chunk) */}
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

                  {/* Streaming assistant message */}
                  {streaming && streamingContent && (
                    <ChatMessage
                      role="assistant"
                      content={streamingContent}
                      isStreaming
                    />
                  )}

                  {/* Error display */}
                  {error && (
                    <div className="flex justify-center">
                      <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-2 max-w-md">
                        {error}
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* Input fixed at bottom */}
              <div className="shrink-0 bg-gradient-to-t from-white via-white to-transparent pt-4 pb-6 px-6">
                <div className="max-w-3xl mx-auto">
                  <ChatInput ref={inputRef} onSend={sendMessage} disabled={streaming} />
                  <p className="text-center text-[10px] text-slate-400 mt-2 font-['JetBrains_Mono']">
                    DocuMind can make mistakes. Verify critical information against original sources.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* PDF Viewer panel */}
        {pdf && (
          <div className="w-[480px] shrink-0 border-l border-slate-200 bg-white flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="text-sm text-slate-700 truncate" dir="auto">
                  {pdf.title}
                </span>
                <span className="font-['JetBrains_Mono'] text-[10px] text-slate-400 shrink-0">p.{pdf.page}</span>
              </div>
              <button
                type="button"
                onClick={() => setPdf(null)}
                className="text-slate-400 hover:text-slate-700 bg-transparent border-none cursor-pointer p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1">
              <iframe
                src={`${pdf.url}#page=${pdf.page}`}
                className="w-full h-full border-none"
                title={pdf.title}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
