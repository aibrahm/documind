"use client";

import { useState, useMemo } from "react";
import { Search, FileText, Building2, Landmark, User2, Briefcase, Shapes } from "lucide-react";
import { PageHeader } from "@/components/page-header";

interface Entity {
  id: string;
  name: string;
  name_en: string | null;
  type: string;
  documentCount: number;
  created_at: string | null;
}

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number; style?: React.CSSProperties }>> = {
  company: Building2,
  ministry: Landmark,
  authority: Landmark,
  person: User2,
  project: Briefcase,
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
    // Sort by doc count descending — most referenced first
    return [...list].sort((a, b) => b.documentCount - a.documentCount);
  }, [entities, search, typeFilter]);

  return (
    <>
      <PageHeader
        eyebrow="ENTITIES"
        title={
          <>
            {entities.length}{" "}
            <span style={{ color: "var(--ink-muted)", fontWeight: 400 }}>
              extracted
            </span>
          </>
        }
      />
      <div>

      {/* Toolbar — edge-to-edge gridline strip */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: `1fr repeat(${types.length + 1}, auto)`,
          gap: "1px",
          background: "var(--border)",
          borderTop: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div
          className="flex items-center gap-2 px-5"
          style={{ background: "var(--surface-raised)" }}
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
            className="flex-1 bg-transparent border-0 outline-none text-sm py-3"
            style={{
              color: "var(--ink)",
              fontFamily: "var(--font-sans)",
            }}
          />
        </div>
        <FilterCell
          active={!typeFilter}
          onClick={() => setTypeFilter(null)}
        >
          All
        </FilterCell>
        {types.map((t) => (
          <FilterCell
            key={t}
            active={typeFilter === t}
            onClick={() => setTypeFilter(typeFilter === t ? null : t)}
          >
            {t}
          </FilterCell>
        ))}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div
          className="p-16 text-center"
          style={{
            background: "var(--surface-raised)",
            borderTop: "1px solid var(--border)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <Shapes
            className="mx-auto h-10 w-10 mb-3"
            style={{ color: "var(--ink-ghost)" }}
            strokeWidth={1.25}
          />
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            {search || typeFilter
              ? "No matches."
              : "No entities extracted yet."}
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
            {filtered.map((entity) => {
              const Icon = TYPE_ICONS[entity.type] ?? Shapes;
              return (
                <div
                  key={entity.id}
                  className="flex items-start gap-3 p-5 transition-colors"
                  style={{ background: "var(--surface-raised)" }}
                >
                  <div
                    className="flex h-8 w-8 items-center justify-center shrink-0"
                    style={{
                      background: "var(--surface-sunken)",
                      borderRadius: "var(--radius-md)",
                    }}
                  >
                    <Icon
                      className="h-4 w-4"
                      style={{ color: "var(--ink-muted)" }}
                      strokeWidth={1.5}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-sm font-medium truncate"
                      style={{ color: "var(--ink)" }}
                    >
                      {entity.name}
                    </div>
                    {entity.name_en && (
                      <div
                        className="text-xs truncate mt-0.5"
                        style={{ color: "var(--ink-muted)" }}
                      >
                        {entity.name_en}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <span
                        className="text-xs capitalize"
                        style={{ color: "var(--ink-faint)" }}
                      >
                        {entity.type}
                      </span>
                      <span
                        className="h-1 w-1 rounded-full"
                        style={{ background: "var(--ink-ghost)" }}
                      />
                      <span
                        className="flex items-center gap-1 text-xs tabular-nums"
                        style={{ color: "var(--ink-faint)" }}
                      >
                        <FileText className="h-3 w-3" strokeWidth={1.5} />
                        {entity.documentCount}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </div>
    </>
  );
}

function FilterCell({
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
      className="px-5 py-3 text-sm font-medium cursor-pointer transition-colors capitalize whitespace-nowrap"
      style={{
        background: active ? "var(--ink)" : "var(--surface-raised)",
        color: active ? "var(--surface-raised)" : "var(--ink-muted)",
        border: "none",
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
      {children}
    </button>
  );
}
