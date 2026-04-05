"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ArrowUp } from "lucide-react";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, disabled, placeholder }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const lineHeight = 24;
    const maxHeight = lineHeight * 5;
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    // Reset height after clearing
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }, 0);
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const canSend = value.trim().length > 0 && !disabled;
  const displayPlaceholder = disabled
    ? "DocuMind is thinking..."
    : placeholder || "Ask DocuMind anything...";

  return (
    <div className="flex items-end gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm focus-within:border-slate-300 focus-within:shadow-md transition-shadow">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
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
            ? "bg-[#1E293B] text-white hover:bg-slate-700"
            : "bg-slate-200 text-slate-400 cursor-not-allowed"
        }`}
      >
        <ArrowUp className="w-4 h-4" />
      </button>
    </div>
  );
}
