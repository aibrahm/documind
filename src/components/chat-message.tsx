"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FileText,
  ExternalLink,
  Sparkles,
  Copy,
  Check,
  RotateCw,
  BrainCircuit,
  Save,
  Mail,
  Pencil,
  CheckCheck,
} from "lucide-react";
import { Tag } from "@/components/ui-system";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Source, AttachmentMeta, PinnedItem } from "@/lib/types";

type MemoryScope = "project" | "shared";
type MemoryKind = "decision" | "fact" | "instruction" | "preference" | "risk" | "question";
type ArtifactKind =
  | "email"
  | "memo"
  | "brief"
  | "deck"
  | "note"
  | "talking_points"
  | "meeting_prep";

interface ChatMessageProps {
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: {
    mode?: string;
    doctrines?: string[];
    sources?: Source[];
    model?: string;
    attachments?: AttachmentMeta[];
    pinned?: PinnedItem[];
  };
  isStreaming?: boolean;
  onSourceClick?: (source: Source) => void;
  onRegenerate?: () => void;
  memoryScopes?: Array<{ id: MemoryScope; label: string }>;
  onSaveMemory?: (payload: {
    text: string;
    kind: MemoryKind;
    scopeType: MemoryScope;
  }) => Promise<void>;
  onSaveArtifact?: (payload: {
    title: string;
    kind: ArtifactKind;
    content: string;
  }) => Promise<void>;
}

