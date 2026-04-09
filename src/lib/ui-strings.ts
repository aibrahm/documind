// src/lib/ui-strings.ts
//
// Bilingual UI chrome strings for the landing page and project
// workspace. Everything the VC reads OUTSIDE the chat stream — the
// card labels, the greeting, the "Start here" header — follows his
// preferred_language setting stored on workspace_profile.
//
// The chat stream itself (assistant messages, user messages) is
// already bilingual-aware via the POSTURE block in chat-turn.ts.
// This file is specifically for the static UI scaffolding: headers,
// labels, button tooltips, empty-state copy.
//
// New strings get added in pairs. Never have an en string without
// an ar counterpart — if you don't know the Arabic yet, leave the
// English in both slots and flag it with a TODO so the gap is
// obvious.

export type UiLanguage = "ar" | "en";

interface UiStrings {
  // Landing page
  greeting: string;
  greetingSubtitle: string;
  startHere: string;
  briefingLabel: string;
  briefingRefreshTooltip: string;
  briefingEmpty: string;
  briefingQuietFallback: string;

  // Project workspace
  whereWeAre: string;
  updatedRelativePrefix: string; // e.g. "updated " → "updated 3d ago"
  newProjectPlaceholder: string;

  // Briefing relative time labels (used in the project "updated Xh ago" chip)
  justNow: string;
  hoursAgo: (n: number) => string;
  daysAgo: (n: number) => string;
  weeksAgo: (n: number) => string;
}

const EN: UiStrings = {
  greeting: "Good to see you.",
  greetingSubtitle: "Here's where things stand.",
  startHere: "Start here",
  briefingLabel: "Briefing",
  briefingRefreshTooltip: "Refresh briefing",
  briefingEmpty:
    "Drop a PDF to add context. Your briefing will start here once there's something to summarize.",
  briefingQuietFallback:
    "Nothing new this week. Drop a PDF or open an old thread to pick up where you left off.",

  whereWeAre: "Where we are",
  updatedRelativePrefix: "updated ",
  newProjectPlaceholder:
    "New project — start a chat below and the workspace will build context as you go.",

  justNow: "just now",
  hoursAgo: (n) => `${n}h ago`,
  daysAgo: (n) => `${n}d ago`,
  weeksAgo: (n) => `${n}w ago`,
};

const AR: UiStrings = {
  greeting: "أهلاً.",
  greetingSubtitle: "هذا ما يجري الآن.",
  startHere: "ابدأ من هنا",
  briefingLabel: "الإحاطة",
  briefingRefreshTooltip: "تحديث الإحاطة",
  briefingEmpty:
    "أضف مستند PDF لبدء الإحاطة. ستبدأ الإحاطات بالظهور هنا عندما يكون هناك ما يُلخَّص.",
  briefingQuietFallback:
    "لا جديد هذا الأسبوع. أضف مستنداً أو افتح محادثة سابقة لمتابعة العمل من حيث توقفت.",

  whereWeAre: "أين نحن الآن",
  updatedRelativePrefix: "آخر تحديث ",
  newProjectPlaceholder:
    "مشروع جديد — ابدأ محادثة بالأسفل وستبني المساحة السياق تدريجياً.",

  justNow: "الآن",
  hoursAgo: (n) => `منذ ${n} ساعة`,
  daysAgo: (n) => `منذ ${n} يوم`,
  weeksAgo: (n) => `منذ ${n} أسبوع`,
};

/**
 * Return the string table for the given language. Defaults to English
 * for any unknown input so we never render `undefined` in the UI.
 */
export function strings(language: UiLanguage | string | null | undefined): UiStrings {
  return language === "ar" ? AR : EN;
}

/**
 * Format a relative "updated Xh ago" label in the caller's language.
 * Returns null if the timestamp is missing or invalid.
 */
export function formatUpdatedRelative(
  iso: string | null | undefined,
  language: UiLanguage | string | null | undefined,
): string | null {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms) || ms < 0) return null;
  const s = strings(language);
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours < 1) return `${s.updatedRelativePrefix}${s.justNow}`;
  if (hours < 24) return `${s.updatedRelativePrefix}${s.hoursAgo(hours)}`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${s.updatedRelativePrefix}${s.daysAgo(days)}`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${s.updatedRelativePrefix}${s.weeksAgo(weeks)}`;
  const locale = language === "ar" ? "ar-EG" : "en-GB";
  const formatted = new Date(iso).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
  });
  return `${s.updatedRelativePrefix}${formatted}`;
}
