"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, ExternalLink, Sparkles, Copy, Check, RotateCw } from "lucide-react";
import { Tag } from "@/components/ui-system";
import type { Source, AttachmentMeta, PinnedItem } from "@/lib/types";

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
}

/**
 * Replace inline [DOC-N] / [WEB-N] / [PINNED-N] tokens in text with clickable spans.
 * Wrap matches in markdown links to a fake scheme so we can intercept them.
 */
function linkifyCitations(text: string): string {
  return text.replace(
    /\[(DOC-\d+|WEB-\d+|PINNED-\d+)\]/g,
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

export function ChatMessage({ role, content, metadata, isStreaming, onSourceClick, onRegenerate }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);

  const copyContent = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // System messages — minimal centered hint, rarely shown
  if (role === "system") {
    return (
      <div className="text-center text-xs text-slate-400 py-2" dir="auto">
        {content}
      </div>
    );
  }

  // User message — right-aligned dark pill (with optional pin + attachment chips above)
  if (role === "user") {
    const attachments = metadata?.attachments ?? [];
    const pinned = metadata?.pinned ?? [];
    return (
      <div className="flex flex-col items-end gap-1.5 group">
        {pinned.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5 max-w-[75%]">
            {pinned.map((p, i) => (
              <div
                key={`pin-${i}`}
                className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg px-2 py-1"
                title={p.label}
              >
                <FileText className="w-3 h-3" />
                <span className="text-[12px] max-w-[180px] truncate" dir="auto">
                  {p.label}
                </span>
              </div>
            ))}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5 max-w-[75%]">
            {attachments.map((a, i) => (
              <div
                key={i}
                className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5"
                title={a.title}
              >
                <FileText className="w-3 h-3 text-slate-400" />
                <span className="text-[12px] text-slate-700 max-w-[180px] truncate" dir="auto">
                  {a.title}
                </span>
                <span className="font-['JetBrains_Mono'] text-[10px] text-slate-400">
                  {a.pageCount}p
                </span>
              </div>
            ))}
          </div>
        )}
        {content && (
          <div className="max-w-[75%] bg-slate-900 text-white rounded-2xl rounded-tr-md px-4 py-2.5">
            <p
              className="text-[14px] leading-relaxed font-['IBM_Plex_Sans_Arabic'] whitespace-pre-wrap"
              dir="auto"
            >
              {content}
            </p>
          </div>
        )}
      </div>
    );
  }

  // Assistant message — full-width column with avatar gutter
  const sourcesById = new Map(metadata?.sources?.map((s) => [s.id, s]) ?? []);
  const linkifiedContent = linkifyCitations(content);

  return (
    <div className="group flex gap-4">
      {/* Avatar gutter */}
      <div className="shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-slate-800 to-slate-600 flex items-center justify-center mt-0.5">
        <Sparkles className="w-4 h-4 text-white" />
      </div>

      {/* Message body */}
      <div className="flex-1 min-w-0">
        {/* Header row: name + tags */}
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[13px] font-semibold text-slate-900">DocuMind</span>
          {metadata?.doctrines && metadata.doctrines.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {metadata.doctrines.map((d) => (
                <Tag key={d} variant="blue">{d}</Tag>
              ))}
            </div>
          )}
          {metadata?.model && (
            <span className="font-['JetBrains_Mono'] text-[9px] text-slate-400 uppercase tracking-wider">
              {metadata.model}
            </span>
          )}
        </div>

        {/* Markdown content */}
        <div className="prose prose-sm prose-slate max-w-none text-[14px] leading-[1.65]" dir="ltr">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="mb-3 last:mb-0 font-['IBM_Plex_Sans_Arabic'] text-slate-700" dir="auto">{children}</p>,
              h1: ({ children }) => <h1 className="text-lg font-semibold mt-4 mb-2 text-slate-900" dir="auto">{children}</h1>,
              h2: ({ children }) => <h2 className="text-base font-semibold mt-4 mb-2 text-slate-900" dir="auto">{children}</h2>,
              h3: ({ children }) => <h3 className="text-sm font-semibold mt-3 mb-1.5 text-slate-900" dir="auto">{children}</h3>,
              ul: ({ children }) => <ul className="list-disc pl-5 mb-3 space-y-1.5" dir="ltr">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-5 mb-3 space-y-1.5" dir="ltr">{children}</ol>,
              li: ({ children }) => <li className="text-[14px] font-['IBM_Plex_Sans_Arabic'] text-slate-700 leading-relaxed" dir="auto">{children}</li>,
              table: ({ children }) => <div className="overflow-x-auto my-3"><table className="min-w-full text-sm border-collapse border border-slate-200">{children}</table></div>,
              th: ({ children }) => <th className="border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold">{children}</th>,
              td: ({ children }) => <td className="border border-slate-200 px-3 py-2 text-sm">{children}</td>,
              strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
              code: ({ children, className }) => {
                const isBlock = className?.includes("language-");
                if (isBlock) {
                  return <code className={`block bg-slate-50 border border-slate-200 rounded-md p-3 text-xs font-['JetBrains_Mono'] overflow-x-auto my-3 ${className || ""}`}>{children}</code>;
                }
                return <code className="bg-slate-100 rounded px-1.5 py-0.5 text-[12px] font-['JetBrains_Mono'] text-slate-700">{children}</code>;
              },
              a: ({ href, children }) => {
                if (href?.startsWith("cite://")) {
                  const id = href.slice("cite://".length);
                  const source = sourcesById.get(id);
                  if (!source) {
                    return <span className="font-['JetBrains_Mono'] text-[10px] text-slate-400">{children}</span>;
                  }
                  return (
                    <button
                      type="button"
                      onClick={() => onSourceClick?.(source)}
                      className="font-['JetBrains_Mono'] text-[10px] font-semibold text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded px-1 py-0.5 mx-0.5 align-baseline border-none bg-transparent cursor-pointer transition-colors no-underline"
                      title={source.title}
                    >
                      {children}
                    </button>
                  );
                }
                return (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    {children}
                  </a>
                );
              },
            }}
          >
            {linkifiedContent}
          </ReactMarkdown>
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-slate-400 animate-pulse ml-0.5 align-middle rounded-sm" />
          )}
        </div>

        {/* Sources */}
        {metadata?.sources && metadata.sources.length > 0 && (
          <div className="mt-4">
            <p className="text-[10px] font-['JetBrains_Mono'] text-slate-400 uppercase tracking-wider mb-2">
              Sources · {metadata.sources.length}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {metadata.sources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => onSourceClick?.(source)}
                  className="flex items-center gap-2.5 text-left bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-lg px-3 py-2 transition-all cursor-pointer group/src"
                  title={source.type === "web" ? source.url : source.title}
                >
                  {source.type === "web" ? (
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${getDomain(source.url)}&sz=32`}
                      alt=""
                      className="w-4 h-4 shrink-0 rounded-sm"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="w-4 h-4 shrink-0 rounded-sm bg-slate-100 flex items-center justify-center">
                      <FileText className="w-3 h-3 text-slate-500" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-slate-700 truncate" dir="auto">
                      {source.title}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate font-['JetBrains_Mono']">
                      {source.type === "web" ? getDomain(source.url) : `Page ${source.pageNumber}`}
                    </p>
                  </div>
                  <span className="font-['JetBrains_Mono'] text-[9px] text-slate-300 group-hover/src:text-slate-500 shrink-0">
                    {source.id}
                  </span>
                  {source.type === "web" && (
                    <ExternalLink className="w-3 h-3 text-slate-300 group-hover/src:text-slate-500 shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Hover actions */}
        {!isStreaming && content && (
          <div className="flex items-center gap-1 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={copyContent}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700 bg-transparent hover:bg-slate-100 border-none rounded px-2 py-1 cursor-pointer transition-colors"
              title="Copy"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
            {onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700 bg-transparent hover:bg-slate-100 border-none rounded px-2 py-1 cursor-pointer transition-colors"
                title="Regenerate"
              >
                <RotateCw className="w-3 h-3" />
                Regenerate
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
