"use client";

import Link from "next/link";
import {
  FileText,
  FolderKanban,
  Network,
  Upload,
  ArrowUpRight,
} from "lucide-react";

interface Props {
  counts: {
    documents: number;
    projects: number;
    entities: number;
  };
  recentDocs: Array<{
    id: string;
    title: string;
    type: string;
    status: string;
    created_at: string | null;
  }>;
}

export function Dashboard({ counts, recentDocs }: Props) {
  return (
    <div className="mx-auto max-w-5xl px-8 py-12">
      {/* Header */}
      <div className="mb-10">
        <h1
          className="text-3xl font-semibold tracking-tight"
          style={{ color: "var(--ink)", letterSpacing: "-0.02em" }}
        >
          DocuMind
        </h1>
        <p className="mt-1.5 text-sm" style={{ color: "var(--ink-muted)" }}>
          Your document intelligence library
        </p>
      </div>

      {/* Bento grid */}
      <div className="grid grid-cols-6 gap-3 auto-rows-[140px]">
        {/* Big: Upload (hero action) */}
        <Link
          href="/upload"
          className="group col-span-6 md:col-span-3 row-span-2 p-6 flex flex-col justify-between transition-all"
          style={{
            background: "var(--ink)",
            color: "var(--surface-raised)",
            borderRadius: "var(--radius-xl)",
          }}
        >
          <div className="flex items-start justify-between">
            <Upload className="h-6 w-6" strokeWidth={1.5} />
            <ArrowUpRight
              className="h-5 w-5 opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all"
              strokeWidth={1.5}
            />
          </div>
          <div>
            <div className="text-2xl font-semibold tracking-tight mb-1" style={{ letterSpacing: "-0.02em" }}>
              Upload a document
            </div>
            <div className="text-sm opacity-60">
              OCR, chunking, entity extraction, and knowledge graph — all
              automatic
            </div>
          </div>
        </Link>

        {/* Documents stat */}
        <StatTile
          href="/documents"
          label="Documents"
          value={counts.documents}
          icon={FileText}
          span="col-span-3 md:col-span-3"
        />

        {/* Projects + Entities */}
        <StatTile
          href="/projects"
          label="Projects"
          value={counts.projects}
          icon={FolderKanban}
          span="col-span-3 md:col-span-3 md:row-start-2"
        />

        {/* Entities — full width below */}
        <Link
          href="/entities"
          className="group col-span-6 p-5 flex items-center justify-between transition-all"
          style={{
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-xl)",
          }}
        >
          <div className="flex items-center gap-4">
            <div
              className="flex h-10 w-10 items-center justify-center"
              style={{
                background: "var(--surface-sunken)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <Network
                className="h-5 w-5"
                style={{ color: "var(--ink-muted)" }}
                strokeWidth={1.5}
              />
            </div>
            <div>
              <div
                className="text-sm font-medium"
                style={{ color: "var(--ink)" }}
              >
                Entities
              </div>
              <div
                className="text-xs"
                style={{ color: "var(--ink-muted)" }}
              >
                People, organizations, and authorities across all documents
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span
              className="text-2xl font-semibold tabular-nums"
              style={{ color: "var(--ink)" }}
            >
              {counts.entities}
            </span>
            <ArrowUpRight
              className="h-4 w-4 opacity-0 group-hover:opacity-60 transition-opacity"
              style={{ color: "var(--ink)" }}
              strokeWidth={1.5}
            />
          </div>
        </Link>
      </div>

      {/* Recent documents */}
      <div className="mt-10">
        <div className="flex items-center justify-between mb-3">
          <h2
            className="text-sm font-medium"
            style={{ color: "var(--ink-muted)" }}
          >
            Recently added
          </h2>
          <Link
            href="/documents"
            className="text-xs font-medium flex items-center gap-1"
            style={{ color: "var(--accent)" }}
          >
            View all
            <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
          </Link>
        </div>

        {recentDocs.length === 0 ? (
          <div
            className="p-8 text-center text-sm"
            style={{
              color: "var(--ink-muted)",
              background: "var(--surface-raised)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
            }}
          >
            No documents yet. Upload your first one to get started.
          </div>
        ) : (
          <div
            style={{
              background: "var(--surface-raised)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              overflow: "hidden",
            }}
          >
            {recentDocs.map((doc, i) => (
              <Link
                key={doc.id}
                href={`/documents/${doc.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors group"
                style={{
                  borderBottom:
                    i < recentDocs.length - 1
                      ? "1px solid var(--border-light)"
                      : "none",
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
                {doc.created_at && (
                  <span
                    className="text-xs shrink-0 tabular-nums w-16 text-right"
                    style={{ color: "var(--ink-ghost)" }}
                  >
                    {new Date(doc.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatTile({
  href,
  label,
  value,
  icon: Icon,
  span,
}: {
  href: string;
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number; style?: React.CSSProperties }>;
  span: string;
}) {
  return (
    <Link
      href={href}
      className={`group ${span} p-5 flex flex-col justify-between transition-all`}
      style={{
        background: "var(--surface-raised)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-xl)",
      }}
    >
      <div className="flex items-start justify-between">
        <Icon
          className="h-5 w-5"
          style={{ color: "var(--ink-muted)" }}
          strokeWidth={1.5}
        />
        <ArrowUpRight
          className="h-4 w-4 opacity-0 group-hover:opacity-60 transition-opacity"
          style={{ color: "var(--ink)" }}
          strokeWidth={1.5}
        />
      </div>
      <div>
        <div
          className="text-3xl font-semibold tabular-nums leading-none"
          style={{ color: "var(--ink)", letterSpacing: "-0.02em" }}
        >
          {value}
        </div>
        <div
          className="mt-1 text-xs"
          style={{ color: "var(--ink-muted)" }}
        >
          {label}
        </div>
      </div>
    </Link>
  );
}
