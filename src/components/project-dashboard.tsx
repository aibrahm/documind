"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  FilePlus2,
  FileText,
  FolderOpen,
  Library,
  Link2,
  Loader2,
  MessageSquare,
  Plus,
  RotateCw,
  Upload as UploadIcon,
  X,
} from "lucide-react";
import type { Database } from "@/lib/database.types";
import type { UseChatResult } from "@/lib/hooks/use-chat";
import { ChatMessage } from "@/components/chat-message";
import { ChatInput } from "@/components/chat-input";
import { usePdfViewer } from "@/components/pdf-viewer-context";
import { DocumentContextCard } from "@/components/document-context-card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Source } from "@/lib/types";
import type { LanguageCode } from "@/lib/extraction-schema";
import { strings, formatUpdatedRelative, type UiLanguage } from "@/lib/ui-strings";

type Project = Database["public"]["Tables"]["projects"]["Row"];

interface ProjectParticipant {
  id: string;
  name: string;
  name_en: string | null;
  role: string;
}

interface ProjectDashboardProps {
  project: Project;
  counts: {
    documents: number;
    entities: number;
    threads: number;
  };
  participants: ProjectParticipant[];
  chat: UseChatResult;
  language: UiLanguage;
}

interface ProjectDocument {
  id: string;
  title: string;
  type: string;
  classification: string;
  language: string | null;
  page_count: number | null;
  processing_error?: string | null;
  context_card?: Record<string, unknown> | null;
  created_at: string;
  link?: {
    role?: string | null;
    added_at?: string | null;
  };
}

interface LibraryDocument {
  id: string;
  title: string;
  type: string;
  classification: string;
  language: string | null;
  page_count: number | null;
  created_at: string;
}

interface ProjectConversation {
  id: string;
  title: string | null;
  mode: string | null;
  query: string | null;
  created_at: string;
}

type Action = "new" | "version" | "duplicate" | "related";
type Classification = "PRIVATE" | "PUBLIC";

interface SuggestedProject {
  id: string;
  slug: string;
  name: string;
  color: string | null;
  overlapCount: number;
  reason: string;
}

interface UploadProposal {
  detected: {
    title: string;
    suggestedTitle: string;
    documentType: string;
    language: LanguageCode;
    pageCount: number;
    fileSize: number;
    suggestedClassification: Classification;
    classificationReason: string;
    entities: Array<{ name: string; type: string; nameEn?: string }>;
    firstPagePreview: string;
  };
  related: Array<{
    documentId: string;
    title: string;
    type: string;
    classification: string;
    createdAt: string;
    similarity: number;
    reason: string;
    isCurrent: boolean;
    versionNumber: number;
  }>;
  recommendation: {
    action: Action;
    reason: string;
    targetDocumentId?: string;
    confidence: "high" | "medium" | "low";
  };
  suggestedProject?: SuggestedProject | null;
  suggestedProjects?: SuggestedProject[];
}

