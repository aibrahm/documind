// src/lib/retry.ts
//
// Tiny exponential-backoff retry helper, used for transient failures on
// calls we don't want to lose silently: Cohere embedding requests, chunk
// batch inserts into Supabase, and anything else that hits an external
// service over an unreliable network.
//
// The helper is deliberately small — it does not try to classify errors
// ("this is a 400, don't retry"). Pass a classifier via `shouldRetry` if
// you want that. For the default use case (transient network / 5xx),
// retrying everything a few times is both safer (fewer silent losses)
// and cheaper (we'd rather spend three retries than mark a document
// permanently broken because of one flaky connection).

export interface RetryOptions {
  /** Maximum number of attempts, including the first one. Default: 3. */
  maxAttempts?: number;
  /** Initial backoff in ms. Default: 200. Doubled each attempt. */
  initialDelayMs?: number;
  /** Max cap on a single backoff delay. Default: 3000. */
  maxDelayMs?: number;
  /** Return false on an error that should NOT be retried (fail immediately). */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Short human label used in error messages. */
  label?: string;
}

function jitter(ms: number): number {
  // ±25% jitter so concurrent retries don't pile up at the same instant.
  const band = ms * 0.25;
  return Math.round(ms - band + Math.random() * band * 2);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 3000;
  const shouldRetry = options.shouldRetry ?? (() => true);
  const label = options.label ?? "operation";

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !shouldRetry(err, attempt)) {
        break;
      }
      const base = Math.min(maxDelayMs, initialDelayMs * Math.pow(2, attempt - 1));
      await sleep(jitter(base));
    }
  }

  // Re-throw with a little context so the outer handler can distinguish
  // retry exhaustion from a plain single-shot error.
  const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
  const wrapped = new Error(
    `${label} failed after ${maxAttempts} attempts: ${message}`,
  );
  (wrapped as Error & { cause?: unknown }).cause = lastErr;
  throw wrapped;
}
