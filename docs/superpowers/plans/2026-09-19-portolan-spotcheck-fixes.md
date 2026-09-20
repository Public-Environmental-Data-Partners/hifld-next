# Portolan spot-check fixes

User-approved scope: fix absolute STAC navigation, partition labels, source
timestamps, and map eligibility. CRS/bounding-box validation is explicitly deferred.

## Implementation

- [x] Publisher: add regression coverage for public-root absolute links (GCS and
  SeaweedFS), preserve offline relative rendering, and wire both publishing paths.
- [x] Publisher: preserve production collection/dataset timestamps in the catalog
  projection and metadata; leave unavailable source dates absent, not build-time.
- [x] Webapp: reproduce duplicate partition labels in tests, display partition-relative
  paths, and keep concise names for single-file assets.
- [x] Webapp: test missing/invalid dates and omit those labels; retain valid dates.
- [x] Webapp: test nonspatial/no-PMTiles versions and hide unsupported map links.
- [x] Metadata refresh: generation-conditional replacement only in the two migration
  buckets, with SQLite published last; never rewrite source data or production.
- [x] Verify targeted regressions, full webapp check/typecheck/tests/build, publisher
  targeted tests, then restart local app with existing GCS config and spot-check.

The existing dirty worktrees are retained. No commits, production bucket changes,
source data transformations, or CRS repairs are part of this pass.

## Verification

- Webapp: check (44 existing informational diagnostics), typecheck, 441 tests,
  production build passed.
- Publisher: 29 focused tests, Python compilation and Ruff passed.
- Refresh tooling: 9 uploader/copy tests and Ruff passed.
- Rebuilt catalog parity: 330 datasets, 525 files, 526 schemas; no dataset metadata,
  tag, schema, or coverage differences. All 330 dataset timestamp pairs preserved.
- Live browser: Address Ranges has no map control; NFHL loads table rows and
  distinguishes partition paths; dataset timestamps render correctly.
- Live API: root-to-version STAC traversal succeeds, asset URLs are absolute,
  and NFHL API JSON equals canonical GCS JSON.
- Previous artifacts retained beside `catalog-fixes-published` and
  `catalog-fixes-staging` under `/private/tmp/hifld-portolan-gcp-spike-20260919`.
