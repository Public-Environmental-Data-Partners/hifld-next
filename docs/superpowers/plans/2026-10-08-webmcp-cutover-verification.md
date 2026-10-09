# WebMCP Cutover Verification Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task in the existing isolated worktree.

**Goal:** Repair the two WebMCP regressions discovered during live bucket-cutover acceptance.

**Architecture:** Preserve the STAC boundary and registered tool contracts. Expand
only scalar statistic parsing and deduplicate validated logical file summaries.

**Tech Stack:** TypeScript, React, Zod, Vitest, Playwright.

## Task 1: Regression tests

Files: `webapp/src/lib/webmcp/__tests__/catalogTools.test.tsx`.

- [x] Add a file/schema regression using a column with `min: "0", max: "8340"`;
  both tools must return `ok: true` and schema must preserve these strings.
- [x] Add a dataset regression with a file Catalog child link repeated for two
  versions, as in production; expect exactly one logical file summary.
- [x] Run `npm test -- src/lib/webmcp/__tests__/catalogTools.test.tsx` from
  `webapp/` and confirm both new regressions fail for the observed reasons.

## Task 2: Minimal adapter repair

File: `webapp/src/lib/webmcp/catalogTools.ts`.

- [x] Change both scalar extrema definitions to
  `z.union([z.number(), z.string()]).nullable().optional()`.
- [x] Filter file summaries by first occurrence of their validated `slug`, using
  an invocation-local `Set<string>`; do not change navigation or fetch behavior.
- [x] Run the targeted command again; require all tests pass.

## Task 3: Full verification and deployment

- [x] From `webapp/`, run `npm run check`, `npm run typecheck`, `npm test`, and
  `npm run build`; commit the focused adapter, tests, and these documents.
- [x] Push and merge through the application PR workflow; require CI and pinned
  image build success before deployment.
- [x] Verify browser catalog, schema, query, and map tools against the candidate
  and production. Report the non-native browser test boundary explicitly.
- [x] Resume the existing approved cutover plan only after these checks pass.

Completed through PRs 64 and 65 and production browser acceptance. See
`docs/production-cutover-2026-10-08.md` for the non-native API-boundary test
limitation and deployed spatial-query verification.
