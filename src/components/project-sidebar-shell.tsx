"use client";

import { useState, useEffect } from "react";
import {
  ProjectSidebar,
  type ProjectSummary,
  type ConversationSummary,
} from "@/components/project-sidebar";

interface ProjectSidebarShellProps {
  projects: ProjectSummary[];
  conversations: ConversationSummary[];
}

const STORAGE_KEY = "documind:sidebar-open";

/**
 * Client wrapper around <ProjectSidebar> that owns the open/closed state.
 * Server layouts can render this; the open state lives client-side and
 * is persisted to localStorage so it survives navigations and reloads.
 */
export function ProjectSidebarShell({
  projects,
  conversations,
}: ProjectSidebarShellProps) {
  const [isOpen, setIsOpen] = useState(true);

  // Hydrate from localStorage on mount
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored !== null) setIsOpen(stored === "true");
    } catch {
      // localStorage may be unavailable (private browsing, etc) — keep default
    }
  }, []);

  const toggle = () => {
    setIsOpen((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  return (
    <ProjectSidebar
      projects={projects}
      conversations={conversations}
      isOpen={isOpen}
      onToggle={toggle}
    />
  );
}
