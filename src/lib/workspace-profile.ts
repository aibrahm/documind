import { supabaseAdmin } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

export type WorkspaceProfileRow = Database["public"]["Tables"]["workspace_profile"]["Row"];

/**
 * Tri-state result so callers can distinguish:
 *   - "missing"  — no profile row exists yet (legitimate empty state)
 *   - "ok"       — profile loaded successfully
 *   - "degraded" — fetch failed; caller should warn the user
 *
 * Previously this function returned `null` on both "missing" and
 * "degraded", so downstream code had no way to tell the difference
 * and silently ran without operator context. See CONCERNS.md B5.
 */
export type WorkspaceProfileResult =
  | { status: "ok"; profile: WorkspaceProfileRow }
  | { status: "missing"; profile: null }
  | { status: "degraded"; profile: null; error: string };

export async function getWorkspaceProfile(): Promise<WorkspaceProfileResult> {
  const { data, error } = await supabaseAdmin
    .from("workspace_profile")
    .select("*")
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    console.error("workspace_profile fetch failed:", error);
    return {
      status: "degraded",
      profile: null,
      error: error.message || "Unknown workspace_profile fetch error",
    };
  }

  if (!data) {
    return { status: "missing", profile: null };
  }

  return { status: "ok", profile: data };
}

/**
 * Single source of truth for "what language should the UI chrome
 * render in". Reads the stored preferred_language if present,
 * otherwise falls back to "ar" because this product is built for
 * an Arabic-first workspace and that's the sane default. Any value
 * other than "en" or "ar" is normalized to "ar" so the UI never
 * sees an unknown language code.
 */
export async function getWorkspaceLanguage(): Promise<"ar" | "en"> {
  const result = await getWorkspaceProfile();
  if (result.status === "ok") {
    const lang = result.profile.preferred_language;
    if (lang === "en") return "en";
    return "ar";
  }
  return "ar";
}

export function buildWorkspaceProfilePromptBlock(
  profile: WorkspaceProfileRow | null,
): string {
  if (!profile) return "";

  return `═══ OPERATOR PROFILE ═══

You are assisting this human operator:
- Name: ${profile.full_name}
- Title: ${profile.title}
- Organization: ${profile.organization}
${profile.organization_short ? `- Organization short name: ${profile.organization_short}\n` : ""}${profile.email ? `- Email: ${profile.email}\n` : ""}${profile.phone ? `- Phone: ${profile.phone}\n` : ""}- Preferred drafting language: ${profile.preferred_language}

When drafting emails, memos, letters, briefs, or meeting notes on the operator's behalf:
- Use this profile as the default sender identity unless the user explicitly overrides it.
- Do NOT use placeholders like [Name] for the sender.
- If the recipient is unknown, keep only the recipient generic. Never leave the sender generic.
- Use this exact signature block unless the user asks for a different one:
${profile.signature}

═══ END OPERATOR PROFILE ═══
`;
}
