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
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <h1
          className="text-xl font-semibold"
          style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}
        >
          Entities
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>
          {entities.length} entities extracted from your documents
        </p>
      </div>

      {/* Filters */}
      <div className="mb-4 flex items-center gap-3">
        <div
          className="flex items-center gap-2 flex-1 px-3 py-2"
          style={{
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <Search
            className="h-4 w-4 shrink-0"
            style={{ color: "var(--ink-ghost)" }}
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
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setTypeFilter(null)}
            className="px-2.5 py-1.5 text-xs font-medium cursor-pointer transition-colors"
            style={{
              background: !typeFilter
                ? "var(--ink)"
                : "var(--surface-raised)",
              color: !typeFilter ? "#fff" : "var(--ink-muted)",
              border: !typeFilter ? "none" : "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
            }}
          >
            All
          </button>
          {types.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(typeFilter === t ? null : t)}
              className="px-2.5 py-1.5 text-xs font-medium cursor-pointer transition-colors"
              style={{
                background:
                  typeFilter === t
                    ? "var(--ink)"
                    : "var(--surface-raised)",
                color:
                  typeFilter === t ? "#fff" : "var(--ink-muted)",
                border:
                  typeFilter === t ? "none" : "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Entity List */}
      <div
        style={{
          background: "var(--surface-raised)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          className="grid grid-cols-[1fr_200px_80px_100px] gap-4 px-4 py-2 text-xs font-medium"
          style={{
            color: "var(--ink-faint)",
            background: "var(--surface-sunken)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span>Name</span>
          <span>English Name</span>
          <span>Type</span>
          <span className="text-right">Documents</span>
        </div>

        {filtered.length === 0 ? (
          <div className="py-12 text-center">
            <Network
              className="mx-auto h-8 w-8 mb-2"
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
          filtered.map((entity, i) => (
            <div
              key={entity.id}
              className="grid grid-cols-[1fr_200px_80px_100px] gap-4 px-4 py-3 items-center text-sm transition-colors cursor-default"
              style={{
                borderBottom:
                  i < filtered.length - 1
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
              <span
                className="font-medium truncate"
                style={{ color: "var(--ink)" }}
              >
                {entity.name}
              </span>
              <span
                className="truncate text-xs"
                style={{ color: "var(--ink-muted)" }}
              >
                {entity.name_en ?? "—"}
              </span>
              <span
                className="text-xs px-1.5 py-0.5 w-fit"
                style={{
                  color: TYPE_COLORS[entity.type] ?? "var(--ink-faint)",
                  background: `color-mix(in srgb, ${TYPE_COLORS[entity.type] ?? "var(--ink-faint)"} 10%, transparent)`,
                  borderRadius: "var(--radius-sm)",
                }}
              >
                {entity.type}
              </span>
              <span
                className="text-right flex items-center justify-end gap-1 text-xs"
                style={{ color: "var(--ink-faint)" }}
              >
                <FileText className="h-3 w-3" />
                {entity.documentCount}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
