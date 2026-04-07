"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { slugify, uniqueSlug } from "@/lib/projects";
import { logAudit } from "@/lib/audit";

export interface CreateProjectResult {
  ok: boolean;
  slug?: string;
  error?: string;
}

export async function createProjectAction(
  formData: FormData,
): Promise<CreateProjectResult> {
  const name = String(formData.get("name") || "").trim();
  if (!name) {
    return { ok: false, error: "Name is required" };
  }

  const description = (String(formData.get("description") || "") || null) as
    | string
    | null;
  const color = (String(formData.get("color") || "") || null) as string | null;
  const icon = (String(formData.get("icon") || "") || null) as string | null;

  let slug = String(formData.get("slug") || "").trim();
  if (!slug) slug = slugify(name);
  slug = await uniqueSlug(slug);

  const { data, error } = await supabaseAdmin
    .from("projects")
    .insert({
      name,
      slug,
      description,
      color,
      icon,
      status: "active",
    })
    .select("id, slug")
    .single();

  if (error) {
    console.error("createProjectAction insert error:", error);
    if (error.code === "23505") {
      return { ok: false, error: "Slug already exists" };
    }
    return { ok: false, error: "Failed to create project" };
  }

  logAudit("project.create", {
    projectId: data.id,
    name,
    slug,
    via: "server-action",
  }).catch(console.error);

  // Revalidate the workspace layout so the sidebar picks up the new project
  revalidatePath("/", "layout");

  return { ok: true, slug: data.slug };
}

export interface RenameProjectResult {
  ok: boolean;
  error?: string;
}

export async function renameProjectAction(
  projectId: string,
  newName: string,
): Promise<RenameProjectResult> {
  const name = newName.trim();
  if (!name) return { ok: false, error: "Name is required" };

  const { error } = await supabaseAdmin
    .from("projects")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", projectId);

  if (error) {
    console.error("renameProjectAction error:", error);
    return { ok: false, error: "Failed to rename project" };
  }

  logAudit("project.update", {
    projectId,
    fields: ["name"],
    via: "server-action",
  }).catch(console.error);
  revalidatePath("/", "layout");
  return { ok: true };
}

export interface ArchiveProjectResult {
  ok: boolean;
  error?: string;
}

export async function archiveProjectAction(
  projectId: string,
): Promise<ArchiveProjectResult> {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("projects")
    .update({ status: "archived", closed_at: now, updated_at: now })
    .eq("id", projectId);

  if (error) {
    console.error("archiveProjectAction error:", error);
    return { ok: false, error: "Failed to archive project" };
  }

  logAudit("project.archive", { projectId, via: "server-action" }).catch(
    console.error,
  );
  revalidatePath("/", "layout");
  return { ok: true };
}
