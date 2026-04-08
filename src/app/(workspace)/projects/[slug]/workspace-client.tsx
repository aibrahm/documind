"use client";

import { useSearchParams } from "next/navigation";
import type { Database } from "@/lib/database.types";
import { useChat } from "@/lib/hooks/use-chat";
import {
  ProjectWorkspaceHeader,
  type ProjectParticipant,
} from "@/components/project-workspace-header";
import { ProjectTabs, type TabId } from "@/components/project-tabs";
import { BriefTab } from "./_tabs/brief";
import { ThreadsTab } from "./_tabs/threads";
import { KnowledgeTab } from "./_tabs/knowledge";
import { ActivityTab } from "./_tabs/activity";
import { OutputsTab } from "./_tabs/outputs";

type Project = Database["public"]["Tables"]["projects"]["Row"];

interface WorkspaceClientProps {
  project: Project;
  initialTab: string;
  counts: {
    documents: number;
    entities: number;
    threads: number;
  };
  participants: ProjectParticipant[];
}

const VALID_TABS: TabId[] = [
  "brief",
  "knowledge",
  "threads",
  "outputs",
  "activity",
];

function isValidTab(t: string): t is TabId {
  return (VALID_TABS as string[]).includes(t);
}

function normalizeTab(rawTab: string): TabId {
  const legacyMap: Record<string, TabId> = {
    overview: "brief",
    documents: "knowledge",
    negotiations: "threads",
    chats: "threads",
    memory: "activity",
  };
  const mapped = legacyMap[rawTab] ?? rawTab;
  return isValidTab(mapped) ? mapped : "brief";
}

export function WorkspaceClient({
  project,
  initialTab,
  counts,
  participants,
}: WorkspaceClientProps) {
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab") ?? initialTab;
  const activeTab = normalizeTab(rawTab);

  // Thread workspace state is lifted to the project level so it survives tab switches.
  const chat = useChat({ projectId: project.id });

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <ProjectWorkspaceHeader
        project={project}
        participants={participants}
      />
      <ProjectTabs activeTab={activeTab} />

      {/*
        Tab content uses `hidden` CSS so inactive tabs stay mounted.
        This preserves the active thread state across tab switches.
      */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        <div hidden={activeTab !== "brief"} className="h-full">
          <BriefTab
            project={project}
            counts={counts}
            participants={participants}
          />
        </div>
        <div hidden={activeTab !== "knowledge"} className="h-full">
          <KnowledgeTab projectSlug={project.slug} />
        </div>
        <div hidden={activeTab !== "threads"} className="h-full">
          <ThreadsTab project={project} counts={counts} chat={chat} />
        </div>
        <div hidden={activeTab !== "outputs"} className="h-full">
          <OutputsTab projectId={project.id} />
        </div>
        <div hidden={activeTab !== "activity"} className="h-full">
          <ActivityTab projectSlug={project.slug} />
        </div>
      </div>
    </div>
  );
}
