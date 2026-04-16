"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FolderKanban, FileText, ArrowUpRight, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { CreateProjectDialog } from "@/components/create-project-dialog";

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
  const [createOpen, setCreateOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (e: React.MouseEvent, projectId: string, name: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Delete "${name}"? Linked documents stay in the library, but the project itself is gone.`)) return;
    setDeletingId(projectId);
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`${res.status}`);
      router.refresh();
    } catch (err) {
      window.alert(`Failed to delete: ${(err as Error).message}`);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="PROJECTS"
        title={
          <>
            {projects.length}{" "}
            <span style={{ color: "var(--ink-muted)", fontWeight: 400 }}>
              active
            </span>
          </>
        }
        rightExtra={
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
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
        }
      />

      <CreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(slug) => {
          setCreateOpen(false);
          router.push(`/projects/${slug}`);
        }}
      />
      <div>

      {projects.length === 0 ? (
        <div
          className="p-16 text-center"
          style={{
            background: "var(--surface-raised)",
            borderTop: "1px solid var(--border)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <FolderKanban
            className="h-10 w-10 mx-auto mb-3"
            style={{ color: "var(--ink-ghost)" }}
            strokeWidth={1.25}
          />
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            Nothing here yet.
          </p>
        </div>
      ) : (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            borderBottom: "1px solid var(--border)",
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
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => handleDelete(e, p.id, p.name)}
                      disabled={deletingId === p.id}
                      className="p-1.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      style={{
                        color: "var(--ink-muted)",
                        background: "transparent",
                        border: "none",
                        borderRadius: "var(--radius-sm)",
                      }}
                      aria-label="Delete project"
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = "var(--danger)";
                        e.currentTarget.style.background = "var(--danger-bg)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = "var(--ink-muted)";
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                    <ArrowUpRight
                      className="h-4 w-4 opacity-0 group-hover:opacity-60 transition-opacity"
                      style={{ color: "var(--ink)" }}
                      strokeWidth={1.5}
                    />
                  </div>
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
    </>
  );
}
