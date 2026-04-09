"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { Source, AttachmentMeta, PinnedItem } from "@/lib/types";
import type { Attachment } from "@/components/chat-input";
import {
  isChatModelChoice,
  type ChatModelChoice,
} from "@/lib/chat-models";

// ── Types ──

export interface MessageMeta {
  mode?: string;
  doctrines?: string[];
  sources?: Source[];
  attachments?: AttachmentMeta[];
  pinned?: PinnedItem[];
}

export interface ChatMsg {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: MessageMeta;
}

export interface UseChatOptions {
  /**
   * Optional project id. When provided, new conversations started via this
   * hook get `project_id` written on them server-side. Phase 04 is visual-only
   * — the chat API does NOT scope retrieval by project until Phase 05.
   */
  projectId?: string;
}

export interface UseChatResult {
  conversationId: string | null;
  messages: ChatMsg[];
  streaming: boolean;
  streamingContent: string;
  routingStatus: string | null;
  error: string | null;
  modelChoice: ChatModelChoice;
  setModelChoice: (model: ChatModelChoice) => void;
  send: (text: string, attachments?: Attachment[], pinned?: PinnedItem[]) => Promise<void>;
  /**
   * Abort the in-flight chat turn. Any text already streamed is kept and
   * persisted to the message list as a partial assistant turn so the user
   * does not lose progress (matches ChatGPT/Claude behavior).
   */
  stop: () => void;
  /**
   * Re-send the last user message. Used by the error banner's retry button
   * when a chat turn fails (OpenAI 400, Tavily outage, Claude timeout, etc).
   * Removes the last failed user bubble from the message list before
   * re-sending so there's no duplicate.
   */
  retry: () => void;
  loadConversation: (id: string) => Promise<void>;
  newChat: () => void;
  setError: (err: string | null) => void;
  /**
   * Called after a new conversation is created so the caller can refresh its
   * conversation list (sidebar). Receives the new conversation id.
   */
  onConversationCreated?: (id: string) => void;
}

const MODEL_STORAGE_KEY = "documind:chat-model";

// ── Helper ──

function routingLabel(mode: string, doctrines?: string[]): string {
  if (mode === "search") return "Searching your documents…";
  if (mode === "casual") return "Thinking…";
  if (mode === "deep") {
    if (doctrines && doctrines.length > 0) {
      // Sentence-case the doctrine names for a human-readable label.
      const pretty = doctrines
        .map((d) => d.charAt(0).toUpperCase() + d.slice(1))
        .join(" · ");
      return `Deep analysis (${pretty})…`;
    }
    return "Deep analysis…";
  }
  return "Working…";
}

// ── Hook ──

