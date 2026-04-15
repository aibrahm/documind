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
      <div className="px-6 py-6">

      {/* Search + type filter row */}
      <div className="mb-4 flex items-center gap-2">
        <div
          className="flex items-center gap-2 flex-1 max-w-sm px-3 py-2"
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
            placeholder="Search..."
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

      {/* Grid */}
      {filtered.length === 0 ? (
        <div
          className="p-16 text-center"
          style={{
            background: "var(--surface-raised)",
            border: "1px dashed var(--border)",
            borderRadius: "var(--radius-xl)",
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
      className="px-2.5 py-1.5 text-xs font-medium cursor-pointer transition-colors capitalize"
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
