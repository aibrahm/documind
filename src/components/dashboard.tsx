"use client";

import Link from "next/link";
import {
  FileText,
  FolderKanban,
  Network,
  Upload,
  ArrowUpRight,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";

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
  const totalDocs = counts.documents;
  return (
    <>
      <PageHeader
        eyebrow="OVERVIEW"
        title={
          <>
            {totalDocs}{" "}
            <span style={{ color: "var(--ink-muted)", fontWeight: 400 }}>
              indexed
            </span>
          </>
        }
      />
      <div>
      {/* The grid — outer border + inner gridlines via gap:1px on a background */}
      <div
        style={{
          borderTop: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
          background: "var(--border)",
        }}
      >
        {/* Row 1: 3 stat cells, divided by gridlines */}
        <div
          className="grid grid-cols-3"
          style={{ gap: "1px", background: "var(--border)" }}
        >
          <StatCell
            href="/documents"
            label="Documents"
            value={counts.documents}
            icon={FileText}
          />
          <StatCell
            href="/projects"
            label="Projects"
            value={counts.projects}
            icon={FolderKanban}
          />
          <StatCell
            href="/entities"
            label="Entities"
            value={counts.entities}
            icon={Network}
          />
        </div>

        {/* Row 2: recent documents + quick links, asymmetric 2-col */}
        <div
          className="grid grid-cols-5"
          style={{
            gap: "1px",
            background: "var(--border)",
            marginTop: "1px",
          }}
        >
          {/* Recent documents — spans 3 */}
          <div
            className="col-span-3 p-6"
            style={{ background: "var(--surface-raised)" }}
          >
            <div className="flex items-center justify-between mb-4">
              <div
                className="text-xs font-medium"
                style={{
                  color: "var(--ink-faint)",
                  letterSpacing: "0.04em",
                }}
              >
                RECENTLY ADDED
              </div>
              <Link
                href="/documents"
                className="text-xs font-medium flex items-center gap-1"
                style={{ color: "var(--ink-muted)" }}
              >
                All documents
                <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
              </Link>
            </div>
            {recentDocs.length === 0 ? (
              <div
                className="py-8 text-sm text-center"
                style={{ color: "var(--ink-muted)" }}
              >
                Nothing here yet.
              </div>
            ) : (
              <div className="space-y-0">
                {recentDocs.slice(0, 5).map((doc, i, arr) => (
                  <Link
                    key={doc.id}
                    href={`/documents/${doc.id}`}
                    className="flex items-center gap-3 py-2.5 transition-colors group"
                    style={{
                      borderBottom:
                        i < arr.length - 1
                          ? "1px solid var(--border-light)"
                          : "none",
                    }}
                  >
                    <FileText
                      className="h-3.5 w-3.5 shrink-0"
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
                      className="shrink-0 text-xs"
                      style={{ color: "var(--ink-faint)" }}
                    >
                      {doc.type}
                    </span>
                    {doc.created_at && (
                      <span
                        className="shrink-0 text-xs tabular-nums w-14 text-right"
                        style={{ color: "var(--ink-ghost)" }}
                        suppressHydrationWarning
                      >
                        {new Date(doc.created_at).toLocaleDateString(
                          "en-US",
                          { month: "short", day: "numeric" },
                        )}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Upload — spans 2, dark tile */}
          <Link
            href="/upload"
            className="col-span-2 p-6 flex flex-col justify-between group transition-colors"
            style={{
              background: "var(--ink)",
              color: "var(--surface-raised)",
            }}
          >
            <div className="flex items-start justify-between">
              <Upload className="h-6 w-6" strokeWidth={1.5} />
              <ArrowUpRight
                className="h-5 w-5 opacity-40 group-hover:opacity-100 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                strokeWidth={1.5}
              />
            </div>
            <div>
              <div
                className="text-xs font-medium opacity-60 mb-2"
                style={{ letterSpacing: "0.04em" }}
              >
                QUICK ACTION
              </div>
              <div
                className="text-xl font-semibold tracking-tight mb-1"
                style={{ letterSpacing: "-0.015em" }}
              >
                Upload a document
              </div>
              <div className="text-sm opacity-60">
                OCR, chunking, entity extraction — all automatic
              </div>
            </div>
          </Link>
        </div>
      </div>

      {/* Secondary grid — status / info */}
      <div
        className="grid grid-cols-2"
        style={{
          gap: "1px",
          background: "var(--border)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <InfoCell label="MCP server" value="Connected" status="ok" />
        <InfoCell
          label="Knowledge graph"
          value="Auto-extracting"
          status="ok"
        />
      </div>
      </div>
    </>
  );
}

function StatCell({
  href,
  label,
  value,
  icon: Icon,
}: {
  href: string;
  label: string;
  value: number;
  icon: React.ComponentType<{
    className?: string;
    strokeWidth?: number;
    style?: React.CSSProperties;
  }>;
}) {
  return (
    <Link
      href={href}
      className="group p-6 flex flex-col justify-between min-h-[160px] transition-colors"
      style={{
        background: "var(--surface-raised)",
      }}
    >
      <div className="flex items-start justify-between">
        <div
          className="text-xs font-medium"
          style={{ color: "var(--ink-faint)", letterSpacing: "0.04em" }}
        >
          {label.toUpperCase()}
        </div>
        <Icon
          className="h-4 w-4"
          style={{ color: "var(--ink-ghost)" }}
          strokeWidth={1.5}
        />
      </div>
      <div>
        <div
          className="text-5xl font-semibold tabular-nums tracking-tight leading-none"
          style={{ color: "var(--ink)", letterSpacing: "-0.03em" }}
        >
          {value}
        </div>
        <div
          className="mt-3 text-xs font-medium flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: "var(--ink-muted)" }}
        >
          View all
          <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
        </div>
      </div>
    </Link>
  );
}

function InfoCell({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status: "ok" | "warn" | "error";
}) {
  const dotColor =
    status === "ok"
      ? "var(--success)"
      : status === "warn"
        ? "var(--warning)"
        : "var(--danger)";
  return (
    <div
      className="p-5 flex items-center justify-between"
      style={{ background: "var(--surface-raised)" }}
    >
      <div>
        <div
          className="text-xs font-medium mb-1"
          style={{ color: "var(--ink-faint)", letterSpacing: "0.04em" }}
        >
          {label.toUpperCase()}
        </div>
        <div className="text-sm font-medium" style={{ color: "var(--ink)" }}>
          {value}
        </div>
      </div>
      <span
        className="h-2 w-2 rounded-full"
        style={{ background: dotColor }}
      />
    </div>
  );
}
