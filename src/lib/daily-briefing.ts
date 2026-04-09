// src/lib/daily-briefing.ts
//
// The landing page briefing — what the Vice Chairman sees the moment
// he opens the app. This is the single most "AI-is-doing-work-for-me"
// moment in the product: instead of the assistant waiting for a
// question, it reads what's new across the workspace and writes a
// 3–5 bullet briefing on the state of things.
//
// ── Inputs the briefing reads ─────────────────────────────────────
//
//   1. Documents uploaded in the last 7 days, with their context cards
//      (summary + key obligations). This is the "what came in" layer.
//   2. Conversations active in the last 7 days, with the one-liner
//      project they belong to. This is the "what we talked about"
//      layer.
//   3. Projects with updated_at in the last 14 days, with their
//      `context_summary` running narrative. This is "what's moving."
//   4. Memory items with importance >= 0.6 captured in the last 14
//      days. These are durable takeaways the assistant extracted from
//      earlier chat turns — decisions, risks, preferences — and give
//      the briefing access to insights beyond what's in the raw docs.
//   5. Recurring counterparty entities: entities that appear in BOTH
//      a document uploaded in the last 7 days AND one uploaded
//      earlier. Cross-deal recurrences are high-signal for a Vice
//      Chairman — "this counterparty is showing up in three places
//      this week" is exactly the kind of pattern he needs to catch.
//
// ── Output ────────────────────────────────────────────────────────
//
//   A DailyBriefing union:
//     { kind: "active", bullets: [...] }    — 3-5 bullets
//     { kind: "quiet",  message: "..." }    — single line for dead weeks
//     { kind: "empty" }                     — fresh workspace, hide block
//
// ── Caching ───────────────────────────────────────────────────────
//
//   The generated payload is cached on workspace_profile.briefing_cache
//   (jsonb) + briefing_generated_at (timestamptz). TTL is CACHE_TTL_MS
//   below. A caller can pass { force: true } to bypass the cache — the
//   /api/briefing/refresh route uses this when the user clicks the
//   manual refresh button on the briefing block.

import { supabaseAdmin } from "@/lib/supabase";
import { getOpenAI } from "@/lib/clients";
import { UTILITY_MODEL } from "@/lib/models";
import { createLogger } from "@/lib/logger";
import { sanitizeDateString } from "@/lib/date-sanitize";

const log = createLogger("daily-briefing");

const RECENT_DOC_DAYS = 7;
const RECENT_CONVO_DAYS = 7;
const RECENT_PROJECT_DAYS = 14;
const RECENT_MEMORY_DAYS = 14;
const MAX_BULLETS = 5;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * One line of the briefing. The `link` field is optional and points
 * at either a document or a project — the UI uses it to make the
 * bullet clickable. Bullets with no link are rendered as plain text.
 */
export interface BriefingBullet {
  text: string;
  link?:
    | { kind: "document"; documentId: string; title: string }
    | { kind: "project"; slug: string; name: string };
}

export type DailyBriefing =
  | { kind: "active"; generatedAt: string; bullets: BriefingBullet[] }
  | { kind: "quiet"; generatedAt: string; message: string }
  | { kind: "empty"; generatedAt: string };

interface RecentDocRow {
  id: string;
  title: string;
  type: string;
  classification: string;
  created_at: string;
  language: string;
  context_card: Record<string, unknown> | null;
  entities: string[] | null;
}

interface RecentConvoRow {
  id: string;
  title: string | null;
  project_id: string | null;
  last_message_at: string | null;
  created_at: string;
}

interface RecentProjectRow {
  id: string;
  name: string;
  slug: string;
  updated_at: string;
  context_summary: string | null;
}

