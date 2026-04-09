"use client";

import { memo, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FileText,
  ExternalLink,
  Sparkles,
  Copy,
  Check,
  RotateCw,
  Mail,
  Pencil,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { Tag } from "@/components/ui-system";
import { DocumentContextCard } from "@/components/document-context-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Source, AttachmentMeta, PinnedItem } from "@/lib/types";

// ArtifactKind is still used for inline "artifact card" rendering — the
// assistant emits fenced code blocks tagged `email`/`memo`/etc. and we
// render them as inline cards in the chat (see ArtifactPreviewCard below).
// The user-facing "Save as artifact" dialog was removed; artifacts live
// inline in the thread and are copied/downloaded from there, not saved
// into a separate "Outputs" section.
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
  /**
   * Server-assigned id of the persisted assistant message. Present as
   * soon as the turn finishes streaming (the backend emits it in the
   * final "done" SSE event) and on all messages loaded from history.
   * Required for the per-message feedback buttons — without an id there's
   * nothing to attach the verdict to, so the buttons hide themselves.
   */
  messageId?: string;
  metadata?: {
    mode?: string;
    doctrines?: string[];
    sources?: Source[];
    model?: string;
    attachments?: AttachmentMeta[];
    pinned?: PinnedItem[];
    coverage?: {
      docCount: number;
      webUsed: boolean;
      confidence: "high" | "medium" | "low";
    };
    warnings?: Array<{ kind: string; message: string }>;
  };
  isStreaming?: boolean;
  onSourceClick?: (source: Source) => void;
  onRegenerate?: () => void;
}

// Honest, plain-english copy for the trust bar. We deliberately avoid
// hedging words like "may have" or "could be" — the VC is an executive
// and a vague signal is worse than no signal. Each tier says what is
// true about where the answer came from and what the user should do
// with it. "Fail Loud, Never Fake" as a product value.
function describeCoverage(coverage: {
  docCount: number;
  webUsed: boolean;
  confidence: "high" | "medium" | "low";
}): { dot: string; text: string; action: string | null } {
  const { docCount, webUsed, confidence } = coverage;
  if (confidence === "high") {
    return {
      dot: "bg-emerald-500",
      text: `Answered from ${docCount} of your documents`,
      action: null,
    };
  }
  if (confidence === "medium") {
    return {
      dot: "bg-amber-500",
      text:
        docCount === 1
          ? "Answered from 1 document"
          : `Answered from ${docCount} documents`,
      action: "Thin coverage — verify before acting",
    };
  }
  // low
  if (webUsed && docCount === 0) {
    return {
      dot: "bg-red-500",
      text: "Answered from web search only",
      action: "Nothing matched in your documents — do not cite as internal",
    };
  }
  return {
    dot: "bg-red-500",
    text: "No matching documents",
    action: "Answered from general knowledge — do not cite",
  };
}

