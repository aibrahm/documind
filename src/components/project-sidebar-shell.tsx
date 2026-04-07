"use client";

import { useState } from "react";
import {
  ProjectSidebar,
  type ProjectSummary,
  type ConversationSummary,
} from "@/components/project-sidebar";

interface ProjectSidebarShellProps {
  projects: ProjectSummary[];
  conversations: ConversationSummary[];
}

/**
 * Client wrapper around <ProjectSidebar> that owns the open/closed state.
 * Server layouts can render this; the open state lives client-side.
 */
export function ProjectSidebarShell({
  projects,
  conversations,
}: ProjectSidebarShellProps) {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <ProjectSidebar
      projects={projects}
      conversations={conversations}
      isOpen={isOpen}
      onToggle={() => setIsOpen((v) => !v)}
    />
  );
}
