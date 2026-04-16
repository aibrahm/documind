"use client";

import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
      <DialogContent
        className="sm:max-w-lg p-0 gap-0"
        style={{
          background: "var(--surface-raised)",
          border: "1px solid var(--border)",
          borderRadius: 0,
        }}
      >
        <DialogHeader
          className="px-6 py-4 text-left space-y-0"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div
            className="text-xs font-medium mb-1"
            style={{ color: "var(--ink-faint)", letterSpacing: "0.04em" }}
          >
            LINK
          </div>
          <DialogTitle
            className="text-xl font-semibold tracking-tight"
            style={{ color: "var(--ink)", letterSpacing: "-0.015em" }}
          >
            Add documents to this project
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          <Input
            autoFocus
            placeholder="Search titles, types…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              color: "var(--ink)",
            }}
          />
          <div
            className="max-h-72 overflow-y-auto"
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
            }}
          >
            {loading && results.length === 0 ? (
              <p className="text-sm text-[color:var(--ink-ghost)] px-4 py-6 text-center">
                Loading…
              </p>
            ) : results.length === 0 ? (
              <p className="text-sm text-[color:var(--ink-ghost)] px-4 py-6 text-center">
                Nothing matches.
              </p>
            ) : (
              results.map((d) => {
                const isSelected = selected.has(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => toggle(d.id)}
                    className="w-full flex items-start gap-3 px-3 py-2 text-left border-b border-[color:var(--border-light)] last:border-b-0 transition-colors cursor-pointer"
                    style={{
                      background: isSelected
                        ? "var(--accent-bg)"
                        : "var(--surface-raised)",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.background =
                          "var(--surface-sunken)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.background =
                          "var(--surface-raised)";
                      }
                    }}
                  >
                    <div className="mt-0.5 w-4 h-4 shrink-0 flex items-center justify-center">
                      {isSelected ? (
                        <Check
                          className="w-4 h-4"
                          style={{ color: "var(--accent)" }}
                        />
                      ) : (
                        <FileText className="w-4 h-4 text-[color:var(--ink-ghost)]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-[13px] font-medium text-[color:var(--ink)] truncate"
                        style={{ fontFamily: "var(--font-arabic)" }}
                        dir="auto"
                      >
                        {d.title}
                      </p>
                      <p
                        className="text-[10px] text-[color:var(--ink-ghost)] uppercase tracking-wider"
                        style={{ fontFamily: "var(--font-mono)" }}
                      >
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
            <label
              className="block text-xs font-medium mb-1.5"
              style={{ color: "var(--ink-faint)", letterSpacing: "0.04em" }}
            >
              ROLE
            </label>
            <div className="flex gap-2">
              {["primary", "reference", "supporting"].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className="text-xs px-3 py-1.5 cursor-pointer transition-colors capitalize"
                  style={{
                    background:
                      role === r ? "var(--ink)" : "var(--surface-raised)",
                    color:
                      role === r
                        ? "var(--surface-raised)"
                        : "var(--ink-muted)",
                    border:
                      role === r
                        ? "1px solid var(--ink)"
                        : "1px solid var(--border)",
                    borderRadius: "var(--radius-md)",
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p
              className="text-sm px-3 py-2"
              style={{
                color: "var(--danger)",
                background: "var(--danger-bg)",
                border: "1px solid var(--danger)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              {error}
            </p>
          )}
        </div>

        {/* Footer strip — flush bottom, ink primary action */}
        <div
          className="flex justify-end gap-2 px-6 py-4"
          style={{
            background: "var(--surface)",
            borderTop: "1px solid var(--border)",
          }}
        >
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium cursor-pointer transition-colors disabled:opacity-50"
            style={{
              background: "var(--surface-raised)",
              color: "var(--ink-muted)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || selected.size === 0}
            className="px-4 py-2 text-sm font-medium cursor-pointer transition-colors disabled:opacity-50"
            style={{
              background: "var(--ink)",
              color: "var(--surface-raised)",
              border: "none",
              borderRadius: "var(--radius-md)",
            }}
          >
            {submitting
              ? "Linking…"
              : selected.size > 0
                ? `Link ${selected.size}`
                : "Link"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
