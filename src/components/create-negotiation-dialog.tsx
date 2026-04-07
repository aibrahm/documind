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
import { Building2, Check, X } from "lucide-react";

interface PickerCompany {
  kind: "entity";
  id: string;
  name: string;
  name_en: string | null;
  type: string;
}

interface CreateNegotiationDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "active", label: "Active" },
  { value: "stalled", label: "Stalled" },
];

export function CreateNegotiationDialog({
  projectId,
  open,
  onOpenChange,
  onCreated,
}: CreateNegotiationDialogProps) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<string>("open");
  const [counterpartyQuery, setCounterpartyQuery] = useState("");
  const [counterpartyResults, setCounterpartyResults] = useState<PickerCompany[]>([]);
  const [counterparty, setCounterparty] = useState<PickerCompany | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setName("");
      setStatus("open");
      setCounterpartyQuery("");
      setCounterpartyResults([]);
      setCounterparty(null);
      setError(null);
    }
  }, [open]);

  // Picker debounce
  useEffect(() => {
    if (!open || counterparty) return;
    if (counterpartyQuery.trim().length === 0) {
      setCounterpartyResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/picker?q=${encodeURIComponent(counterpartyQuery)}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        setCounterpartyResults((data.companies || []).slice(0, 6));
      } catch {
        // best effort
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [counterpartyQuery, counterparty, open]);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        project_id: projectId,
        name: trimmed,
        status,
      };
      if (counterparty) body.counterparty_entity_id = counterparty.id;

      const res = await fetch("/api/negotiations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onCreated();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New negotiation</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="block text-[11px] font-['JetBrains_Mono'] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Name
            </label>
            <Input
              autoFocus
              placeholder="e.g. Scenario A — Developer + Partnership"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-[11px] font-['JetBrains_Mono'] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Counterparty (optional)
            </label>
            {counterparty ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-md">
                <Building2 className="w-3.5 h-3.5 text-blue-600" />
                <span
                  className="flex-1 text-[13px] text-slate-900 truncate"
                  dir="auto"
                >
                  {counterparty.name_en || counterparty.name}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCounterparty(null);
                    setCounterpartyQuery("");
                  }}
                  className="text-slate-400 hover:text-slate-700 bg-transparent border-none cursor-pointer p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                <Input
                  placeholder="Search companies..."
                  value={counterpartyQuery}
                  onChange={(e) => setCounterpartyQuery(e.target.value)}
                />
                {counterpartyResults.length > 0 && (
                  <div className="mt-1 border border-slate-200 rounded-md max-h-40 overflow-y-auto">
                    {counterpartyResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setCounterparty(c)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left bg-white hover:bg-slate-50 border-b border-slate-100 last:border-b-0 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5 text-slate-400" />
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
              </>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-['JetBrains_Mono'] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Status
            </label>
            <div className="flex gap-2">
              {STATUS_OPTIONS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setStatus(s.value)}
                  className={`text-[12px] px-3 py-1.5 rounded-md border cursor-pointer transition-colors ${
                    status === s.value
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  {s.label}
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
              disabled={submitting}
            >
              {submitting ? "Creating…" : "Create negotiation"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
