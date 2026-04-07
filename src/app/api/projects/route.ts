import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { CREATE_FIELDS, slugify, uniqueSlug } from "@/lib/projects";
import { logAudit } from "@/lib/audit";

const ALLOWED_STATUS = new Set(["active", "on_hold", "closed", "archived"]);

// GET /api/projects?status=active
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    let query = supabaseAdmin
      .from("projects")
      .select("id, name, slug, description, status, start_date, target_close, closed_at, color, icon, context_summary, created_at, updated_at")
      .order("updated_at", { ascending: false });

    if (status) {
      if (!ALLOWED_STATUS.has(status)) {
        return NextResponse.json({ error: `Invalid status filter: ${status}` }, { status: 400 });
      }
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      console.error("Projects list error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    return NextResponse.json({ projects: data || [] });
  } catch (err) {
    console.error("Projects GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/projects
export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // Whitelist body to allowed create fields
    const filtered: Record<string, unknown> = {};
    for (const k of CREATE_FIELDS) {
      if (body[k] !== undefined) filtered[k] = body[k];
    }
    const unknownKeys = Object.keys(body).filter((k) => !(CREATE_FIELDS as readonly string[]).includes(k));
    if (unknownKeys.length > 0) {
      return NextResponse.json({ error: `Unknown fields: ${unknownKeys.join(", ")}` }, { status: 400 });
    }

    // Required: name (non-empty string)
    const name = typeof filtered.name === "string" ? filtered.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    // Auto-generate slug if not provided
    let slug = typeof filtered.slug === "string" ? filtered.slug.trim() : "";
    if (!slug) slug = slugify(name);
    slug = await uniqueSlug(slug);

    // Validate status if provided
    if (filtered.status !== undefined) {
      if (typeof filtered.status !== "string" || !ALLOWED_STATUS.has(filtered.status)) {
        return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
      }
    }

    const insertRow = {
      ...filtered,
      name,
      slug,
      status: (filtered.status as string | undefined) ?? "active",
    };

    const { data, error } = await supabaseAdmin
      .from("projects")
      .insert(insertRow)
      .select("*")
      .single();

    if (error) {
      console.error("Project create error:", error);
      // 23505 = unique_violation (Postgres) → slug clash race
      if (error.code === "23505") {
        return NextResponse.json({ error: "Slug already exists" }, { status: 409 });
      }
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    logAudit("project.create", { projectId: data.id, name, slug }).catch(console.error);
    return NextResponse.json({ project: data }, { status: 201 });
  } catch (err) {
    console.error("Projects POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
