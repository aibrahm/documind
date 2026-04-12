import { supabaseAdmin } from "@/lib/supabase";
import { EntityExplorer } from "@/components/entity-explorer";

export const dynamic = "force-dynamic";

export default async function EntitiesPage() {
  const { data: entities } = await supabaseAdmin
    .from("entities")
    .select("id, name, name_en, type, created_at")
    .order("name", { ascending: true })
    .limit(200);

  const { data: docLinks } = await supabaseAdmin
    .from("document_entities")
    .select("entity_id, role");

  const entityCounts: Record<string, number> = {};
  if (docLinks) {
    for (const link of docLinks) {
      entityCounts[link.entity_id] =
        (entityCounts[link.entity_id] ?? 0) + 1;
    }
  }

  return (
    <EntityExplorer
      entities={(entities ?? []).map((e) => ({
        ...e,
        documentCount: entityCounts[e.id] ?? 0,
      }))}
    />
  );
}
