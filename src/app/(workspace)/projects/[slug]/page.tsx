import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { WorkspaceClient } from "./workspace-client";

export default async function ProjectWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug } = await params;
  const { tab = "brief" } = await searchParams;

  const { data: project, error } = await supabaseAdmin
    .from("projects")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !project) {
    notFound();
  }

  // Membership counts + linked participants fetched in parallel
  const [docsCount, entityLinks, convosCount] = await Promise.all([
    supabaseAdmin
      .from("project_documents")
      .select("project_id", { count: "exact", head: true })
      .eq("project_id", project.id),
    supabaseAdmin
      .from("project_entities")
      .select(
        `
        role,
        entity:entities ( id, name, name_en, type )
      `,
      )
      .eq("project_id", project.id),
    supabaseAdmin
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project.id),
  ]);

  const participants = (entityLinks.data || [])
    .filter((l) => l.entity)
    .map((l) => {
      const e = l.entity as { id: string; name: string; name_en: string | null };
      return {
        id: e.id,
        name: e.name,
        name_en: e.name_en,
        role: l.role as string,
      };
    });

  const counts = {
    documents: docsCount.count || 0,
    entities: participants.length,
    threads: convosCount.count || 0,
  };

  return (
    <WorkspaceClient
      project={project}
      initialTab={tab}
      counts={counts}
      participants={participants}
    />
  );
}
