"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronDown, ChevronRight, Pencil, Save, Loader2, X, BookOpen } from "lucide-react";

interface Doctrine {
  id: string;
  name: string;
  title: string;
  content_ar: string;
  content_en: string;
  version: number;
  is_active: boolean;
}

const DOCTRINE_DOT: Record<string, string> = {
  master: "bg-violet-500",
  legal: "bg-blue-500",
  investment: "bg-emerald-500",
  governance: "bg-amber-500",
  negotiation: "bg-rose-500",
};

const DOCTRINE_LABEL: Record<string, string> = {
  negotiation: "commercial",
};

export default function DoctrinesPage() {
  const [doctrines, setDoctrines] = useState<Doctrine[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState<{ title: string; content_ar: string; content_en: string }>({
    title: "",
    content_ar: "",
    content_en: "",
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; kind: "success" | "error" } | null>(null);

  useEffect(() => {
    fetch("/api/doctrines")
      .then((r) => r.json())
      .then((d) => setDoctrines(d.doctrines || []))
      .catch(() => setToast({ message: "Failed to load doctrines", kind: "error" }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const startEdit = useCallback((d: Doctrine) => {
    setEditing(d.id);
    setEditData({ title: d.title, content_ar: d.content_ar, content_en: d.content_en });
    setExpanded((prev) => new Set(prev).add(d.id));
  }, []);

  const saveEdit = useCallback(
    async (id: string) => {
      setSaving(true);
      try {
        const res = await fetch(`/api/doctrines/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editData),
        });
        const d = await res.json();
        if (d.doctrine) {
          setDoctrines((prev) => prev.map((doc) => (doc.id === id ? d.doctrine : doc)));
          setEditing(null);
          setToast({ message: "Doctrine updated", kind: "success" });
        } else {
          setToast({ message: d.error || "Failed to save", kind: "error" });
        }
      } catch {
        setToast({ message: "Failed to save", kind: "error" });
      } finally {
        setSaving(false);
      }
    },
    [editData],
  );

  return (
    <div className="flex flex-1 flex-col bg-white overflow-hidden min-h-0">
      <main className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-3xl mx-auto px-6 py-10">
          {/* Header */}
          <h1 className="text-[28px] font-semibold text-slate-900 tracking-tight mb-1">Doctrines</h1>
          <p className="text-[14px] text-slate-500 mb-8">
            System rules that govern analysis, classification, and the tone of every response. The
            master doctrine is always injected; specialized doctrines activate based on query type.
          </p>

          {loading && (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-[60px] bg-slate-50 border border-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          )}

          {!loading && doctrines.length === 0 && (
            <div className="border border-dashed border-slate-200 rounded-xl p-16 text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-slate-50 flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-slate-300" />
              </div>
              <p className="text-[15px] font-medium text-slate-900 mb-1">No doctrines configured</p>
              <p className="text-[13px] text-slate-500">
                Doctrines are seeded via the database migration.
              </p>
            </div>
          )}

          {/* List */}
          <div className="space-y-2">
            {doctrines.map((d) => {
              const isExpanded = expanded.has(d.id);
              const isEditing = editing === d.id;
              const dot = DOCTRINE_DOT[d.name] || "bg-slate-400";
              const label = DOCTRINE_LABEL[d.name] || d.name;

              return (
                <div
                  key={d.id}
                  className="bg-white border border-slate-200 rounded-xl overflow-hidden"
                >
                  {/* Header row */}
                  <button
                    type="button"
                    onClick={() => toggle(d.id)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 bg-transparent border-none cursor-pointer text-left hover:bg-slate-50 transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                    <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[14px] font-semibold text-slate-900">{d.title}</span>
                        <span className="font-['JetBrains_Mono'] text-[10px] text-slate-400 uppercase tracking-wider">
                          {label}
                        </span>
                      </div>
                    </div>
                    <span className="font-['JetBrains_Mono'] text-[10px] text-slate-400 tracking-wider shrink-0">
                      v{d.version}
                    </span>
                  </button>

                  {/* Expanded body */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 px-4 py-4 bg-slate-50/40">
                      {!isEditing ? (
                        <>
                          <div className="flex justify-end mb-3">
                            <button
                              type="button"
                              onClick={() => startEdit(d)}
                              className="flex items-center gap-1.5 text-[12px] font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-md px-2.5 py-1.5 cursor-pointer transition-colors hover:bg-slate-50"
                            >
                              <Pencil className="w-3 h-3" />
                              Edit
                            </button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <p className="font-['JetBrains_Mono'] text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                                Arabic
                              </p>
                              <div
                                dir="rtl"
                                className="font-['IBM_Plex_Sans_Arabic'] text-[13px] leading-relaxed text-slate-700 whitespace-pre-wrap bg-white border border-slate-200 rounded-lg p-3 max-h-72 overflow-auto"
                              >
                                {d.content_ar || <span className="text-slate-300">— empty —</span>}
                              </div>
                            </div>
                            <div>
                              <p className="font-['JetBrains_Mono'] text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                                English
                              </p>
                              <div className="text-[13px] leading-relaxed text-slate-700 whitespace-pre-wrap bg-white border border-slate-200 rounded-lg p-3 max-h-72 overflow-auto">
                                {d.content_en || <span className="text-slate-300">— empty —</span>}
                              </div>
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          {/* Edit mode */}
                          <div className="mb-3">
                            <p className="font-['JetBrains_Mono'] text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                              Title
                            </p>
                            <input
                              type="text"
                              value={editData.title}
                              onChange={(e) => setEditData((p) => ({ ...p, title: e.target.value }))}
                              className="w-full bg-white border border-slate-200 rounded-md px-3 py-2 text-[13px] text-slate-900 focus:border-slate-400 focus:outline-none"
                            />
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                            <div>
                              <p className="font-['JetBrains_Mono'] text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                                Arabic
                              </p>
                              <textarea
                                dir="rtl"
                                value={editData.content_ar}
                                onChange={(e) =>
                                  setEditData((p) => ({ ...p, content_ar: e.target.value }))
                                }
                                rows={12}
                                className="w-full bg-white border border-slate-200 rounded-md px-3 py-2 font-['IBM_Plex_Sans_Arabic'] text-[13px] text-slate-900 resize-y focus:border-slate-400 focus:outline-none"
                              />
                            </div>
                            <div>
                              <p className="font-['JetBrains_Mono'] text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                                English
                              </p>
                              <textarea
                                value={editData.content_en}
                                onChange={(e) =>
                                  setEditData((p) => ({ ...p, content_en: e.target.value }))
                                }
                                rows={12}
                                className="w-full bg-white border border-slate-200 rounded-md px-3 py-2 text-[13px] text-slate-900 resize-y focus:border-slate-400 focus:outline-none"
                              />
                            </div>
                          </div>

                          <div className="flex gap-2 justify-end">
                            <button
                              type="button"
                              onClick={() => setEditing(null)}
                              disabled={saving}
                              className="text-[12px] font-medium text-slate-600 bg-white border border-slate-200 rounded-md px-3 py-1.5 cursor-pointer hover:bg-slate-50 disabled:opacity-50"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => saveEdit(d.id)}
                              disabled={saving}
                              className="flex items-center gap-1.5 text-[12px] font-medium text-white bg-slate-900 rounded-md px-3 py-1.5 cursor-pointer hover:bg-slate-800 disabled:opacity-50 border-none"
                            >
                              {saving ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Save className="w-3 h-3" />
                              )}
                              Save changes
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </main>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 text-[13px] font-medium px-4 py-2.5 rounded-lg shadow-lg z-50 ${
            toast.kind === "success"
              ? "bg-emerald-600 text-white"
              : "bg-red-600 text-white"
          }`}
        >
          {toast.message}
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-white/70 hover:text-white bg-transparent border-none cursor-pointer p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
