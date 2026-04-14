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
    <nav
      className="sticky top-0 z-40 flex h-14 shrink-0 items-center px-6"
      style={{
        background:
          "color-mix(in srgb, var(--surface-raised) 85%, transparent)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
        borderBottom: "1px solid var(--border-light)",
      }}
    >
      {/* Brand */}
      <Link
        href="/"
        className="flex items-center gap-2.5 mr-8 transition-opacity hover:opacity-80"
      >
        <span
          aria-hidden
          className="flex h-6 w-6 items-center justify-center"
          style={{
            background: "var(--ink)",
            borderRadius: "var(--radius-sm)",
            color: "var(--surface-raised)",
            fontSize: "0.75rem",
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: "-0.03em",
          }}
        >
          D
        </span>
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "0.9375rem",
            fontWeight: 600,
            letterSpacing: "-0.015em",
            color: "var(--ink)",
          }}
        >
          DocuMind
        </span>
      </Link>

      {/* Primary links */}
      <div className="flex items-center gap-1">
        {LINKS.map((l) => {
          const active =
            pathname === l.href ||
            (l.href !== "/" && pathname.startsWith(l.href));
          const Icon = l.icon;
          return (
            <Link
              key={l.href}
              href={l.href}
              className="flex items-center gap-2 px-3 py-1.5 transition-all"
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "0.8125rem",
                fontWeight: 500,
                color: active ? "var(--ink)" : "var(--ink-muted)",
                background: active ? "var(--surface-sunken)" : "transparent",
                borderRadius: "var(--radius-md)",
              }}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              {l.label}
            </Link>
          );
        })}
      </div>

      {/* Settings on the right */}
      <Link
        href="/settings"
        className="ms-auto flex items-center gap-2 px-2.5 py-1.5 transition-colors"
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "0.8125rem",
          fontWeight: 500,
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
        <Settings className="h-3.5 w-3.5" strokeWidth={1.75} />
      </Link>
    </nav>
  );
}
