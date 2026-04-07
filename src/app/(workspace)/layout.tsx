import { Nav } from "@/components/nav";
import { ProjectSidebarShell } from "@/components/project-sidebar-shell";
import { PdfViewerProvider } from "@/components/pdf-viewer-context";
import { supabaseAdmin } from "@/lib/supabase";

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Parallel fetch: non-archived projects + recent conversations (all)
  const [projectsRes, convosRes] = await Promise.all([
    supabaseAdmin
      .from("projects")
      .select("id, name, slug, status, color, icon, updated_at")
      .neq("status", "archived")
      .order("updated_at", { ascending: false }),
    supabaseAdmin
      .from("conversations")
      .select("id, title, project_id, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const projects = projectsRes.data ?? [];
  const conversations = convosRes.data ?? [];

  return (
    <div className="flex flex-col h-screen bg-white">
      <Nav />
      <div className="flex flex-1 overflow-hidden">
        <ProjectSidebarShell
          projects={projects}
          conversations={conversations}
        />
        <PdfViewerProvider>{children}</PdfViewerProvider>
      </div>
    </div>
  );
}
