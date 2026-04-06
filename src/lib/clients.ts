/**
 * Shared API client singletons.
 * Import these instead of creating new instances per file.
 */
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { CohereClientV2 } from "cohere-ai";

// OpenAI — used for extraction (GPT-4o), routing (GPT-4o-mini), fallback analysis
let _openai: OpenAI | null = null;
export function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// Anthropic — used for deep analysis (Claude Sonnet)
let _anthropic: Anthropic | null = null;
export function getAnthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

// Cohere — used for embeddings and reranking
let _cohere: CohereClientV2 | null = null;
export function getCohere(): CohereClientV2 {
  if (!_cohere) _cohere = new CohereClientV2({ token: process.env.COHERE_API_KEY! });
  return _cohere;
}

// Check if Anthropic is configured
export function hasAnthropic(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Calculate API cost from token usage.
 */
export function calculateCost(
  usage: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number } | null | undefined,
  model: "gpt-4o" | "gpt-4o-mini" | "claude-sonnet" | "cohere-embed" | "cohere-rerank"
): number {
  if (!usage) return 0;
  const input = usage.prompt_tokens || usage.input_tokens || 0;
  const output = usage.completion_tokens || usage.output_tokens || 0;

  const rates: Record<string, [number, number]> = {
    "gpt-4o": [2.5, 10],
    "gpt-4o-mini": [0.15, 0.6],
    "claude-sonnet": [3, 15],
    "cohere-embed": [0.1, 0],
    "cohere-rerank": [0, 0],
  };

  const [inputRate, outputRate] = rates[model] || [0, 0];
  return (input * inputRate + output * outputRate) / 1_000_000;
}
