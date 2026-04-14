import { supabaseAdmin } from "@/lib/supabase";
import { Dashboard } from "@/components/dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [docsResult, projectsResult, entitiesResult, recentDocsResult] =
    await Promise.all([
      supabaseAdmin
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("is_current", true),
      supabaseAdmin
        .from("projects")
        .select("id", { count: "exact", head: true })
        .neq("status", "archived"),
      supabaseAdmin
        .from("entities")
        .select("id", { count: "exact", head: true }),
      supabaseAdmin
        .from("documents")
        .select("id, title, type, status, created_at")
        .eq("is_current", true)
        .order("created_at", { ascending: false })
        .limit(6),
    ]);

  return (
    <Dashboard
      counts={{
        documents: docsResult.count ?? 0,
        projects: projectsResult.count ?? 0,
        entities: entitiesResult.count ?? 0,
      }}
      recentDocs={recentDocsResult.data ?? []}
    />
  );
}
