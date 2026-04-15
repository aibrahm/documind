"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Pencil,
  Trash2,
  X,
  Check,
  GitMerge,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface EntityRow {
  id: string;
  name: string;
  name_en: string | null;
  type: string;
  role: string | null;
}

interface DuplicatePair {
  aId: string;
  bId: string;
  score: number;
}

interface EntityEditorProps {
  documentId: string;
}

const TYPE_OPTIONS = [
  "company",
  "organization",
  "authority",
  "ministry",
  "project",
  "person",
  "place",
  "location",
  "law",
  "other",
] as const;

const TYPE_COLORS: Record<string, string> = {
  company: "bg-blue-50 text-blue-700 border-blue-200",
  organization: "bg-blue-50 text-blue-700 border-blue-200",
  authority: "bg-purple-50 text-purple-700 border-purple-200",
  ministry: "bg-purple-50 text-purple-700 border-purple-200",
  project: "bg-emerald-50 text-emerald-700 border-emerald-200",
  person: "bg-amber-50 text-amber-700 border-amber-200",
  place: "bg-rose-50 text-rose-700 border-rose-200",
  location: "bg-rose-50 text-rose-700 border-rose-200",
  law: "bg-[color:var(--surface-sunken)] text-[color:var(--ink)] border-[color:var(--border-strong)]",
  other: "bg-[color:var(--surface-sunken)] text-[color:var(--ink-muted)] border-[color:var(--border)]",
};

