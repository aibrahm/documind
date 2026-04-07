"use client";

import { useSearchParams } from "next/navigation";
import type { Database } from "@/lib/database.types";
import { useChat } from "@/lib/hooks/use-chat";
import {
  ProjectWorkspaceHeader,
  type Counterparty,
} from "@/components/project-workspace-header";
import { ProjectTabs, type TabId } from "@/components/project-tabs";
import { OverviewTab } from "./_tabs/overview";

type Project = Database["public"]["Tables"]["projects"]["Row"];

interface WorkspaceClientProps {
  project: Project;
  initialTab: string;
  counts: {
    documents: number;
    companies: number;
    negotiations: number;
    conversations: number;
  };
  counterparties: Counterparty[];
}

const VALID_TABS: TabId[] = [
  "overview",
  "documents",
  "negotiations",
  "chats",
  "memory",
];

function isValidTab(t: string): t is TabId {
  return (VALID_TABS as string[]).includes(t);
}

export function WorkspaceClient({
  project,
  initialTab,
  counts,
  counterparties,
}: WorkspaceClientProps) {
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab") ?? initialTab;
  const activeTab: TabId = isValidTab(rawTab) ? rawTab : "overview";

  // Chat state lifted to workspace level so it survives tab switches
  const chat = useChat({ projectId: project.id });

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <ProjectWorkspaceHeader
        project={project}
        counterparties={counterparties}
        counts={counts}
      />
      <ProjectTabs activeTab={activeTab} />

      {/*
        Tab content uses `hidden` CSS so inactive tabs stay mounted.
        This preserves chat state in the Overview tab across tab switches.
      */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        <div hidden={activeTab !== "overview"} className="h-full">
          <OverviewTab project={project} counts={counts} chat={chat} />
        </div>
        <div hidden={activeTab !== "documents"} className="h-full">
          <TabPlaceholder label="Documents" />
        </div>
        <div hidden={activeTab !== "negotiations"} className="h-full">
          <TabPlaceholder label="Negotiations" />
        </div>
        <div hidden={activeTab !== "chats"} className="h-full">
          <TabPlaceholder label="Chats" />
        </div>
        <div hidden={activeTab !== "memory"} className="h-full">
          <TabPlaceholder label="Memory" />
        </div>
      </div>
    </div>
  );
}

function TabPlaceholder({ label }: { label: string }) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center space-y-2">
        <p className="text-lg font-semibold text-slate-700">{label} tab</p>
        <p className="text-sm text-slate-400">
          Coming in Phase 04-04 — this tab exists so the tab bar is functional.
        </p>
      </div>
    </div>
  );
}