interface RecentMemoryRow {
  id: string;
  text: string;
  kind: string;
  scope_type: string;
  importance: number | null;
  created_at: string | null;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/**
 * Read the cached briefing from workspace_profile. Returns null if
 * nothing is cached, if the cache is older than CACHE_TTL_MS, or if
 * the row can't be read for any reason (fail-open: we'd rather
 * regenerate than block on a stale read).
 */
async function readCachedBriefing(): Promise<DailyBriefing | null> {
  const { data, error } = await supabaseAdmin
    .from("workspace_profile")
    .select("briefing_cache, briefing_generated_at")
    .eq("id", "default")
    .maybeSingle();
  if (error || !data) return null;
  const generatedAt = data.briefing_generated_at as string | null;
  const cached = data.briefing_cache as DailyBriefing | null;
  if (!generatedAt || !cached) return null;
  const age = Date.now() - Date.parse(generatedAt);
  if (Number.isNaN(age) || age > CACHE_TTL_MS) return null;
  return cached;
}

/**
 * Write the freshly-generated briefing to the cache. Best-effort —
 * a failure to cache should not prevent returning the briefing to
 * the caller, so we swallow errors here and log.
 */
async function writeCachedBriefing(briefing: DailyBriefing): Promise<void> {
  // The jsonb column is typed as `Json` in the generated types, which
  // is a strict recursive union that our tagged-union type doesn't
  // match structurally. Cast is safe — briefing is a pure data shape
  // with primitives, arrays, and plain objects.
  const payload = briefing as unknown as import("@/lib/database.types").Json;
  const { error } = await supabaseAdmin
    .from("workspace_profile")
    .update({
      briefing_cache: payload,
      briefing_generated_at: briefing.generatedAt,
    })
    .eq("id", "default");
  if (error) {
    log.warn("failed to write briefing cache", { error: error.message });
  }
}

export interface GenerateBriefingOptions {
  /** Skip the cache read and regenerate from scratch. */
  force?: boolean;
}

/**
 * Drop the cached briefing so the next page load regenerates from
 * scratch. Called from document ingest and delete paths so the VC
 * never sees a briefing that references a just-deleted document or
 * misses a just-uploaded one. Failures are swallowed — a cache-bust
 * that can't write is identical in effect to a cache that already
 * expired naturally.
 */
export async function invalidateBriefingCache(): Promise<void> {
  const { error } = await supabaseAdmin
    .from("workspace_profile")
    .update({
      briefing_cache: null,
      briefing_generated_at: null,
    })
    .eq("id", "default");
  if (error) {
    log.warn("failed to invalidate briefing cache", { error: error.message });
  }
}

export async function generateDailyBriefing(
  options: GenerateBriefingOptions = {},
): Promise<DailyBriefing> {
  if (!options.force) {
    const cached = await readCachedBriefing();
    if (cached) return cached;
  }

  const generatedAt = new Date().toISOString();

  // Parallel reads — all independent.
  const [docsRes, convosRes, projectsRes, memoriesRes, allDocsCountRes] =
    await Promise.all([
      supabaseAdmin
        .from("documents")
        .select(
          "id, title, type, classification, created_at, language, context_card, entities",
        )
        .eq("status", "ready")
        .gte("created_at", isoDaysAgo(RECENT_DOC_DAYS))
        .order("created_at", { ascending: false })
        .limit(10),
      supabaseAdmin
        .from("conversations")
        .select("id, title, project_id, last_message_at, created_at")
        .gte("last_message_at", isoDaysAgo(RECENT_CONVO_DAYS))
        .order("last_message_at", { ascending: false })
        .limit(8),
      supabaseAdmin
        .from("projects")
        .select("id, name, slug, updated_at, context_summary")
        .neq("status", "archived")
        .gte("updated_at", isoDaysAgo(RECENT_PROJECT_DAYS))
        .order("updated_at", { ascending: false })
        .limit(5),
      supabaseAdmin
        .from("memory_items")
        .select("id, text, kind, scope_type, importance, created_at")
        .in("scope_type", ["project", "shared"])
        .gte("importance", 0.6)
        .gte("created_at", isoDaysAgo(RECENT_MEMORY_DAYS))
        .order("importance", { ascending: false })
        .limit(6),
      supabaseAdmin
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("status", "ready"),
    ]);

  const recentDocs = (docsRes.data ?? []) as RecentDocRow[];
  const recentConvos = (convosRes.data ?? []) as RecentConvoRow[];
  const recentProjects = (projectsRes.data ?? []) as RecentProjectRow[];
  const recentMemories = (memoriesRes.data ?? []) as RecentMemoryRow[];
  const totalDocs = allDocsCountRes.count ?? 0;

  // Empty workspace — nothing to brief about.
  if (totalDocs === 0) {
    const empty: DailyBriefing = { kind: "empty", generatedAt };
    await writeCachedBriefing(empty);
    return empty;
  }

  // ── Compute recurring counterparties ──
  //
  // An entity is "recurring" if it's linked to at least one document
  // uploaded in the last 7 days AND to at least one older document.
  // That's the cross-deal signal — the same party showing up in
  // multiple places this week.
  let recurringEntities: Array<{ name: string; count: number }> = [];
  const newDocIds = recentDocs.map((d) => d.id);
  if (newDocIds.length > 0) {
    // Fetch entity links for the new docs.
    const { data: newLinks } = await supabaseAdmin
      .from("document_entities")
      .select("entity_id")
      .in("document_id", newDocIds);
    const newEntityIds = new Set(
      (newLinks ?? []).map((l) => l.entity_id as string),
    );
    if (newEntityIds.size > 0) {
      // For each new-doc entity, count how many total docs it's linked to.
      const { data: allLinks } = await supabaseAdmin
        .from("document_entities")
        .select("entity_id")
        .in("entity_id", [...newEntityIds]);
      const totalCountByEntity = new Map<string, number>();
      for (const l of allLinks ?? []) {
        const id = l.entity_id as string;
        totalCountByEntity.set(id, (totalCountByEntity.get(id) ?? 0) + 1);
      }
      const recurringIds = [...newEntityIds].filter(
        (id) => (totalCountByEntity.get(id) ?? 0) >= 2,
      );
      if (recurringIds.length > 0) {
        const { data: entityRows } = await supabaseAdmin
          .from("entities")
          .select("id, name, name_en")
          .in("id", recurringIds);
        recurringEntities = (entityRows ?? [])
          .map((e) => ({
            name: (e.name as string) || (e.name_en as string) || "",
            count: totalCountByEntity.get(e.id as string) ?? 0,
          }))
          .filter((e) => e.name)
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);
      }
    }
  }

