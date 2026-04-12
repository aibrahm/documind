"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  FolderKanban,
  Network,
  Upload,
  Settings,
} from "lucide-react";

const links = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Documents", href: "/documents", icon: FileText },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Entities", href: "/entities", icon: Network },
  { label: "Upload", href: "/upload", icon: Upload },
  { label: "Settings", href: "/settings", icon: Settings },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav
      className="flex h-12 shrink-0 items-center gap-6 px-5"
      style={{
        background: "var(--surface-raised)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {/* Brand — small filled square mark + wordmark */}
      <button
        type="button"
        onClick={() => router.push("/")}
        className="group flex items-center gap-2 border-0 bg-transparent p-0 cursor-pointer"
      >
        <span
          aria-hidden
          className="flex h-5 w-5 items-center justify-center"
          style={{
            background: "var(--ink)",
            borderRadius: "var(--radius-sm)",
            color: "var(--surface-raised)",
            fontSize: "0.6875rem",
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: "-0.02em",
          }}
        >
          D
        </span>
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "0.875rem",
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: "var(--ink)",
            lineHeight: 1,
          }}
        >
          DocuMind
        </span>
      </button>

      <span
        aria-hidden
        className="h-4 w-px"
        style={{ background: "var(--border)" }}
      />

      {/* Primary links */}
      <div className="flex items-center gap-1">
        {links.map((l) => {
          const active =
            pathname === l.href ||
            (l.href !== "/" && pathname.startsWith(l.href));
          const Icon = l.icon;
          return (
            <button
              key={l.href}
              type="button"
              onClick={() => router.push(l.href)}
              className="relative flex items-center gap-1.5 border-0 bg-transparent px-2.5 py-2 cursor-pointer transition-colors"
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "0.8125rem",
                fontWeight: active ? 600 : 500,
                color: active ? "var(--ink)" : "var(--ink-muted)",
                borderRadius: "var(--radius-md)",
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLButtonElement).style.color =
                    "var(--ink)";
                  (e.currentTarget as HTMLButtonElement).style.background =
                    "var(--surface-sunken)";
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLButtonElement).style.color =
                    "var(--ink-muted)";
                  (e.currentTarget as HTMLButtonElement).style.background =
                    "transparent";
                }
              }}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              {l.label}
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-0 -bottom-3 h-[2px]"
                  style={{ background: "var(--accent)" }}
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="ms-auto" />
    </nav>
  );
}
