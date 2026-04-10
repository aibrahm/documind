"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { ChatMessage } from "@/components/chat-message";
import { ChatInput, type ChatInputHandle } from "@/components/chat-input";
import {
  Upload as UploadIcon,
  AlertTriangle,
  RotateCw,
  X,
  ArrowRight,
  FileText,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Source } from "@/lib/types";
import { useChat } from "@/lib/hooks/use-chat";
import { usePdfViewer } from "@/components/pdf-viewer-context";
import type { WorkspaceSuggestion } from "@/lib/workspace-suggestions";
import type { DailyBriefing } from "@/lib/daily-briefing";
import { strings, type UiLanguage } from "@/lib/ui-strings";

interface WorkspaceHomeProps {
  suggestions: WorkspaceSuggestion[];
  briefing: DailyBriefing;
  language: UiLanguage;
}

export function WorkspaceHome({
  suggestions,
  briefing,
  language,
}: WorkspaceHomeProps) {
  return (
    <Suspense fallback={null}>
      <WorkspaceHomeInner
        suggestions={suggestions}
        briefing={briefing}
        language={language}
      />
    </Suspense>
  );
}

function WorkspaceHomeInner({
  suggestions,
  briefing: initialBriefing,
  language,
}: WorkspaceHomeProps) {
  const t = strings(language);
  // Briefing is passed in from the server component but can be live-
  // replaced by the manual refresh button. We keep it in local state
  // so a refresh doesn't force a full page reload.
  const [briefing, setBriefing] = useState<DailyBriefing>(initialBriefing);
  const [refreshingBriefing, setRefreshingBriefing] = useState(false);

  const handleBriefingRefresh = useCallback(async () => {
    if (refreshingBriefing) return;
    setRefreshingBriefing(true);
    try {
      const res = await fetch("/api/briefing/refresh", { method: "POST" });
      if (res.ok) {
        const data = (await res.json()) as { briefing: DailyBriefing };
        if (data.briefing) setBriefing(data.briefing);
      }
    } catch {
      // Swallow — a failed refresh keeps the old briefing on screen
      // rather than replacing it with an error. The regenerator
      // itself falls back to a "temporarily unavailable" quiet
      // state on persistent failure.
    } finally {
      setRefreshingBriefing(false);
    }
  }, [refreshingBriefing]);

  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedConvoId = searchParams.get("conversation");
  const requestedPinnedDocId = searchParams.get("pinned_document");

  const refreshLayout = useCallback(() => {
    router.refresh();
  }, [router]);

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

  const { openDocument, closePdf } = usePdfViewer();

  // Drag-drop attachments onto the chat area
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<ChatInputHandle>(null);
  const idleInputRef = useRef<ChatInputHandle>(null);

  // Refs for scrolling
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);

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

  // ── React to ?pinned_document=<id> (from /documents/[id] "Ask about this document") ──
  //
  // Flow: user clicks "Ask about this document" on the library detail
  // page → we navigate here with ?pinned_document=<doc-id>. We resolve
  // the title via /api/documents/{id}, pin it into the idle ChatInput,
  // and then strip the query param from the URL so a refresh doesn't
  // re-pin the same doc twice.
  useEffect(() => {
    if (!requestedPinnedDocId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/documents/${requestedPinnedDocId}`);
        if (!res.ok) return;
        const data = await res.json();
        const doc = data?.document as { id?: string; title?: string } | null;
        if (cancelled || !doc?.id) return;
        // Queue the pin onto whichever input is currently visible.
        const target = messages.length === 0 ? idleInputRef.current : inputRef.current;
        target?.addPinned({
          kind: "document",
          id: doc.id,
          label: doc.title || "Document",
        });
        target?.focus();
        // Strip the query param so reload doesn't duplicate the pin.
        const params = new URLSearchParams(searchParams.toString());
        params.delete("pinned_document");
        const qs = params.toString();
        router.replace(qs ? `/?${qs}` : "/", { scroll: false });
      } catch {
        // Silent — if the doc fetch fails, the user can still type a
        // question manually from the library page.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedPinnedDocId]);

  // ── Sticky auto-scroll ──
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

  // ── Guided query card click → populate the input, don't auto-send ──
  //
  // Populating lets the VC edit before committing. If we auto-sent, the first
  // thing he'd see is a canned query he didn't write — which is exactly the
  // "feels like the product has an opinion about me" problem we're trying to
  // avoid. He keeps agency; the card is a starting point, not a command.
  const handleSuggestionClick = useCallback((prompt: string) => {
    idleInputRef.current?.setText(prompt);
  }, []);

  // Briefing bullet clicks navigate into the relevant context.
  // Documents → the library detail page, which has its own
  // "Ask about this document" handoff back to here. Projects →
  // the project workspace.
  const handleBriefingLinkClick = useCallback(
    (link: NonNullable<import("@/lib/daily-briefing").BriefingBullet["link"]>) => {
      if (link.kind === "document") {
        router.push(`/documents/${link.documentId}`);
      } else if (link.kind === "project") {
        router.push(`/projects/${link.slug}`);
      }
    },
    [router],
  );

  const isIdle = messages.length === 0 && !streaming;

  return (
    <div className="flex flex-1 overflow-hidden">
      <div
        className="relative flex min-w-0 flex-1 flex-col"
        style={{ background: "var(--surface)" }}
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
          <div
            className="pointer-events-none absolute inset-0 z-20 m-3 flex items-center justify-center rounded-xl border-2 border-dashed"
            style={{
              background: "rgba(11,12,22,0.04)",
              borderColor: "var(--accent-muted)",
              backdropFilter: "blur(4px)",
            }}
          >
            <div
              className="flex items-center gap-3 rounded-xl border px-6 py-4"
              style={{
                background: "var(--surface-raised)",
                borderColor: "var(--border)",
                boxShadow: "var(--shadow-md)",
              }}
            >
              <UploadIcon
                className="h-5 w-5"
                style={{ color: "var(--accent)" }}
              />
              <div>
                <p className="dm-text" style={{ fontWeight: 600 }}>
                  Drop PDFs to attach
                </p>
                <p className="dm-caption">
                  Files become context for this conversation only
                </p>
              </div>
            </div>
          </div>
        )}

        {isIdle ? (
          /* ── Idle state: greeting + briefing + input + guided queries ── */
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-2xl px-8 pt-20 pb-16">
              {/* Display greeting — the one moment where the serif
                  gets to breathe. Kept short. */}
              <h1 className="dm-display mb-2" dir="auto">
                {t.greeting}
              </h1>
              <p
                className="dm-lead mb-10"
                style={{ color: "var(--ink-muted)" }}
                dir="auto"
              >
                {t.greetingSubtitle}
              </p>

              {/*
                Briefing block — the hero surface of the entire app.
                Renders as a proper document card (parchment background,
                left accent rail, generous padding) so it reads as
                "prepared for you" not as "another UI card."
              */}
              {briefing.kind === "active" && (
                <div className="dm-briefing-card mb-10" dir="auto">
                  <div className="mb-4 flex items-center gap-2 ps-3">
                    <span className="dm-label-accent">{t.briefingLabel}</span>
                    <button
                      type="button"
                      onClick={handleBriefingRefresh}
                      disabled={refreshingBriefing}
                      className="ms-auto inline-flex h-7 w-7 items-center justify-center rounded-lg border-0 bg-transparent cursor-pointer transition-colors disabled:opacity-40"
                      style={{
                        color: "var(--ink-faint)",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background =
                          "var(--accent-bg)";
                        (e.currentTarget as HTMLButtonElement).style.color =
                          "var(--accent)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background =
                          "transparent";
                        (e.currentTarget as HTMLButtonElement).style.color =
                          "var(--ink-faint)";
                      }}
                      title={t.briefingRefreshTooltip}
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${refreshingBriefing ? "animate-spin" : ""}`}
                        strokeWidth={1.75}
                      />
                    </button>
                  </div>
                  <ul className="space-y-4 ps-3">
                    {briefing.bullets.map((bullet, i) => (
                      <li
                        key={i}
                        className="dm-text flex items-start gap-3"
                        style={{
                          fontSize: "var(--text-md)",
                          lineHeight: "var(--leading-normal)",
                          color: "var(--ink-light)",
                        }}
                        dir="auto"
                      >
                        <span
                          aria-hidden
                          className="dm-serif-num mt-0.5 shrink-0"
                          style={{
                            color: "var(--accent)",
                            minWidth: "1.25rem",
                            fontSize: "var(--text-md)",
                          }}
                        >
                          {i + 1}.
                        </span>
                        <div className="min-w-0 flex-1">
                          <p>{bullet.text}</p>
                          {bullet.link && (
                            <button
                              type="button"
                              onClick={() => handleBriefingLinkClick(bullet.link!)}
                              className="dm-chip mt-2 cursor-pointer border-0 transition-colors"
                              style={{
                                background: "var(--surface-raised)",
                                borderColor: "var(--border)",
                                border: "1px solid var(--border)",
                                color: "var(--ink-muted)",
                              }}
                              onMouseEnter={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.background =
                                  "var(--accent-bg)";
                                (e.currentTarget as HTMLButtonElement).style.borderColor =
                                  "var(--accent-muted)";
                                (e.currentTarget as HTMLButtonElement).style.color =
                                  "var(--accent)";
                              }}
                              onMouseLeave={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.background =
                                  "var(--surface-raised)";
                                (e.currentTarget as HTMLButtonElement).style.borderColor =
                                  "var(--border)";
                                (e.currentTarget as HTMLButtonElement).style.color =
                                  "var(--ink-muted)";
                              }}
                              dir="auto"
                            >
                              {bullet.link.kind === "document" ? (
                                <FileText className="h-3 w-3" strokeWidth={1.75} />
                              ) : (
                                <FolderOpen className="h-3 w-3" strokeWidth={1.75} />
                              )}
                              <span className="max-w-[260px] truncate">
                                {bullet.link.kind === "document"
                                  ? bullet.link.title
                                  : bullet.link.name}
                              </span>
                              <ArrowRight className="h-3 w-3" strokeWidth={1.75} />
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {briefing.kind === "quiet" && (
                <div
                  className="mb-10 flex items-start gap-4 rounded-xl border px-5 py-4"
                  style={{
                    background: "var(--surface-sunken)",
                    borderColor: "var(--border-light)",
                  }}
                >
                  <p
                    className="dm-text flex-1"
                    style={{ color: "var(--ink-muted)" }}
                    dir="auto"
                  >
                    {briefing.message}
                  </p>
                  <button
                    type="button"
                    onClick={handleBriefingRefresh}
                    disabled={refreshingBriefing}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent cursor-pointer transition-colors disabled:opacity-40"
                    style={{ color: "var(--ink-faint)" }}
                    title={t.briefingRefreshTooltip}
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${refreshingBriefing ? "animate-spin" : ""}`}
                      strokeWidth={1.75}
                    />
                  </button>
                </div>
              )}

              <div className="mb-8">
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

              {/* Three guided query cards derived from real workspace data. */}
              <div className="space-y-3">
                <p className="dm-label mb-3" dir="auto">
                  {t.startHere}
                </p>
                {suggestions.map((suggestion, index) => (
                  <button
                    key={`${suggestion.id}-${index}`}
                    type="button"
                    onClick={() => handleSuggestionClick(suggestion.prompt)}
                    className="dm-card-interactive group w-full border-0 text-start"
                    style={{ textAlign: "inherit" }}
                  >
                    <div className="flex items-start gap-4">
                      <span
                        aria-hidden
                        className="dm-serif-num mt-0.5 shrink-0"
                        style={{
                          color: "var(--ink-faint)",
                          fontSize: "var(--text-md)",
                          minWidth: "1.25rem",
                        }}
                      >
                        {index + 1}.
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate dm-text"
                          style={{
                            fontWeight: 600,
                            color: "var(--ink)",
                          }}
                          dir="auto"
                        >
                          {suggestion.subject}
                        </p>
                        <p
                          className="dm-caption mt-1"
                          style={{ color: "var(--ink-muted)" }}
                          dir="auto"
                        >
                          {suggestion.hint}
                        </p>
                      </div>
                      <ArrowRight
                        className="mt-1 h-3.5 w-3.5 shrink-0 transition-colors"
                        strokeWidth={1.75}
                        style={{ color: "var(--ink-ghost)" }}
                      />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* ── Active state: messages + input ── */
          <>
            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
              <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
                {messages.map((msg, i) => (
                  <ChatMessage
                    key={msg.id || `msg-${i}`}
                    role={msg.role}
                    messageId={msg.id}
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

                {streaming && streamingContent && routingStatus && (
                  <div className="flex gap-4 -mt-4">
                    <div className="shrink-0 w-8 h-8" />
                    <div className="flex items-center gap-2 text-[12px] text-slate-400">
                      <span className="inline-block w-1.5 h-1.5 bg-slate-400 rounded-full animate-pulse" />
                      {routingStatus}
                    </div>
                  </div>
                )}

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
