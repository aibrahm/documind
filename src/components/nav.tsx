"use client";

import {
  FileText,
  FolderKanban,
  LayoutDashboard,
  Network,
  Settings,
  Share2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DocuMindLogo } from "@/components/logo";

const LINKS = [
  { label: "Home", href: "/", icon: LayoutDashboard },
  { label: "Documents", href: "/documents", icon: FileText },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Graph", href: "/graph", icon: Share2 },
  { label: "Entities", href: "/entities", icon: Network },
  { label: "Upload", href: "/upload", icon: Upload },
];

/**
 * Full-width gridline nav bar.
 *
 * One edge-to-edge row. Cells are separated by 1px gridlines (via the
 * `gap: 1px` + colored parent background pattern used elsewhere). The
 * brand sits in the first cell, nav links fill the middle cells, and
 * the settings icon is the last cell.
 */
export function Nav() {
  const pathname = usePathname();

  return (
    <header
      className="sticky top-0 z-40 shrink-0"
      style={{
        background: "var(--border)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div
        className="grid w-full"
        style={{
          gridTemplateColumns: `auto repeat(${LINKS.length}, minmax(0, 1fr)) auto`,
          gap: "1px",
          background: "var(--border)",
        }}
      >
        {/* Brand cell */}
        <Link
          href="/"
          className="flex items-center px-6 h-16 transition-opacity hover:opacity-70"
          style={{
            color: "var(--ink)",
            background: "var(--surface-raised)",
          }}
        >
          <DocuMindLogo variant="horizontal" size="md" />
        </Link>

        {/* Nav cells */}
        {LINKS.map((l) => {
          const active =
            pathname === l.href ||
            (l.href !== "/" && pathname.startsWith(l.href));
          const Icon = l.icon;
          return (
            <Link
              key={l.href}
              href={l.href}
              className="flex items-center justify-center gap-2 h-16 transition-colors leading-none"
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "0.875rem",
                fontWeight: active ? 600 : 500,
                color: active ? "var(--surface-raised)" : "var(--ink-muted)",
                background: active ? "var(--ink)" : "var(--surface-raised)",
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
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} style={{ transform: "translateY(0.5px)" }} />
              {l.label}
            </Link>
          );
        })}

        {/* Settings cell */}
        <Link
          href="/settings"
          className="flex items-center justify-center px-5 h-16 transition-colors"
          style={{
            color:
              pathname === "/settings"
                ? "var(--surface-raised)"
                : "var(--ink-muted)",
            background:
              pathname === "/settings" ? "var(--ink)" : "var(--surface-raised)",
          }}
          aria-label="Settings"
        >
          <Settings className="h-4 w-4 shrink-0" strokeWidth={1.75} style={{ transform: "translateY(0.5px)" }} />
        </Link>
      </div>
    </header>
  );
}
