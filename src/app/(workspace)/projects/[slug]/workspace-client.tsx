"use client";

import type { Database } from "@/lib/database.types";
import { ProjectDashboard } from "@/components/project-dashboard";

type Project = Database["public"]["Tables"]["projects"]["Row"];

interface WorkspaceClientProps {
  project: Project;
  counts: {
    documents: number;
    entities: number;
    threads: number;
  };
}

export function WorkspaceClient({ project, counts }: WorkspaceClientProps) {
  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <div className="flex-1 min-h-0 overflow-auto">
        <ProjectDashboard project={project} counts={counts} />
      </div>
    </div>
  );
}
