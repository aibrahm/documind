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
import { DocumentsTab } from "./_tabs/documents";
import { NegotiationsTab } from "./_tabs/negotiations";
import { ChatsTab } from "./_tabs/chats";
import { MemoryTab } from "./_tabs/memory";

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
          <DocumentsTab projectSlug={project.slug} />
        </div>
        <div hidden={activeTab !== "negotiations"} className="h-full">
          <NegotiationsTab projectId={project.id} />
        </div>
        <div hidden={activeTab !== "chats"} className="h-full">
          <ChatsTab projectSlug={project.slug} />
        </div>
        <div hidden={activeTab !== "memory"} className="h-full">
          <MemoryTab />
        </div>
      </div>
    </div>
  );
}
