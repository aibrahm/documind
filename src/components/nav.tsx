"use client";

import { usePathname, useRouter } from "next/navigation";
import { Search, FileText, Upload, UserRound } from "lucide-react";

/**
 * Top navigation bar.
 *
 * The old nav was a dark slate bar grafted onto a white body — it
 * read as a generic 2017 admin panel. The new nav is light, flush
 * with the page surface, carries the brand mark in a real serif,
 * and uses the amber accent only on the active link underline.
 *
 * The status meta (model / stages / time) that used to crowd the
 * right side is gone — it was dev telemetry for an executive user.
 */
const links = [
  { label: "Intelligence", href: "/", icon: Search },
  { label: "Documents", href: "/documents", icon: FileText },
  { label: "Upload", href: "/upload", icon: Upload },
  { label: "Profile", href: "/settings", icon: UserRound },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav
      className="flex h-14 shrink-0 items-center gap-8 border-b px-6"
      style={{
        background: "var(--surface)",
        borderColor: "var(--border-light)",
      }}
    >
      {/* Brand mark */}
      <button
        type="button"
        onClick={() => router.push("/")}
        className="group flex items-baseline gap-0 border-0 bg-transparent p-0 cursor-pointer"
      >
        <span
          style={{
            fontFamily: "'Source Serif 4', Georgia, serif",
            fontSize: "1.125rem",
            fontWeight: 700,
            letterSpacing: "-0.015em",
            color: "var(--ink)",
            lineHeight: 1,
          }}
        >
          Docu
        </span>
        <span
          style={{
            fontFamily: "'Source Serif 4', Georgia, serif",
            fontSize: "1.125rem",
            fontWeight: 400,
            fontStyle: "italic",
            letterSpacing: "-0.01em",
            color: "var(--ink-muted)",
            lineHeight: 1,
          }}
        >
          Mind
        </span>
      </button>

      <span
        aria-hidden
        className="h-6 w-px"
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
              className="relative flex items-center gap-1.5 border-0 bg-transparent px-3 py-2 cursor-pointer transition-colors"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "var(--text-sm)",
                fontWeight: active ? 600 : 500,
                color: active ? "var(--ink)" : "var(--ink-muted)",
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLButtonElement).style.color =
                    "var(--ink)";
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLButtonElement).style.color =
                    "var(--ink-muted)";
                }
              }}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              {l.label}
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-3 -bottom-[1px] h-[2px]"
                  style={{ background: "var(--accent)" }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Right side spacer — kept empty intentionally. Previous
          versions had a dev telemetry row (model · stages · time)
          here which served no user purpose. */}
      <div className="ms-auto" />
    </nav>
  );
}