// Use a fragment identifier (#cite-ID) instead of a custom scheme. react-markdown
// v10 strips unknown URL schemes like `cite://` during sanitization, which was
// causing clicks to fall through to a blank `<a target="_blank">` and open a
// new empty tab. Fragments are always safe and preserved.
function linkifyCitations(text: string): string {
  return text.replace(
    /\[(DOC-\d+|WEB-\d+|PINNED-\d+|PROJECT-DOC-\d+|TARGET-DOC-\d+)\]/g,
    (_, id) => `[[${id}]](#cite-${id})`,
  );
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
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

function ChatMessageInner({
  role,
  content,
  messageId,
  metadata,
  isStreaming,
  onSourceClick,
  onRegenerate,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  // Local feedback state — optimistic so the button feels instant. We
  // only support one active verdict at a time in the UI (clicking the
  // other one retracts the first). null means "nothing marked yet".
  const [feedback, setFeedback] = useState<"helpful" | "wrong" | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const submitFeedback = async (verdict: "helpful" | "wrong") => {
    if (!messageId) return;
    const previous = feedback;
    // Optimistic update.
    if (previous === verdict) {
      // Clicking the active verdict retracts it.
      setFeedback(null);
      try {
        await fetch(
          `/api/messages/${messageId}/feedback?verdict=${verdict}`,
          { method: "DELETE" },
        );
      } catch {
        setFeedback(previous);
        setFeedbackError("Couldn't update feedback");
      }
      return;
    }
    setFeedback(verdict);
    try {
      const res = await fetch(`/api/messages/${messageId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      setFeedbackError(null);
    } catch {
      setFeedback(previous);
      setFeedbackError("Couldn't save feedback");
    }
  };

  const plainEmail = useMemo(
    () => (role === "assistant" && looksLikePlainEmail(content) ? parseEmailBlock(content) : null),
    [content, role],
  );

  const sourcesById = useMemo(
    () => new Map(metadata?.sources?.map((source) => [source.id, source]) ?? []),
    [metadata?.sources],
  );

  // Dedupe source cards by document (or URL for web) so the same memo
  // doesn't render as 3 identical cards just because 3 chunks matched.
  // Each entry keeps a representative source (first one, used for click)
  // plus the unique list of pages that were cited across all chunks.
  //
  // Sorted: documents first (user's own corpus = most trusted), then web.
  // Within each group, most-cited appear first (higher signal).
  const dedupedSources = useMemo(() => {
    const entries: Array<{
      key: string;
      primary: Source;
      pages: number[];
      citationCount: number;
    }> = [];
    const index = new Map<string, number>();
    for (const source of metadata?.sources ?? []) {
      const key = source.type === "web" ? source.url : source.documentId;
      const existing = index.get(key);
      if (existing !== undefined) {
        const entry = entries[existing];
        entry.citationCount += 1;
        if (source.type !== "web" && !entry.pages.includes(source.pageNumber)) {
          entry.pages.push(source.pageNumber);
        }
      } else {
        index.set(key, entries.length);
        entries.push({
          key,
          primary: source,
          pages: source.type === "web" ? [] : [source.pageNumber],
          citationCount: 1,
        });
      }
    }
    for (const entry of entries) entry.pages.sort((a, b) => a - b);
    // Sort: documents first, then web. Within each group: most cited first.
    entries.sort((a, b) => {
      const aIsDoc = a.primary.type !== "web" ? 0 : 1;
      const bIsDoc = b.primary.type !== "web" ? 0 : 1;
      if (aIsDoc !== bIsDoc) return aIsDoc - bIsDoc;
      return b.citationCount - a.citationCount;
    });
    return entries;
  }, [metadata?.sources]);

  // Collapse long source lists. 5 is the threshold — below that, the full
  // list fits comfortably and the toggle is more noise than value. Above
  // that, we show the top 5 (docs first, then top web hits) and hide the
  // rest behind a "Show all" button.
  const SOURCE_PREVIEW_COUNT = 5;
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const hasHiddenSources = dedupedSources.length > SOURCE_PREVIEW_COUNT;
  const visibleSources = sourcesExpanded
    ? dedupedSources
    : dedupedSources.slice(0, SOURCE_PREVIEW_COUNT);
  const docSourceCount = dedupedSources.filter(
    (e) => e.primary.type !== "web",
  ).length;
  const webSourceCount = dedupedSources.length - docSourceCount;

  const linkifiedContent = useMemo(() => linkifyCitations(content), [content]);

  const copyContent = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
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
                if (href?.startsWith("#cite-")) {
                  const id = href.slice("#cite-".length);
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
                      onClick={(e) => {
                        e.preventDefault();
                        onSourceClick?.(source);
                      }}
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

        {dedupedSources.length > 0 && (
          <div className="mt-3">
            <p className="mb-1.5 font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-slate-400">
              Sources · {dedupedSources.length}
              {docSourceCount > 0 && webSourceCount > 0 && (
                <span className="ml-1.5 text-slate-300">
                  ({docSourceCount} doc{docSourceCount === 1 ? "" : "s"} ·{" "}
                  {webSourceCount} web)
                </span>
              )}
            </p>
            <div className="space-y-2">
              {visibleSources.map((entry) => {
                const source = entry.primary;
                const isWeb = source.type === "web";
                const pagesLabel =
                  entry.pages.length === 0
                    ? ""
                    : entry.pages.length === 1
                    ? `p.${entry.pages[0]}`
                    : entry.pages.length <= 3
                    ? `pp.${entry.pages.join(",")}`
                    : `${entry.pages.length} pages`;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => onSourceClick?.(source)}
                    className="group/src flex w-full min-w-0 cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
                    title={isWeb ? source.url : source.title}
                  >
                    {isWeb ? (
                      <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                    ) : (
                      <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="min-w-0 flex-1 truncate text-[12px] font-medium text-slate-700"
                          dir="auto"
                        >
                          {source.title}
                        </span>
                        <span className="shrink-0 font-['JetBrains_Mono'] text-[10px] text-slate-400">
                          {isWeb ? getDomain(source.url) : pagesLabel}
                        </span>
                        {entry.citationCount > 1 && (
                          <span className="shrink-0 rounded bg-slate-100 px-1 font-['JetBrains_Mono'] text-[9px] text-slate-500">
                            ×{entry.citationCount}
                          </span>
                        )}
                      </div>
                      {isWeb ? (
                        <p className="mt-1 text-[11px] text-slate-500">
                          Web source
                        </p>
                      ) : (
                        <>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {source.classification && (
                              <Tag variant="default">{source.classification}</Tag>
                            )}
                            {source.sectionTitle && (
                              <span className="text-[11px] text-slate-500" dir="auto">
                                {source.sectionTitle}
                              </span>
                            )}
                          </div>
                          <DocumentContextCard
                            card={source.contextCard}
                            preferredLanguage={source.language}
                            variant="compact"
                            bordered={false}
                            className="mt-1"
                          />
                        </>
                      )}
                    </div>
                  </button>
                );
              })}
              {hasHiddenSources && (
                <button
                  type="button"
                  onClick={() => setSourcesExpanded((v) => !v)}
                  className="flex items-center gap-1 rounded-md border border-dashed border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-700 cursor-pointer"
                >
                  {sourcesExpanded ? (
                    <>
                      <ChevronUp className="h-3 w-3" />
                      Show fewer
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3 w-3" />
                      Show {dedupedSources.length - SOURCE_PREVIEW_COUNT} more
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        )}

        {/*
          Backend-reported warnings for this turn. These are always visible,
          even when the answer is otherwise fine — the whole point is to
          surface silent degradations (memory extraction broken, audit log
          down, etc.) instead of logging them to stderr and moving on.
          "Fail Loud, Never Fake" as a product value.
        */}
        {!isStreaming && metadata?.warnings && metadata.warnings.length > 0 && (
          <div className="mt-3 space-y-1">
            {metadata.warnings.map((w, i) => (
              <div
                key={`warn-${i}`}
                className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
                dir="auto"
              >
                <span className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold uppercase tracking-wider text-amber-900">
                    {w.kind} degraded
                  </p>
                  <p className="mt-0.5 text-[12px] leading-snug text-amber-800">
                    {w.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {!isStreaming && content && metadata?.coverage && (() => {
          const describe = describeCoverage(metadata.coverage);
          return (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${describe.dot}`} />
              <span className="font-medium text-slate-600">{describe.text}</span>
              {describe.action && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className="text-slate-500">{describe.action}</span>
                </>
              )}
            </div>
          );
        })()}

        {!isStreaming && content && (
          <div className="mt-2 flex flex-wrap items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
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

            {/*
              Per-message feedback — two buttons, no stars, no forms.
              This is the one product metric that matters: did the VC
              actually find this answer worth acting on. Kept deliberately
              lightweight (no modal, no "why was this wrong?" prompt)
              because friction on feedback kills the signal.
            */}
            {messageId && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => void submitFeedback("helpful")}
                  className={
                    feedback === "helpful"
                      ? "text-emerald-600 hover:text-emerald-700"
                      : "text-slate-400 hover:text-slate-700"
                  }
                  title="This helped"
                >
                  <ThumbsUp className="h-3 w-3" />
                  <span>Helpful</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => void submitFeedback("wrong")}
                  className={
                    feedback === "wrong"
                      ? "text-red-600 hover:text-red-700"
                      : "text-slate-400 hover:text-slate-700"
                  }
                  title="This was wrong"
                >
                  <ThumbsDown className="h-3 w-3" />
                  <span>Wrong</span>
                </Button>
                {feedbackError && (
                  <span className="text-[11px] text-red-500" title={feedbackError}>
                    ({feedbackError})
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Memoized wrapper — prevents every prior message from re-rendering on every
// token of the streaming message. The custom comparator checks the fields
// that actually affect rendering. Callbacks are expected to be stable
// (wrapped in useCallback by the parent) — we treat them as ref-equal.
export const ChatMessage = memo(ChatMessageInner, (prev, next) => {
  if (prev.role !== next.role) return false;
  if (prev.content !== next.content) return false;
  if (prev.messageId !== next.messageId) return false;
  if (prev.isStreaming !== next.isStreaming) return false;
  if (prev.metadata !== next.metadata) return false;
  if (prev.onSourceClick !== next.onSourceClick) return false;
  if (prev.onRegenerate !== next.onRegenerate) return false;
  return true;
});
