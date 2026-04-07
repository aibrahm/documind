# Testing Patterns

**Analysis Date:** 2026-04-06

## Test Framework

**None configured.**

- `package.json` devDependencies contain no test framework (no vitest, jest, playwright, mocha, cypress)
- No `test`, `test:watch`, `test:coverage`, or `e2e` scripts in `package.json`
- No test runner configuration files (no `vitest.config.ts`, `jest.config.js`, `playwright.config.ts`)

## Test Files

**Zero test files in `src/`.**

- Searched: `**/*.test.ts`, `**/*.test.tsx`, `**/*.spec.ts`, `**/*.spec.tsx`, `__tests__/`
- No matches in `src/` or any app directory
- Only matches are inside `node_modules/` (transitive dependency tests)

## Run Commands

```bash
pnpm dev          # Dev server
pnpm build        # Production build
pnpm start        # Serve production build
pnpm lint         # ESLint
```

**No test commands.**

## CI / Automation

**None.**

- No `.github/workflows/` directory
- No GitLab CI, CircleCI, or other CI config
- No pre-commit hooks
- No Husky / lefthook configured

## What Stands In for Tests

Because there is no automated test suite, the project relies on:

1. **TypeScript strict mode** (`tsconfig.json` has `strict: true`, `noEmit: true`)
   - Catches type errors at build time
   - Heavy use of discriminated unions (e.g., `type Source = { type: "document" } | { type: "web" }`) enforces correctness at the type level

2. **ESLint** (`eslint.config.mjs` extends `next/core-web-vitals` + TS presets)
   - Catches Next.js antipatterns and common bugs
   - Not run in CI (there is no CI)

3. **Manual UAT** via ngrok tunnel (per `STATE.md`)
   - Dev server runs locally, exposed via ngrok for the Vice Chairman
   - Interactive testing through the chat UI
   - `/gsd:verify-work` workflow in the GSD planning system

4. **Embedded "spec comments" inside code**
   - System prompts in `src/lib/doctrine.ts` and `src/lib/librarian.ts` contain example outputs that serve as informal test cases
   - Inline JSON schemas in librarian comments document expected shapes (e.g., `QuickAnalysis` at ~line 95)

5. **Database as source of truth**
   - Schema types regenerated to `src/lib/database.types.ts` after migrations
   - Schema mismatches surface at compile time

## Coverage Gaps (High-Risk Untested Areas)

The complete absence of tests means these load-bearing pieces have no regression safety net:

- **Librarian similarity scoring** (`src/lib/librarian.ts`) — the known 31% duplicate bug would have been caught by a test
- **Entity canonicalization** (`src/lib/entities.ts`) — bilingual fuzzy matching has many edge cases
- **Intelligence routing** (`src/lib/intelligence-router.ts`) — mode selection + query rebuilding logic
- **Chunking boundary conditions** (`src/lib/chunking.ts`) — tiny-tail merging, in-section overlap
- **Claude tool loop** (`src/lib/claude-with-tools.ts`) — max-rounds cap, forced-final-answer fallback
- **Memory extract/retrieve** (`src/lib/memory.ts`) — decision/fact/recommendation classification
- **Arabic-Indic digit normalization** (`src/lib/normalize.ts`) — the "2026 → 2023" OCR fix
- **Doctrine prompt composition** (`src/lib/doctrine.ts`) — OUTPUT GUIDE override behavior

## Recommendation

Given the single-developer + active iteration pace, a minimal Vitest setup focused on the highest-leverage pure functions would pay back quickly:

1. Start with `entities.ts`, `normalize.ts`, `chunking.ts` (pure, deterministic, high reuse)
2. Add `librarian.ts::decideAction` + similarity scoring (would have caught the 31% bug)
3. Add `intelligence-router.ts` mock tests against recorded GPT-4o-mini responses
4. Defer component + integration tests until the product shape stabilizes

This is not urgent debt but it will become blocking once a second person is ever involved.

---

*Testing analysis: 2026-04-06*
*Update when test patterns change*
