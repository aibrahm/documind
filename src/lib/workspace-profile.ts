import { supabaseAdmin } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

export type WorkspaceProfileRow = Database["public"]["Tables"]["workspace_profile"]["Row"];

export async function getWorkspaceProfile(): Promise<WorkspaceProfileRow | null> {
  const { data, error } = await supabaseAdmin
    .from("workspace_profile")
    .select("*")
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    console.error("workspace_profile fetch failed:", error);
    return null;
  }

  return data ?? null;
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
