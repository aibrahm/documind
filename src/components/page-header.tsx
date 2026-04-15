"use client";

import Link from "next/link";
import type { ReactNode } from "react";

interface PageHeaderProps {
  eyebrow: string; // "LIBRARY", "PROJECTS", etc — small uppercase tag
  title: ReactNode; // "22 documents" or just a string
  actionHref?: string;
  actionLabel?: string;
  actionIcon?: ReactNode;
  rightExtra?: ReactNode; // filters, search etc
}

/**
 * Page header bar — matches the nav's gridline aesthetic. Edge-to-edge,
 * sits directly under the nav, border-bottom continues the gridline.
 * Left cell: eyebrow + title. Right cell: optional action button.
 */
export function PageHeader({
  eyebrow,
  title,
  actionHref,
  actionLabel,
  actionIcon,
  rightExtra,
}: PageHeaderProps) {
  return (
    <div
      className="flex items-center justify-between px-6 py-4 shrink-0"
      style={{
        background: "var(--surface-raised)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div>
        <div
          className="text-xs font-medium mb-1"
          style={{ color: "var(--ink-faint)", letterSpacing: "0.04em" }}
        >
          {eyebrow}
        </div>
        <h1
          className="text-xl font-semibold tracking-tight"
          style={{ color: "var(--ink)", letterSpacing: "-0.015em" }}
        >
          {title}
        </h1>
      </div>
      <div className="flex items-center gap-3">
        {rightExtra}
        {actionHref && actionLabel && (
          <Link
            href={actionHref}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors"
            style={{
              background: "var(--ink)",
              color: "var(--surface-raised)",
              borderRadius: "var(--radius-md)",
            }}
          >
            {actionIcon}
            {actionLabel}
          </Link>
        )}
      </div>
    </div>
  );
}
