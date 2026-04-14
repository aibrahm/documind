import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { WorkspaceClient } from "./workspace-client";

export default async function ProjectWorkspacePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const { data: project, error } = await supabaseAdmin
    .from("projects")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !project) {
    notFound();
  }

  const [docsCount, entitiesCount] = await Promise.all([
    supabaseAdmin
      .from("project_documents")
      .select("project_id", { count: "exact", head: true })
      .eq("project_id", project.id),
    supabaseAdmin
      .from("project_entities")
      .select("project_id", { count: "exact", head: true })
      .eq("project_id", project.id),
  ]);

  const counts = {
    documents: docsCount.count || 0,
    entities: entitiesCount.count || 0,
    threads: 0,
  };

  return <WorkspaceClient project={project} counts={counts} />;
}
