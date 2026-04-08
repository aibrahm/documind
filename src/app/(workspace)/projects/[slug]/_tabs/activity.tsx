"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock3, MessageSquare, MessageSquarePlus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

interface ConversationItem {
  id: string;
  title: string;
  mode: string | null;
  query: string | null;
  created_at: string | null;
}

export function ActivityTab({ projectSlug }: { projectSlug: string }) {
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
            err instanceof Error ? err.message : "Failed to load thread activity",
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectSlug]);

  const newThreadHref = `/projects/${projectSlug}?tab=threads&new=${Date.now()}`;
  const newChatButton = (
    <Link
      href={newThreadHref}
      className={`${buttonVariants({ variant: "outline" })} gap-1.5 no-underline`}
    >
      <MessageSquarePlus className="w-3.5 h-3.5" />
      New thread
    </Link>
  );

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="max-w-md rounded-lg border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
          Failed to load thread activity: {error}
        </div>
      </div>
    );
  }
  if (convos === null) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-slate-400">
        Loading activity…
      </div>
    );
  }
  if (convos.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="max-w-md text-center space-y-3">
          <MessageSquare className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="text-lg font-semibold text-slate-700">
            No thread activity yet
          </p>
          <p className="text-sm text-slate-400">
            Start a new thread and it will appear here once the first message is
            sent.
          </p>
          <div className="pt-2">{newChatButton}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-2">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-['JetBrains_Mono'] font-semibold uppercase tracking-wider text-slate-400">
            {convos.length} thread{convos.length === 1 ? "" : "s"}
          </p>
          {newChatButton}
        </div>
        {convos.map((c) => (
          <Link
            key={c.id}
            href={`/projects/${projectSlug}?tab=threads&conversation=${c.id}`}
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
              <div className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-400 font-['JetBrains_Mono']">
                <Clock3 className="w-3 h-3" />
                <span>{new Date(c.created_at).toLocaleString()}</span>
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
