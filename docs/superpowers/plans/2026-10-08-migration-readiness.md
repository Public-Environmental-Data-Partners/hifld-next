# Migration Readiness Implementation Plan

**Goal:** Close publication and legacy-service dependencies before moving the
Portolan writer/readers to the permanent production buckets.

**Architecture:** Preserve canonical version keys with conditional, no-overwrite
promotion. Read the sitemap from one leased SQLite snapshot. Keep legacy mode
explicit while making catalog mode independent of the legacy API. Configure one
storage slug per bucket and validate a complete candidate before switching readers.

**Workspaces:** `.worktrees/migration-readiness` (application),
`.worktrees/migration-readiness-publisher` (publisher, current main), and
`.worktrees/migration-readiness-iac` (infrastructure, existing registry repair).

## Publisher

- [x] Add real filesystem regressions in `tests/test_publish.py` for changed
  published bytes, identical reruns, partial retries, and source-key changes.
  Run `uv run python -m unittest discover -s tests -p test_publish.py` and
  observe the new failures before implementation.
- [x] Replace `_copy_version_files` deletion with snapshot-verified conditional
  copies. Verify every existing source/target pair before making any changes;
  reject changed published bytes and dropped canonical data keys. Allow
  create-only missing keys for partial retries. Preserve source archives and
  deterministic compressed legacy normalization.
- [x] Apply the same protection to Portolan metadata-only data promotion and
  derivative writes. Keep metadata refresh possible without rewriting data.
- [x] Retain the explicit configured storage slug and integrate the existing
  canonical-default correction against publisher main.
- [x] Run focused tests, then `uv run python -m unittest discover tests`.

## Webapp and local configuration

- [x] Add a sitemap regression with an actual catalog SQLite fixture and a
  failing legacy fetch. Run `npm test -- src/lib/__tests__/sitemap.test.ts`.
- [x] Build sitemap groups through one `activeCatalogLifecycle().withRepository`
  lease, using `listCollections`, paginated `listDatasets`, and `listFiles`.
  Keep legacy HTTP walking only when no catalog source is configured.
- [x] Audit numeric-ID and ZIP compatibility callers; preserve supported routes
  using catalog identities/assets, without inventing a numeric-ID mapping.
- [x] Make `DATASET_API_URL` optional in catalog mode and fail clearly if neither
  catalog nor legacy configuration exists.
- [x] Remove duplicate aliases from `ops/gcp-portolan.env.example` and document
  explicit canonical slugs in all deployment profiles.
- [x] Run targeted tests, `npm run check`, `npm run typecheck`, `npm test`, and
  `npm run build`.

## Infrastructure and cutover verification

- [x] Replace hardcoded bucket/slug/pointer settings with one consistent
  permanent-bucket profile while keeping temporary-bucket defaults for rollback.
- [x] Add configuration regressions to `tests/test_portolan_production_wiring.py`;
  run the infrastructure unittest suite and Terraform format/validation checks.
- [x] Refresh the draft cutover procedure with the current release and registry,
  copy verification, candidate metadata regeneration, routing compatibility,
  first-new-version publication, and rollback/observation gates.
- [x] Read live service generations, full catalog listings, representative
  features and IDs, source downloads/range behavior, bucket inventories/IAM, and
  load-balancer storage routes. Record exact evidence and remaining gates.
  Evidence and remaining operational gates are in
  `docs/migration-readiness-2026-10-08.md`. A built local webapp was also verified
  against the public catalog with the legacy API URL unset.
- [x] Commit reviewable changes on the three isolated branches. No production
  pointer switch, service removal, or bucket deletion is part of this repair.
