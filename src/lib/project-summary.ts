/**
 * Project status narrative — the "mini LLM" that keeps track of where
 * the user is in a given project.
 *
 * After each chat turn (and optionally after uploads, artifact saves,
 * entity edits), a cheap gpt-4o-mini call reads the previous summary
 * plus the latest event and produces a new ~100-word narrative stored
 * in `projects.context_summary`. The narrative is:
 *
 *   1. Shown at the top of the project dashboard as "Where we are"
 *   2. Injected into every new chat turn's system prompt so the model
 *      has project-level continuity without re-reading every document
 *
 * Cost: ~$0.001 per update. Negligible vs the chat turn cost.
 */

import { getOpenAI } from "@/lib/clients";
import { supabaseAdmin } from "@/lib/supabase";
import { createLogger } from "@/lib/logger";

const log = createLogger("project-summary");

const SUMMARY_MODEL = "gpt-4o-mini";
const MAX_SUMMARY_CHARS = 800;

interface UpdateSummaryInput {
  projectId: string;
  userMessage?: string;
  assistantMessage?: string;
  event?: string; // e.g. "document uploaded", "artifact saved"
  eventDetail?: string;
}

/**
 * Update the project's context_summary based on a new event (chat turn,
 * upload, etc.). Fails silently with a warning log — summary failures
 * should never block the turn that triggered them.
 */
export async function updateProjectSummary(
  input: UpdateSummaryInput,
): Promise<void> {
  try {
    // Load the current project state. We need the name, description, and
    // the existing summary (so we can evolve it rather than rewrite it).
    const { data: project, error } = await supabaseAdmin
      .from("projects")
      .select("id, name, description, context_summary")
      .eq("id", input.projectId)
      .maybeSingle();

    if (error || !project) {
      log.warn("project not found for summary update", {
        projectId: input.projectId,
        error: error?.message,
      });
      return;
    }

    const previousSummary =
      (project.context_summary as string | null) || "";

    const openai = getOpenAI();

    const systemPrompt = `You are maintaining a running status narrative for a project workspace. The user is the Vice Chairman of an economic authority working on deals, negotiations, and strategic analysis.

Your job: given the PREVIOUS summary and a description of what just happened, produce an UPDATED summary that:

1. Captures WHERE the user is in this piece of work (what stage / phase / decision point)
2. Notes the KEY FINDINGS or DECISIONS so far (specific numbers, specific risks, specific parties)
3. Flags what's PENDING or coming next
4. Is ONE paragraph, 80-140 words max, no headings, no bullets
5. Uses the SAME LANGUAGE as the latest event (Arabic if the latest turn was Arabic, English if English, match)
6. Preserves specific names, numbers, and entities from the previous summary unless they've been explicitly updated

The narrative must be factual and grounded — do not invent details. If the previous summary had specific data and the new event doesn't contradict it, keep that data.

Return ONLY the updated narrative text. No preamble, no meta-commentary, just the paragraph.`;

    const eventBlock = [
      input.event ? `Event: ${input.event}` : null,
      input.eventDetail ? `Detail: ${input.eventDetail}` : null,
      input.userMessage ? `User asked: ${truncate(input.userMessage, 500)}` : null,
      input.assistantMessage
        ? `Assistant responded: ${truncate(input.assistantMessage, 1500)}`
        : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    const userPrompt = `Project: ${project.name}${project.description ? ` — ${project.description}` : ""}

Previous summary:
${previousSummary || "(no previous summary — this is the first event)"}

What just happened:
${eventBlock}

Produce the updated narrative now.`;

    const res = await openai.chat.completions.create({
      model: SUMMARY_MODEL,
      temperature: 0.2,
      max_completion_tokens: 400,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const newSummary = (res.choices[0]?.message?.content || "").trim();
    if (!newSummary) {
      log.warn("empty summary returned", { projectId: input.projectId });
      return;
    }

    // Hard cap to prevent runaway summaries
    const capped =
      newSummary.length > MAX_SUMMARY_CHARS
        ? newSummary.slice(0, MAX_SUMMARY_CHARS)
        : newSummary;

    const { error: updateError } = await supabaseAdmin
      .from("projects")
      .update({
        context_summary: capped,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.projectId);

    if (updateError) {
      log.warn("failed to save project summary", {
        projectId: input.projectId,
        error: updateError.message,
      });
      return;
    }

    log.info("project summary updated", {
      projectId: input.projectId,
      length: capped.length,
    });
  } catch (err) {
    log.warn("updateProjectSummary failed", {
      projectId: input.projectId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}
