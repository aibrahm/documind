"use client";

import { Brain } from "lucide-react";

export function MemoryTab() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="max-w-md text-center space-y-3 px-6">
        <Brain className="w-10 h-10 text-slate-300 mx-auto" />
        <p className="text-lg font-semibold text-slate-700">Project memory</p>
        <p className="text-sm text-slate-400 leading-relaxed">
          Memories for this project will appear here once project-scoped chat
          lands in Phase 05. Today, memories are stored across all conversations,
          not scoped to individual projects.
        </p>
      </div>
    </div>
  );
}
