"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Nav } from "@/components/nav";
import { StatusBar } from "@/components/ui-system";
import { ChatMessage } from "@/components/chat-message";
import { ChatInput } from "@/components/chat-input";
import { ChatSidebar } from "@/components/chat-sidebar";
import { X, FileText, Search as SearchIcon, Sparkles } from "lucide-react";

// ── Types ──

interface Source {
  id: string;
  title: string;
  pageNumber: number;
  documentId: string;
}

interface MessageMeta {
  mode?: string;
  doctrines?: string[];
  sources?: Source[];
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

// ── Suggestion chips ──

const SUGGESTIONS = [
  "What documents do I have?",
  "ملخص الاستثمارات المطلوبة",
  "Summarize the Golden Triangle plan",
  "What are the key economic sectors?",
  "حلل المخاطر الاستثمارية",
  "Compare mining and tourism sectors",
];

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
  // Core state
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Sidebar
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);

  // PDF viewer
  const [pdf, setPdf] = useState<PdfState | null>(null);

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
                const label = routingLabel(pendingMode, pendingDoctrines);
                setMessages((prev) => [
                  ...prev,
                  { role: "system", content: label },
                ]);
                break;
              }
              case "sources": {
                pendingSources = (event.sources as Source[]) || [];
                break;
              }
              case "text": {
                accumulated += event.content as string;
                setStreamingContent(accumulated);
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
                setStreaming(false);
                break;
              }
              case "error": {
                setError((event.message as string) || "Something went wrong");
                setStreaming(false);
                setStreamingContent("");
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
    async (text: string) => {
      setError(null);

      // Add user message
      setMessages((prev) => [...prev, { role: "user", content: text }]);
      setStreaming(true);
      setStreamingContent("");

      // Abort any existing request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const isNew = !conversationId;
        const url = conversationId ? `/api/chat/${conversationId}` : "/api/chat";

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
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
        }
      }
    },
    [conversationId, parseSSE]
  );

  // ── Load conversation from sidebar ──

  const loadConversation = useCallback(async (id: string) => {
    setError(null);
    setStreaming(false);
    setStreamingContent("");
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
    setError(null);
    setPdf(null);
  }, []);

  // ── Source click → open PDF ──

  const handleSourceClick = useCallback(async (documentId: string, pageNumber: number, title: string) => {
    try {
      const response = await fetch(`/api/documents/${documentId}/url`);
      const data = await response.json();
      if (data.url) {
        setPdf({ url: data.url, page: pageNumber, title });
      }
    } catch {
      setError("Failed to load document");
    }
  }, []);

  // ── Determine UI state ──
  const isIdle = messages.length === 0 && !streaming;

  return (
    <div className="flex flex-col h-screen">
      <Nav />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <ChatSidebar
          conversations={conversations}
          activeId={conversationId}
          onSelect={loadConversation}
          onNew={newChat}
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen((prev) => !prev)}
        />

        {/* Chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          {isIdle ? (
            /* ── Idle state: welcome ── */
            <div className="flex-1 flex flex-col items-center justify-center px-4 pb-8">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-6 h-6 text-slate-400" />
                <h1 className="text-2xl font-semibold text-slate-800">DocuMind</h1>
              </div>
              <p className="text-sm text-slate-400 mb-8">What would you like to know?</p>

              <div className="w-full max-w-2xl mb-4">
                <ChatInput onSend={sendMessage} disabled={streaming} />
              </div>

              <div className="flex flex-wrap gap-2 justify-center max-w-2xl">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => sendMessage(s)}
                    className="text-xs text-slate-500 bg-white border border-slate-200 rounded-full px-3 py-1.5 hover:bg-slate-50 hover:border-slate-300 transition-colors cursor-pointer font-['IBM_Plex_Sans_Arabic']"
                    dir="auto"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* ── Active state: messages + input ── */
            <>
              {/* Messages area */}
              <div className="flex-1 overflow-y-auto px-4 py-6">
                <div className="max-w-3xl mx-auto space-y-4">
                  {messages.map((msg, i) => (
                    <ChatMessage
                      key={msg.id || `msg-${i}`}
                      role={msg.role}
                      content={msg.content}
                      metadata={msg.metadata}
                      onSourceClick={handleSourceClick}
                    />
                  ))}

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
              <div className="shrink-0 border-t border-slate-100 bg-white px-4 py-3">
                <div className="max-w-3xl mx-auto">
                  <ChatInput onSend={sendMessage} disabled={streaming} />
                </div>
              </div>
            </>
          )}
        </div>

        {/* PDF Viewer panel */}
        {pdf && (
          <div className="w-[480px] shrink-0 border-l border-slate-200 bg-white flex flex-col">
            {/* PDF header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="text-sm text-slate-600 truncate" dir="auto">
                  {pdf.title}
                </span>
                <span className="text-xs text-slate-400 shrink-0">p.{pdf.page}</span>
              </div>
              <button
                type="button"
                onClick={() => setPdf(null)}
                className="text-slate-400 hover:text-slate-600 bg-transparent border-none cursor-pointer p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* PDF iframe */}
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

      <StatusBar
        items={[
          { label: "MODE", value: conversationId ? "CHAT" : "IDLE" },
          { label: "MESSAGES", value: String(messages.length) },
        ]}
      />
    </div>
  );
}
