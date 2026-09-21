# Source Date Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop presenting inventory issue/modification dates as catalog creation/update or data coverage, while retaining their exact values and provenance in STAC metadata and the UI.

**Status (2026-09-20):** Local publisher and webapp implementation verified. Production catalog regeneration and release-pointer publication remain pending; this plan does not imply that live GCS metadata has changed.

**Architecture:** The publisher keeps source dates separate from temporal coverage and catalog lifecycle fields. Version Collections carry inventory-reported date strings in a namespaced source-date object; an explicitly authored coverage interval alone populates `extent.temporal.interval`. The webapp parses that STAC object and labels it accurately. No pre-change catalog compatibility path is added.

**Tech Stack:** Python 3.12, Dagster publisher, STAC 1.1, SQLite catalog projection, TypeScript, Zod, TanStack Router, Vitest.

---

### Task 1: Publisher date semantics

**Files:**
- Modify: `../hifld-next-datasets/src/dagster_hifld/portolan/catalog.py`
- Modify: `../hifld-next-datasets/src/dagster_hifld/portolan/workflow.py`
- Modify: `../hifld-next-datasets/src/dagster_hifld/portolan/inventory.py`
- Test: `../hifld-next-datasets/tests/test_portolan_catalog.py`
- Test: `../hifld-next-datasets/tests/test_portolan_inventory.py`

- [ ] Add a test record with `source_issued_date="2024-06-25"`, `source_modified_date="2020-10-21"`, and provenance `inventory`; assert the rendered Collection has `extent.temporal.interval == [[None, None]]`, retains the two source strings in `hifld:source_dates`, and has no source-derived `hifld:created_at` or `hifld:updated_at`.
- [ ] Run `uv run python -m unittest tests.test_portolan_catalog tests.test_portolan_inventory`; confirm the new assertion fails on the old publisher.
- [ ] Replace `CatalogRecord.created_at`/`updated_at` source-date usage with explicit source-date and optional coverage fields. Read only explicit coverage fields from source metadata; never derive them from `date_issued`/`date_modified`.
- [ ] Run the focused tests and confirm green.

### Task 2: Metadata publication validation

**Files:**
- Modify: `../hifld-next-datasets/src/dagster_hifld/portolan/validation.py`
- Test: `../hifld-next-datasets/tests/test_portolan_validation.py`

- [ ] Add a candidate-tree regression with a backwards temporal interval; assert `PortolanValidationError` includes the Collection path. Add a candidate with `[[null,null]]` and assert it remains valid.
- [ ] Run `uv run python -m unittest tests.test_portolan_validation`; confirm the backwards case fails to be rejected.
- [ ] Validate each non-null temporal bound as RFC 3339 and reject start after end. Do not enforce order between independent source issue/modification dates.
- [ ] Run the focused tests and confirm green.

### Task 3: Webapp source-date presentation

**Files:**
- Modify: `webapp/src/lib/stac-view-models.ts`
- Modify: `webapp/src/lib/api-client.ts`
- Modify: `webapp/src/routes/collections.$collectionSlug.datasets.$datasetSlug.files.$fileSlug.index.tsx`
- Test: `webapp/src/routes/__tests__/collections.$collectionSlug.datasets.$datasetSlug.files.$fileSlug.index.test.tsx`

- [ ] Add a route test asserting `2024-06-25` and `2020-10-21` display as `Source issued` and `Source modified`, with no synthetic `12:00 AM UTC` or `Created`/`Updated` labels.
- [ ] Run `npx vitest run 'src/routes/__tests__/collections.$collectionSlug.datasets.$datasetSlug.files.$fileSlug.index.test.tsx'`; confirm the new assertion fails.
- [ ] Parse `hifld:source_dates` at the STAC boundary, carry the selected/latest version's date strings to the file view, and omit unverified file `updated_at` from JSON-LD. Remove the old timestamp display without a compatibility branch.
- [ ] Run the focused tests and confirm green.

### Task 4: Documentation, verification, and release

**Files:**
- Modify: `docs/superpowers/specs/2026-09-07-portolan-catalog-migration-design.md`
- Test: publisher and webapp suites.

- [ ] Amend the spec so unverified inventory dates stay inventory-reported source metadata; standard source link/asset timestamps require evidence for the linked resource. Explicit coverage alone fills STAC temporal extent.
- [ ] Run publisher `uv run python -m unittest discover tests` and webapp `npm run check`, `npm run typecheck`, `npm test`, `npm run build`.
- [ ] Generate a local metadata-only catalog from a reversed-date fixture, validate the STAC tree, and confirm non-date metadata/assets are unchanged.
- [ ] Before any GCS publication, compare candidate catalog counts, asset hrefs/checksums, and exception report against the active release. Publish through the release-pointer workflow only after those checks pass.
