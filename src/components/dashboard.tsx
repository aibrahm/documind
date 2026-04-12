"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  FolderKanban,
  Network,
  Upload,
  ArrowRight,
  Clock,
} from "lucide-react";

interface Stats {
  documents: number;
  projects: number;
  entities: number;
  recentDocs: Array<{
    id: string;
    title: string;
    type: string;
    status: string;
    created_at: string;
  }>;
}

export function Dashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [docsRes, projRes, entRes, recentRes] = await Promise.all([
          fetch("/api/documents?limit=1").then((r) => r.json()),
          fetch("/api/projects").then((r) => r.json()),
          fetch("/api/entities?limit=1").then((r) => r.json()),
          fetch("/api/documents?limit=8").then((r) => r.json()),
        ]);
        setStats({
          documents:
            Array.isArray(docsRes) ? docsRes.length : docsRes?.total ?? 0,
          projects: Array.isArray(projRes) ? projRes.length : 0,
          entities: Array.isArray(entRes) ? entRes.length : 0,
          recentDocs: Array.isArray(recentRes)
            ? recentRes.slice(0, 8)
            : [],
        });
      } catch {
        setStats({
          documents: 0,
          projects: 0,
          entities: 0,
          recentDocs: [],
        });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const kpis = [
    {
      label: "Documents",
      value: stats?.documents ?? "—",
      icon: FileText,
      href: "/documents",
      color: "var(--accent)",
    },
    {
      label: "Projects",
      value: stats?.projects ?? "—",
      icon: FolderKanban,
      href: "/projects",
      color: "var(--success)",
    },
    {
      label: "Entities",
      value: stats?.entities ?? "—",
      icon: Network,
      href: "/entities",
      color: "var(--warning)",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1
            className="text-2xl font-semibold"
            style={{ color: "var(--ink)", letterSpacing: "-0.02em" }}
          >
            DocuMind
          </h1>
          <p
            className="mt-1 text-sm"
            style={{ color: "var(--ink-muted)" }}
          >
            Document intelligence library
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push("/upload")}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium cursor-pointer transition-colors"
          style={{
            background: "var(--accent)",
            color: "#fff",
            borderRadius: "var(--radius-md)",
            border: "none",
          }}
        >
          <Upload className="h-4 w-4" />
          Upload Document
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <button
              key={kpi.label}
              type="button"
              onClick={() => router.push(kpi.href)}
              className="group flex items-center gap-4 p-4 cursor-pointer text-left transition-all"
              style={{
                background: "var(--surface-raised)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--border-strong)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              <div
                className="flex h-10 w-10 items-center justify-center shrink-0"
                style={{
                  background: `color-mix(in srgb, ${kpi.color} 10%, transparent)`,
                  borderRadius: "var(--radius-md)",
                }}
              >
                <Icon
                  className="h-5 w-5"
                  style={{ color: kpi.color }}
                  strokeWidth={1.75}
                />
              </div>
              <div>
                <div
                  className="text-2xl font-semibold tabular-nums"
                  style={{ color: "var(--ink)", lineHeight: 1.2 }}
                >
                  {loading ? (
                    <span
                      className="inline-block h-7 w-12 animate-pulse"
                      style={{
                        background: "var(--surface-sunken)",
                        borderRadius: "var(--radius-sm)",
                      }}
                    />
                  ) : (
                    kpi.value
                  )}
                </div>
                <div
                  className="text-xs font-medium"
                  style={{ color: "var(--ink-muted)" }}
                >
                  {kpi.label}
                </div>
              </div>
              <ArrowRight
                className="ml-auto h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: "var(--ink-ghost)" }}
              />
            </button>
          );
        })}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <button
          type="button"
          onClick={() => router.push("/upload")}
          className="flex items-center gap-3 p-4 cursor-pointer text-left transition-all"
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
          <Upload
            className="h-5 w-5"
            style={{ color: "var(--accent)" }}
            strokeWidth={1.75}
          />
          <div>
            <div
              className="text-sm font-medium"
              style={{ color: "var(--ink)" }}
            >
              Upload & Process
            </div>
            <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
              Add documents to the intelligence library
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => router.push("/projects")}
          className="flex items-center gap-3 p-4 cursor-pointer text-left transition-all"
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
          <FolderKanban
            className="h-5 w-5"
            style={{ color: "var(--success)" }}
            strokeWidth={1.75}
          />
          <div>
            <div
              className="text-sm font-medium"
              style={{ color: "var(--ink)" }}
            >
              Manage Projects
            </div>
            <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
              Organize documents by deal, initiative, or matter
            </div>
          </div>
        </button>
      </div>

      {/* Recent Documents */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2
            className="text-sm font-semibold"
            style={{ color: "var(--ink)" }}
          >
            Recent Documents
          </h2>
          <button
            type="button"
            onClick={() => router.push("/documents")}
            className="text-xs font-medium cursor-pointer border-0 bg-transparent"
            style={{ color: "var(--accent)" }}
          >
            View all
          </button>
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
            <div className="p-8 text-center">
              <div
                className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent"
                style={{ color: "var(--ink-ghost)" }}
              />
            </div>
          ) : stats?.recentDocs && stats.recentDocs.length > 0 ? (
            <div>
              {stats.recentDocs.map((doc, i) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => router.push(`/documents/${doc.id}`)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left cursor-pointer transition-colors"
                  style={{
                    borderBottom:
                      i < stats.recentDocs.length - 1
                        ? "1px solid var(--border-light)"
                        : "none",
                    background: "transparent",
                    border: "none",
                    borderBottomWidth: i < stats.recentDocs.length - 1 ? 1 : 0,
                    borderBottomStyle: "solid",
                    borderBottomColor: "var(--border-light)",
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
                    className="shrink-0 text-xs px-1.5 py-0.5"
                    style={{
                      color: "var(--ink-faint)",
                      background: "var(--surface-sunken)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  >
                    {doc.type}
                  </span>
                  <span className="flex items-center gap-1 text-xs shrink-0" style={{ color: "var(--ink-ghost)" }}>
                    <Clock className="h-3 w-3" />
                    {new Date(doc.created_at).toLocaleDateString()}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center">
              <p
                className="text-sm"
                style={{ color: "var(--ink-muted)" }}
              >
                No documents yet. Upload your first document to get started.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
