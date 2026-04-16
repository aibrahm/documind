// src/lib/metrics.ts
//
// Per-stage extraction telemetry. Replaces the hardcoded `costs: 0` that
// used to live in extraction-v2.ts and makes the monthly-spend dashboard
// queryable. Every async stage in the pipeline should be wrapped in
// `withMetric(...)` so we get a real duration + USD cost in the
// `extraction_runs` table (migration 024).
//
// Design notes:
//   - Pricing table is the SINGLE source of truth for cost math. If a
//     model isn't in the table we fail loud (return 0 + log a warning)
//     rather than silently under-reporting cost.
//   - Recording is best-effort. If the insert into `extraction_runs`
//     fails (e.g. transient Supabase blip) we log and move on — we don't
//     want telemetry failures to cascade into extraction failures.
//   - Stage names are a soft enum in the migration comment, not a DB
//     CHECK, so new stages can be added without a migration.
import { supabaseAdmin } from "@/lib/supabase";

export type Stage =
  | "ocr"
  | "normalize"
  | "chunk"
  | "embed"
  | "llm_title"
  | "llm_context"
  | "llm_entities"
  | "llm_graph"
  | "persist"
  | "total";

interface UsageLike {
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}

// USD per 1K tokens.
//
// Sources:
//   - gpt-4o-mini: https://openai.com/api/pricing/
//   - embed-multilingual-v3: https://cohere.com/pricing (flat $0.10/1M)
//
// Azure Document Intelligence is priced per-page, not per-token, so it has
// its own constant below.
export const MODEL_PRICING_PER_1K_TOKENS: Record<
  string,
  { in: number; out: number }
> = {
  "gpt-4o-mini": { in: 0.00015, out: 0.0006 },
  "gpt-4o": { in: 0.0025, out: 0.01 },
  "embed-multilingual-v3.0": { in: 0.0001, out: 0 },
  "claude-sonnet-4-5": { in: 0.003, out: 0.015 },
};

export const AZURE_LAYOUT_USD_PER_PAGE = 0.01;

export function costForLlmUsage(
  model: string,
  usage: UsageLike | null | undefined,
): number {
  if (!usage) return 0;
  const rates = MODEL_PRICING_PER_1K_TOKENS[model];
  if (!rates) {
    console.warn(
      `[metrics] unknown model in pricing table: ${model} — reporting $0`,
    );
    return 0;
  }
  const inTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const outTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
  return (inTokens * rates.in + outTokens * rates.out) / 1000;
}

export function costForAzurePages(pageCount: number): number {
  return pageCount * AZURE_LAYOUT_USD_PER_PAGE;
}

export interface StageRecord {
  stage: Stage;
  documentId: string | null;
  durationMs: number;
  tokensIn?: number;
  tokensOut?: number;
  usdCost?: number;
  modelVersion?: string | null;
  ok?: boolean;
  errorMessage?: string | null;
}

/**
 * Write a single extraction_runs row. Best-effort: a logging failure
 * must not cause the upstream pipeline to fail.
 */
async function recordStage(record: StageRecord): Promise<void> {
  const { error } = await supabaseAdmin.from("extraction_runs").insert({
    document_id: record.documentId,
    stage: record.stage,
    duration_ms: Math.round(record.durationMs),
    tokens_in: record.tokensIn ?? 0,
    tokens_out: record.tokensOut ?? 0,
    usd_cost: record.usdCost ?? 0,
    model_version: record.modelVersion ?? null,
    ok: record.ok ?? true,
    error_message: record.errorMessage ?? null,
  });
  if (error) {
    console.warn(
      `[metrics] failed to record stage ${record.stage}:`,
      error.message,
    );
  }
}

export interface WithMetricOptions {
  stage: Stage;
  documentId: string | null;
  modelVersion?: string | null;
  /** Pre-computed cost (used for per-page Azure charges). */
  fixedCost?: number;
  /** Called on success with the function's return value — lets the caller
   *  extract token usage to compute cost + record it. Must return numbers. */
  extractUsage?: (result: unknown) => {
    tokensIn?: number;
    tokensOut?: number;
    usdCost?: number;
  };
}

/**
 * Wrap an async stage so it auto-records a row in `extraction_runs`.
 *
 *   const result = await withMetric(
 *     { stage: "llm_entities", documentId: docId, modelVersion: "gpt-4o-mini" },
 *     async () => openai.chat.completions.create(...),
 *     { extractUsage: (r) => ({ usdCost: costForLlmUsage("gpt-4o-mini", r.usage) }) },
 *   );
 *
 * On throw we still record a row with `ok: false` + the error message so
 * the dashboard can show failed stages honestly.
 */
export async function withMetric<T>(
  opts: WithMetricOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    const usage = opts.extractUsage?.(result) ?? {};
    await recordStage({
      stage: opts.stage,
      documentId: opts.documentId,
      durationMs: Date.now() - start,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      usdCost: usage.usdCost ?? opts.fixedCost ?? 0,
      modelVersion: opts.modelVersion,
      ok: true,
    });
    return result;
  } catch (err) {
    await recordStage({
      stage: opts.stage,
      documentId: opts.documentId,
      durationMs: Date.now() - start,
      usdCost: opts.fixedCost ?? 0,
      modelVersion: opts.modelVersion,
      ok: false,
      errorMessage: (err as Error).message.slice(0, 500),
    });
    throw err;
  }
}
