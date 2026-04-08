"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BrainCircuit, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Database } from "@/lib/database.types";

type Project = Database["public"]["Tables"]["projects"]["Row"];
type MemoryItem = Database["public"]["Tables"]["memory_items"]["Row"];

interface BriefTabProps {
  project: Project;
  participants: Array<{
    id: string;
    name: string;
    name_en: string | null;
    role: string;
  }>;
  counts: {
    documents: number;
    entities: number;
    threads: number;
  };
}

export function BriefTab({ project, participants, counts }: BriefTabProps) {
  const [memories, setMemories] = useState<MemoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftKind, setDraftKind] = useState<MemoryItem["kind"]>("fact");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const summary =
    project.context_summary?.trim() ||
    project.description?.trim() ||
    "No project brief yet. Add a short summary so every thread starts from the same context.";

  const nextActions = useMemo(() => {
    return Array.isArray(project.next_actions)
      ? project.next_actions.filter((item): item is string => typeof item === "string")
      : [];
  }, [project.next_actions]);

  const loadMemories = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch(`/api/projects/${project.id}/memory`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      const data = await response.json();
      setMemories(data.memories || []);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load project memory",
      );
    }
  }, [project.id]);

  useEffect(() => {
    void loadMemories();
  }, [loadMemories]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (detail?.projectId === project.id) {
        void loadMemories();
      }
    };
    window.addEventListener("workspace-memory-updated", handler);
    return () => window.removeEventListener("workspace-memory-updated", handler);
  }, [loadMemories, project.id]);

  const handleSave = async () => {
    if (draftText.trim().length < 8) return;
    setSaving(true);
    try {
      const response = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scopeType: "project",
          scopeId: project.id,
          kind: draftKind,
          text: draftText.trim(),
          importance: 0.8,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save memory");
      }
      setDraftText("");
      await loadMemories();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save memory");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (memoryId: string) => {
    setDeletingId(memoryId);
    try {
      const response = await fetch(`/api/memory/${memoryId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete memory");
      }
      setMemories((current) => (current || []).filter((memory) => memory.id !== memoryId));
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Failed to delete memory",
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-8 px-6 py-8">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-slate-400">
              Project brief
            </p>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-slate-500">
              {project.kind.replace("_", " ")}
            </span>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-emerald-700">
              {project.stage.replace("_", " ")}
            </span>
          </div>
          <h2
            className="text-[28px] font-semibold tracking-tight text-slate-900"
            dir="auto"
          >
            {project.name}
          </h2>
          <p className="max-w-3xl text-[14px] leading-7 text-slate-600" dir="auto">
            {summary}
          </p>
          {project.objective && (
            <div className="max-w-3xl rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-slate-400">
                Current objective
              </p>
              <p className="mt-2 text-[14px] leading-7 text-slate-700" dir="auto">
                {project.objective}
              </p>
            </div>
          )}
        </section>

        <section className="grid gap-4 md:grid-cols-[1.2fr,0.8fr]">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-slate-400">
              Snapshot
            </p>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <Metric label="Documents" value={counts.documents} />
              <Metric label="Participants" value={counts.entities} />
              <Metric label="Threads" value={counts.threads} />
              <Metric label="Status" value={project.status.replace("_", " ")} />
            </dl>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-5">
            <p className="font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-slate-400">
              Linked participants
            </p>
            {participants.length === 0 ? (
              <p className="mt-3 text-[14px] text-slate-500">
                No linked participants yet.
              </p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {participants.map((participant) => (
                  <span
                    key={`${participant.id}-${participant.role}`}
                    className="inline-flex items-center rounded-full bg-white px-3 py-1 text-[12px] text-slate-700"
                  >
                    <span dir="auto">{participant.name_en || participant.name}</span>
                    <span className="ml-1.5 text-slate-400">· {participant.role}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>

        {nextActions.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-slate-400">
              Next actions
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-[14px] leading-7 text-slate-700">
              {nextActions.map((action, index) => (
                <li key={`${action}-${index}`} dir="auto">
                  {action}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-slate-400">
                Project memory
              </p>
              <h3 className="mt-1 text-[20px] font-semibold text-slate-900">
                Durable context
              </h3>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1">
              <BrainCircuit className="h-4 w-4 text-slate-400" />
              <span className="font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-slate-500">
                {(memories || []).length} saved
              </span>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-4">
            <div className="grid gap-3 md:grid-cols-[180px,1fr,auto]">
              <select
                value={draftKind}
                onChange={(event) => setDraftKind(event.target.value as MemoryItem["kind"])}
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
              >
                <option value="fact">Fact</option>
                <option value="decision">Decision</option>
                <option value="instruction">Instruction</option>
                <option value="preference">Preference</option>
                <option value="risk">Risk</option>
                <option value="question">Question</option>
              </select>
              <Textarea
                value={draftText}
                onChange={(event) => setDraftText(event.target.value)}
                placeholder="Add a durable project note, decision, risk, or instruction."
                rows={3}
              />
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || draftText.trim().length < 8}
                className="self-start"
              >
                <Plus className="h-4 w-4" />
                {saving ? "Saving..." : "Save memory"}
              </Button>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {memories === null ? (
            <div className="mt-4 text-sm text-slate-400">Loading project memory…</div>
          ) : memories.length === 0 ? (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
              No project memory saved yet. Save key takeaways from threads so future work starts with the right context.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {memories.map((memory) => (
                <article
                  key={memory.id}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-white px-2.5 py-1 font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-slate-500">
                          {memory.kind}
                        </span>
                        <span className="font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-slate-400">
                          {memory.created_at
                            ? new Date(memory.created_at).toLocaleString()
                            : "Saved memory"}
                        </span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-[14px] leading-7 text-slate-700" dir="auto">
                        {memory.text}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => void handleDelete(memory.id)}
                      disabled={deletingId === memory.id}
                      title="Delete memory"
                    >
                      <Trash2 className="h-4 w-4 text-slate-400" />
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-3">
      <dt className="font-['JetBrains_Mono'] text-[11px] uppercase tracking-wider text-slate-400">
        {label}
      </dt>
      <dd className="text-[16px] font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
