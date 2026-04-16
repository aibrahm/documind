"use client";

import {
  BookOpen,
  Calendar,
  FileText,
  Network,
  Save,
  Share2,
  Target,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DocumentGraphView } from "@/components/graph/document-graph-view";
import { PageHeader } from "@/components/page-header";
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
  const [tab, setTab] = useState<
    "context" | "documents" | "entities" | "graph"
  >("context");
  const [docs, setDocs] = useState<LinkedDoc[]>([]);
  const [entities, setEntities] = useState<LinkedEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [contextDraft, setContextDraft] = useState(
    (project as { context_md?: string | null }).context_md ?? "",
  );
  const [contextSaving, setContextSaving] = useState(false);
  const [contextDirty, setContextDirty] = useState(false);

  const saveContext = useCallback(async () => {
    setContextSaving(true);
    try {
      await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context_md: contextDraft }),
      });
      setContextDirty(false);
    } finally {
      setContextSaving(false);
    }
  }, [project.id, contextDraft]);

  useEffect(() => {
    async function load() {
      try {
        const [docsRes, entRes] = await Promise.all([
          fetch(`/api/projects/${project.id}/documents`).then((r) => r.json()),
          fetch(`/api/projects/${project.id}/entities`).then((r) => r.json()),
        ]);
        // APIs return { documents: [...] } and { entities: [...] }
        const docsList = Array.isArray(docsRes)
          ? docsRes
          : (docsRes.documents ?? []);
        const entList = Array.isArray(entRes)
          ? entRes
          : (entRes.entities ?? []);
        setDocs(docsList);
        setEntities(entList);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [project.id]);

  const meta: Array<{ key: string; node: React.ReactNode }> = [];
  if (project.kind) meta.push({ key: "kind", node: project.kind });
  if (project.stage)
    meta.push({
      key: "stage",
      node: (
        <span className="flex items-center gap-1">
          <Target className="h-3 w-3" strokeWidth={1.5} />
          {project.stage}
        </span>
      ),
    });
  if (project.target_close)
    meta.push({
      key: "close",
      node: (
        <span className="flex items-center gap-1">
          <Calendar className="h-3 w-3" strokeWidth={1.5} />
          {new Date(project.target_close).toLocaleDateString()}
        </span>
      ),
    });

  return (
    <>
      <PageHeader
        eyebrow="PROJECT"
        title={project.name}
        rightExtra={
          meta.length > 0 ? (
            <div
              className="flex items-center gap-3 text-xs"
              style={{ color: "var(--ink-faint)" }}
            >
              {meta.map((m, i) => (
                <span key={m.key} className="flex items-center gap-3">
                  {i > 0 && (
                    <span
                      className="h-1 w-1 rounded-full"
                      style={{ background: "var(--ink-ghost)" }}
                    />
                  )}
                  {m.node}
                </span>
              ))}
            </div>
          ) : undefined
        }
      />

      {/* Tab strip — full-width gridline cells matching nav language */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: "repeat(4, auto) 1fr",
          gap: "1px",
          background: "var(--border)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <TabButton
          active={tab === "context"}
          onClick={() => setTab("context")}
          icon={BookOpen}
          label="Context"
        />
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
        <TabButton
          active={tab === "graph"}
          onClick={() => setTab("graph")}
          icon={Share2}
          label="Graph"
        />
        {/* Empty filler cell so the strip extends to the right edge */}
        <div style={{ background: "var(--surface-raised)" }} />
      </div>

      <div
        style={{
          background: "var(--surface-raised)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {tab === "graph" ? (
          // Graph fetches its own data and sizes itself. Min-height keeps
          // the canvas usable on a typical laptop without forcing a fixed
          // viewport-relative height that breaks on very short windows.
          <div className="min-h-[560px] h-[calc(100vh-260px)]">
            {/* key={project.id} forces a remount when navigating between
                projects so DocumentGraphView's state resets cleanly
                without needing a synchronous clear inside its effect. */}
            <DocumentGraphView key={project.id} projectId={project.id} />
          </div>
        ) : tab === "context" ? (
          <div className="p-0">
            <div
              className="flex items-center justify-between px-4 py-2"
              style={{ borderBottom: "1px solid var(--border-light)" }}
            >
              <div
                className="text-xs"
                style={{ color: "var(--ink-faint)", letterSpacing: "0.04em" }}
              >
                CONTEXT.MD
              </div>
              <button
                type="button"
                onClick={saveContext}
                disabled={!contextDirty || contextSaving}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium cursor-pointer transition-colors disabled:opacity-40"
                style={{
                  background: contextDirty
                    ? "var(--ink)"
                    : "var(--surface-sunken)",
                  color: contextDirty
                    ? "var(--surface-raised)"
                    : "var(--ink-muted)",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                }}
              >
                <Save className="h-3.5 w-3.5" strokeWidth={1.75} />
                {contextSaving ? "Saving..." : contextDirty ? "Save" : "Saved"}
              </button>
            </div>
            <textarea
              value={contextDraft}
              onChange={(e) => {
                setContextDraft(e.target.value);
                setContextDirty(true);
              }}
              placeholder={`## Current State\nWhat's happening with this project right now.\n\n## Timeline\n2026-04-14  First entry — what happened today`}
              className="w-full p-4 bg-transparent border-0 outline-none text-sm resize-none"
              style={{
                color: "var(--ink)",
                fontFamily: "var(--font-mono)",
                minHeight: "420px",
                lineHeight: 1.6,
              }}
              spellCheck={false}
            />
          </div>
        ) : loading ? (
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
    </>
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
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 px-5 py-3 text-sm cursor-pointer transition-colors whitespace-nowrap"
      style={{
        background: active ? "var(--ink)" : "var(--surface-raised)",
        color: active ? "var(--surface-raised)" : "var(--ink-muted)",
        border: "none",
        fontWeight: active ? 600 : 500,
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = "var(--surface-sunken)";
          e.currentTarget.style.color = "var(--ink)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = "var(--surface-raised)";
          e.currentTarget.style.color = "var(--ink-muted)";
        }
      }}
    >
      <Icon className="h-4 w-4" strokeWidth={1.5} />
      {label}
      {typeof count === "number" && (
        <span
          className="text-xs tabular-nums"
          style={{
            color: active
              ? "color-mix(in srgb, var(--surface-raised) 55%, transparent)"
              : "var(--ink-faint)",
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}
