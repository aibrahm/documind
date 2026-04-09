// src/lib/models.ts
//
// Single source of truth for every model identifier used across the
// product. Before this existed, the same model IDs were scattered across
// at least six files (chat-turn.ts, intelligence-router.ts, memory.ts,
// claude-with-tools.ts, context-card.ts, project-summary.ts, and every
// Claude tool handler). A model retirement meant grepping, praying, and
// then discovering the stray reference weeks later in production.
//
// Rule: if you type a model string literal anywhere in src/lib or src/app,
// you are doing it wrong. Import from here instead.
//
// This file complements src/lib/chat-models.ts, which holds the USER-
// facing model picker labels ("auto" / "gpt-5.4" / "claude-opus-4-6").
// That file is about UI; this file is about the backend source of truth
// for every LLM call, including ones the user never sees.

/**
 * Primary chat model used for visible assistant replies in every mode
 * (casual, search, and deep when Claude is unavailable). Also used as
 * the fallback model when Claude tool-use fails mid-stream.
 */
export const PRIMARY_CHAT_MODEL = "gpt-5.4" as const;

/**
 * Intelligence router model — decides casual vs search vs deep, picks
 * doctrines, and rewrites the search query. Runs on every turn before
 * retrieval, so it needs to be fast. We deliberately use the same model
 * as the primary chat path to keep routing and drafting aligned on tone
 * and to simplify prompt debugging.
 */
export const ROUTER_MODEL = "gpt-5.4" as const;

/**
 * Deep-analysis model with tool use. Called when the router picks
 * `mode: "deep"` and Anthropic credentials are configured; falls back
 * to PRIMARY_CHAT_MODEL when not.
 */
export const DEEP_ANALYSIS_MODEL = "claude-opus-4-6" as const;

/**
 * Small, fast model used for cheap background jobs: memory extraction,
 * document context cards, project summary updates, and tool-side
 * summarization (e.g., extract_key_terms). gpt-4o-mini is the sweet
 * spot on cost vs Arabic quality right now.
 */
export const UTILITY_MODEL = "gpt-4o-mini" as const;

/**
 * Vision-capable model for multimodal extraction fallback. Not currently
 * in the critical path but kept here so the constant exists when the
 * next extraction refactor needs it.
 */
export const VISION_MODEL = "gpt-4o" as const;

/**
 * Union of every known ID. Useful for exhaustive switches and type
 * constraints at API boundaries.
 */
export type KnownModelId =
  | typeof PRIMARY_CHAT_MODEL
  | typeof ROUTER_MODEL
  | typeof DEEP_ANALYSIS_MODEL
  | typeof UTILITY_MODEL
  | typeof VISION_MODEL;

/**
 * Consolidated export so callers can `import { MODELS } from "@/lib/models"`
 * and pass `MODELS.utility` into a generic wrapper. Prefer the named
 * constants for direct calls.
 */
export const MODELS = {
  primaryChat: PRIMARY_CHAT_MODEL,
  router: ROUTER_MODEL,
  deepAnalysis: DEEP_ANALYSIS_MODEL,
  utility: UTILITY_MODEL,
  vision: VISION_MODEL,
} as const;
