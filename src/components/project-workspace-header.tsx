"use client";

import type { Database } from "@/lib/database.types";
import { Tag } from "@/components/ui-system";
import { FileText, Building2, Handshake, MessageSquare } from "lucide-react";

type Project = Database["public"]["Tables"]["projects"]["Row"];

export interface Counterparty {
  id: string;
  name: string;
  name_en: string | null;
  role: string;
}

interface ProjectWorkspaceHeaderProps {
  project: Project;
  counterparties: Counterparty[];
  counts: {
    documents: number;
    companies: number;
    negotiations: number;
    conversations: number;
  };
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-50 text-green-700",
  on_hold: "bg-amber-50 text-amber-700",
  closed: "bg-blue-50 text-blue-700",
  archived: "bg-slate-100 text-slate-500",
};

export function ProjectWorkspaceHeader({
  project,
  counterparties,
  counts,
}: ProjectWorkspaceHeaderProps) {
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

          {/* Counterparty pills */}
          {counterparties.length > 0 && (
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {counterparties.map((c) => (
                <Tag key={c.id + c.role} variant="blue">
                  {c.name_en || c.name} · {c.role}
                </Tag>
              ))}
            </div>
          )}

          {/* Counts strip */}
          <div className="flex items-center gap-6 mt-4 text-[11px] text-slate-500 font-['JetBrains_Mono']">
            <CountItem icon={FileText} label="DOCUMENTS" value={counts.documents} />
            <CountItem icon={Building2} label="COMPANIES" value={counts.companies} />
            <CountItem icon={Handshake} label="NEGOTIATIONS" value={counts.negotiations} />
            <CountItem icon={MessageSquare} label="CONVERSATIONS" value={counts.conversations} />
          </div>
        </div>
      </div>
    </div>
  );
}

function CountItem({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="w-3.5 h-3.5 text-slate-400" />
      <span className="font-semibold text-slate-700">{value}</span>
      <span className="text-slate-400 tracking-wider">{label}</span>
    </div>
  );
}
