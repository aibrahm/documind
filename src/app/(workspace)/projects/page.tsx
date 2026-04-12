import { supabaseAdmin } from "@/lib/supabase";
import { ProjectList } from "@/components/project-list";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const { data: projects } = await supabaseAdmin
    .from("projects")
    .select(
      "id, name, slug, description, status, kind, stage, color, icon, updated_at",
    )
    .neq("status", "archived")
    .order("updated_at", { ascending: false });

  const projectIds = (projects ?? []).map((p) => p.id);

  let docCounts: Record<string, number> = {};
  if (projectIds.length > 0) {
    const { data } = await supabaseAdmin
      .from("project_documents")
      .select("project_id");
    if (data) {
      for (const row of data) {
        docCounts[row.project_id] = (docCounts[row.project_id] ?? 0) + 1;
      }
    }
  }

  return (
    <ProjectList
      projects={(projects ?? []).map((p) => ({
        ...p,
        documentCount: docCounts[p.id] ?? 0,
      }))}
    />
  );
}
