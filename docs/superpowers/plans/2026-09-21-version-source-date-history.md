# Version Source-Date History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authored issue date to Hospitals v1.1.0 and present accurate file-level and version-level source-date history.

**Architecture:** The publisher resolves source dates from version metadata into each STAC Collection. The webapp parses all version Collections already associated with a file, derives a clearly labelled history summary, and renders the selected pair's dates on the comparison page.

**Tech Stack:** Python 3.12, Dagster publisher, STAC 1.1, TypeScript, React, Zod, Vitest.

---

### Task 1: Publisher provenance

**Files:**
- Modify: `../hifld-next-datasets/tests/test_portolan_workflow.py`
- Modify only if required by the failing test: `../hifld-next-datasets/src/dagster_hifld/portolan/workflow.py`

- [ ] Add a fixture assertion that a version manifest containing `date_issued: 2026-04-06` produces `hifld:source_dates.issued` with `provenance.issued == "version"`.
- [ ] Run the focused test and confirm it fails before any publisher implementation change.
- [ ] Make the smallest publisher correction required by the test.
- [ ] Run the focused test and the complete publisher suite.

### Task 2: File history summary

**Files:**
- Modify: `webapp/src/lib/api-client.ts`
- Modify: `webapp/src/routes/collections.$collectionSlug.datasets.$datasetSlug.files.$fileSlug.index.tsx`
- Modify: `webapp/src/routes/__tests__/collections.$collectionSlug.datasets.$datasetSlug.files.$fileSlug.index.test.tsx`

- [ ] Add a failing route test with multiple source-date-bearing versions that expects `First issued` and `Latest source activity`.
- [ ] Carry all version source dates through the file response and derive the two summary values with valid date-only comparisons.
- [ ] Render only the aggregate labels on the file page and run the focused test.

### Task 3: Version comparison dates

**Files:**
- Modify: `webapp/src/routes/collections.$collectionSlug.datasets.$datasetSlug.files.$fileSlug.compare.tsx`
- Modify: `webapp/src/routes/__tests__/collections.$collectionSlug.datasets.$datasetSlug.files.$fileSlug.compare.test.tsx`

- [ ] Add a failing comparison test that expects each selected version's own issue and modification dates.
- [ ] Resolve the selected versions' STAC metadata without cross-version fallback and render their date rows.
- [ ] Run the focused comparison test.

### Task 4: Release and production verification

**Files:**
- Update authored Hospitals v1.1.0 source metadata in staging and production object storage.

- [ ] Run `npm run check`, `npm run typecheck`, `npm test`, and `npm run build` from `webapp/`.
- [ ] Run `uv run python -m unittest discover tests` from the publisher repository.
- [ ] Merge both reviewed changes and deploy their SHA-tagged images through the infrastructure workflows.
- [ ] Run the Hospitals publication/catalog job to create a validated immutable catalog release.
- [ ] Verify production STAC metadata, file summary dates, per-version comparison dates, and downloads.
