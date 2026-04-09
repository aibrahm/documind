// Landing page — the VC's entry point into the workspace.
//
// This is a server component so the three guided query cards render on
// first paint instead of flashing in after a client-side fetch. The cards
// are derived from real workspace data (most recent project, top-linked
// entity, most recent document) so the very first interaction is already
// on a useful question rather than a blinking cursor.
//
// All chat state lives in <WorkspaceHome>, the client child.

import { WorkspaceHome } from "@/components/workspace-home";
import { getWorkspaceSuggestions } from "@/lib/workspace-suggestions";
import { generateDailyBriefing } from "@/lib/daily-briefing";
import { getWorkspaceLanguage } from "@/lib/workspace-profile";

// Force dynamic rendering — the guided queries and the daily briefing
// both reflect the current state of the workspace (latest project,
// latest doc, 7-day activity). If Next.js prerenders this at build
// time we'd ship stale content baked into the bundle. Reads are cheap
// (a handful of parallel Supabase queries + one gpt-4o-mini call) so
// paying the per-request cost is fine for a single-user deployment.
export const dynamic = "force-dynamic";

export default async function Home() {
  // Fetch the guided queries, the briefing, and the UI chrome
  // language in parallel. None of them block each other. A briefing
  // failure falls back to a neutral "quiet" state inside
  // generateDailyBriefing — never throws. A language lookup failure
  // defaults to "ar" so the UI always renders.
  const [suggestions, briefing, language] = await Promise.all([
    getWorkspaceSuggestions(),
    generateDailyBriefing(),
    getWorkspaceLanguage(),
  ]);
  return (
    <WorkspaceHome
      suggestions={suggestions}
      briefing={briefing}
      language={language}
    />
  );
}
