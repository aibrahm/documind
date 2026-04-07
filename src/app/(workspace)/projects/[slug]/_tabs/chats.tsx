"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageSquare } from "lucide-react";

interface ConversationItem {
  id: string;
  title: string;
  mode: string | null;
  query: string | null;
  created_at: string | null;
}

export function ChatsTab({ projectSlug }: { projectSlug: string }) {
  const [convos, setConvos] = useState<ConversationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectSlug}/conversations`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setConvos(data.conversations || []);
      } catch (err) {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "Failed to load conversations",
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectSlug]);

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="max-w-md rounded-lg border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
          Failed to load conversations: {error}
        </div>
      </div>
    );
  }
  if (convos === null) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-slate-400">
        Loading conversations…
      </div>
    );
  }
  if (convos.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="max-w-md text-center space-y-2">
          <MessageSquare className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="text-lg font-semibold text-slate-700">
            No conversations yet
          </p>
          <p className="text-sm text-slate-400">
            Start chatting in the Overview tab — new conversations will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-2">
        {convos.map((c) => (
          <Link
            key={c.id}
            href={`/?conversation=${c.id}`}
            className="block rounded-lg border border-slate-200 px-4 py-3 hover:bg-slate-50 hover:border-slate-300 transition-colors no-underline"
          >
            <div className="flex items-start justify-between gap-2">
              <h3
                className="text-[14px] font-medium text-slate-900 truncate font-['IBM_Plex_Sans_Arabic']"
                dir="auto"
              >
                {c.title}
              </h3>
              {c.mode && (
                <span className="text-[10px] text-slate-400 font-['JetBrains_Mono'] uppercase tracking-wider shrink-0">
                  {c.mode}
                </span>
              )}
            </div>
            {c.query && (
              <p
                className="mt-1 text-[12px] text-slate-500 line-clamp-1"
                dir="auto"
              >
                {c.query}
              </p>
            )}
            {c.created_at && (
              <p className="mt-1 text-[10px] text-slate-400 font-['JetBrains_Mono']">
                {new Date(c.created_at).toLocaleString()}
              </p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
