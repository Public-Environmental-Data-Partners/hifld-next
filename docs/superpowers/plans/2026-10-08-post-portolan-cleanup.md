# Post-Portolan cleanup implementation plan

**Goal:** Finish the remaining behavior from app PR 48, merge the cutover report,
and remove the concrete dead code identified in the read-only cleanup audit.

**Architecture:** Preserve the Portolan catalog, current public routes, SeaweedFS,
and source ID attributes. Restore mobile-only legend collapse at the map's
feature-selection handler. Delete only unused/no-op publisher code and the retired
GeoServer setup script. Full dataset-api retirement is a separate decision and PR;
do not delete the production database, bucket objects, or audit evidence.

**Tech stack:** React/TypeScript/Vitest; Python/GeoPandas/unittest; GitHub PRs.

## 1. Cutover report

- [x] Verify publisher PR 12 and its image workflow against GitHub.
- [x] Update `docs/production-cutover-2026-10-08.md` to record merge commit
  `5395d597f4d48293e0f71bbc5270145921f877d9`, without claiming deployment.
- [x] Run `git diff --check`, push the report, verify the head, and merge PR 66.

## 2. Complete map PR 48 on current main

- [x] Establish clean webapp baseline: 497 tests passed.
- [x] Restore the mobile/desktop regression in
  `webapp/src/routes/__tests__/MapWorkspace.analytics.test.tsx`, adapting its
  typed map-hook fixture for the current categorical styling return value.
  Select a real normalized fixture feature and assert the actual legend DOM:
  desktop remains visible, mobile collapses, manual reopening still works,
  and clearing selection does not hide an opened legend.
- [x] Run `npm test -- src/routes/__tests__/MapWorkspace.analytics.test.tsx`;
  require the mobile assertion to fail before implementation.
- [x] In `webapp/src/routes/collections.$collectionSlug.map.tsx`, add
  `if (isMobileMapLayout) setLegendVisible(false);` only for a nonempty incoming
  selection and include `isMobileMapLayout` in the callback dependencies.
- [x] Restore PR 48's mobile table grid, full-width search row, and medium-screen
  scroll breakpoint in `FeatureTablePanel.tsx`. Its updated regression first
  failed on the missing search-row span, then passed with the layout restored.
  Preserve the current map-controls/popup z-index choices rather than reordering
  the overlay stack as the old PR did.
- [x] Run the targeted test plus existing camera/popup/panel regressions, then
  `npm run check`, `npm run typecheck`, `npm test` (499 passed), and
  `npm run build`. Seven root frontend-workspace checks also passed.
- [x] Compare all original PR 48 files against main plus this change. Open a
  replacement PR linking PR 48; close PR 48 only after integration reaches main.

## 3. Focused dead-code cleanup

- [x] Verify no callers of `scripts/setup-geoserver.sh`; remove that tracked
  script, recoverable from Git. Keep catalog acceptance/migration audit tools.
- [x] In the publisher worktree, establish baseline with
  `uv run python -m unittest discover tests`.
- [x] Remove unused `_ensure_id_column` from `src/dagster_hifld/catalog.py`.
  Remove its no-op counterpart and all six calls from
  `src/dagster_hifld/conversion.py`; replace the sample wrapper with
  `gpd.GeoDataFrame.from_features(sample_features, crs=crs)` and remove counters
  used only to supply its ignored `start_id`. Preserve adaptive chunking and
  GeoPackage `FID="fid"`/`index=False` behavior.
- [x] Remove unused `DatasetApiResource.get_dataset_quality()` from
  `src/dagster_hifld/resources.py`. Keep the remaining registration interface
  until full legacy retirement is explicitly approved.
- [x] Run targeted conversion/catalog/resource tests, full publisher unittest
  discovery, compile checks, and native lint on touched files. Compare any lint
  findings against the unchanged baseline; introduce no ignores.
- [x] Commit focused changes, push review branches, and verify GitHub checks.

Integrated through application PR 67 and publisher PR 13. Original application
PR 48 and superseded publisher PR 10 are closed; report PR 66 is merged.

## 4. Separate approved retirement PRs

The operator approved removal of dataset-api code/deployment wiring and legacy
numeric-ID fallbacks in separate retirement PRs, preserving database and bucket
data. Scope also includes GeoServer remnants and obsolete one-off migration
scripts. Historical Git documentation and ignored rollback evidence are not
active runtime dependencies and must not be erased.

- [x] Trace webapp legacy numeric-ID and ZIP fallbacks, publisher API registration,
  local compose, image workflows, Helm charts, and IaC deployment/config-sync.
- [x] Read only relevant production routing/catalog configuration. Report the
  compatibility loss and preserve database/data; no live teardown in this pass.
- [x] Develop retirement separately, with tests proving catalog,
  downloads, schema/compare, MCP/WebMCP, feature server, and SeaweedFS remain
  supported without dataset-api. Infrastructure/database deletion requires its
  own reviewed plan.
