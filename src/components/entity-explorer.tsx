"use client";

import { useState, useMemo } from "react";
import { Network, Search, FileText } from "lucide-react";

interface Entity {
  id: string;
  name: string;
  name_en: string | null;
  type: string;
  documentCount: number;
  created_at: string | null;
}

const TYPE_COLORS: Record<string, string> = {
  company: "var(--accent)",
  ministry: "var(--info)",
  authority: "var(--warning)",
  person: "var(--success)",
  project: "var(--danger)",
};

export function EntityExplorer({ entities }: { entities: Entity[] }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const types = useMemo(() => {
    const s = new Set(entities.map((e) => e.type));
    return Array.from(s).sort();
  }, [entities]);

  const filtered = useMemo(() => {
    let list = entities;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          (e.name_en && e.name_en.toLowerCase().includes(q)),
      );
    }
    if (typeFilter) {
      list = list.filter((e) => e.type === typeFilter);
    }
    return list;
  }, [entities, search, typeFilter]);

  return (
    <div className="mx-auto max-w-6xl px-8 py-12">
      {/* Header */}
      <div className="mb-10">
        <div
          className="text-xs font-medium mb-2"
          style={{ color: "var(--ink-faint)", letterSpacing: "0.04em" }}
        >
          ENTITIES
        </div>
        <h1
          className="text-4xl font-semibold tracking-tight"
          style={{ color: "var(--ink)", letterSpacing: "-0.02em" }}
        >
          {entities.length}{" "}
          <span
            className="text-2xl font-normal"
            style={{ color: "var(--ink-muted)" }}
          >
            extracted
          </span>
        </h1>
      </div>

      {/* Filters */}
      <div className="mb-4 flex items-center gap-3">
        <div
          className="flex items-center gap-2 flex-1 max-w-md px-3 py-2"
          style={{
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <Search
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: "var(--ink-ghost)" }}
            strokeWidth={1.5}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search entities..."
            className="flex-1 bg-transparent border-0 outline-none text-sm"
            style={{
              color: "var(--ink)",
              fontFamily: "var(--font-sans)",
            }}
          />
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <FilterChip
            active={!typeFilter}
            onClick={() => setTypeFilter(null)}
          >
            All
          </FilterChip>
          {types.map((t) => (
            <FilterChip
              key={t}
              active={typeFilter === t}
              onClick={() => setTypeFilter(typeFilter === t ? null : t)}
            >
              {t}
            </FilterChip>
          ))}
        </div>
      </div>

      {/* Entity grid with visible gridlines */}
      {filtered.length === 0 ? (
        <div
          className="p-16 text-center"
          style={{
            background: "var(--surface-raised)",
            border: "1px dashed var(--border)",
            borderRadius: "var(--radius-xl)",
          }}
        >
          <Network
            className="mx-auto h-10 w-10 mb-3"
            style={{ color: "var(--ink-ghost)" }}
            strokeWidth={1.25}
          />
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            {search || typeFilter
              ? "No entities match your filters."
              : "No entities extracted yet."}
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
          {/* Header row */}
          <div
            className="grid grid-cols-[1fr_180px_100px_80px]"
            style={{
              background: "var(--surface-sunken)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <HeaderCell label="Name" />
            <HeaderCell label="English" />
            <HeaderCell label="Type" />
            <HeaderCell label="Docs" align="right" />
          </div>

          {/* Body rows — gridlines via gap:1px on background */}
          <div
            className="grid grid-cols-1"
            style={{ gap: "1px", background: "var(--border)" }}
          >
            {filtered.map((entity) => (
              <div
                key={entity.id}
                className="grid grid-cols-[1fr_180px_100px_80px] items-center text-sm transition-colors cursor-default"
                style={{ background: "var(--surface-raised)" }}
              >
                <div
                  className="px-4 py-3 font-medium truncate"
                  style={{ color: "var(--ink)" }}
                >
                  {entity.name}
                </div>
                <div
                  className="px-4 py-3 truncate text-xs"
                  style={{ color: "var(--ink-muted)" }}
                >
                  {entity.name_en ?? "—"}
                </div>
                <div className="px-4 py-3">
                  <span
                    className="text-xs px-1.5 py-0.5"
                    style={{
                      color:
                        TYPE_COLORS[entity.type] ?? "var(--ink-faint)",
                      background: `color-mix(in srgb, ${TYPE_COLORS[entity.type] ?? "var(--ink-faint)"} 10%, transparent)`,
                      borderRadius: "var(--radius-sm)",
                    }}
                  >
                    {entity.type}
                  </span>
                </div>
                <div
                  className="px-4 py-3 text-right flex items-center justify-end gap-1 text-xs tabular-nums"
                  style={{ color: "var(--ink-faint)" }}
                >
                  <FileText className="h-3 w-3" strokeWidth={1.5} />
                  {entity.documentCount}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HeaderCell({
  label,
  align,
}: {
  label: string;
  align?: "right";
}) {
  return (
    <div
      className="px-4 py-2.5 text-xs font-medium"
      style={{
        color: "var(--ink-faint)",
        letterSpacing: "0.04em",
        textAlign: align ?? "left",
      }}
    >
      {label.toUpperCase()}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2.5 py-1.5 text-xs font-medium cursor-pointer transition-colors"
      style={{
        background: active ? "var(--ink)" : "var(--surface-raised)",
        color: active ? "var(--surface-raised)" : "var(--ink-muted)",
        border: active ? "1px solid var(--ink)" : "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
      }}
    >
      {children}
    </button>
  );
}
