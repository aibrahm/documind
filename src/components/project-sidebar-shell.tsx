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
const OPEN_HISTORY_EVENT = "documind:open-history";
const FOCUS_HISTORY_SEARCH_EVENT = "documind:focus-history-search";

function persistSidebarOpenState(next: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // ignore
  }
}

/**
 * Client wrapper around <ProjectSidebar> that owns the open/closed state.
 * Server layouts can render this; the open state lives client-side and
 * is persisted to localStorage so it survives navigations and reloads.
 */
export function ProjectSidebarShell({
  projects,
  conversations,
}: ProjectSidebarShellProps) {
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      return stored === null ? true : stored === "true";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const handleOpenHistory = () => {
      setIsOpen(true);
      persistSidebarOpenState(true);
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event(FOCUS_HISTORY_SEARCH_EVENT));
      });
    };

    window.addEventListener(OPEN_HISTORY_EVENT, handleOpenHistory);
    return () => {
      window.removeEventListener(OPEN_HISTORY_EVENT, handleOpenHistory);
    };
  }, []);

  const toggle = () => {
    setIsOpen((v) => {
      const next = !v;
      persistSidebarOpenState(next);
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
