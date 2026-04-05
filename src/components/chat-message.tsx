"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText } from "lucide-react";
import { Tag } from "@/components/ui-system";

interface Source {
  id: string;
  title: string;
  pageNumber: number;
  documentId: string;
}

interface ChatMessageProps {
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: {
    mode?: string;
    doctrines?: string[];
    sources?: Source[];
  };
  isStreaming?: boolean;
  onSourceClick?: (documentId: string, pageNumber: number, title: string) => void;
}

export function ChatMessage({ role, content, metadata, isStreaming, onSourceClick }: ChatMessageProps) {
  if (role === "system") {
    return (
      <div className="text-center text-xs text-slate-400 py-1" dir="auto">
        {content}
      </div>
    );
  }

  if (role === "user") {
    return (
      <div className="flex justify-start">
        <div className="bg-slate-100 rounded-lg px-4 py-3 max-w-[80%]">
          <p className="text-sm font-['IBM_Plex_Sans_Arabic'] whitespace-pre-wrap" dir="auto">
            {content}
          </p>
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="flex justify-start">
      <div className="max-w-[80%]">
        {metadata?.doctrines && metadata.doctrines.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {metadata.doctrines.map((d) => (
              <Tag key={d} variant="blue">{d}</Tag>
            ))}
          </div>
        )}

        <div className="prose prose-sm prose-slate max-w-none" dir="auto">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="mb-2 last:mb-0 font-['IBM_Plex_Sans_Arabic']" dir="auto">{children}</p>,
              h1: ({ children }) => <h1 className="text-lg font-semibold mt-4 mb-2" dir="auto">{children}</h1>,
              h2: ({ children }) => <h2 className="text-base font-semibold mt-3 mb-2" dir="auto">{children}</h2>,
              h3: ({ children }) => <h3 className="text-sm font-semibold mt-3 mb-1" dir="auto">{children}</h3>,
              ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>,
              li: ({ children }) => <li className="text-sm" dir="auto">{children}</li>,
              table: ({ children }) => <div className="overflow-x-auto my-2"><table className="min-w-full text-sm border-collapse border border-slate-200">{children}</table></div>,
              th: ({ children }) => <th className="border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-xs font-semibold">{children}</th>,
              td: ({ children }) => <td className="border border-slate-200 px-3 py-1.5 text-sm">{children}</td>,
              strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
              code: ({ children, className }) => {
                const isBlock = className?.includes("language-");
                if (isBlock) {
                  return <code className={`block bg-slate-50 rounded p-3 text-xs font-['JetBrains_Mono'] overflow-x-auto ${className || ""}`}>{children}</code>;
                }
                return <code className="bg-slate-100 rounded px-1 py-0.5 text-xs font-['JetBrains_Mono']">{children}</code>;
              },
            }}
          >
            {content}
          </ReactMarkdown>
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-slate-400 animate-pulse ml-0.5 align-middle rounded-sm" />
          )}
        </div>

        {metadata?.sources && metadata.sources.length > 0 && (
          <div className="mt-3 pt-2 border-t border-slate-100">
            <p className="text-[10px] font-['JetBrains_Mono'] text-slate-400 uppercase tracking-wider mb-1.5">Sources</p>
            <div className="flex flex-wrap gap-1.5">
              {metadata.sources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => onSourceClick?.(source.documentId, source.pageNumber, source.title)}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 rounded px-2 py-1 transition-colors border-none cursor-pointer"
                >
                  <FileText className="w-3 h-3" />
                  <span className="truncate max-w-[150px]" dir="auto">{source.title}</span>
                  <span className="text-slate-400">p.{source.pageNumber}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
