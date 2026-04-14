"use client";

import Link from "next/link";
import { FolderKanban, FileText, ArrowUpRight, Plus } from "lucide-react";

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
  return (
    <div className="mx-auto max-w-6xl px-8 py-12">
      {/* Header */}
      <div className="mb-10 flex items-end justify-between">
        <div>
          <div
            className="text-xs font-medium mb-2"
            style={{
              color: "var(--ink-faint)",
              letterSpacing: "0.04em",
            }}
          >
            PROJECTS
          </div>
          <h1
            className="text-4xl font-semibold tracking-tight"
            style={{ color: "var(--ink)", letterSpacing: "-0.02em" }}
          >
            {projects.length}{" "}
            <span
              className="text-2xl font-normal"
              style={{ color: "var(--ink-muted)" }}
            >
              active
            </span>
          </h1>
        </div>
        <button
          type="button"
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium cursor-pointer transition-colors"
          style={{
            background: "var(--ink)",
            color: "var(--surface-raised)",
            border: "none",
            borderRadius: "var(--radius-md)",
          }}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          New project
        </button>
      </div>

      {projects.length === 0 ? (
        <div
          className="p-16 text-center"
          style={{
            background: "var(--surface-raised)",
            border: "1px dashed var(--border)",
            borderRadius: "var(--radius-xl)",
          }}
        >
          <FolderKanban
            className="h-10 w-10 mx-auto mb-3"
            style={{ color: "var(--ink-ghost)" }}
            strokeWidth={1.25}
          />
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            No projects yet. Create one to organize your documents.
          </p>
        </div>
      ) : (
        <div
          className="overflow-hidden"
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-xl)",
            background: "var(--border)",
          }}
        >
          <div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
            style={{ gap: "1px", background: "var(--border)" }}
          >
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.slug}`}
                className="group p-6 flex flex-col gap-4 transition-colors min-h-[180px]"
                style={{ background: "var(--surface-raised)" }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="flex h-9 w-9 items-center justify-center shrink-0 text-sm"
                      style={{
                        background: p.color
                          ? `color-mix(in srgb, ${p.color} 12%, transparent)`
                          : "var(--surface-sunken)",
                        borderRadius: "var(--radius-md)",
                        color: p.color ?? "var(--ink-muted)",
                      }}
                    >
                      {p.icon ?? "📁"}
                    </div>
                    <div>
                      <div
                        className="text-sm font-semibold leading-tight"
                        style={{ color: "var(--ink)" }}
                      >
                        {p.name}
                      </div>
                      {p.kind && (
                        <div
                          className="text-xs mt-0.5"
                          style={{ color: "var(--ink-faint)" }}
                        >
                          {p.kind}
                          {p.stage ? ` · ${p.stage}` : ""}
                        </div>
                      )}
                    </div>
                  </div>
                  <ArrowUpRight
                    className="h-4 w-4 opacity-0 group-hover:opacity-60 transition-opacity shrink-0"
                    style={{ color: "var(--ink)" }}
                    strokeWidth={1.5}
                  />
                </div>

                {p.description && (
                  <p
                    className="text-xs line-clamp-2"
                    style={{ color: "var(--ink-muted)", lineHeight: 1.55 }}
                  >
                    {p.description}
                  </p>
                )}

                <div className="flex items-center gap-3 mt-auto">
                  <span
                    className="flex items-center gap-1 text-xs"
                    style={{ color: "var(--ink-faint)" }}
                  >
                    <FileText className="h-3 w-3" strokeWidth={1.5} />
                    {p.documentCount} doc{p.documentCount !== 1 ? "s" : ""}
                  </span>
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{
                      background:
                        p.status === "active"
                          ? "var(--success)"
                          : "var(--ink-ghost)",
                    }}
                  />
                  <span
                    className="text-xs"
                    style={{ color: "var(--ink-faint)" }}
                  >
                    {p.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
