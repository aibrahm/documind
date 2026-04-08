"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Database } from "@/lib/database.types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Building2,
  Plus,
  X,
  Loader2,
} from "lucide-react";

type Project = Database["public"]["Tables"]["projects"]["Row"];

export interface ProjectParticipant {
  id: string;
  name: string;
  name_en: string | null;
  role: string;
}

interface ProjectWorkspaceHeaderProps {
  project: Project;
  participants: ProjectParticipant[];
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-50 text-green-700",
  on_hold: "bg-amber-50 text-amber-700",
  closed: "bg-blue-50 text-blue-700",
  archived: "bg-slate-100 text-slate-500",
};

const ROLE_OPTIONS = [
  { value: "counterparty", label: "Counterparty" },
  { value: "advisor", label: "Advisor" },
  { value: "partner", label: "Partner" },
  { value: "stakeholder", label: "Stakeholder" },
  { value: "regulator", label: "Regulator" },
  { value: "internal_owner", label: "Internal owner" },
  { value: "asset_owner", label: "Asset owner" },
  { value: "other", label: "Other" },
];

export function ProjectWorkspaceHeader({
  project,
  participants,
}: ProjectWorkspaceHeaderProps) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [removingKey, setRemovingKey] = useState<string | null>(null);

  const handleRemove = async (c: ProjectParticipant) => {
    const label = c.name_en || c.name;
    if (
      !window.confirm(
        `Remove "${label}" (${c.role}) from this project? The entity stays in your knowledge base.`,
      )
    ) {
      return;
    }
    const key = `${c.id}|${c.role}`;
    setRemovingKey(key);
    try {
      const res = await fetch(
        `/api/projects/${project.id}/entities?entity_id=${encodeURIComponent(c.id)}&role=${encodeURIComponent(c.role)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error || `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      window.alert(
        `Failed to remove: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    } finally {
      setRemovingKey(null);
    }
  };

  return (
    <div className="border-b border-slate-200 px-6 py-4 bg-white shrink-0">
      <div className="flex items-start gap-3">
        {project.color && (
          <div
            className="w-3 h-3 rounded-full mt-2 flex-shrink-0"
            style={{ background: project.color }}
          />
        )}
        <div className="flex-1 min-w-0">
          {/* Title + status */}
          <div className="flex items-center gap-3">
            <h1
              className="text-[22px] font-semibold text-slate-900 tracking-tight truncate"
              dir="auto"
            >
              {project.name}
            </h1>
            <span
              className={`text-[10px] font-['JetBrains_Mono'] uppercase tracking-wider px-2 py-0.5 rounded ${
                STATUS_STYLES[project.status] || "bg-slate-100 text-slate-500"
              }`}
            >
              {project.status.replace("_", " ")}
            </span>
          </div>

          {/* Description */}
          {project.description && (
            <p
              className="text-[13px] text-slate-500 mt-1 line-clamp-2"
              dir="auto"
            >
              {project.description}
            </p>
          )}

          {/* Participant pills + add button */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {participants.map((c) => {
              const key = `${c.id}|${c.role}`;
              const isRemoving = removingKey === key;
              return (
                <span
                  key={key}
                  className="inline-flex items-center gap-1.5 rounded bg-blue-50 text-blue-700 text-[11px] px-2 py-0.5 font-['JetBrains_Mono'] group"
                >
                  <span className="truncate max-w-[220px]" dir="auto">
                    {c.name_en || c.name} · {c.role}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemove(c)}
                    disabled={isRemoving}
                    className="p-0 text-blue-400 hover:text-red-600 bg-transparent border-none cursor-pointer disabled:opacity-60"
                    title="Remove from project"
                  >
                    {isRemoving ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <X className="w-3 h-3" />
                    )}
                  </button>
                </span>
              );
            })}
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 hover:bg-slate-50 border border-dashed border-slate-300 rounded px-2 py-0.5 bg-transparent cursor-pointer"
              title="Add a participant to this project"
            >
              <Plus className="w-3 h-3" />
              Add participant
            </button>
          </div>

        </div>
      </div>

      <AddParticipantDialog
        projectId={project.id}
        open={addOpen}
        onOpenChange={setAddOpen}
        existing={participants}
        onAdded={() => {
          setAddOpen(false);
          router.refresh();
        }}
      />
    </div>
  );
}

// ── Add participant dialog ─────────────────────────────────────────────────

interface PickerEntity {
  id: string;
  name: string;
  name_en: string | null;
  type: string;
}

function AddParticipantDialog({
  projectId,
  open,
  onOpenChange,
  existing,
  onAdded,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: ProjectParticipant[];
  onAdded: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerEntity[]>([]);
  const [picked, setPicked] = useState<PickerEntity | null>(null);
  const [role, setRole] = useState<string>("counterparty");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setPicked(null);
      setRole("counterparty");
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || picked) return;
    if (query.trim().length === 0) {
      setResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/picker?q=${encodeURIComponent(query)}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        setResults((data.companies || []).slice(0, 8));
      } catch {
        // best effort
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, picked, open]);

  const handleSubmit = async () => {
    if (!picked) {
      setError("Pick an entity first");
      return;
    }
    // Guard against (entity_id, role) duplicates — the API would upsert,
    // but we surface it in the UI so the user knows nothing changed.
    const alreadyLinked = existing.some(
      (c) => c.id === picked.id && c.role === role,
    );
    if (alreadyLinked) {
      setError("This entity is already linked with that role");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/entities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_ids: [picked.id], role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
      }
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
        <DialogTitle>Add participant</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="block text-[11px] font-['JetBrains_Mono'] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Entity
            </label>
            {picked ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-md">
                <Building2 className="w-3.5 h-3.5 text-blue-600" />
                <span
                  className="flex-1 text-[13px] text-slate-900 truncate"
                  dir="auto"
                >
                  {picked.name_en || picked.name}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPicked(null);
                    setQuery("");
                  }}
                  className="text-slate-400 hover:text-slate-700 bg-transparent border-none cursor-pointer p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                <Input
                  autoFocus
                  placeholder="Search entities…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {results.length > 0 && (
                  <div className="mt-1 border border-slate-200 rounded-md max-h-48 overflow-y-auto">
                    {results.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setPicked(c)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left bg-white hover:bg-slate-50 border-b border-slate-100 last:border-b-0 cursor-pointer"
                      >
                        <Building2 className="w-3.5 h-3.5 text-slate-400" />
                        <span
                          className="text-[13px] text-slate-700 truncate"
                          dir="auto"
                        >
                          {c.name_en || c.name}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {query.trim().length > 0 && results.length === 0 && (
                  <p className="mt-1 text-[11px] text-slate-400 italic">
                    No entities match &ldquo;{query}&rdquo; — try a shorter
                    search. New entities are created automatically when a
                    document is uploaded.
                  </p>
                )}
              </>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-['JetBrains_Mono'] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Role
            </label>
            <div className="flex gap-2 flex-wrap">
              {ROLE_OPTIONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRole(r.value)}
                  className={`text-[12px] px-3 py-1.5 rounded-md border cursor-pointer transition-colors ${
                    role === r.value
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-md">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !picked}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Adding…
                </>
              ) : (
                "Add"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
