"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  FileText,
  FolderKanban,
  Network,
  Upload,
  Settings,
} from "lucide-react";
import { DocuMindLogo } from "@/components/logo";

const LINKS = [
  { label: "Home", href: "/", icon: LayoutDashboard },
  { label: "Documents", href: "/documents", icon: FileText },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Entities", href: "/entities", icon: Network },
  { label: "Upload", href: "/upload", icon: Upload },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header
      className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between px-6"
      style={{
        background: "var(--surface)",
        borderBottom: "1px solid var(--border-light)",
      }}
    >
      {/* Brand */}
      <Link
        href="/"
        className="transition-opacity hover:opacity-70"
        style={{ color: "var(--ink)" }}
      >
        <DocuMindLogo variant="horizontal" size="sm" />
      </Link>

      {/* Centered nav pill — segmented control with gridlines */}
      <div
        className="flex items-center overflow-hidden"
        style={{
          background: "var(--border)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          gap: "1px",
        }}
      >
        {LINKS.map((l) => {
          const active =
            pathname === l.href ||
            (l.href !== "/" && pathname.startsWith(l.href));
          const Icon = l.icon;
          return (
            <Link
              key={l.href}
              href={l.href}
              className="flex items-center gap-1.5 px-3 py-1.5 transition-colors"
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "0.8125rem",
                fontWeight: active ? 600 : 500,
                color: active
                  ? "var(--surface-raised)"
                  : "var(--ink-muted)",
                background: active ? "var(--ink)" : "var(--surface-raised)",
              }}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              {l.label}
            </Link>
          );
        })}
      </div>

      {/* Settings icon */}
      <Link
        href="/settings"
        className="flex items-center justify-center h-8 w-8 transition-colors"
        style={{
          color:
            pathname === "/settings" ? "var(--ink)" : "var(--ink-muted)",
          background:
            pathname === "/settings"
              ? "var(--surface-sunken)"
              : "transparent",
          borderRadius: "var(--radius-md)",
        }}
        aria-label="Settings"
      >
        <Settings className="h-4 w-4" strokeWidth={1.75} />
      </Link>
    </header>
  );
}
