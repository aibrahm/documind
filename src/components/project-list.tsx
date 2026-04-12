"use client";

import { useRouter } from "next/navigation";
import {
  FolderKanban,
  FileText,
  ArrowRight,
  Plus,
} from "lucide-react";

interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  kind: string | null;
  stage: string | null;
  color: string | null;
  icon: string | null;
  documentCount: number;
  updated_at: string;
}

export function ProjectList({ projects }: { projects: Project[] }) {
  const router = useRouter();

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1
            className="text-xl font-semibold"
            style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}
          >
            Projects
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>
            {projects.length} active project{projects.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            /* TODO: open create project dialog */
          }}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium cursor-pointer"
          style={{
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: "var(--radius-md)",
          }}
        >
          <Plus className="h-4 w-4" />
          New Project
        </button>
      </div>

      {projects.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-16"
          style={{
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
          }}
        >
          <FolderKanban
            className="h-10 w-10 mb-3"
            style={{ color: "var(--ink-ghost)" }}
            strokeWidth={1.25}
          />
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            No projects yet. Create one to organize your documents.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => router.push(`/projects/${p.slug}`)}
              className="group flex flex-col gap-3 p-4 text-left cursor-pointer transition-all"
              style={{
                background: "var(--surface-raised)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--accent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="flex h-8 w-8 items-center justify-center shrink-0"
                    style={{
                      background: p.color
                        ? `color-mix(in srgb, ${p.color} 15%, transparent)`
                        : "var(--surface-sunken)",
                      borderRadius: "var(--radius-md)",
                      color: p.color ?? "var(--ink-muted)",
                      fontSize: "0.875rem",
                    }}
                  >
                    {p.icon ?? "📁"}
                  </div>
                  <div>
                    <div
                      className="text-sm font-semibold"
                      style={{ color: "var(--ink)" }}
                    >
                      {p.name}
                    </div>
                    {p.kind && (
                      <span
                        className="text-xs"
                        style={{ color: "var(--ink-faint)" }}
                      >
                        {p.kind}
                        {p.stage ? ` · ${p.stage}` : ""}
                      </span>
                    )}
                  </div>
                </div>
                <ArrowRight
                  className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  style={{ color: "var(--ink-ghost)" }}
                />
              </div>

              {p.description && (
                <p
                  className="text-xs line-clamp-2"
                  style={{ color: "var(--ink-muted)" }}
                >
                  {p.description}
                </p>
              )}

              <div className="flex items-center gap-3 mt-auto">
                <span
                  className="flex items-center gap-1 text-xs"
                  style={{ color: "var(--ink-faint)" }}
                >
                  <FileText className="h-3 w-3" />
                  {p.documentCount} doc{p.documentCount !== 1 ? "s" : ""}
                </span>
                <span
                  className="text-xs px-1.5 py-0.5"
                  style={{
                    color:
                      p.status === "active"
                        ? "var(--success)"
                        : "var(--ink-faint)",
                    background:
                      p.status === "active"
                        ? "var(--success-bg)"
                        : "var(--surface-sunken)",
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  {p.status}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