function linkifyCitations(text: string): string {
  return text.replace(
    /\[(DOC-\d+|WEB-\d+|PINNED-\d+|PROJECT-DOC-\d+|TARGET-DOC-\d+)\]/g,
    (_, id) => `[[${id}]](cite://${id})`,
  );
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function deriveTitleFromContent(content: string): string {
  const flattened = content
    .replace(/\[[A-Z-]+\d+\]/g, "")
    .replace(/[#>*_`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!flattened) return "Saved output";
  const firstSentence = flattened.split(/[.!?؟\n]/)[0]?.trim() || flattened;
  return firstSentence.slice(0, 80);
}

function deriveMemoryText(content: string): string {
  const flattened = content
    .replace(/\[[A-Z-]+\d+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return flattened.slice(0, 280);
}

function getArtifactBlockKind(className?: string): ArtifactKind | null {
  if (!className) return null;
  if (className.includes("language-email")) return "email";
  if (className.includes("language-memo")) return "memo";
  if (className.includes("language-brief")) return "brief";
  if (className.includes("language-deck")) return "deck";
  if (className.includes("language-note")) return "note";
  if (className.includes("language-talking-points")) return "talking_points";
  if (className.includes("language-meeting-prep")) return "meeting_prep";
  return null;
}

function formatArtifactLabel(kind: ArtifactKind): string {
  return kind.replace(/_/g, " ");
}

function parseEmailBlock(rawContent: string): { subject: string; body: string } {
  const lines = rawContent.trim().split(/\r?\n/);
  const subjectIndex = lines.findIndex((line) => /^subject\s*:/i.test(line.trim()));
  const subject =
    subjectIndex >= 0
      ? lines[subjectIndex].replace(/^subject\s*:/i, "").trim()
      : "Draft email";
  const body = lines
    .filter((_, index) => index !== subjectIndex)
    .join("\n")
    .trim();
  return { subject, body };
}

function looksLikePlainEmail(rawContent: string): boolean {
  const trimmed = rawContent.trim();
  if (!/^subject\s*:/i.test(trimmed)) return false;
  return /\bdear\b/i.test(trimmed) || /(kind regards|best regards|sincerely|تحية|مع خالص|وتفضلوا)/i.test(trimmed);
}

function ArtifactPreviewCard({
  kind,
  rawContent,
}: {
  kind: ArtifactKind;
  rawContent: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(rawContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (kind === "email") {
    return <EmailArtifactCard rawContent={rawContent} />;
  }

  return (
    <div className="my-4 overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm shadow-slate-100/80">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <p className="font-['JetBrains_Mono'] text-[10px] uppercase tracking-[0.18em] text-slate-400">
            {formatArtifactLabel(kind)}
          </p>
          <p className="mt-1 text-[15px] font-semibold text-slate-900">
            Draft deliverable
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleCopy}
          title="Copy deliverable"
        >
          {copied ? <Check className="h-4 w-4 text-slate-500" /> : <Copy className="h-4 w-4 text-slate-400" />}
        </Button>
      </div>
      <div className="px-4 py-4">
        <p
          className="whitespace-pre-wrap font-['IBM_Plex_Sans_Arabic'] text-[14px] leading-7 text-slate-700"
          dir="auto"
        >
          {rawContent.trim()}
        </p>
      </div>
    </div>
  );
}

function EmailArtifactCard({ rawContent }: { rawContent: string }) {
  const parsed = useMemo(() => parseEmailBlock(rawContent), [rawContent]);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);
  const subjectDraft = draft?.subject ?? parsed.subject;
  const bodyDraft = draft?.body ?? parsed.body;
  const emailText = `Subject: ${subjectDraft}\n\n${bodyDraft}`;

  const handleToggleEdit = () => {
    if (editing) {
      setEditing(false);
      return;
    }
    setDraft({ subject: parsed.subject, body: parsed.body });
    setEditing(true);
  };

  const handleCopyEmail = () => {
    navigator.clipboard.writeText(emailText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="my-4 overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm shadow-slate-100/80">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <p className="font-['JetBrains_Mono'] text-[10px] uppercase tracking-[0.18em] text-slate-400">
            Email
          </p>
          <p className="mt-1 text-[15px] font-semibold text-slate-900" dir="auto">
            {editing ? "Editing draft" : "Ready-to-edit draft"}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={handleToggleEdit}
            title={editing ? "Done editing" : "Edit email"}
          >
            {editing ? (
              <CheckCheck className="h-4 w-4 text-slate-500" />
            ) : (
              <Pencil className="h-4 w-4 text-slate-400" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={handleCopyEmail}
            title="Copy email"
          >
            {copied ? (
              <Check className="h-4 w-4 text-slate-500" />
            ) : (
              <Copy className="h-4 w-4 text-slate-400" />
            )}
          </Button>
        </div>
      </div>
      <div className="px-4 py-4">
        <div className="mb-4 flex items-center gap-2 text-slate-400">
          <Mail className="h-4 w-4" />
          <span className="font-['JetBrains_Mono'] text-[11px] uppercase tracking-wider">
            Executive outreach
          </span>
        </div>
        {editing ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-slate-400">
                Subject
              </label>
              <Input
                value={subjectDraft}
                onChange={(event) =>
                  setDraft((current) => ({
                    subject: event.target.value,
                    body: current?.body ?? parsed.body,
                  }))
                }
                placeholder="Email subject"
              />
            </div>
            <div className="space-y-1">
              <label className="font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-slate-400">
                Body
              </label>
              <Textarea
                value={bodyDraft}
                onChange={(event) =>
                  setDraft((current) => ({
                    subject: current?.subject ?? parsed.subject,
                    body: event.target.value,
                  }))
                }
                rows={14}
                className="min-h-[320px] text-[14px] leading-7"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="border-b border-slate-100 pb-4">
              <p className="font-['JetBrains_Mono'] text-[10px] uppercase tracking-[0.18em] text-slate-400">
                Subject
              </p>
              <p className="mt-2 text-[16px] font-semibold leading-6 text-slate-900" dir="auto">
                {subjectDraft}
              </p>
            </div>
            {bodyDraft.split(/\n{2,}/).map((paragraph, index) => (
              <p
                key={`${paragraph.slice(0, 24)}-${index}`}
                className="whitespace-pre-wrap font-['IBM_Plex_Sans_Arabic'] text-[15px] leading-8 text-slate-700"
                dir="auto"
              >
                {paragraph.trim()}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatMessage({
  role,
  content,
  metadata,
  isStreaming,
  onSourceClick,
  onRegenerate,
  memoryScopes = [],
  onSaveMemory,
  onSaveArtifact,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [memoryText, setMemoryText] = useState(() => deriveMemoryText(content));
  const [memoryKind, setMemoryKind] = useState<MemoryKind>("fact");
  const [savingMemoryScope, setSavingMemoryScope] = useState<MemoryScope | null>(null);
  const [artifactTitle, setArtifactTitle] = useState(() => deriveTitleFromContent(content));
  const [artifactKind, setArtifactKind] = useState<ArtifactKind>("brief");
  const [savingArtifact, setSavingArtifact] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const plainEmail = useMemo(
    () => (role === "assistant" && looksLikePlainEmail(content) ? parseEmailBlock(content) : null),
    [content, role],
  );

  const sourcesById = useMemo(
    () => new Map(metadata?.sources?.map((source) => [source.id, source]) ?? []),
    [metadata?.sources],
  );
  const linkifiedContent = useMemo(() => linkifyCitations(content), [content]);

  const copyContent = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSaveMemory = async (scopeType: MemoryScope) => {
    if (!onSaveMemory || !memoryText.trim()) return;
    setSavingMemoryScope(scopeType);
    try {
      await onSaveMemory({
        text: memoryText.trim(),
        kind: memoryKind,
        scopeType,
      });
      setActionNotice(
        scopeType === "project" ? "Saved to project memory" : "Saved to shared memory",
      );
      setMemoryOpen(false);
      setTimeout(() => setActionNotice(null), 2500);
    } catch (error) {
      setActionNotice(
        error instanceof Error ? error.message : "Failed to save memory",
      );
    } finally {
      setSavingMemoryScope(null);
    }
  };

  const handleSaveArtifact = async () => {
    if (!onSaveArtifact || !artifactTitle.trim()) return;
    setSavingArtifact(true);
    try {
      await onSaveArtifact({
        title: artifactTitle.trim(),
        kind: artifactKind,
        content,
      });
      setActionNotice("Saved to outputs");
      setArtifactOpen(false);
      setTimeout(() => setActionNotice(null), 2500);
    } catch (error) {
      setActionNotice(
        error instanceof Error ? error.message : "Failed to save output",
      );
    } finally {
      setSavingArtifact(false);
    }
  };

  if (role === "system") {
    return (
      <div className="py-2 text-center text-xs text-slate-400" dir="auto">
        {content}
      </div>
    );
  }

  if (role === "user") {
    const attachments = metadata?.attachments ?? [];
    const pinned = metadata?.pinned ?? [];
    return (
      <div className="group flex flex-col items-end gap-1.5">
        {pinned.length > 0 && (
          <div className="flex max-w-[75%] flex-wrap justify-end gap-1.5">
            {pinned.map((pinnedItem, index) => (
              <div
                key={`pin-${index}`}
                className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-blue-700"
                title={pinnedItem.label}
              >
                <FileText className="h-3 w-3" />
                <span className="max-w-[180px] truncate text-[12px]" dir="auto">
                  {pinnedItem.label}
                </span>
              </div>
            ))}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="flex max-w-[75%] flex-wrap justify-end gap-1.5">
            {attachments.map((attachment, index) => (
              <div
                key={index}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5"
                title={attachment.title}
              >
                <FileText className="h-3 w-3 text-slate-400" />
                <span className="max-w-[180px] truncate text-[12px] text-slate-700" dir="auto">
                  {attachment.title}
                </span>
                <span className="font-['JetBrains_Mono'] text-[10px] text-slate-400">
                  {attachment.pageCount}p
                </span>
              </div>
            ))}
          </div>
        )}
        {content && (
          <div className="max-w-[75%] rounded-2xl rounded-tr-md bg-slate-900 px-4 py-2.5 text-white">
            <p
              className="whitespace-pre-wrap font-['IBM_Plex_Sans_Arabic'] text-[14px] leading-relaxed"
              dir="auto"
            >
              {content}
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="group flex gap-4">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-800 to-slate-600">
        <Sparkles className="h-4 w-4 text-white" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[13px] font-semibold text-slate-900">DocuMind</span>
          {metadata?.doctrines && metadata.doctrines.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {metadata.doctrines.map((doctrine) => (
                <Tag key={doctrine} variant="blue">
                  {doctrine}
                </Tag>
              ))}
            </div>
          )}
          {metadata?.model && (
            <span className="font-['JetBrains_Mono'] text-[9px] uppercase tracking-wider text-slate-400">
              {metadata.model}
            </span>
          )}
        </div>

        {plainEmail ? (
          <ArtifactPreviewCard kind="email" rawContent={content} />
        ) : (
          <div className="prose prose-sm prose-slate max-w-none text-[14px] leading-[1.65]" dir="ltr">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
              p: ({ children }) => (
                <p
                  className="mb-3 font-['IBM_Plex_Sans_Arabic'] text-slate-700 last:mb-0"
                  dir="auto"
                >
                  {children}
                </p>
              ),
              h1: ({ children }) => (
                <h1 className="mb-2 mt-4 text-lg font-semibold text-slate-900" dir="auto">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="mb-2 mt-4 text-base font-semibold text-slate-900" dir="auto">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="mb-1.5 mt-3 text-sm font-semibold text-slate-900" dir="auto">
                  {children}
                </h3>
              ),
              ul: ({ children }) => (
                <ul className="mb-3 list-disc space-y-1.5 pl-5" dir="ltr">
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol className="mb-3 list-decimal space-y-1.5 pl-5" dir="ltr">
                  {children}
                </ol>
              ),
              li: ({ children }) => (
                <li
                  className="font-['IBM_Plex_Sans_Arabic'] text-[14px] leading-relaxed text-slate-700"
                  dir="auto"
                >
                  {children}
                </li>
              ),
              table: ({ children }) => (
                <div className="my-3 overflow-x-auto">
                  <table className="min-w-full border-collapse border border-slate-200 text-sm">
                    {children}
                  </table>
                </div>
              ),
              th: ({ children }) => (
                <th className="border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border border-slate-200 px-3 py-2 text-sm">{children}</td>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold text-slate-900">{children}</strong>
              ),
              code: ({ children, className }) => {
                const artifactBlockKind = getArtifactBlockKind(className);
                if (artifactBlockKind) {
                  return (
                    <ArtifactPreviewCard
                      kind={artifactBlockKind}
                      rawContent={String(children).replace(/\n$/, "")}
                    />
                  );
                }
                const isBlock = className?.includes("language-");
                if (isBlock) {
                  return (
                    <code
                      className={`my-3 block overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-3 font-['JetBrains_Mono'] text-xs ${className || ""}`}
                    >
                      {children}
                    </code>
                  );
                }
                return (
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-['JetBrains_Mono'] text-[12px] text-slate-700">
                    {children}
                  </code>
                );
              },
              a: ({ href, children }) => {
                if (href?.startsWith("cite://")) {
                  const id = href.slice("cite://".length);
                  const source = sourcesById.get(id);
                  if (!source) {
                    return (
                      <span className="font-['JetBrains_Mono'] text-[10px] text-slate-400">
                        {children}
                      </span>
                    );
                  }
                  return (
                    <button
                      type="button"
                      onClick={() => onSourceClick?.(source)}
                      className="mx-0.5 rounded px-1 py-0.5 align-baseline font-['JetBrains_Mono'] text-[10px] font-semibold text-blue-600 no-underline transition-colors hover:bg-blue-50 hover:text-blue-800"
                      title={source.title}
                    >
                      {children}
                    </button>
                  );
                }
                return (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {children}
                  </a>
                );
              },
              }}
            >
              {linkifiedContent}
            </ReactMarkdown>
            {isStreaming && (
              <span className="ml-0.5 inline-block h-4 w-2 animate-pulse rounded-sm bg-slate-400 align-middle" />
            )}
          </div>
        )}

        {metadata?.sources && metadata.sources.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-slate-400">
              Sources · {metadata.sources.length}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {metadata.sources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => onSourceClick?.(source)}
                  className="group/src flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition-all hover:border-slate-300 hover:bg-slate-50"
                  title={source.type === "web" ? source.url : source.title}
                >
                  {source.type === "web" ? (
                    <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-slate-100">
                      <ExternalLink className="h-3 w-3 text-slate-500" />
                    </div>
                  ) : (
                    <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-slate-100">
                      <FileText className="h-3 w-3 text-slate-500" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-slate-700" dir="auto">
                      {source.title}
                    </p>
                    <p className="truncate font-['JetBrains_Mono'] text-[10px] text-slate-400">
                      {source.type === "web" ? getDomain(source.url) : `Page ${source.pageNumber}`}
                    </p>
                  </div>
                  <span className="shrink-0 font-['JetBrains_Mono'] text-[9px] text-slate-300 group-hover/src:text-slate-500">
                    {source.id}
                  </span>
                  {source.type === "web" && (
                    <ExternalLink className="h-3 w-3 shrink-0 text-slate-300 group-hover/src:text-slate-500" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {!isStreaming && content && (
          <div className="mt-3 flex flex-wrap items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={copyContent}
              className="text-slate-400 hover:text-slate-700"
              title="Copy"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </Button>

            {onSaveMemory && memoryScopes.length > 0 && (
              <Dialog open={memoryOpen} onOpenChange={setMemoryOpen}>
                <DialogTrigger
                  render={
                    <Button variant="ghost" size="xs" className="text-slate-400 hover:text-slate-700" />
                  }
                >
                  <BrainCircuit className="h-3 w-3" />
                  Remember
                </DialogTrigger>
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Save memory</DialogTitle>
                    <DialogDescription>
                      Save a durable takeaway from this reply for future work.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="font-['JetBrains_Mono'] text-[11px] uppercase tracking-wider text-slate-400">
                        Memory kind
                      </label>
                      <select
                        value={memoryKind}
                        onChange={(event) => setMemoryKind(event.target.value as MemoryKind)}
                        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                      >
                        <option value="fact">Fact</option>
                        <option value="decision">Decision</option>
                        <option value="instruction">Instruction</option>
                        <option value="preference">Preference</option>
                        <option value="risk">Risk</option>
                        <option value="question">Question</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="font-['JetBrains_Mono'] text-[11px] uppercase tracking-wider text-slate-400">
                        Saved note
                      </label>
                      <Textarea
                        value={memoryText}
                        onChange={(event) => setMemoryText(event.target.value)}
                        placeholder="Write the exact point you want the workspace to remember."
                        rows={5}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    {memoryScopes.map((scope) => (
                      <Button
                        key={scope.id}
                        type="button"
                        variant={scope.id === "project" ? "default" : "outline"}
                        disabled={savingMemoryScope !== null || memoryText.trim().length < 8}
                        onClick={() => void handleSaveMemory(scope.id)}
                      >
                        {savingMemoryScope === scope.id ? "Saving..." : scope.label}
                      </Button>
                    ))}
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}

            {onSaveArtifact && (
              <Dialog open={artifactOpen} onOpenChange={setArtifactOpen}>
                <DialogTrigger
                  render={
                    <Button variant="ghost" size="xs" className="text-slate-400 hover:text-slate-700" />
                  }
                >
                  <Save className="h-3 w-3" />
                  Save output
                </DialogTrigger>
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Save output</DialogTitle>
                    <DialogDescription>
                      Turn this reply into a reusable deliverable for the project.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="font-['JetBrains_Mono'] text-[11px] uppercase tracking-wider text-slate-400">
                        Title
                      </label>
                      <Input
                        value={artifactTitle}
                        onChange={(event) => setArtifactTitle(event.target.value)}
                        placeholder="Chairman brief"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-['JetBrains_Mono'] text-[11px] uppercase tracking-wider text-slate-400">
                        Output type
                      </label>
                      <select
                        value={artifactKind}
                        onChange={(event) => setArtifactKind(event.target.value as ArtifactKind)}
                        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                      >
                        <option value="brief">Brief</option>
                        <option value="memo">Memo</option>
                        <option value="email">Email</option>
                        <option value="talking_points">Talking points</option>
                        <option value="meeting_prep">Meeting prep</option>
                        <option value="deck">Deck</option>
                        <option value="note">Note</option>
                      </select>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="font-['JetBrains_Mono'] text-[11px] uppercase tracking-wider text-slate-400">
                        Preview
                      </p>
                      <p className="mt-2 line-clamp-6 text-[13px] leading-6 text-slate-600" dir="auto">
                        {content}
                      </p>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      type="button"
                      onClick={() => void handleSaveArtifact()}
                      disabled={savingArtifact || artifactTitle.trim().length < 3}
                    >
                      {savingArtifact ? "Saving..." : "Save to outputs"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}

            {onRegenerate && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={onRegenerate}
                className="text-slate-400 hover:text-slate-700"
                title="Regenerate"
              >
                <RotateCw className="h-3 w-3" />
                <span>Regenerate</span>
              </Button>
            )}

            {actionNotice && (
              <span className="ml-1 text-[11px] text-slate-500" dir="auto">
                {actionNotice}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