export function useChat(
  options: UseChatOptions = {},
  callbacks: { onConversationCreated?: (id: string) => void } = {},
): UseChatResult {
  const { projectId } = options;
  const { onConversationCreated } = callbacks;

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [routingStatus, setRoutingStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelChoice, setModelChoice] = useState<ChatModelChoice>("auto");

  const abortRef = useRef<AbortController | null>(null);
  // Mirror of streamingContent that's safe to read inside event handlers
  // (state can lag behind in fast-streaming turns). Used by stop() to
  // capture the partial response before clearing it.
  const streamingContentRef = useRef("");
  // Tracks the current routing/sources/etc. for the in-flight turn so stop()
  // can preserve metadata when persisting the partial response.
  const inflightMetaRef = useRef<{
    mode: string;
    doctrines: string[];
    sources: Source[];
  }>({ mode: "", doctrines: [], sources: [] });

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(MODEL_STORAGE_KEY);
      if (isChatModelChoice(stored)) {
        setModelChoice(stored);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(MODEL_STORAGE_KEY, modelChoice);
    } catch {
      // ignore
    }
  }, [modelChoice]);

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
      let createdId: string | null = null;

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
                createdId = sessionId;
                break;
              }
              case "routing": {
                pendingMode = (event.mode as string) || "";
                pendingDoctrines = (event.doctrines as string[]) || [];
                inflightMetaRef.current.mode = pendingMode;
                inflightMetaRef.current.doctrines = pendingDoctrines;
                setRoutingStatus(routingLabel(pendingMode, pendingDoctrines));
                break;
              }
              case "sources": {
                const newSources = (event.sources as Source[]) || [];
                const existingIds = new Set(pendingSources.map((s) => s.id));
                pendingSources = [
                  ...pendingSources,
                  ...newSources.filter((s) => !existingIds.has(s.id)),
                ];
                inflightMetaRef.current.sources = pendingSources;
                break;
              }
              case "tool": {
                const toolName = (event.name as string) || "tool";
                const query = (event.query as string) || "";
                if (event.status === "start") {
                  // Show which tool is running right now.
                  if (toolName === "web_search") {
                    setRoutingStatus(`Searching the web: ${query}`);
                  } else {
                    setRoutingStatus(`Running ${toolName}…`);
                  }
                } else if (event.status === "end") {
                  // IMPORTANT: don't clear the status here. The model may be
                  // about to call another tool or start a long reasoning pass
                  // before streaming text. Clearing to null makes the UI look
                  // hung. Instead, switch to a "drafting" state that persists
                  // until the first text token arrives.
                  setRoutingStatus("Drafting response…");
                } else if (event.status === "error") {
                  const errMsg = (event.error as string) || "unknown error";
                  setRoutingStatus(`Tool ${toolName} failed: ${errMsg}`);
                }
                break;
              }
              case "text": {
                accumulated += event.content as string;
                streamingContentRef.current = accumulated;
                setStreamingContent(accumulated);
                // Clear the routing status only once the FIRST text token
                // has actually arrived. Before that, keep the "drafting" or
                // tool-progress label visible so the UI never looks dead.
                if (accumulated.length > 0) {
                  setRoutingStatus(null);
                }
                break;
              }
              case "done": {
                setMessages((prev) => [
                  ...prev,
                  {
                    role: "assistant",
                    content: accumulated,
                    metadata: {
                      mode: pendingMode,
                      doctrines:
                        pendingDoctrines.length > 0 ? pendingDoctrines : undefined,
                      sources: pendingSources.length > 0 ? pendingSources : undefined,
                    },
                  },
                ]);
                streamingContentRef.current = "";
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

      if (isNew && createdId && onConversationCreated) {
        onConversationCreated(createdId);
      }
    },
    [onConversationCreated],
  );

  // Ref mirror of `streaming` so send() can read the latest value without
  // getting stale closures. A double-submit guard needs the CURRENT streaming
  // state, not whatever was captured when the callback was last recreated.
  const streamingRef = useRef(false);
  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);

  const send = useCallback(
    async (
      text: string,
      attachments: Attachment[] = [],
      pinned: PinnedItem[] = [],
    ) => {
      // Guard against double-submit while a previous turn is still streaming.
      // Happens when the user hits send twice during a long Claude+tool turn
      // that feels hung. Without this guard, the second send races with the
      // first and can produce duplicate user-bubbles in the UI.
      if (streamingRef.current) {
        return;
      }

      setError(null);

      const attachmentMeta: AttachmentMeta[] = attachments.map((a) => ({
        title: a.title,
        pageCount: a.pageCount,
        size: a.size,
      }));

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

      // Reset in-flight tracking refs for the new turn.
      streamingContentRef.current = "";
      inflightMetaRef.current = { mode: "", doctrines: [], sources: [] };

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
            model: modelChoice,
            ...(projectId ? { project_id: projectId } : {}),
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
    [conversationId, modelChoice, parseSSE, projectId],
  );

  const loadConversation = useCallback(async (id: string) => {
    setError(null);
    setStreaming(false);
    setStreamingContent("");
    setRoutingStatus(null);

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
          }),
        );
        setMessages(loaded);
        setConversationId(id);
      }
    } catch {
      setError("Failed to load conversation");
    }
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    streamingContentRef.current = "";
    inflightMetaRef.current = { mode: "", doctrines: [], sources: [] };
    setConversationId(null);
    setMessages([]);
    setStreaming(false);
    setStreamingContent("");
    setRoutingStatus(null);
    setError(null);
  }, []);

  // Re-send the last user message. Called by the error banner's Retry
  // button. We pop the failing user message off the list so we don't
  // show it twice, then call send() with the same text.
  const retry = useCallback(() => {
    setMessages((prev) => {
      // Find the last user message; if there is none, there's nothing to retry.
      let lastUserIdx = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === "user") {
          lastUserIdx = i;
          break;
        }
      }
      if (lastUserIdx === -1) return prev;
      const lastUser = prev[lastUserIdx];
      // Strip trailing user message (and any assistant after it, defensive)
      const trimmed = prev.slice(0, lastUserIdx);
      // Fire the re-send asynchronously so React finishes this update first.
      // We pass pinned/attachments from the original user message metadata.
      const pinned = lastUser.metadata?.pinned ?? [];
      setTimeout(() => {
        void sendRef.current?.(
          lastUser.content,
          [],
          pinned,
        );
      }, 0);
      return trimmed;
    });
    setError(null);
  }, []);

  // Forward ref to the latest `send` function — needed because retry() is
  // defined before send() and can't close over it directly without breaking
  // React hook rules. We set this below after send is declared.
  const sendRef = useRef<
    ((text: string, attachments?: Attachment[], pinned?: PinnedItem[]) => Promise<void>) | null
  >(null);

  // Abort the in-flight chat turn but keep whatever was streamed so far as
  // a partial assistant message. Matches ChatGPT/Claude "stop generating"
  // behavior — the user does not lose progress when they hit stop.
  const stop = useCallback(() => {
    abortRef.current?.abort();
    const partial = streamingContentRef.current;
    const meta = inflightMetaRef.current;
    if (partial.trim().length > 0) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: partial,
          metadata: {
            mode: meta.mode || undefined,
            doctrines: meta.doctrines.length > 0 ? meta.doctrines : undefined,
            sources: meta.sources.length > 0 ? meta.sources : undefined,
          },
        },
      ]);
    }
    streamingContentRef.current = "";
    inflightMetaRef.current = { mode: "", doctrines: [], sources: [] };
    setStreamingContent("");
    setStreaming(false);
    setRoutingStatus(null);
  }, []);

  // Keep sendRef up to date so retry() can call the latest send closure.
  sendRef.current = send;

  return {
    conversationId,
    messages,
    streaming,
    streamingContent,
    routingStatus,
    error,
    modelChoice,
    setModelChoice,
    send,
    stop,
    retry,
    loadConversation,
    newChat,
    setError,
  };
}
