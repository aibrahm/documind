"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  ArrowUp,
  Paperclip,
  X,
  FileText,
  Loader2,
  AlertCircle,
  Building2,
  FolderOpen,
  User,
  MapPin,
  Landmark,
  Sparkles,
} from "lucide-react";
import type { PinnedItem } from "@/lib/types";

export interface ChatInputHandle {
  addFiles: (files: File[]) => void;
}

export interface Attachment {
  id: string;
  title: string;
  content: string;
  pageCount: number;
  size: number;
}

interface ChatInputProps {
  onSend: (message: string, attachments: Attachment[], pinned: PinnedItem[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

interface PendingFile {
  id: string;
  file: File;
  status: "uploading" | "ready" | "error";
  attachment?: Attachment;
  error?: string;
}

interface PickerEntity {
  kind: "entity";
  id: string;
  name: string;
  name_en: string | null;
  type: string;
  doc_count: number;
}
interface PickerDocument {
  kind: "document";
  id: string;
  title: string;
  type: string;
  classification: string;
  created_at: string;
}
interface PickerData {
  recent: PickerDocument[];
  companies: PickerEntity[];
  projects: PickerEntity[];
  authorities: PickerEntity[];
  people: PickerEntity[];
  places: PickerEntity[];
  documents: PickerDocument[];
}

const ENTITY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  company: Building2,
  organization: Building2,
  project: FolderOpen,
  authority: Landmark,
  ministry: Landmark,
  person: User,
  place: MapPin,
  location: MapPin,
};

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(
  { onSend, disabled, placeholder },
  ref,
) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [pinned, setPinned] = useState<PinnedItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerData, setPickerData] = useState<PickerData | null>(null);
  const [pickerHighlight, setPickerHighlight] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // ── Textarea autosize ──
  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const lineHeight = 24;
    const maxHeight = lineHeight * 5;
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
  }, []);
  useEffect(() => adjustHeight(), [value, adjustHeight]);

  // ── @ mention detection ──
  // When the user types "@" we open the picker. While the picker is open we
  // track everything they type after the "@" as the search query and feed it
  // to the picker endpoint.
  const detectMention = useCallback((newValue: string, caret: number) => {
    // Find the most recent "@" at or before the caret that is preceded by
    // whitespace or start-of-string (to avoid matching emails / mid-word @s).
    let i = caret - 1;
    while (i >= 0) {
      const ch = newValue[i];
      if (ch === "@") {
        const before = i === 0 ? " " : newValue[i - 1];
        if (/\s/.test(before) || before === "" || before === undefined) {
          // Valid @ — extract the query (everything after the @ up to caret)
          const query = newValue.slice(i + 1, caret);
          // Bail if the query contains whitespace (user finished typing)
          if (/\s/.test(query)) return null;
          return { atIndex: i, query };
        }
        return null;
      }
      // Stop scanning if we hit whitespace before finding @
      if (/\s/.test(ch)) return null;
      i--;
    }
    return null;
  }, []);

  // Fetch picker data when picker opens or query changes
  useEffect(() => {
    if (!pickerOpen) return;
    const controller = new AbortController();
    fetch(`/api/picker?q=${encodeURIComponent(pickerQuery)}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((d) => setPickerData(d))
      .catch(() => {});
    return () => controller.abort();
  }, [pickerOpen, pickerQuery]);

  // Reset highlight when results change
  useEffect(() => {
    setPickerHighlight(0);
  }, [pickerData]);

  // ── Flatten picker data into a single navigable list ──
  type PickerRow =
    | { type: "header"; label: string }
    | { type: "item"; item: PickerEntity | PickerDocument };

  const buildPickerRows = (): PickerRow[] => {
    if (!pickerData) return [];
    const rows: PickerRow[] = [];
    const sections: Array<[string, Array<PickerEntity | PickerDocument>]> = [
      ["Recent uploads", pickerData.recent],
      ["Documents", pickerData.documents],
      ["Companies", pickerData.companies],
      ["Projects", pickerData.projects],
      ["Authorities", pickerData.authorities],
      ["People", pickerData.people],
      ["Places", pickerData.places],
    ];
    for (const [label, items] of sections) {
      if (items.length === 0) continue;
      rows.push({ type: "header", label });
      for (const item of items) rows.push({ type: "item", item });
    }
    return rows;
  };

  const pickerRows = buildPickerRows();
  const itemRows = pickerRows.filter((r) => r.type === "item") as Array<{
    type: "item";
    item: PickerEntity | PickerDocument;
  }>;

  // ── Pin selection ──
  const pinItem = useCallback(
    (item: PickerEntity | PickerDocument) => {
      const pin: PinnedItem =
        item.kind === "document"
          ? {
              kind: "document",
              id: item.id,
              label: item.title,
              type: item.type,
            }
          : {
              kind: "entity",
              id: item.id,
              label: item.name,
              type: item.type,
              doc_count: item.doc_count,
            };

      setPinned((prev) => {
        if (prev.some((p) => p.kind === pin.kind && p.id === pin.id)) return prev;
        return [...prev, pin];
      });

      // Strip the @query from the input value
      const ta = textareaRef.current;
      if (ta) {
        const caret = ta.selectionStart;
        const detected = detectMention(value, caret);
        if (detected) {
          const newValue = value.slice(0, detected.atIndex) + value.slice(caret);
          setValue(newValue);
          // Restore caret to where the @ was
          setTimeout(() => {
            if (ta) {
              ta.focus();
              ta.setSelectionRange(detected.atIndex, detected.atIndex);
            }
          }, 0);
        }
      }
      setPickerOpen(false);
      setPickerQuery("");
    },
    [value, detectMention],
  );

  const removePin = useCallback((kind: string, id: string) => {
    setPinned((prev) => prev.filter((p) => !(p.kind === kind && p.id === id)));
  }, []);

  // ── Attachment upload ──
  const uploadAttachment = useCallback(async (file: File) => {
    const id = crypto.randomUUID();
    setPending((prev) => [...prev, { id, file, status: "uploading" }]);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/attachments", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setPending((prev) =>
          prev.map((p) =>
            p.id === id ? { ...p, status: "error", error: data.error || "Upload failed" } : p,
          ),
        );
        return;
      }
      setPending((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                status: "ready",
                attachment: {
                  id,
                  title: data.title,
                  content: data.content,
                  pageCount: data.pageCount,
                  size: data.size,
                },
              }
            : p,
        ),
      );
    } catch {
      setPending((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: "error", error: "Upload failed" } : p)),
      );
    }
  }, []);

  const addFiles = useCallback(
    (files: File[]) => {
      const pdfs = files.filter((f) => f.type === "application/pdf");
      pdfs.forEach(uploadAttachment);
    },
    [uploadAttachment],
  );

  useImperativeHandle(ref, () => ({ addFiles }), [addFiles]);

  const removePending = useCallback((id: string) => {
    setPending((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // ── Send ──
  const anyUploading = pending.some((p) => p.status === "uploading");

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    const ready = pending
      .filter((p) => p.status === "ready" && p.attachment)
      .map((p) => p.attachment!);
    if ((!trimmed && ready.length === 0 && pinned.length === 0) || disabled || anyUploading)
      return;
    onSend(trimmed, ready, pinned);
    setValue("");
    setPending([]);
    setPinned([]);
    setPickerOpen(false);
    setPickerQuery("");
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }, 0);
  }, [value, pending, pinned, disabled, anyUploading, onSend]);

  // ── Keyboard handling ──
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Picker navigation
      if (pickerOpen && itemRows.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setPickerHighlight((h) => Math.min(h + 1, itemRows.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setPickerHighlight((h) => Math.max(h - 1, 0));
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const row = itemRows[pickerHighlight];
          if (row) pinItem(row.item);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setPickerOpen(false);
          setPickerQuery("");
          return;
        }
      }
      // Normal send
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [pickerOpen, itemRows, pickerHighlight, pinItem, handleSend],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setValue(newValue);
      const caret = e.target.selectionStart;
      const detected = detectMention(newValue, caret);
      if (detected) {
        setPickerOpen(true);
        setPickerQuery(detected.query);
      } else {
        setPickerOpen(false);
        setPickerQuery("");
      }
    },
    [detectMention],
  );

  // Close picker when clicking outside
  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        textareaRef.current &&
        !textareaRef.current.contains(target)
      ) {
        setPickerOpen(false);
        setPickerQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [pickerOpen]);

  const canSend =
    (value.trim().length > 0 ||
      pending.some((p) => p.status === "ready") ||
      pinned.length > 0) &&
    !disabled &&
    !anyUploading;
  const displayPlaceholder = disabled
    ? "DocuMind is thinking..."
    : placeholder || "Ask DocuMind anything... (type @ to mention)";

  // Track running item index for highlight matching
  let itemIndex = -1;

  return (
    <div className="relative">
      {/* Picker popover */}
      {pickerOpen && (
        <div
          ref={popoverRef}
          className="absolute bottom-full left-0 right-0 mb-2 bg-white border border-slate-200 rounded-xl shadow-lg max-h-[360px] overflow-y-auto z-30"
        >
          {!pickerData ? (
            <div className="flex items-center gap-2 px-4 py-3 text-[12px] text-slate-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading...
            </div>
          ) : pickerRows.length === 0 ? (
            <div className="px-4 py-3 text-[12px] text-slate-400">
              No matches{pickerQuery ? ` for "${pickerQuery}"` : ""}.
            </div>
          ) : (
            pickerRows.map((row, ri) => {
              if (row.type === "header") {
                return (
                  <div
                    key={`h-${ri}`}
                    className="px-3 py-1.5 font-['JetBrains_Mono'] text-[9px] font-semibold uppercase tracking-wider text-slate-400 bg-slate-50/50 border-b border-slate-100 sticky top-0"
                  >
                    {row.label}
                  </div>
                );
              }
              itemIndex++;
              const isActive = itemIndex === pickerHighlight;
              const item = row.item;
              if (item.kind === "document") {
                return (
                  <button
                    key={`d-${item.id}`}
                    type="button"
                    onClick={() => pinItem(item)}
                    onMouseEnter={() => setPickerHighlight(itemIndex)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left border-none cursor-pointer transition-colors ${
                      isActive ? "bg-slate-100" : "bg-transparent hover:bg-slate-50"
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span
                      className="flex-1 text-[13px] text-slate-700 truncate"
                      dir="auto"
                    >
                      {item.title}
                    </span>
                    <span className="font-['JetBrains_Mono'] text-[9px] uppercase tracking-wider text-slate-400 shrink-0">
                      {item.type}
                    </span>
                  </button>
                );
              }
              const Icon = ENTITY_ICON[item.type] || Sparkles;
              return (
                <button
                  key={`e-${item.id}`}
                  type="button"
                  onClick={() => pinItem(item)}
                  onMouseEnter={() => setPickerHighlight(itemIndex)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left border-none cursor-pointer transition-colors ${
                    isActive ? "bg-slate-100" : "bg-transparent hover:bg-slate-50"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span
                    className="flex-1 text-[13px] text-slate-700 truncate"
                    dir="auto"
                  >
                    {item.name}
                    {item.name_en && item.name_en !== item.name && (
                      <span className="text-slate-400 ml-1.5 text-[12px]">
                        / {item.name_en}
                      </span>
                    )}
                  </span>
                  {item.doc_count > 0 && (
                    <span className="font-['JetBrains_Mono'] text-[9px] text-slate-400 shrink-0">
                      {item.doc_count} doc{item.doc_count > 1 ? "s" : ""}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm focus-within:border-slate-300 focus-within:shadow-md transition-shadow">
        {/* Pinned chips + attachment chips (above input row) */}
        {(pinned.length > 0 || pending.length > 0) && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            {pinned.map((p) => {
              const Icon =
                p.kind === "document"
                  ? FileText
                  : ENTITY_ICON[p.type || ""] || Sparkles;
              return (
                <div
                  key={`pin-${p.kind}-${p.id}`}
                  className="flex items-center gap-1.5 text-[12px] rounded-lg pl-2 pr-1 py-1 border bg-blue-50 border-blue-200 text-blue-700"
                  title={p.label}
                >
                  <Icon className="w-3 h-3" />
                  <span className="max-w-[180px] truncate" dir="auto">
                    {p.label}
                  </span>
                  {p.doc_count != null && p.doc_count > 0 && (
                    <span className="font-['JetBrains_Mono'] text-[9px] text-blue-500">
                      {p.doc_count}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removePin(p.kind, p.id)}
                    className="p-0.5 rounded hover:bg-white/60 text-blue-500 hover:text-blue-700 cursor-pointer bg-transparent border-none"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
            {pending.map((p) => (
              <div
                key={p.id}
                className={`flex items-center gap-2 text-[12px] rounded-lg pl-2 pr-1 py-1 border ${
                  p.status === "error"
                    ? "bg-red-50 border-red-200 text-red-700"
                    : "bg-slate-50 border-slate-200 text-slate-700"
                }`}
                title={p.error || p.file.name}
              >
                {p.status === "uploading" ? (
                  <Loader2 className="w-3 h-3 animate-spin text-slate-400" />
                ) : p.status === "error" ? (
                  <AlertCircle className="w-3 h-3 text-red-500" />
                ) : (
                  <FileText className="w-3 h-3 text-slate-400" />
                )}
                <span className="max-w-[180px] truncate" dir="auto">
                  {p.file.name}
                </span>
                {p.status === "ready" && p.attachment && (
                  <span className="font-['JetBrains_Mono'] text-[10px] text-slate-400">
                    {p.attachment.pageCount}p
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removePending(p.id)}
                  className="p-0.5 rounded hover:bg-white/80 text-slate-400 hover:text-slate-700 cursor-pointer bg-transparent border-none"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input row */}
        <div className="flex items-end gap-2 px-3 py-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer bg-transparent border-none transition-colors disabled:opacity-50"
            title="Attach PDF"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(Array.from(e.target.files || []));
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
          />

          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={displayPlaceholder}
            disabled={disabled}
            rows={1}
            dir="auto"
            className="flex-1 resize-none border-none outline-none bg-transparent text-sm text-slate-800 placeholder:text-slate-400 font-['IBM_Plex_Sans_Arabic'] leading-6 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors border-none cursor-pointer ${
              canSend
                ? "bg-slate-900 text-white hover:bg-slate-800"
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
});
