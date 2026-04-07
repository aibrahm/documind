// src/lib/logger.ts
//
// Minimal structured logger. Per CLAUDE.md "Fail Loud, Never Fake": every
// log call goes to stderr with a level + namespace prefix and an optional
// metadata object that's serialized inline. No silent swallows.
//
// Usage:
//   import { createLogger } from "@/lib/logger";
//   const log = createLogger("librarian");
//   log.info("analyzing upload", { fileName });
//   log.warn("entity overlap empty", { docId });
//   log.error("classification failed", err, { docId });
//
// Why this exists: console.error was scattered across 17+ files with no
// consistent level, no namespacing, no metadata. This module is the
// chokepoint so future hooks (Sentry, structured JSON output, log levels
// from env) have a single place to land.

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO ",
  warn: "WARN ",
  error: "ERROR",
};

// In production we drop debug logs by default. The env var lets us re-enable.
const ENABLED_LEVELS: Record<LogLevel, boolean> = {
  debug: process.env.DOCUMIND_LOG_DEBUG === "true",
  info: true,
  warn: true,
  error: true,
};

function format(
  level: LogLevel,
  namespace: string,
  message: string,
  meta?: Record<string, unknown>,
): string {
  const ts = new Date().toISOString();
  const head = `${ts} ${LEVEL_LABEL[level]} [${namespace}] ${message}`;
  if (meta && Object.keys(meta).length > 0) {
    try {
      return `${head} ${JSON.stringify(meta)}`;
    } catch {
      return `${head} [meta-not-serializable]`;
    }
  }
  return head;
}

export interface Logger {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (
    message: string,
    err?: unknown,
    meta?: Record<string, unknown>,
  ) => void;
}

export function createLogger(namespace: string): Logger {
  return {
    debug(message, meta) {
      if (!ENABLED_LEVELS.debug) return;
      console.error(format("debug", namespace, message, meta));
    },
    info(message, meta) {
      if (!ENABLED_LEVELS.info) return;
      console.error(format("info", namespace, message, meta));
    },
    warn(message, meta) {
      if (!ENABLED_LEVELS.warn) return;
      console.error(format("warn", namespace, message, meta));
    },
    error(message, err, meta) {
      if (!ENABLED_LEVELS.error) return;
      const errMeta: Record<string, unknown> = { ...(meta || {}) };
      if (err instanceof Error) {
        errMeta.error = err.message;
        if (err.stack) errMeta.stack = err.stack.split("\n").slice(0, 5).join(" | ");
      } else if (err !== undefined) {
        errMeta.error = String(err);
      }
      console.error(format("error", namespace, message, errMeta));
    },
  };
}
