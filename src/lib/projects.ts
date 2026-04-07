// src/lib/projects.ts

import { supabaseAdmin } from "./supabase";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Detect whether an URL path segment is a UUID or a slug.
 */
export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

/**
 * Generate a URL-friendly slug from a project name.
 * - Lowercase
 * - Replace non-alphanumeric (incl. Arabic) with single dash
 * - Collapse repeated dashes
 * - Strip leading/trailing dashes
 *
 * For Arabic-only names, the result will be empty after stripping
 * non-alphanumeric — in that case, fall back to a timestamp-based slug.
 */
export function slugify(name: string): string {
  // Normalize unicode, then strip diacritics
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, ""); // diacritics

  // Replace anything not a-z0-9 (after lowercasing) with a dash
  let slug = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  // If the slug is empty (e.g. all-Arabic name) or too short, fall back
  if (slug.length < 2) {
    slug = `project-${Date.now().toString(36)}`;
  }

  return slug.slice(0, 80); // cap length
}

/**
 * Find a slug that doesn't clash with existing projects.
 * If `base` is taken, try `base-2`, `base-3`, etc.
 */
export async function uniqueSlug(base: string): Promise<string> {
  let candidate = base;
  let suffix = 1;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("projects")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (error && error.code !== "PGRST116") {
      // Unknown error — log and bail with the base candidate; the unique
      // constraint will catch it at insert time as a 409.
      console.error("uniqueSlug lookup failed:", error);
      return candidate;
    }
    if (!data) return candidate;
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}

/**
 * Resolve a path segment that may be either a UUID or a slug to a row id.
 * Returns null if no project matches.
 */
export async function resolveProjectId(idOrSlug: string): Promise<string | null> {
  if (isUuid(idOrSlug)) {
    // Direct lookup by id (just to confirm it exists and isn't archived)
    const { data } = await supabaseAdmin
      .from("projects")
      .select("id")
      .eq("id", idOrSlug)
      .maybeSingle();
    return data?.id ?? null;
  }
  // Slug lookup
  const { data } = await supabaseAdmin
    .from("projects")
    .select("id")
    .eq("slug", idOrSlug)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Whitelist of fields the API allows on create.
 */
export const CREATE_FIELDS = [
  "name",
  "slug",
  "description",
  "status",
  "color",
  "icon",
  "context_summary",
  "start_date",
  "target_close",
] as const;

/**
 * Whitelist of fields the API allows on update.
 * Note: includes closed_at (set when archiving), excludes id and created_at.
 */
export const UPDATE_FIELDS = [
  "name",
  "slug",
  "description",
  "status",
  "color",
  "icon",
  "context_summary",
  "start_date",
  "target_close",
  "closed_at",
] as const;
