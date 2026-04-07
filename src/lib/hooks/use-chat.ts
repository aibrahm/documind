"use client";

import { useState, useCallback, useRef } from "react";
import type { Source, AttachmentMeta, PinnedItem } from "@/lib/types";
import type { Attachment } from "@/components/chat-input";

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
  send: (text: string, attachments?: Attachment[], pinned?: PinnedItem[]) => Promise<void>;
  loadConversation: (id: string) => Promise<void>;
  newChat: () => void;
  setError: (err: string | null) => void;
  /**
   * Called after a new conversation is created so the caller can refresh its
   * conversation list (sidebar). Receives the new conversation id.
   */
  onConversationCreated?: (id: string) => void;
}

// ── Helper ──

function routingLabel(mode: string, doctrines?: string[]): string {
  if (mode === "search") return "Searching documents...";
  if (mode === "casual") return "Thinking...";
  if (mode === "deep" && doctrines && doctrines.length > 0) {
    return `Analyzing with ${doctrines.join(" + ")} doctrines...`;
  }
  return "Analyzing...";
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

  const abortRef = useRef<AbortController | null>(null);

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
                break;
              }
              case "tool": {
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

  const send = useCallback(
    async (
      text: string,
      attachments: Attachment[] = [],
      pinned: PinnedItem[] = [],
    ) => {
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
    [conversationId, parseSSE, projectId],
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
    setConversationId(null);
    setMessages([]);
    setStreaming(false);
    setStreamingContent("");
    setRoutingStatus(null);
    setError(null);
  }, []);

  return {
    conversationId,
    messages,
    streaming,
    streamingContent,
    routingStatus,
    error,
    send,
    loadConversation,
    newChat,
    setError,
  };
}