export function ProjectDashboard({
  project,
  counts,
  participants,
  chat,
  language,
}: ProjectDashboardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const skipNextLoadRef = useRef(false);
  const { openDocument } = usePdfViewer();
  const t = strings(language);

  const {
    conversationId,
    messages,
    streaming,
    streamingContent,
    routingStatus,
    error,
    modelChoice,
    setModelChoice,
    send,
    stop: stopGeneration,
    retry: retryLastTurn,
    newChat,
    loadConversation,
    setError,
  } = chat;

  const [projectDocuments, setProjectDocuments] = useState<ProjectDocument[]>([]);
  const [recentConversations, setRecentConversations] = useState<ProjectConversation[]>([]);
  const [homeTab, setHomeTab] = useState<"chats" | "sources">("chats");
  const [dataLoading, setDataLoading] = useState(true);
  const [addSourceOpen, setAddSourceOpen] = useState(false);

  const loadDashboardData = useCallback(async () => {
    setDataLoading(true);
    try {
      const [docsRes, convosRes] = await Promise.all([
        fetch(`/api/projects/${project.id}/documents`).then((r) => r.json()),
        fetch(`/api/projects/${project.id}/conversations?limit=12`).then((r) =>
          r.json(),
        ),
      ]);
      setProjectDocuments(docsRes.documents || []);
      setRecentConversations(convosRes.conversations || []);
    } catch (err) {
      console.error("project shell load failed:", err);
    } finally {
      setDataLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void loadDashboardData();
  }, [loadDashboardData]);

  const prevStreamingRef = useRef(streaming);
  useEffect(() => {
    if (prevStreamingRef.current && !streaming) {
      const timer = setTimeout(() => {
        void loadDashboardData();
      }, 2000);
      return () => clearTimeout(timer);
    }
    prevStreamingRef.current = streaming;
  }, [streaming, loadDashboardData]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    const end = messagesEndRef.current;
    if (!container || !end) return;
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
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

  const requestedConvoId = searchParams.get("conversation");
  useEffect(() => {
    if (skipNextLoadRef.current) {
      skipNextLoadRef.current = false;
      return;
    }
    if (!requestedConvoId) return;
    if (requestedConvoId === conversationId) return;
    void loadConversation(requestedConvoId);
  }, [requestedConvoId, conversationId, loadConversation]);

  const handleSourceClick = useCallback(
    (source: Source) => {
      if (source.type === "web") {
        window.open(source.url, "_blank", "noopener,noreferrer");
        return;
      }
      openDocument(source.documentId, source.pageNumber, source.title);
    },
    [openDocument],
  );

  const handleProjectHome = useCallback(() => {
    skipNextLoadRef.current = true;
    newChat();
    const params = new URLSearchParams(searchParams.toString());
    params.delete("conversation");
    const qs = params.toString();
    router.replace(`/projects/${project.slug}${qs ? `?${qs}` : ""}`, {
      scroll: false,
    });
  }, [newChat, router, searchParams, project.slug]);

  const handleOpenConversation = useCallback(
    (convoId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("conversation", convoId);
      router.replace(`/projects/${project.slug}?${params.toString()}`, {
        scroll: false,
      });
    },
    [router, searchParams, project.slug],
  );

  const removeProjectDocument = useCallback(
    async (documentId: string) => {
      const response = await fetch(
        `/api/projects/${project.id}/documents?document_id=${encodeURIComponent(documentId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to remove source");
      }
      await loadDashboardData();
    },
    [project.id, loadDashboardData],
  );

  const projectContext = project.context_summary || project.description || null;
  // Narrow "where we are" — only the live running summary, not the
  // static description. This is what gets rendered as the prominent
  // status card at the top of the project workspace. If it's empty
  // the card is hidden entirely (no placeholder copy).
  const whereWeAre = project.context_summary?.trim() || null;
  const lastUpdatedRelative = formatUpdatedRelative(
    project.updated_at,
    language,
  );
  const activeConversation =
    Boolean(requestedConvoId || conversationId || messages.length > 0 || streaming);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto">
        {activeConversation ? (
          <div className="mx-auto flex h-full max-w-3xl flex-col px-6 py-6">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={handleProjectHome}
                  className="mb-2 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-500 hover:border-slate-300 hover:text-slate-900"
                >
                  <FolderOpen className="h-3 w-3" />
                  {project.name}
                </button>
                <p className="text-[12px] text-slate-400">
                  Project-scoped chat. Linked sources are used quietly in the background.
                </p>
              </div>
              <button
                type="button"
                onClick={handleProjectHome}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              >
                <Plus className="h-3.5 w-3.5" />
                New chat
              </button>
            </div>

            {whereWeAre && !conversationId && messages.length === 0 && (
              <WhereWeAreCard
                summary={whereWeAre}
                lastUpdatedRelative={lastUpdatedRelative}
                label={t.whereWeAre}
              />
            )}

            <div className="space-y-8">
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
                  <div className="shrink-0 h-8 w-8 rounded-full bg-gradient-to-br from-slate-800 to-slate-600 flex items-center justify-center">
                    <span className="inline-block h-2 w-2 rounded-full bg-white animate-pulse" />
                  </div>
                  <div className="flex items-center text-[13px] text-slate-400">
                    {routingStatus}
                  </div>
                </div>
              )}
              {streaming && streamingContent && (
                <ChatMessage role="assistant" content={streamingContent} isStreaming />
              )}
              {streaming && streamingContent && routingStatus && (
                <div className="flex gap-4 -mt-4">
                  <div className="shrink-0 h-8 w-8" />
                  <div className="flex items-center gap-2 text-[12px] text-slate-400">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400 animate-pulse" />
                    {routingStatus}
                  </div>
                </div>
              )}
              {error && (
                <div className="flex gap-4">
                  <div className="shrink-0 h-8 w-8 rounded-full border border-red-200 bg-red-50 flex items-center justify-center">
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
                        className="shrink-0 rounded p-1 text-red-400 hover:bg-red-100 hover:text-red-600"
                        title="Dismiss"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => retryLastTurn()}
                        className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-2.5 py-1 text-[12px] font-medium text-red-700 hover:bg-red-100"
                      >
                        <RotateCw className="h-3 w-3" />
                        Retry
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {!streaming && messages.length === 0 && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-6 text-center">
                  <p className="text-[14px] font-medium text-slate-700">
                    This chat is empty.
                  </p>
                  <p className="mt-1 text-[12px] text-slate-400">
                    Ask a question below to start working inside {project.name}.
                  </p>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-4xl flex-col px-6 py-10">
            <div className="mx-auto w-full max-w-2xl">
              <div className="mb-6 text-center">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1 text-slate-600">
                  <FolderOpen className="h-4 w-4" />
                  <span className="text-[16px] font-semibold tracking-tight" dir="auto">
                    {project.name}
                  </span>
                </div>
                {!whereWeAre && projectContext && (
                  <p
                    className="mx-auto max-w-xl text-[13px] leading-relaxed text-slate-500"
                    dir="auto"
                  >
                    {projectContext}
                  </p>
                )}
                {!whereWeAre && !projectContext && (
                  <p
                    className="mx-auto max-w-xl text-[13px] leading-relaxed text-slate-400"
                    dir="auto"
                  >
                    {t.newProjectPlaceholder}
                  </p>
                )}
                <p className="mt-2 text-[11px] text-slate-400">
                  {counts.threads} chats · {counts.documents} sources · {participants.length} linked participants
                </p>
              </div>

              {whereWeAre && (
                <WhereWeAreCard
                  summary={whereWeAre}
                  lastUpdatedRelative={lastUpdatedRelative}
                  label={t.whereWeAre}
                  centered
                />
              )}

              <div className="rounded-[28px] border border-slate-200 bg-white p-2 shadow-sm">
                <ChatInput
                  onSend={send}
                  onStop={stopGeneration}
                  isStreaming={streaming}
                  disabled={streaming}
                  modelChoice={modelChoice}
                  onModelChoiceChange={setModelChoice}
                  placeholder={`New chat in ${project.name}`}
                />
              </div>
            </div>

            <div className="mx-auto mt-8 w-full max-w-2xl">
              <Tabs value={homeTab} onValueChange={(value) => setHomeTab(value as "chats" | "sources")}>
                <TabsList variant="line" className="mb-4">
                  <TabsTrigger value="chats">Chats</TabsTrigger>
                  <TabsTrigger value="sources">Sources</TabsTrigger>
                </TabsList>

                <TabsContent value="chats">
                  {dataLoading ? (
                    <ShellEmptyState icon={Loader2} title="Loading chats" body="Pulling recent project chats…" spinning />
                  ) : recentConversations.length === 0 ? (
                    <ShellEmptyState
                      icon={MessageSquare}
                      title="No chats yet"
                      body={`Chats in ${project.name} will live here.`}
                    />
                  ) : (
                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                      {recentConversations.map((conversation, index) => (
                        <button
                          key={conversation.id}
                          type="button"
                          onClick={() => handleOpenConversation(conversation.id)}
                          className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                            index < recentConversations.length - 1 ? "border-b border-slate-100" : ""
                          }`}
                        >
                          <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[14px] font-medium text-slate-800" dir="auto">
                              {conversation.title || conversation.query || "Untitled chat"}
                            </p>
                            <p className="mt-0.5 truncate text-[12px] text-slate-400" dir="auto">
                              {conversation.query || "Open this chat to continue working."}
                            </p>
                          </div>
                          <span className="shrink-0 text-[11px] text-slate-400">
                            {formatRelative(conversation.created_at)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                </TabsContent>

                <TabsContent value="sources">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <p className="text-[13px] text-slate-500">
                      Project sources are the documents linked to this workspace. Every uploaded file still lives in the library; linking it here makes it primary context for this project.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => setAddSourceOpen(true)}
                    >
                      <FilePlus2 className="h-4 w-4" />
                      Add source
                    </Button>
                  </div>

                  {dataLoading ? (
                    <ShellEmptyState icon={Loader2} title="Loading sources" body="Pulling linked project sources…" spinning />
                  ) : projectDocuments.length === 0 ? (
                    <ShellEmptyState
                      icon={Library}
                      title="No sources yet"
                      body="Upload a new file or link an existing library document into this project."
                      action={{
                        label: "Add source",
                        onClick: () => setAddSourceOpen(true),
                      }}
                    />
                  ) : (
                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                      {projectDocuments.map((doc, index) => (
                        <div
                          key={doc.id}
                          className={`flex items-start gap-3 px-4 py-3 ${
                            index < projectDocuments.length - 1 ? "border-b border-slate-100" : ""
                          }`}
                        >
                          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                          <div className="min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={() => router.push(`/documents/${doc.id}`)}
                              className="block max-w-full truncate text-left text-[14px] font-medium text-slate-800 hover:text-slate-950"
                              dir="auto"
                              title={doc.title}
                            >
                              {doc.title}
                            </button>
                            <p className="mt-0.5 text-[12px] text-slate-400">
                              {doc.type} · {doc.page_count ?? "?"} pages
                              {doc.link?.role ? ` · ${doc.link.role}` : ""}
                              {doc.created_at ? ` · ${formatRelative(doc.created_at)}` : ""}
                            </p>
                            <DocumentContextCard
                              card={doc.context_card}
                              preferredLanguage={doc.language}
                              variant="compact"
                              bordered={false}
                              className="mt-2"
                            />
                            {doc.processing_error && (
                              <p className="mt-2 text-[12px] leading-relaxed text-amber-700">
                                Extraction warning: {doc.processing_error}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => router.push(`/documents/${doc.id}`)}
                              className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                            >
                              Open
                            </button>
                            <button
                              type="button"
                              onClick={() => void removeProjectDocument(doc.id)}
                              className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-500 hover:border-slate-300 hover:bg-slate-50"
                            >
                              Unlink
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </div>
        )}
      </div>

      {activeConversation && (
        <div className="shrink-0 border-t border-slate-100 bg-gradient-to-t from-white via-white to-transparent px-6 pb-5 pt-3">
          <div className="mx-auto max-w-3xl">
            <ChatInput
              onSend={send}
              onStop={stopGeneration}
              isStreaming={streaming}
              disabled={streaming}
              modelChoice={modelChoice}
              onModelChoiceChange={setModelChoice}
              placeholder="Continue this chat"
            />
            <p className="mt-2 text-center font-['JetBrains_Mono'] text-[10px] text-slate-400">
              This chat is scoped to {project.name}. Use <code>@</code> to pin a specific source or entity.
            </p>
          </div>
        </div>
      )}

      <AddSourceDialog
        open={addSourceOpen}
        onOpenChange={setAddSourceOpen}
        project={project}
        linkedDocumentIds={new Set(projectDocuments.map((doc) => doc.id))}
        onDone={() => {
          setAddSourceOpen(false);
          void loadDashboardData();
          setHomeTab("sources");
        }}
      />
    </div>
  );
}

function ShellEmptyState({
  icon: Icon,
  title,
  body,
  spinning,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  spinning?: boolean;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm">
        <Icon className={`h-5 w-5 ${spinning ? "animate-spin" : ""}`} />
      </div>
      <p className="text-[15px] font-medium text-slate-700">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-[12px] leading-relaxed text-slate-400">{body}</p>
      {action && (
        <div className="mt-4">
          <Button type="button" variant="outline" onClick={action.onClick}>
            {action.label}
          </Button>
        </div>
      )}
    </div>
  );
}

function AddSourceDialog({
  open,
  onOpenChange,
  project,
  linkedDocumentIds,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  linkedDocumentIds: Set<string>;
  onDone: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"upload" | "library">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [proposal, setProposal] = useState<UploadProposal | null>(null);
  const [stage, setStage] = useState<"idle" | "analyzing" | "ready">("idle");
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [linkToProject, setLinkToProject] = useState(true);
  const [libraryDocuments, setLibraryDocuments] = useState<LibraryDocument[]>([]);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setMode("upload");
      setFile(null);
      setStoragePath(null);
      setProposal(null);
      setStage("idle");
      setError(null);
      setTitle("");
      setLinkToProject(true);
      setLibraryQuery("");
      setLinkingId(null);
      setSubmitting(false);
      return;
    }

    void fetch("/api/documents")
      .then((r) => r.json())
      .then((data) => setLibraryDocuments(data.documents || []))
      .catch(() => {});
  }, [open]);

  const analyzeFile = useCallback(
    async (selectedFile: File) => {
      setError(null);
      setStage("analyzing");
      setFile(selectedFile);
      try {
        const signRes = await fetch("/api/storage/signed-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: selectedFile.name, size: selectedFile.size }),
        });
        const signData = await signRes.json();
        if (!signRes.ok) {
          throw new Error(signData.error || "Failed to create upload URL");
        }

        const uploadRes = await fetch(signData.signedUrl as string, {
          method: "PUT",
          headers: { "Content-Type": "application/pdf" },
          body: selectedFile,
        });
        if (!uploadRes.ok) {
          const text = await uploadRes.text().catch(() => "");
          throw new Error(
            `Upload failed (HTTP ${uploadRes.status})${text ? `: ${text.slice(0, 120)}` : ""}`,
          );
        }

        setStoragePath(signData.storagePath as string);
        const analysisRes = await fetch("/api/intake/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storagePath: signData.storagePath,
            fileName: selectedFile.name,
          }),
        });
        const data = await analysisRes.json();
        if (!analysisRes.ok) {
          throw new Error(data.error || "Analysis failed");
        }

        const nextProposal = data.proposal as UploadProposal;
        setProposal(nextProposal);
        setTitle(nextProposal.detected.suggestedTitle);
        setStage("ready");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
        setStage("idle");
      }
    },
    [],
  );

  const confirmUpload = useCallback(async () => {
    if (!file || !storagePath || !proposal) return;
    setSubmitting(true);
    setError(null);
    try {
      if (proposal.recommendation.action === "duplicate" && proposal.recommendation.targetDocumentId) {
        router.push(`/documents/${proposal.recommendation.targetDocumentId}`);
        onDone();
        return;
      }

      const body: Record<string, unknown> = {
        storagePath,
        fileName: file.name,
        classification: proposal.detected.suggestedClassification,
        title,
        documentType: proposal.detected.documentType,
        languageHint: proposal.detected.language,
        skipClassification: true,
      };

      if (proposal.recommendation.action === "version" && proposal.recommendation.targetDocumentId) {
        body.versionOf = proposal.recommendation.targetDocumentId;
      }
      if (proposal.recommendation.action === "related" && proposal.recommendation.targetDocumentId) {
        body.relatedTo = proposal.recommendation.targetDocumentId;
      }
      if (linkToProject) {
        body.linkToProject = project.id;
      }

      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Upload failed");
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setStage("ready");
    } finally {
      setSubmitting(false);
    }
  }, [file, storagePath, proposal, title, linkToProject, project.id, router, onDone]);

  const filteredLibraryDocs = useMemo(() => {
    const normalizedQuery = libraryQuery.trim().toLowerCase();
    return libraryDocuments
      .filter((doc) => !linkedDocumentIds.has(doc.id))
      .filter((doc) => {
        if (!normalizedQuery) return true;
        return (
          doc.title.toLowerCase().includes(normalizedQuery) ||
          doc.type.toLowerCase().includes(normalizedQuery)
        );
      })
      .slice(0, 40);
  }, [libraryDocuments, libraryQuery, linkedDocumentIds]);

  const handleLinkExisting = useCallback(
    async (documentId: string) => {
      setLinkingId(documentId);
      setError(null);
      try {
        const response = await fetch(`/api/projects/${project.id}/documents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ document_ids: [documentId], role: "primary" }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Failed to link source");
        }
        onDone();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to link source");
      } finally {
        setLinkingId(null);
      }
    },
    [project.id, onDone],
  );

  const recommendationLabel =
    proposal?.recommendation.action === "version"
      ? "Looks like a new version"
      : proposal?.recommendation.action === "related"
        ? "Looks related to an existing source"
        : proposal?.recommendation.action === "duplicate"
          ? "Looks like a duplicate"
          : "Looks like a new source";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add source</DialogTitle>
          <DialogDescription>
            Add a new file to the library and optionally link it into {project.name}, or attach an existing library document to this project.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(value) => setMode(value as "upload" | "library")}>
          <TabsList variant="line" className="mb-4">
            <TabsTrigger value="upload">Upload</TabsTrigger>
            <TabsTrigger value="library">Link from library</TabsTrigger>
          </TabsList>

          <TabsContent value="upload">
            {stage === "idle" && (
              <div className="space-y-4">
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center hover:border-slate-400 hover:bg-slate-100/60">
                  <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm">
                    <UploadIcon className="h-5 w-5 text-slate-400" />
                  </div>
                  <p className="text-[14px] font-medium text-slate-800">
                    Upload a PDF
                  </p>
                  <p className="mt-1 text-[12px] text-slate-400">
                    The system will suggest a title, type, and whether it looks like a duplicate or new version.
                  </p>
                  <input
                    type="file"
                    accept=".pdf,application/pdf"
                    className="hidden"
                    onChange={(event) => {
                      const selectedFile = event.target.files?.[0];
                      if (!selectedFile) return;
                      void analyzeFile(selectedFile);
                    }}
                  />
                </label>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-[12px] font-medium text-slate-600">
                    Scope inside this flow
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-slate-400">
                    Every uploaded document is stored in the library. Linking it here makes it part of this project’s working context.
                  </p>
                </div>
                {error && <p className="text-[12px] text-red-600">{error}</p>}
              </div>
            )}

            {stage === "analyzing" && file && (
              <div className="rounded-2xl border border-slate-200 bg-white px-5 py-6">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                  <div>
                    <p className="text-[14px] font-medium text-slate-800">
                      Analyzing {file.name}
                    </p>
                    <p className="text-[12px] text-slate-400">
                      OCR, title suggestion, duplicate/version check, and project fit
                    </p>
                  </div>
                </div>
              </div>
            )}

            {stage === "ready" && proposal && file && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Suggested title
                      </p>
                      <Input
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        className="mt-2"
                      />
                    </div>
                    <div className="shrink-0 rounded-xl bg-slate-50 px-3 py-2 text-right">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Type
                      </p>
                      <p className="mt-1 text-[13px] font-medium text-slate-700">
                        {proposal.detected.documentType}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Filing suggestion
                      </p>
                      <p className="mt-1 text-[13px] font-medium text-slate-700">
                        {recommendationLabel}
                      </p>
                      <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
                        {proposal.recommendation.reason}
                      </p>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Scope
                      </p>
                      <label className="mt-2 flex items-start gap-2 text-[13px] text-slate-700">
                        <input
                          type="checkbox"
                          checked={linkToProject}
                          onChange={(event) => setLinkToProject(event.target.checked)}
                          className="mt-0.5"
                        />
                        Link this document into {project.name} after upload
                      </label>
                    </div>
                  </div>

                  {proposal.recommendation.targetDocumentId && (
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-[12px] text-amber-800">
                      <p className="font-medium">
                        {proposal.recommendation.action === "duplicate"
                          ? "A matching source already exists."
                          : proposal.recommendation.action === "version"
                            ? "This looks like a newer version of an existing source."
                            : "This appears related to an existing source."}
                      </p>
                      {proposal.related[0] && (
                        <p className="mt-1">
                          Closest match: <span className="font-medium">{proposal.related[0].title}</span>
                        </p>
                      )}
                    </div>
                  )}

                  <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      First page preview
                    </p>
                    <p className="mt-2 line-clamp-6 whitespace-pre-wrap text-[12px] leading-relaxed text-slate-600" dir="auto">
                      {proposal.detected.firstPagePreview || "No preview available."}
                    </p>
                  </div>
                </div>

                {error && <p className="text-[12px] text-red-600">{error}</p>}

                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      setStoragePath(null);
                      setProposal(null);
                      setStage("idle");
                      setError(null);
                      setTitle("");
                    }}
                    className="text-[12px] font-medium text-slate-500 hover:text-slate-900"
                  >
                    Pick another file
                  </button>
                  <div className="flex items-center gap-2">
                    {proposal.recommendation.action === "duplicate" &&
                      proposal.recommendation.targetDocumentId && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            router.push(`/documents/${proposal.recommendation.targetDocumentId}`);
                            onDone();
                          }}
                        >
                          Open existing source
                        </Button>
                      )}
                    <Button type="button" onClick={() => void confirmUpload()} disabled={submitting}>
                      {submitting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Adding…
                        </>
                      ) : (
                        <>
                          <FilePlus2 className="h-4 w-4" />
                          Add source
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="library">
            <div className="space-y-4">
              <Input
                value={libraryQuery}
                onChange={(event) => setLibraryQuery(event.target.value)}
                placeholder="Search your library by title or type"
              />

              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {filteredLibraryDocs.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-[14px] font-medium text-slate-700">
                      No matching library documents
                    </p>
                    <p className="mt-1 text-[12px] text-slate-400">
                      Try a different search, or upload a new file instead.
                    </p>
                  </div>
                ) : (
                  filteredLibraryDocs.map((doc, index) => (
                    <div
                      key={doc.id}
                      className={`flex items-start gap-3 px-4 py-3 ${
                        index < filteredLibraryDocs.length - 1 ? "border-b border-slate-100" : ""
                      }`}
                    >
                      <Library className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium text-slate-800" dir="auto">
                          {doc.title}
                        </p>
                        <p className="mt-0.5 text-[12px] text-slate-400">
                          {doc.type} · {doc.page_count ?? "?"} pages · {formatRelative(doc.created_at)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={linkingId === doc.id}
                        onClick={() => void handleLinkExisting(doc.id)}
                      >
                        {linkingId === doc.id ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Linking…
                          </>
                        ) : (
                          <>
                            <Link2 className="h-4 w-4" />
                            Link
                          </>
                        )}
                      </Button>
                    </div>
                  ))
                )}
              </div>
              {error && <p className="text-[12px] text-red-600">{error}</p>}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSeconds = Math.round((now - then) / 1000);
  if (diffSeconds < 60) return "just now";
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  if (diffSeconds < 86400 * 7) return `${Math.floor(diffSeconds / 86400)}d ago`;
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * "Where we are" card — the project-level briefing surface.
 *
 * Renders the running project narrative (projects.context_summary)
 * as a small card at the top of the project workspace so the VC
 * can walk back into a project without re-reading everything.
 *
 * The summary itself is written by src/lib/project-summary.ts after
 * each chat turn inside the project — this component just displays
 * it. If the summary is empty, the caller is expected to hide the
 * card entirely (no placeholder copy here).
 */
function WhereWeAreCard({
  summary,
  lastUpdatedRelative,
  label,
  centered = false,
}: {
  summary: string;
  /** Pre-formatted "updated 3d ago" / "آخر تحديث منذ 3 يوم" string. */
  lastUpdatedRelative: string | null;
  /** Localized "Where we are" label. */
  label: string;
  centered?: boolean;
}) {
  return (
    <div
      className={`${centered ? "mx-auto mb-6 max-w-2xl" : "mb-5"} rounded-[20px] border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4`}
      dir="auto"
    >
      <div className="mb-2 flex items-center gap-2">
        <MessageSquare className="h-3.5 w-3.5 text-slate-500" />
        <p
          className="font-['JetBrains_Mono'] text-[10px] font-semibold uppercase tracking-wider text-slate-500"
          dir="auto"
        >
          {label}
        </p>
        {lastUpdatedRelative && (
          <span className="ml-auto text-[10px] text-slate-400" dir="auto">
            {lastUpdatedRelative}
          </span>
        )}
      </div>
      <p
        className="text-[13px] leading-relaxed text-slate-700 whitespace-pre-wrap"
        dir="auto"
      >
        {summary}
      </p>
    </div>
  );
}
