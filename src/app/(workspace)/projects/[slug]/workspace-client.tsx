"use client";

import { Suspense } from "react";
import type { Database } from "@/lib/database.types";
import { useChat } from "@/lib/hooks/use-chat";
import type { ProjectParticipant } from "@/components/project-workspace-header";
import { ProjectDashboard } from "@/components/project-dashboard";
import type { UiLanguage } from "@/lib/ui-strings";

type Project = Database["public"]["Tables"]["projects"]["Row"];

interface WorkspaceClientProps {
  project: Project;
  initialTab: string; // kept for backwards-compat with page.tsx, unused
  counts: {
    documents: number;
    entities: number;
    threads: number;
  };
  participants: ProjectParticipant[];
  language: UiLanguage;
}

/**
 * Project workspace shell.
 *
 * Previously this rendered a 5-tab interface (Brief / Knowledge / Threads /
 * Outputs / Activity). We replaced all five tabs with a single flowing
 * dashboard — see components/project-dashboard.tsx. Tab-based navigation
 * was removed because it hid the content you were coming to see and
 * forced a click-to-reveal model that didn't match how the work actually
 * flowed.
 *
 * The Suspense wrapper exists because ProjectDashboard uses useSearchParams
 * (for ?conversation=<id> deep-linking), and Next.js 16 requires any
 * component using search params to be inside a Suspense boundary so
 * prerendering can bail out cleanly.
 */
export function WorkspaceClient({
  project,
  counts,
  participants,
  language,
}: WorkspaceClientProps) {
  // Chat state is lifted to the workspace level so it survives any
  // in-page navigation the dashboard might do (e.g. loading a thread
  // from the activity feed).
  const chat = useChat({ projectId: project.id });

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <div className="flex-1 min-h-0 overflow-hidden">
        <Suspense fallback={null}>
          <ProjectDashboard
            project={project}
            counts={counts}
            participants={participants}
            chat={chat}
            language={language}
          />
        </Suspense>
      </div>
    </div>
  );
}