export function EntityEditor({ documentId }: EntityEditorProps) {
  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicatePair[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    name: string;
    name_en: string;
    type: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/entities`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setEntities(data.entities || []);
      setDuplicates(data.duplicates || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load entities");
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = (entity: EntityRow) => {
    setEditingId(entity.id);
    setDraft({
      name: entity.name,
      name_en: entity.name_en ?? "",
      type: entity.type,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };

  const saveEdit = async () => {
    if (!editingId || !draft) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/entities/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          name_en: draft.name_en || null,
          type: draft.type,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setEditingId(null);
      setDraft(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save entity");
    } finally {
      setSaving(false);
    }
  };

  const unlinkFromDocument = async (entityId: string) => {
    if (!confirm("Remove this entity from this document? It will stay in other documents.")) {
      return;
    }
    try {
      const res = await fetch(
        `/api/documents/${documentId}/entities?entityId=${entityId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unlink entity");
    }
  };

  const deleteEntityEntirely = async (entityId: string) => {
    if (
      !confirm(
        "Delete this entity from the entire workspace? It will be removed from every document that references it. This cannot be undone.",
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/entities/${entityId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete entity");
    }
  };

  const mergeEntities = async (sourceId: string, targetId: string) => {
    const source = entities.find((e) => e.id === sourceId);
    const target = entities.find((e) => e.id === targetId);
    if (!source || !target) return;
    if (
      !confirm(
        `Merge "${source.name}" into "${target.name}"?\n\nAll documents linked to the first entity will be re-linked to the second, and the first entity will be deleted.`,
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/entities/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, targetId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to merge entities");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-[12px] text-[color:var(--ink-ghost)]">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading entities…
      </div>
    );
  }

  if (entities.length === 0) {
    return (
      <div className="py-3 text-[12px] text-[color:var(--ink-ghost)]">
        No entities extracted from this document.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="cursor-pointer border-none bg-transparent text-red-500 hover:text-red-700"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {duplicates.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="mb-1.5 font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-amber-700">
            Possible duplicates · {duplicates.length}
          </p>
          <div className="space-y-1.5">
            {duplicates.map((pair, i) => {
              const a = entities.find((e) => e.id === pair.aId);
              const b = entities.find((e) => e.id === pair.bId);
              if (!a || !b) return null;
              return (
                <div
                  key={`${pair.aId}-${pair.bId}-${i}`}
                  className="flex items-center justify-between gap-2 text-[12px]"
                >
                  <span className="flex-1 text-[color:var(--ink)]" dir="auto">
                    <span className="font-medium">{a.name}</span>
                    <span className="mx-1 text-[color:var(--ink-ghost)]">↔</span>
                    <span className="font-medium">{b.name}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void mergeEntities(pair.aId, pair.bId)}
                    className="flex items-center gap-1 rounded border border-amber-300 bg-[color:var(--surface-raised)] px-2 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-100 cursor-pointer"
                  >
                    <GitMerge className="h-3 w-3" />
                    Merge
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {entities.map((entity) => {
          const isEditing = editingId === entity.id && draft !== null;
          const typeClass =
            TYPE_COLORS[entity.type] || TYPE_COLORS.other;

          if (isEditing) {
            return (
              <div
                key={entity.id}
                className="rounded-md border border-[color:var(--border-strong)] bg-[color:var(--surface-sunken)] p-3 space-y-2"
              >
                <div className="space-y-1">
                  <label className="font-['JetBrains_Mono'] text-[9px] uppercase tracking-wider text-[color:var(--ink-ghost)]">
                    Name (Arabic / primary)
                  </label>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.target.value })
                    }
                    dir="auto"
                    className="w-full rounded border border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] px-2 py-1 text-[13px] outline-none focus:border-[color:var(--ink)]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-['JetBrains_Mono'] text-[9px] uppercase tracking-wider text-[color:var(--ink-ghost)]">
                    Name (English)
                  </label>
                  <input
                    type="text"
                    value={draft.name_en}
                    onChange={(e) =>
                      setDraft({ ...draft, name_en: e.target.value })
                    }
                    placeholder="(optional)"
                    className="w-full rounded border border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] px-2 py-1 text-[13px] outline-none focus:border-[color:var(--ink)]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-['JetBrains_Mono'] text-[9px] uppercase tracking-wider text-[color:var(--ink-ghost)]">
                    Type
                  </label>
                  <select
                    value={draft.type}
                    onChange={(e) =>
                      setDraft({ ...draft, type: e.target.value })
                    }
                    className="w-full rounded border border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] px-2 py-1 text-[13px] outline-none focus:border-[color:var(--ink)]"
                  >
                    {TYPE_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center justify-end gap-1 pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={cancelEdit}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    onClick={() => void saveEdit()}
                    disabled={saving || draft.name.trim().length === 0}
                  >
                    {saving ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Saving
                      </>
                    ) : (
                      <>
                        <Check className="h-3 w-3" />
                        Save
                      </>
                    )}
                  </Button>
                </div>
              </div>
            );
          }

          return (
            <div
              key={entity.id}
              className="group flex items-center gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-2.5 py-1.5 hover:border-[color:var(--border-strong)] transition-colors"
            >
              <span
                className={`shrink-0 rounded border px-1.5 py-0.5 font-['JetBrains_Mono'] text-[9px] uppercase tracking-wider ${typeClass}`}
              >
                {entity.type}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-[13px] font-medium text-[color:var(--ink)]"
                  dir="auto"
                >
                  {entity.name}
                </p>
                {entity.name_en && entity.name_en !== entity.name && (
                  <p className="truncate text-[11px] text-[color:var(--ink-muted)]">
                    {entity.name_en}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => startEdit(entity)}
                  className="rounded p-1 text-[color:var(--ink-ghost)] hover:bg-[color:var(--surface-sunken)] hover:text-[color:var(--ink)] cursor-pointer border-none bg-transparent"
                  title="Edit entity"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => void unlinkFromDocument(entity.id)}
                  className="rounded p-1 text-[color:var(--ink-ghost)] hover:bg-[color:var(--surface-sunken)] hover:text-[color:var(--ink)] cursor-pointer border-none bg-transparent"
                  title="Remove from this document"
                >
                  <X className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => void deleteEntityEntirely(entity.id)}
                  className="rounded p-1 text-[color:var(--ink-ghost)] hover:bg-red-50 hover:text-red-600 cursor-pointer border-none bg-transparent"
                  title="Delete entity entirely (from every document)"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
