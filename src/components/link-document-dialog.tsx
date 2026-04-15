"use client";

import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FileText, Check } from "lucide-react";

interface PickerDocument {
  kind: "document";
  id: string;
  title: string;
  type: string;
  classification: string;
  created_at: string;
}

interface LinkDocumentDialogProps {
  projectSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked: () => void;
}

export function LinkDocumentDialog({
  projectSlug,
  open,
  onOpenChange,
  onLinked,
}: LinkDocumentDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerDocument[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [role, setRole] = useState<string>("primary");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state when the dialog opens
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setSelected(new Set());
      setRole("primary");
      setError(null);
    }
  }, [open]);

  // Fetch picker results when query changes
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/picker?q=${encodeURIComponent(query)}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // Use `documents` for filtered queries; fall back to `recent` for empty queries
        const docs: PickerDocument[] = (
          query.trim().length > 0 ? data.documents : data.recent
        ).filter((d: { kind?: string }) => d.kind === "document");
        setResults(docs.slice(0, 12));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Picker failed");
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selected.size === 0) {
      setError("Pick at least one document");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectSlug}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_ids: Array.from(selected),
          role,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onLinked();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Link failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link documents to this project</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            autoFocus
            placeholder="Search documents..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="border border-[color:var(--border)] rounded-lg max-h-72 overflow-y-auto">
            {loading && results.length === 0 ? (
              <p className="text-sm text-[color:var(--ink-ghost)] px-4 py-6 text-center">
                Loading…
              </p>
            ) : results.length === 0 ? (
              <p className="text-sm text-[color:var(--ink-ghost)] px-4 py-6 text-center">
                No documents found.
              </p>
            ) : (
              results.map((d) => {
                const isSelected = selected.has(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => toggle(d.id)}
                    className={`w-full flex items-start gap-3 px-3 py-2 text-left border-b border-[color:var(--border-light)] last:border-b-0 transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-blue-50/60"
                        : "bg-[color:var(--surface-raised)] hover:bg-[color:var(--surface-sunken)]"
                    }`}
                  >
                    <div className="mt-0.5 w-4 h-4 shrink-0 flex items-center justify-center">
                      {isSelected ? (
                        <Check className="w-4 h-4 text-blue-600" />
                      ) : (
                        <FileText className="w-4 h-4 text-[color:var(--ink-ghost)]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-[13px] font-medium text-[color:var(--ink)] truncate font-['IBM_Plex_Sans_Arabic']"
                        dir="auto"
                      >
                        {d.title}
                      </p>
                      <p className="text-[10px] text-[color:var(--ink-ghost)] font-['JetBrains_Mono'] uppercase tracking-wider">
                        {d.type} · {d.classification}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Role selector */}
          <div>
            <label className="block text-[11px] font-['JetBrains_Mono'] font-semibold uppercase tracking-wider text-[color:var(--ink-muted)] mb-1.5">
              Role
            </label>
            <div className="flex gap-2">
              {["primary", "reference", "supporting"].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`text-[12px] px-3 py-1.5 rounded-md border cursor-pointer transition-colors ${
                    role === r
                      ? "bg-[color:var(--ink)] text-white border-slate-900"
                      : "bg-[color:var(--surface-raised)] text-[color:var(--ink-muted)] border-[color:var(--border)] hover:border-[color:var(--border-strong)]"
                  }`}
                >
                  {r}
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
              disabled={submitting || selected.size === 0}
            >
              {submitting
                ? "Linking…"
                : `Link ${selected.size > 0 ? selected.size : ""} document${selected.size === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
