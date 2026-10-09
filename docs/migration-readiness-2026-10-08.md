# Portolan migration readiness — 2026-10-08

## Decision

Proceed with a **verified copy-and-switch after merging/building/deploying the
readiness repairs**. Do not replace buckets by deleting their current contents,
remove the legacy API/database, or delete the temporary Portolan buckets yet.
The target copy and its rebuilt catalog have not been created or validated by
this review. No production configuration or object was changed.

Changes are on `codex/migration-readiness` in isolated worktrees under the
application repository's `.worktrees/`: `migration-readiness` (application),
`migration-readiness-publisher` (publisher; safety commit `7488f39`, canonical
slug fix `ad5b6f7`), and `migration-readiness-iac` (infrastructure `79ef1bc`).
They are local commits, not pushed, merged, or deployed. Existing checkouts and
untracked review notes were preserved.

## Repairs

- Publisher promotion no longer deletes a published version prefix. It checks
  existing bytes before copying, uses source/destination generation preconditions,
  preserves identical object identities, and rejects changed bytes or removal of
  existing canonical data keys. Missing objects can be created to resume a partial
  upload. Generated canonical objects are also no-overwrite. Legacy Shapefile ZIP
  normalization is deterministic and compressed; authored archives remain intact.
  Metadata-only refresh preserves existing styles/thumbnails without regenerating
  their bytes, so immutable derivatives do not block catalog metadata changes.
- The publisher's canonical GCS default-slug fix is included against current
  publisher main, rather than leaving it solely on an older repair branch.
- Sitemap generation walks collections, datasets (including pagination), and
  files under one SQLite lease. Catalog mode needs no legacy API URL. Missing both
  catalog and legacy configuration now reports not-ready.
- Remaining webapp ID wrappers understand qualified catalog paths. Catalog ZIP
  sources redirect to the registered storage object without proxying the archive.
  ZIP link generation encodes the qualified source ID as one route parameter.
  Real legacy numeric IDs still use the legacy API when configured; they are not
  guessed or mapped to arbitrary SQLite rows. Numeric compatibility is a separate
  retirement decision, not a reason to delay bucket relocation.
- Local GCP examples use one slug and distinguish the webapp's service-endpoint
  URL from MCP's bucket URL.
- Infrastructure has a shared `PORTOLAN_PERMANENT_BUCKETS` repository variable,
  default false. Terraform selects writer buckets, public root, explicit slug,
  and the `/storage` Portolan backend. Container/feature-server workflows select
  matching Helm profiles, and republishing checks the selected bucket. The
  permanent container profile suspends both legacy discovery/config-sync cronjobs.
  Helm rendering tests verify the temporary MCP alias is actually absent, not a
  JSON `null` in the registry.

## Verified production evidence

Current pointer:
`gs://hifld-next-portolan-published/_catalog/current.json`.
Generation: `ca91279d-478e-4003-96fa-d6478c9f0d14`.
Published timestamp: `2026-10-08T22:24:23Z`.

- SQLite integrity/foreign-key checks pass. Counts: 330 datasets, 525 files,
  526 versions (515 spatial, 11 non-spatial), 2,734 assets/objects. All locations
  use the single `gcp-portolan-published` slug.
- A complete public object-metadata listing of the published `hifld/` prefix
  contained 9,828 objects. **Every one of the 2,734 referenced objects exists and
  matches the catalog's byte size and recorded GCS generation**, with no missing
  keys or identity mismatches. Referenced bytes: 600,993,568,357 (~560 GiB).
  This is an identity/metadata audit, not a new full-byte SHA-256 download.
- Public webapp health and feature readiness report the same generation. Dataset
  stats report 330 ready. Hospital point and National Forest polygon feature
  requests return 200; the hospital query reports 8,340 matching features.
- Representative File Geodatabase ZIP, GeoJSON, GeoPackage, GeoParquet, and PMTiles
  requests return HTTP 206 for a 16-byte range, correct magic bytes, and public
  CORS headers. Same-origin `/storage/…pmtiles` ranges also return 206.
- Public MCP initialization and tool listing return 200.
- A locally built repaired webapp, with `DATASET_API_URL` unset, serves health,
  stats, search, full sitemap, STAC, and an SSR hospital file page successfully
  against the published catalog.
- All five production application deployments are ready. Application/MCP image
  revision is `00032f50e5bc9633f659f5b31a0563b670505774`; feature-server revision
  is `e3019f486fc00d5b85795cbd84006f27eb8af7c1`. These are the existing deployed
  images, **not** the readiness repairs.
- Permanent published bucket `hifld-next-datasets-prod`: no objects under
  `hifld/`, `releases/`, `_catalog/`, or the `catalog.json` prefix. The equivalent
  permanent staging Portolan prefixes also have no objects. Existing legacy data
  elsewhere in those buckets must remain untouched.
