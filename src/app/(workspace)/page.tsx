"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { ChatMessage } from "@/components/chat-message";
import { ChatInput, type ChatInputHandle } from "@/components/chat-input";
import { FileText, Upload as UploadIcon, AlertTriangle, RotateCw, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Source } from "@/lib/types";
import { useChat } from "@/lib/hooks/use-chat";
import { usePdfViewer } from "@/components/pdf-viewer-context";

// ── Types ──

interface RecentDoc {
  id: string;
  title: string;
  type: string;
  classification: string;
  page_count: number;
  status: string;
}

// ── Main Component ──
//
// Next.js 16 requires any client component that calls useSearchParams() to
// live inside a <Suspense> boundary, otherwise static prerendering fails
// during `next build`. We wrap the actual workspace UI in a Suspense child
// so the default export is safe to pre-render while the inner component
// reads search params on the client.
export default function Home() {
  return (
    <Suspense fallback={null}>
      <WorkspaceHome />
    </Suspense>
  );
}

function WorkspaceHome() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedConvoId = searchParams.get("conversation");

  // Refresh the workspace layout (sidebar conversations) after a new
  // conversation is created from the chat. router.refresh() re-runs the
  // server layout without unmounting the page.
  const refreshLayout = useCallback(() => {
    router.refresh();
  }, [router]);

  // Chat state via hook
  const {
    conversationId,
    messages,
    streaming,
    streamingContent,
    routingStatus,
    error,
    modelChoice,
    setModelChoice,
    send: sendMessage,
    stop: stopGeneration,
    retry: retryLastTurn,
    loadConversation,
    newChat,
    setError,
  } = useChat({}, { onConversationCreated: refreshLayout });

  // Empty state data
  const [recentDocs, setRecentDocs] = useState<RecentDoc[]>([]);
  const [docCount, setDocCount] = useState<number>(0);

  // PDF viewer (lifted to workspace context — see PdfViewerProvider)
  const { openDocument, closePdf } = usePdfViewer();

  // Drag-drop attachments onto the chat area
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<ChatInputHandle>(null);
  const idleInputRef = useRef<ChatInputHandle>(null);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);

  // ── Load recent docs on mount ──

  useEffect(() => {
    fetch("/api/documents")
      .then((r) => r.json())
      .then((data) => {
        const docs: RecentDoc[] = data.documents || [];
        setDocCount(docs.length);
        setRecentDocs(docs.filter((d) => d.status === "ready").slice(0, 4));
      })
      .catch(() => {});
  }, []);

  // ── React to ?conversation=<id> in the URL (sidebar nav) ──

  useEffect(() => {
    if (requestedConvoId && requestedConvoId !== conversationId) {
      closePdf();
      loadConversation(requestedConvoId);
    } else if (!requestedConvoId && conversationId !== null) {
      closePdf();
      newChat();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedConvoId]);

  // ── Auto-scroll (sticky bottom, no jank) ──
  //
  //   - Only auto-scroll if the user is already near the bottom — otherwise
  //     they scrolled up to read something and we must not yank them back.
  //   - Use instant scroll, not smooth — "smooth" queues animations on every
  //     token and produces visible jitter during streaming.
  //   - Throttle via requestAnimationFrame so we scroll at most once per
  //     paint frame even when tokens arrive faster than that.
  useEffect(() => {
    const container = scrollContainerRef.current;
    const end = messagesEndRef.current;
    if (!container || !end) return;
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
    }
    scrollRafRef.current = requestAnimationFrame(() => {
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      if (distanceFromBottom < 120) {
        end.scrollIntoView({ behavior: "auto", block: "end" });
      }
    });
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [messages, streamingContent]);

  // ── Source click → open PDF (document) or new tab (web) ──

  const handleSourceClick = useCallback(
    async (source: Source) => {
      if (source.type === "web") {
        window.open(source.url, "_blank", "noopener,noreferrer");
        return;
      }
      try {
        await openDocument(source.documentId, source.pageNumber, source.title);
      } catch {
        setError("Failed to load document");
      }
    },
    [openDocument, setError],
  );

  const handleSaveSharedMemory = useCallback(
    async (payload: {
      text: string;
      kind: "decision" | "fact" | "instruction" | "preference" | "risk" | "question";
      scopeType: "shared";
    }) => {
      const response = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: payload.text,
          kind: payload.kind,
          scopeType: "shared",
          sourceConversationId: conversationId,
          importance: 0.7,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save memory");
      }
    },
    [conversationId],
  );

  // ── Determine UI state ──
  const isIdle = messages.length === 0 && !streaming;

  return (
    <div className="flex flex-1 overflow-hidden">
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
                  <ChatInput
                    ref={idleInputRef}
                    onSend={sendMessage}
                    onStop={stopGeneration}
                    isStreaming={streaming}
                    disabled={streaming}
                    modelChoice={modelChoice}
                    onModelChoiceChange={setModelChoice}
                  />
                </div>

                {/* Two columns: recent docs / recent threads */}
                <div className="grid grid-cols-1 gap-8">
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
              <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
                  {messages.map((msg, i) => (
                    <ChatMessage
                      key={msg.id || `msg-${i}`}
                      role={msg.role}
                      content={msg.content}
                      metadata={msg.metadata}
                      onSourceClick={handleSourceClick}
                      memoryScopes={
                        msg.role === "assistant"
                          ? [{ id: "shared", label: "Save to shared memory" }]
                          : []
                      }
                      onSaveMemory={
                        msg.role === "assistant"
                          ? (payload) =>
                              handleSaveSharedMemory({
                                ...payload,
                                scopeType: "shared",
                              })
                          : undefined
                      }
                    />
                  ))}

                  {/* Pre-first-token state: avatar + status pill */}
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

                  {/*
                    Mid-stream tool status: shown BELOW the streaming message
                    whenever there's text AND a routing status is set. This
                    covers the case where Claude streams some text, then
                    pauses to call a tool — without this block, the UI looks
                    hung during tool rounds because the status was hidden.
                  */}
                  {streaming && streamingContent && routingStatus && (
                    <div className="flex gap-4 -mt-4">
                      <div className="shrink-0 w-8 h-8" />
                      <div className="flex items-center gap-2 text-[12px] text-slate-400">
                        <span className="inline-block w-1.5 h-1.5 bg-slate-400 rounded-full animate-pulse" />
                        {routingStatus}
                      </div>
                    </div>
                  )}

                  {/* Error banner — fail-loud with retry */}
                  {error && (
                    <div className="flex gap-4">
                      <div className="shrink-0 w-8 h-8 rounded-full bg-red-50 border border-red-200 flex items-center justify-center">
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                      </div>
                      <div className="flex-1 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-red-500">
                              Turn failed
                            </p>
                            <p className="mt-1 text-[13px] leading-snug text-red-700" dir="auto">
                              {error}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setError(null)}
                            className="shrink-0 rounded p-1 text-red-400 hover:bg-red-100 hover:text-red-600 cursor-pointer border-none bg-transparent"
                            title="Dismiss"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => retryLastTurn()}
                            className="flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-2.5 py-1 text-[12px] font-medium text-red-700 hover:bg-red-100 cursor-pointer"
                          >
                            <RotateCw className="h-3 w-3" />
                            Retry
                          </button>
                          <span className="text-[11px] text-red-400">
                            Re-sends the last message
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* Input fixed at bottom */}
              <div className="shrink-0 bg-gradient-to-t from-white via-white to-transparent pt-4 pb-6 px-6">
                <div className="max-w-3xl mx-auto">
                  <ChatInput
                    ref={inputRef}
                    onSend={sendMessage}
                    onStop={stopGeneration}
                    isStreaming={streaming}
                    disabled={streaming}
                    modelChoice={modelChoice}
                    onModelChoiceChange={setModelChoice}
                  />
                  <p className="text-center text-[10px] text-slate-400 mt-2 font-['JetBrains_Mono']">
                    DocuMind can make mistakes. Verify critical information against original sources.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

    </div>
  );
}