  // Quiet week — something exists but nothing recent AND no memory
  // activity. Return a neutral status line without calling the LLM.
  if (
    recentDocs.length === 0 &&
    recentConvos.length === 0 &&
    recentProjects.length === 0 &&
    recentMemories.length === 0
  ) {
    const quiet: DailyBriefing = {
      kind: "quiet",
      generatedAt,
      message:
        "Nothing new this week. Drop a PDF or open an old thread to pick up where you left off.",
    };
    await writeCachedBriefing(quiet);
    return quiet;
  }

  // Build the payload for the LLM. Compact — no document bodies,
  // just context-card summaries + obligations + linked entities.
  const docsBlock =
    recentDocs.length === 0
      ? "(none)"
      : recentDocs
          .map((d) => {
            const card = (d.context_card ?? {}) as {
              summary_en?: string;
              summary_ar?: string | null;
              key_obligations?: string[];
              key_dates?: string[];
              document_role?: string;
            };
            const summary =
              d.language === "ar" && card.summary_ar
                ? card.summary_ar
                : card.summary_en ?? "";
            const obligations = (card.key_obligations ?? [])
              .slice(0, 2)
              .join("; ");
            const dates = (card.key_dates ?? [])
              .map(sanitizeDateString)
              .filter((s): s is string => s !== null)
              .slice(0, 2)
              .join(", ");
            return [
              `- id=${d.id}`,
              `  title: "${d.title}"`,
              `  type: ${d.type}`,
              `  created: ${d.created_at}`,
              summary ? `  summary: ${summary.slice(0, 240)}` : "",
              obligations ? `  obligations: ${obligations}` : "",
              dates ? `  dates: ${dates}` : "",
            ]
              .filter(Boolean)
              .join("\n");
          })
          .join("\n");

  const projectMap = new Map(recentProjects.map((p) => [p.id, p]));
  const convosBlock =
    recentConvos.length === 0
      ? "(none)"
      : recentConvos
          .map((c) => {
            const proj = c.project_id ? projectMap.get(c.project_id) : null;
            const projPart = proj
              ? ` (project: "${proj.name}", slug=${proj.slug})`
              : "";
            return `- "${(c.title ?? "Untitled conversation").slice(0, 80)}"${projPart}  last=${c.last_message_at ?? c.created_at}`;
          })
          .join("\n");

  const projectsBlock =
    recentProjects.length === 0
      ? "(none)"
      : recentProjects
          .map(
            (p) =>
              `- slug=${p.slug}  "${p.name}"  ${
                p.context_summary ? `— ${p.context_summary.slice(0, 200)}` : ""
              }`,
          )
          .join("\n");

  const memoriesBlock =
    recentMemories.length === 0
      ? "(none)"
      : recentMemories
          .map(
            (m) =>
              `- [${m.kind}, importance=${(m.importance ?? 0).toFixed(2)}, scope=${m.scope_type}] ${m.text.slice(0, 200)}`,
          )
          .join("\n");

  const recurringBlock =
    recurringEntities.length === 0
      ? "(none)"
      : recurringEntities
          .map((e) => `- "${e.name}" appears in ${e.count} documents`)
          .join("\n");

