# Testing Patterns

**Analysis Date:** 2026-04-07

## Test Framework

**None configured.**

This codebase has **no automated test suite**. There is no test runner, no test config, and no test files.

**Evidence:**
- `package.json` has no `test` script. `devDependencies` contains only `eslint`, `eslint-config-next`, `tailwindcss`, `typescript`, and `@types/*` packages — no Vitest / Jest / Playwright / Testing Library.
- No `vitest.config.*`, `jest.config.*`, `playwright.config.*`, or `cypress.config.*` anywhere in the repo.
- No `*.test.ts` / `*.test.tsx` / `*.spec.ts` / `*.spec.tsx` files under `src/`.
- No `__tests__/` directories.
- ESLint config (`eslint.config.mjs`) contains no test-specific plugins.
- No CI workflows under `.github/workflows/` that would gate tests.

## Run Commands

```bash
pnpm dev       # Next.js dev server
pnpm build     # Next.js production build
pnpm start     # Start production server
pnpm lint      # ESLint (the only automated quality gate)
```

`pnpm test` — **would fail** (no script defined).

No `type-check` script either; type checking only happens implicitly via `next build`.

## Quality Control (Current State)

The codebase relies on three non-test safeguards:

1. **TypeScript `strict: true`** — catches type errors at compile time (`tsconfig.json`)
2. **ESLint 9** with `eslint-config-next` core-web-vitals + TypeScript — catches Next.js anti-patterns and unused code
3. **Manual review + manual UAT** — per GSD workflow

## Test Coverage Gaps

Zero automated coverage across the stack. High-priority gaps, in order of fragility:

**Tier 1 — Urgent (pure-logic modules, easy to test, high regression risk):**
- `src/lib/chunking.ts` — section splitting, overlap, tail merging, Arabic sentence detection
- `src/lib/entities.ts` — Arabic/English name normalization, Levenshtein similarity, canonicalization
- `src/lib/normalize.ts` — diacritic/number/Unicode folding
- `src/lib/extraction-validation.ts` — schema checks, repetition detection, language consistency
- `src/lib/intelligence-router.ts` — command parsing, mode selection heuristics

**Tier 2 — High (integration-level, requires mocking):**
- `src/lib/librarian.ts` — quick extract → classify → entity match → action recommendation
- `src/lib/extraction-v2.ts` → `src/lib/pdf-text-extraction.ts` → `src/lib/azure-document-intelligence.ts` — extraction pipeline with real PDF fixtures
- `src/lib/search.ts` — hybrid retrieval + rerank
- `src/lib/chat-turn.ts` — end-to-end chat turn orchestration (mocked LLM responses)
- `src/lib/memory.ts` — extraction + retrieval + scope filtering
- `src/lib/claude-with-tools.ts` — tool-use loop with max-round limits
- `src/lib/doctrine.ts` — prompt building + cache invalidation

**Tier 3 — Medium (route-level + UI):**
- All `src/app/api/**/route.ts` — input validation, permission checks, error responses
- `src/lib/actions/projects.ts` — slug uniqueness, result tuple contract
- `src/components/chat-input.tsx`, `src/components/project-sidebar.tsx` — form submission, file upload, state management
- `src/lib/hooks/use-chat.ts` — SSE parsing + message accumulation

**Tier 4 — End-to-end (Playwright, once unit/integration are stable):**
- Upload → librarian proposal → confirm → extraction → search
- New conversation → routing → streaming response → memory persistence
- Project creation → link documents → tab navigation

## Recommended Framework

**Vitest** — ESM-native, fast, zero-config for TypeScript, integrates cleanly with Next.js. Adding it is a single `pnpm add -D vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom` and creating `vitest.config.ts`.

Suggested `package.json` additions:
```json
"scripts": {
  "test": "vitest",
  "test:ui": "vitest --ui",
  "test:coverage": "vitest run --coverage",
  "type-check": "tsc --noEmit"
}
```

**Playwright** — add later for E2E once unit + integration coverage is established.

## Why This Matters

Recent git history shows repeated fixes to the extraction pipeline and prompt engineering. A single unit test on `chunkDocument()` or `canonicalizeEntities()` would have caught several of those regressions before users saw them. The cost-benefit ratio for adding Vitest here is extremely high given how much core logic is purely functional and easy to test in isolation.

---

*Testing analysis: 2026-04-07*
*Update when test infrastructure is introduced*
