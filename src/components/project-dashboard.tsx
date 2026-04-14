"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Network, Calendar, Target } from "lucide-react";
import type { Database } from "@/lib/database.types";

type Project = Database["public"]["Tables"]["projects"]["Row"];

interface Props {
  project: Project;
  counts: {
    documents: number;
    entities: number;
    threads: number;
  };
}

interface LinkedDoc {
  id: string;
  title: string;
  type: string;
  created_at: string | null;
}

interface LinkedEntity {
  id: string;
  name: string;
  name_en: string | null;
  type: string;
  role: string | null;
}

export function ProjectDashboard({ project, counts }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<"documents" | "entities">("documents");
  const [docs, setDocs] = useState<LinkedDoc[]>([]);
  const [entities, setEntities] = useState<LinkedEntity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [docsRes, entRes] = await Promise.all([
          fetch(`/api/projects/${project.id}/documents`).then((r) => r.json()),
          fetch(`/api/projects/${project.id}/entities`).then((r) => r.json()),
        ]);
        if (Array.isArray(docsRes)) setDocs(docsRes);
        if (Array.isArray(entRes)) setEntities(entRes);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [project.id]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <h1
          className="text-xl font-semibold"
          style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}
        >
          {project.name}
        </h1>
        {project.description && (
          <p
            className="mt-1 text-sm max-w-2xl"
            style={{ color: "var(--ink-muted)" }}
          >
            {project.description}
          </p>
        )}
        <div className="mt-3 flex items-center gap-3 text-xs">
          {project.kind && (
            <span
              className="px-1.5 py-0.5"
              style={{
                background: "var(--surface-sunken)",
                color: "var(--ink-muted)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              {project.kind}
            </span>
          )}
          {project.stage && (
            <span
              className="flex items-center gap-1"
              style={{ color: "var(--ink-faint)" }}
            >
              <Target className="h-3 w-3" />
              {project.stage}
            </span>
          )}
          {project.target_close && (
            <span
              className="flex items-center gap-1"
              style={{ color: "var(--ink-faint)" }}
            >
              <Calendar className="h-3 w-3" />
              {new Date(project.target_close).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      {project.context_summary && (
        <div
          className="mb-6 p-4 text-sm"
          style={{
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            color: "var(--ink)",
            lineHeight: 1.6,
          }}
        >
          {project.context_summary}
        </div>
      )}

      <div
        className="mb-4 flex items-center gap-1 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <TabButton
          active={tab === "documents"}
          onClick={() => setTab("documents")}
          icon={FileText}
          label="Documents"
          count={counts.documents}
        />
        <TabButton
          active={tab === "entities"}
          onClick={() => setTab("entities")}
          icon={Network}
          label="Entities"
          count={counts.entities}
        />
      </div>

      <div
        style={{
          background: "var(--surface-raised)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          overflow: "hidden",
        }}
      >
        {loading ? (
          <div
            className="p-8 text-center text-sm"
            style={{ color: "var(--ink-muted)" }}
          >
            Loading...
          </div>
        ) : tab === "documents" ? (
          docs.length === 0 ? (
            <div
              className="p-8 text-center text-sm"
              style={{ color: "var(--ink-muted)" }}
            >
              No documents linked to this project yet.
            </div>
          ) : (
            docs.map((doc, i) => (
              <button
                key={doc.id}
                type="button"
                onClick={() => router.push(`/documents/${doc.id}`)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left cursor-pointer transition-colors"
                style={{
                  background: "transparent",
                  border: "none",
                  borderBottom:
                    i < docs.length - 1
                      ? "1px solid var(--border-light)"
                      : "none",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--surface-sunken)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <FileText
                  className="h-4 w-4 shrink-0"
                  style={{ color: "var(--ink-ghost)" }}
                  strokeWidth={1.5}
                />
                <span
                  className="flex-1 truncate text-sm"
                  style={{ color: "var(--ink)" }}
                >
                  {doc.title}
                </span>
                <span
                  className="text-xs px-1.5 py-0.5 shrink-0"
                  style={{
                    color: "var(--ink-faint)",
                    background: "var(--surface-sunken)",
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  {doc.type}
                </span>
              </button>
            ))
          )
        ) : entities.length === 0 ? (
          <div
            className="p-8 text-center text-sm"
            style={{ color: "var(--ink-muted)" }}
          >
            No entities extracted for this project yet.
          </div>
        ) : (
          entities.map((ent, i) => (
            <div
              key={ent.id}
              className="flex items-center gap-3 px-4 py-3 text-sm"
              style={{
                borderBottom:
                  i < entities.length - 1
                    ? "1px solid var(--border-light)"
                    : "none",
              }}
            >
              <Network
                className="h-4 w-4 shrink-0"
                style={{ color: "var(--ink-ghost)" }}
                strokeWidth={1.5}
              />
              <span
                className="flex-1 truncate font-medium"
                style={{ color: "var(--ink)" }}
              >
                {ent.name}
                {ent.name_en && (
                  <span
                    className="ml-2 text-xs font-normal"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    {ent.name_en}
                  </span>
                )}
              </span>
              {ent.role && (
                <span
                  className="text-xs px-1.5 py-0.5"
                  style={{
                    color: "var(--accent)",
                    background: "var(--accent-bg)",
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  {ent.role}
                </span>
              )}
              <span
                className="text-xs shrink-0"
                style={{ color: "var(--ink-faint)" }}
              >
                {ent.type}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex items-center gap-2 px-3 py-2 text-sm cursor-pointer border-0 bg-transparent"
      style={{
        color: active ? "var(--ink)" : "var(--ink-muted)",
        fontWeight: active ? 600 : 500,
      }}
    >
      <Icon className="h-4 w-4" strokeWidth={1.5} />
      {label}
      <span
        className="ml-0.5 px-1.5 py-0.5 text-xs tabular-nums"
        style={{
          color: "var(--ink-faint)",
          background: "var(--surface-sunken)",
          borderRadius: "var(--radius-sm)",
        }}
      >
        {count}
      </span>
      {active && (
        <span
          aria-hidden
          className="absolute inset-x-0 -bottom-px h-[2px]"
          style={{ background: "var(--accent)" }}
        />
      )}
    </button>
  );
}
