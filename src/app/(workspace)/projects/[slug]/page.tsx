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
  const { tab = "overview" } = await searchParams;

  const { data: project, error } = await supabaseAdmin
    .from("projects")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !project) {
    notFound();
  }

  // Membership counts + companies fetched in parallel
  const [docsCount, companiesLinks, negsCount, convosCount] = await Promise.all([
    supabaseAdmin
      .from("project_documents")
      .select("project_id", { count: "exact", head: true })
      .eq("project_id", project.id),
    supabaseAdmin
      .from("project_companies")
      .select(
        `
        role,
        entity:entities ( id, name, name_en, type )
      `,
      )
      .eq("project_id", project.id),
    supabaseAdmin
      .from("negotiations")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project.id),
    supabaseAdmin
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project.id),
  ]);

  const counterparties = (companiesLinks.data || [])
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
    companies: counterparties.length,
    negotiations: negsCount.count || 0,
    conversations: convosCount.count || 0,
  };

  return (
    <WorkspaceClient
      project={project}
      initialTab={tab}
      counts={counts}
      counterparties={counterparties}
    />
  );
}