  const systemPrompt = `You write the opening briefing the Vice Chairman of an Egyptian economic authority sees when he opens his document intelligence workspace. Think: the first two minutes of a morning update from a sharp chief of staff.

HARD RULES:
- 3 to 5 bullets. Not more, not fewer.
- Each bullet is ONE short sentence. 12-25 words.
- Lead with the substance, not filler. Never start a bullet with "Here's" / "Today" / "I noticed" / "There's a new".
- Prioritize by decision-relevance. What matters most to a Vice Chairman between meetings.
- Every bullet MUST include a structured link target when the bullet is about a specific document or project. Use the ids provided in the input.
- When a counterparty is "recurring" across multiple documents this week, that pattern is high-signal — mention it in at least one bullet if the list is non-empty.
- When a memory item is high-importance and recent, prefer it over a generic document recap — the memory already captures why it matters.
- Respond in the language that matches the dominant content. Mixed workspace → default to English.
- When talking about specific amounts or dates, use the original document's own numerals (Arabic-Indic for Arabic content, Western for English content).
- No closing summary, no pleasantries, no "hope this helps."

RESPOND with JSON matching this schema:
{
  "bullets": [
    {
      "text": "string — one sharp sentence, no prefix",
      "link": { "kind": "document", "id": "<document uuid>" } | { "kind": "project", "slug": "<project slug>" } | null
    }
  ]
}`;

  const userPrompt = `Recent documents uploaded in the last ${RECENT_DOC_DAYS} days:
${docsBlock}

Recent conversations in the last ${RECENT_CONVO_DAYS} days:
${convosBlock}

Projects updated in the last ${RECENT_PROJECT_DAYS} days:
${projectsBlock}

High-importance durable memories captured in the last ${RECENT_MEMORY_DAYS} days:
${memoriesBlock}

Recurring counterparties (entities appearing in this week's uploads AND in older documents):
${recurringBlock}

Write the briefing.`;

  try {
    const openai = getOpenAI();
    const res = await openai.chat.completions.create({
      model: UTILITY_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      max_tokens: 800,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = res.choices[0]?.message?.content ?? "";
    const parsed = safeParseJson(raw);
    const rawBullets = Array.isArray(parsed?.bullets) ? parsed.bullets : [];

    const docTitleById = new Map(recentDocs.map((d) => [d.id, d.title]));
    const projectNameBySlug = new Map(
      recentProjects.map((p) => [p.slug, p.name]),
    );

    const bullets: BriefingBullet[] = [];
    for (const b of rawBullets) {
      if (!b || typeof b !== "object") continue;
      const text =
        typeof (b as { text?: unknown }).text === "string"
          ? (b as { text: string }).text.trim()
          : "";
      if (!text) continue;
      const bullet: BriefingBullet = { text };
      const rawLink = (b as { link?: unknown }).link;
      if (rawLink && typeof rawLink === "object") {
        const link = rawLink as {
          kind?: unknown;
          id?: unknown;
          slug?: unknown;
        };
        if (
          link.kind === "document" &&
          typeof link.id === "string" &&
          docTitleById.has(link.id)
        ) {
          bullet.link = {
            kind: "document",
            documentId: link.id,
            title: docTitleById.get(link.id)!,
          };
        } else if (
          link.kind === "project" &&
          typeof link.slug === "string" &&
          projectNameBySlug.has(link.slug)
        ) {
          bullet.link = {
            kind: "project",
            slug: link.slug,
            name: projectNameBySlug.get(link.slug)!,
          };
        }
      }
      bullets.push(bullet);
      if (bullets.length >= MAX_BULLETS) break;
    }

    if (bullets.length === 0) {
      log.warn("briefing generator returned zero bullets");
      const quiet: DailyBriefing = {
        kind: "quiet",
        generatedAt,
        message: "Nothing urgent this week.",
      };
      await writeCachedBriefing(quiet);
      return quiet;
    }

    const active: DailyBriefing = { kind: "active", generatedAt, bullets };
    await writeCachedBriefing(active);
    return active;
  } catch (err) {
    log.error("briefing generation failed", err);
    // Don't cache error states — a transient failure should not
    // pin the UI on "temporarily unavailable" for the full TTL.
    return {
      kind: "quiet",
      generatedAt,
      message: "Briefing temporarily unavailable.",
    };
  }
}

function safeParseJson(raw: string): { bullets?: unknown } | null {
  try {
    return JSON.parse(raw) as { bullets?: unknown };
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as { bullets?: unknown };
    } catch {
      return null;
    }
  }
}
