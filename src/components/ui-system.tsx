"use client";

/* ═══════════════════════════════════════
   DOCUMIND — Shared UI Components
   ═══════════════════════════════════════ */

/* ─── StatusBar ─────────────────────── */

interface StatusBarItem {
  label: string;
  value: string;
}

interface StatusBarProps {
  items: StatusBarItem[];
}

export function StatusBar({ items }: StatusBarProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 h-7 bg-white border-t border-[#E4E5E7] px-5 flex items-center justify-between z-50">
      <div className="flex items-center gap-4">
        {items.map((item) => (
          <span
            key={item.label}
            className="font-['JetBrains_Mono'] text-[10px] text-slate-400 tracking-wide"
          >
            {item.label}:{" "}
            <span className="text-slate-500">{item.value}</span>
          </span>
        ))}
      </div>
      <span className="font-['JetBrains_Mono'] text-[10px] text-slate-400 tracking-wide">
        DOCUMIND v1.0
      </span>
    </div>
  );
}

/* ─── Tag ───────────────────────────── */

type TagVariant = "default" | "blue" | "green" | "amber" | "red";

interface TagProps {
  children: React.ReactNode;
  variant?: TagVariant;
}

const tagVariants: Record<TagVariant, string> = {
  default: "bg-slate-100 text-slate-500",
  blue: "bg-blue-50 text-blue-600",
  green: "bg-green-50 text-green-600",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-600",
};

export function Tag({ children, variant = "default" }: TagProps) {
  return (
    <span
      className={`font-mono text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-sm inline-flex items-center ${tagVariants[variant]}`}
    >
      {children}
    </span>
  );
}

/* ─── Skeleton ──────────────────────── */

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return <div className={`animate-pulse bg-slate-100 rounded ${className}`} />;
}
