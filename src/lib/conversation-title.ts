// src/lib/conversation-title.ts
//
// Canonical conversation titles. When a new conversation is created
// (see src/app/api/chat/route.ts), its title is set to the first
// 60 characters of the user's opening message. That's the best we
// can do on turn 1 — we have no assistant response to summarize yet.
//
// After the second exchange (user → assistant → user → assistant)
// we have enough context to write a real title. This module is
// called once, at the end of the second turn, to replace the
// first-message snippet with a short 3-6 word summary. Subsequent
// turns don't touch the title — the rewrite is idempotent because
// the trigger condition (history.length === 2) only fires once.
//
// Cost: ~$0.0002 per call on gpt-4o-mini. Runs once per conversation.

import { supabaseAdmin } from "@/lib/supabase";
import { getOpenAI } from "@/lib/clients";
import { UTILITY_MODEL } from "@/lib/models";
import { createLogger } from "@/lib/logger";

const log = createLogger("conversation-title");

interface HistoryEntry {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Rewrite a conversation title based on its first two exchanges.
 * Fire-and-forget — callers can ignore the return value. Errors are
 * logged but never thrown, because a failed title rewrite should
 * never break a chat turn.
 */
export async function rewriteConversationTitle(args: {
  conversationId: string;
  firstUserMessage: string;
  firstAssistantMessage: string;
  secondUserMessage: string;
  secondAssistantMessage: string;
}): Promise<void> {
  const {
    conversationId,
    firstUserMessage,
    firstAssistantMessage,
    secondUserMessage,
    secondAssistantMessage,
  } = args;

  try {
    const openai = getOpenAI();
    const res = await openai.chat.completions.create({
      model: UTILITY_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      max_tokens: 100,
      messages: [
        {
          role: "system",
          content: `You write short archival titles for conversations in a bilingual Arabic/English document intelligence workspace. The title is shown in a sidebar history list — it must be scannable at a glance.

HARD RULES:
- 3 to 7 words. Not more, not fewer.
- Title describes the SUBJECT of the conversation, not the action the user took. "Abu Dhabi Ports MoU review" is good; "User asked about the memo" is bad.
- Use the same language as the dominant content of the conversation. Arabic conversation → Arabic title. English → English.
- Arabic titles use Arabic-Indic numerals (٠-٩) for any numbers.
- No quotation marks, no trailing punctuation, no "Re:" / "Discussion of" / "About" prefixes.
- No placeholder words like "conversation", "chat", "discussion", "topic".

RESPOND with JSON: {"title": "..."}`,
        },
        {
          role: "user",
          content: `First exchange:
USER: ${firstUserMessage.slice(0, 800)}
ASSISTANT: ${firstAssistantMessage.slice(0, 800)}

Second exchange:
USER: ${secondUserMessage.slice(0, 800)}
ASSISTANT: ${secondAssistantMessage.slice(0, 800)}

Write the canonical title.`,
        },
      ],
    });

    const raw = res.choices[0]?.message?.content ?? "";
    let parsed: { title?: unknown };
    try {
      parsed = JSON.parse(raw) as { title?: unknown };
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return;
      try {
        parsed = JSON.parse(match[0]) as { title?: unknown };
      } catch {
        return;
      }
    }
    const title =
      typeof parsed.title === "string" ? parsed.title.trim() : "";
    if (!title) return;
    if (title.length < 3 || title.length > 120) return;

    const { error } = await supabaseAdmin
      .from("conversations")
      .update({ title })
      .eq("id", conversationId);
    if (error) {
      log.warn("failed to update conversation title", {
        conversationId,
        error: error.message,
      });
    }
  } catch (err) {
    log.warn("title rewrite failed", {
      conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Decide whether this turn is the right moment to rewrite the title.
 * The rewrite should fire exactly once per conversation, after the
 * second assistant response. `history` here is the conversation
 * context passed into runChatTurn BEFORE the current turn's user
 * message is appended — so:
 *
 *   history.length === 0  → this is turn 1 (nothing to summarize yet)
 *   history.length === 2  → this is turn 2 (run the rewrite)
 *   history.length >= 4   → subsequent turns, skip
 */
export function shouldRewriteTitle(history: HistoryEntry[]): boolean {
  return history.length === 2;
}

/**
 * Extract the four messages we need from the history + current turn.
 * Returns null if the shape doesn't match expectations (defensive —
 * if history is malformed, skip the rewrite rather than crash).
 */
export function extractRewriteInputs(
  history: HistoryEntry[],
  currentUserMessage: string,
  currentAssistantMessage: string,
): {
  firstUserMessage: string;
  firstAssistantMessage: string;
  secondUserMessage: string;
  secondAssistantMessage: string;
} | null {
  if (history.length !== 2) return null;
  const [first, second] = history;
  if (first.role !== "user" || second.role !== "assistant") return null;
  return {
    firstUserMessage: first.content,
    firstAssistantMessage: second.content,
    secondUserMessage: currentUserMessage,
    secondAssistantMessage: currentAssistantMessage,
  };
}
