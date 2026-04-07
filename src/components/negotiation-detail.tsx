"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  FileText,
  MessageSquare,
  Sparkles,
  Edit3,
  XCircle,
} from "lucide-react";

interface Negotiation {
  id: string;
  name: string;
  status: string;
  key_terms: Record<string, unknown> | null;
  opened_at: string | null;
  closed_at: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface ProjectDocument {
  id: string;
  title: string;
  link: { added_at: string; role: string | null };
}

interface ProjectConversation {
  id: string;
  title: string;
  created_at: string | null;
}

interface TimelineEvent {
  id: string;
  iso_date: string;
  icon: typeof CalendarClock;
  label: string;
  detail: string;
}

export function NegotiationDetail({
  negotiation,
  projectSlug,
}: {
  negotiation: Negotiation;
  projectSlug: string;
}) {
  const [docs, setDocs] = useState<ProjectDocument[]>([]);
  const [convos, setConvos] = useState<ProjectConversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [docsRes, convosRes] = await Promise.all([
          fetch(`/api/projects/${projectSlug}/documents`),
          fetch(`/api/projects/${projectSlug}/conversations`),
        ]);
        if (cancelled) return;
        if (docsRes.ok) {
          const d = await docsRes.json();
          setDocs(d.documents || []);
        }
        if (convosRes.ok) {
          const d = await convosRes.json();
          setConvos(d.conversations || []);
        }
      } catch {
        // best effort — the timeline still shows the negotiation's own events
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectSlug]);

  // Build a unified timeline from existing data sources
  const timeline = useMemo<TimelineEvent[]>(() => {
    const events: TimelineEvent[] = [];

    if (negotiation.opened_at) {
      events.push({
        id: `opened-${negotiation.id}`,
        iso_date: negotiation.opened_at,
        icon: Sparkles,
        label: "Negotiation opened",
        detail: negotiation.name,
      });
    }
    if (
      negotiation.updated_at &&
      negotiation.opened_at &&
      negotiation.updated_at !== negotiation.opened_at
    ) {
      events.push({
        id: `updated-${negotiation.id}`,
        iso_date: negotiation.updated_at,
        icon: Edit3,
        label: "Last updated",
        detail: `Status: ${negotiation.status.replace("_", " ")}`,
      });
    }
    if (negotiation.closed_at) {
      events.push({
        id: `closed-${negotiation.id}`,
        iso_date: negotiation.closed_at,
        icon: XCircle,
        label: `Closed: ${negotiation.status.replace("_", " ")}`,
        detail: "",
      });
    }
    for (const d of docs) {
      events.push({
        id: `doc-${d.id}`,
        iso_date: d.link.added_at,
        icon: FileText,
        label: "Document linked",
        detail: d.title,
      });
    }
    for (const c of convos) {
      if (!c.created_at) continue;
      events.push({
        id: `conv-${c.id}`,
        iso_date: c.created_at,
        icon: MessageSquare,
        label: "Conversation",
        detail: c.title,
      });
    }

    return events.sort(
      (a, b) => new Date(b.iso_date).getTime() - new Date(a.iso_date).getTime(),
    );
  }, [negotiation, docs, convos]);

  const keyTermsEntries = negotiation.key_terms
    ? Object.entries(negotiation.key_terms)
    : [];

  return (
    <div className="border-t border-slate-200 bg-slate-50/40 px-4 py-4 space-y-5">
      {/* Key facts table */}
      <div>
        <p className="font-['JetBrains_Mono'] text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Key facts
        </p>
        {keyTermsEntries.length === 0 ? (
          <p className="text-xs text-slate-400 italic">
            No key terms recorded yet. Use the <code>extract_key_terms</code> tool
            in deep-mode chat to populate this from the project&apos;s documents.
          </p>
        ) : (
          <div className="border border-slate-200 rounded-md bg-white overflow-hidden">
            {keyTermsEntries.map(([k, v], i) => (
              <div
                key={k}
                className={`flex items-start gap-3 px-3 py-2 ${
                  i < keyTermsEntries.length - 1 ? "border-b border-slate-100" : ""
                }`}
              >
                <span className="text-[11px] text-slate-500 font-['JetBrains_Mono'] uppercase tracking-wider min-w-[140px]">
                  {k.replace(/_/g, " ")}
                </span>
                <span
                  className="text-[12px] text-slate-800 font-['JetBrains_Mono'] flex-1 break-words"
                  dir="auto"
                >
                  {formatValue(v)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Timeline */}
      <div>
        <p className="font-['JetBrains_Mono'] text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Timeline {loading && <span className="text-slate-300">— loading…</span>}
        </p>
        {timeline.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No events yet.</p>
        ) : (
          <div className="space-y-2">
            {timeline.map((e) => {
              const Icon = e.icon;
              const date = new Date(e.iso_date);
              return (
                <div key={e.id} className="flex items-start gap-3">
                  <div className="mt-0.5 w-6 h-6 rounded-full bg-white border border-slate-200 flex items-center justify-center shrink-0">
                    <Icon className="w-3 h-3 text-slate-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-[12px] font-medium text-slate-700">
                        {e.label}
                      </span>
                      <span className="text-[10px] text-slate-400 font-['JetBrains_Mono']">
                        {date.toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                    {e.detail && (
                      <p
                        className="text-[12px] text-slate-500 truncate"
                        dir="auto"
                      >
                        {e.detail}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Format key_terms values for display ──

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") {
    if (Math.abs(v) >= 1_000_000) return v.toLocaleString("en-US");
    return String(v);
  }
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v))
    return v
      .map((item) => (typeof item === "object" ? JSON.stringify(item) : String(item)))
      .join(", ");
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${k}: ${val}`)
      .join(", ");
  }
  return String(v);
}