- Permanent published bucket already grants public object read, allows GET/HEAD
  CORS, and grants Dagster object-admin access. Permanent staging remains private
  and grants Dagster object-admin access. Both have seven-day soft delete; that
  is not a replacement for a catalog-and-data rollback plan.
- The live URL map routes `/storage/hifld/*`, `/storage/releases/*`,
  `/storage/_catalog/*`, and `/storage/catalog.json` to the Portolan backend,
  retains the legacy `/storage/*` fallback, and routes `/features/*` to the
  feature server. Both legacy cronjobs are still active today.

Existing data caveats remain: 90 version-quality records are flagged failed.
Some source extents are explicitly marked unknown/world bounds; successful
feature requests do not repair source geometry. Only eight style/thumbnail
assets are currently indexed. The project's structural/profile validation is
not evidence that every rule of a full Portolan conformance suite passes.

## Verification of repairs

- Webapp: `npm run check`, `npm run typecheck`, `npm test` (487 tests), and
  `npm run build` pass. Existing informational lint/build warnings remain.
- Publisher: `uv run python -m unittest discover tests` passes (443 tests,
  one skipped). The new promotion helper/tests also pass Ruff checks/formatting.
- Infrastructure: all 59 unittests pass; `terraform fmt -check -recursive` and
  `terraform validate` pass. Validation used isolated provider data and no state
  backend. No production Terraform plan/apply was performed.

## Cutover gates, in order

1. Merge the readiness branches and their existing parent repairs; build pinned
   images and deploy the repaired publisher/webapp while **still on temporary
   buckets**. Retain the feature-server/MCP fixes already deployed. Verify no
   source-to-main changes were missed; private IaC remote authentication was not
   available during this review.
2. Pause writers/sensors and drain active publication runs. Save the temporary
   pointer, deployment values, sensor state, and generation-pinned source/target
   inventories. Pause legacy discovery before copying, not merely after the
   final container deployment. Recheck destination-prefix collisions.
3. Copy canonical data and source metadata into the permanent buckets, retaining
   the `hifld/<dataset>/<file>/<version>/…` layout. Use create-only destination and
   source-generation preconditions; compare names, sizes and GCS checksums and
   record **new target generations**. Do not use a deleting sync, overwrite
   legacy unprefixed paths, or rewrite every stored historical object.
4. Build a **new candidate release** for
   `https://storage.googleapis.com/hifld-next-datasets-prod` with explicit slug
   `gcs-hifld-next-datasets-prod`. Rebuild object identities from the target
   inventory; a string replacement in the old SQLite is insufficient because
   GCS copies get new generations. Preserve authored metadata and quality flags.
   Do not activate a copied old pointer/release as the candidate. Regenerate
   generated MapLibre styles against target PMTiles URLs before their first
   publication into the target; copying styles that reference the temporary
   bucket would leave an undeclared dependency. Existing canonical styles cannot
   be overwritten by the repaired publisher.
5. Validate the entire target index/STAC tree and every referenced target object.
   Counts and identities must match the frozen source (or have reviewed explicit
   differences). Check all registry slugs, object generations, root/asset/style
   URLs, metadata/schema/quality preservation, HTTP ranges, CORS, and archive
   downloads. Run webapp, feature-server and MCP against the candidate explicitly
   before pointing public readers to it. Account for candidate-build time: the
   normal catalog-only workflow can still read GeoParquet to derive facts; it is
   not automatically a bounded metadata-only rebase tool.
6. Set shared `PORTOLAN_PERMANENT_BUCKETS=true` with
   `PORTOLAN_WRITER_ENABLED=true`. Run the container deployment with
   `portolan_catalog=true`, the feature-server deployment, and a reviewed
   Terraform plan/apply in a coordinated maintenance window. Readers, writer,
   registry and storage routing must all agree before resuming publication.
   Restart/redeploy Dagster config consumers via the supported deployment
   workflow; editing only a ConfigMap does not update existing process env.
7. Prove a **new version** through real Dagster conversion/checks/promotion into
   the permanent target. Confirm webapp and feature server adopt the new release
   without restart, MCP resolves it, older versions still work, and an identical
   promotion does not replace existing target generations. Deliberately changed
   bytes at an existing key must fail. Roll the candidate pointer back to its
   prior complete permanent release and confirm serving, then restore it.
8. Observe before cleanup. For a bucket-level rollback, restore the shared flag
   to false and redeploy all matching temporary profiles and writer config;
   temporary buckets and the saved pointer must remain intact. Reader rollback
   does not migrate writes made after cutover—freeze/reconcile those explicitly.
   Retire old buckets/data/API/database only in a separate authorized change,
   after legacy URL/numeric-ID usage and rollback retention are resolved.

No bulk data replication per metadata release is required: canonical immutable
version objects are shared by small immutable catalog releases. The one-time
bucket move temporarily duplicates data while rollback storage is retained.
