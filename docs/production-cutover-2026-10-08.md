# Production Portolan bucket cutover — 2026-10-08

## Status

The permanent-bucket switch is deployed and live publication, browser, object
audit and rollback/restore acceptance passed. Discovery was restored to its prior
`RUNNING` status; both legacy cronjobs remain suspended with no active jobs.
This report supersedes the earlier readiness review's pre-deployment status.

## Storage and configuration

- Published: `hifld-next-datasets-prod`; staging: `hifld-next-staging-prod`.
- Canonical slug: `gcs-hifld-next-datasets-prod`.
- Live pointer: `gs://hifld-next-datasets-prod/_catalog/current.json`.
- `PORTOLAN_PERMANENT_BUCKETS=true` and `PORTOLAN_WRITER_ENABLED=true` select
  matching reader, writer, registry, and load-balancer storage configuration.
- Existing legacy unprefixed objects and both temporary Portolan buckets were
  retained. No bucket or canonical data was deleted. Both legacy discovery
  cronjobs remain suspended; retiring the legacy API/database is separate work.

The frozen published copy contained 9,828 objects (601,012,833,967 source bytes);
staging contained 9,814 objects (601,012,776,954 bytes). Copies used create-only
destinations and pinned source generations. Fresh listings verified all keys,
sizes, CRC32C/MD5 identities and unchanged source generations. In the published
copy, 1,382 STAC documents and eight styles were rebased; binary data was not
rewritten. New target GCS generations were indexed, not copied from old SQLite.

The initial permanent candidate `b68bd01a-eb87-486e-8040-5ba2e394ae92` passed
SQLite integrity/foreign-key checks and project tree validation. Its 330 datasets,
525 files, 526 versions, and 2,734 assets/objects matched the source; authored
metadata, schema and quality records were compared. Every indexed target object
matched its stored size and generation. Eight generated styles referenced the
new target PMTiles URLs. This validation is not a full Portolan conformance suite.

## Merged repairs and deployments

- Application readiness PR 63, publisher PR 11, infrastructure PR 27.
- WebMCP PR 64: accept string/number schema extrema and deduplicate logical files
  repeated across version child links. Reproduced failures before fixing.
- WebMCP PR 65: accept only the exact MapLibre `.mjs` and `.cjs` worker paths;
  preserve scheme, credentials, query, fragment and path restrictions. Spatial
  HTTP queries already succeeded but the client rejected the deployed `.cjs` URL.
  Regression reproduced; 18 targeted tests, lint, typecheck, 497 full tests and
  build passed, as did PR/main CI and pinned image builds.
- Publisher revision: `23bb5dc7291313343eeced24b636a55e73a1bd26`.
- Infrastructure revision: `93ea38384748d0024f0917734c8740ffbf93b76a`.
- Reader deployment revision before final worker repair:
  `99c07f7b3b43052ca5d2345714d9ea92cdb9303a`.
- Final worker repair revision: `a990aa6bae27b299da5a862fa1cc466ab1e947a6`;
  container rollout `37869924121` succeeded and browser acceptance passed.
  Feature-server code did not
  change in that repair and remains pinned to `99c07f7`.

Relevant successful infrastructure workflow runs: Terraform apply `37867550526`
(zero additions, two changes, zero destroys), Dagster `37867760402`, containers
`37868084068`, feature server `37868083026`. Metadata-only publication
`37868632189` activated `cf809c93-c5c0-4ec3-968a-d3ecb8ec6696`; webapp and feature
server adopted it with the same pod UIDs and zero restarts. It took about twelve
minutes to rebuild/upload the 4,152-file catalog bundle; canonical data was shared.

## Acceptance evidence so far

Public checks passed for STAC, 330-dataset statistics, sitemap (867 entries),
six original/derived formats, direct and same-origin 16-byte HTTP 206 ranges,
file magic, CORS, File Geodatabase/Shapefile ZIP redirects, and discovery links.
MCP initialized with 16 tools, returned metadata/schema, executed a count query
(8,340 Hospitals), and served a nonempty authenticated query-map vector tile.
Feature checks covered points, polygons and lines, schemas, feature IDs,
pagination, bbox filtering, explicit versions and unsupported-CQL rejection.

Real deployed WebMCP catalog/schema/search/compare tools, catalog PMTiles,
count queries and spatial query rendering passed. Spatial queries returned five
rows, added a ready layer and fetched a vector tile with HTTP 200; published
PMTiles used HTTP 206 ranges. No browser page errors were observed. Native WebMCP
was unavailable in the installed browser; the
probe supplied only its registration boundary. Application code, HTTP, query
execution and map rendering were real.

Deployed immutable-promotion checks preserved generations for identical
GeoPackage/GeoParquet/PMTiles/Shapefile copies and an identical style, and rejected
changed canonical bytes and changed style bytes without replacing existing objects.

The operator approved Hospitals `v1.1.1` as a processing-only release from the
archived `v1.1.0` GeoPackage. Input SHA-256:
`0872793940e4984b7873f4ee559b4f4661ab237f84d71585996d5aa0b26a3858`.
Source date issued remains `2026-04-06`; descriptions explicitly state that no
new source data was fetched. Run `a7e3de63-05e9-4c81-a8dd-2c97caa22626` finished
successfully and activated `4b70b392-c6cc-4df1-b690-6f6a5ddc07a2` at
`2026-10-09T01:35:51Z` (catalog SHA-256
`820e6409f07b09074925d192f7e9c0bbf584ff4333d85e70a753346eb61b7e2f`).
The resulting index has 527 versions and 2,740 assets/objects. A fresh full listing
verified all indexed object sizes and GCS generations; integrity/foreign-key
checks passed. New quality is passed with 8,340 features and zero invalid/null
geometries. GeoPackage bytes and authored source date were verified unchanged.

Webapp and feature server adopted this release without restarts (webapp UID
`9909d175-2bb6-4afc-a80c-ef792dbcbeb1`, feature UID
`abc97c90-340d-45fe-acd8-d770f618e5cd`, both zero restarts). All three Hospitals
versions served 8,340 features. WebMCP discovered v1.1.1, rendered its PMTiles and
compared versions; MCP queried v1.1.1 and served an authenticated map tile.
The deployed verified/CAS rollback operation selected the prior complete permanent
release `b68bd01a-eb87-486e-8040-5ba2e394ae92`, and both readers adopted it without
restart. The catalog stopped advertising v1.1.1 and continued serving both older
versions. The same operation restored `4b70b392-c6cc-4df1-b690-6f6a5ddc07a2`;
both readers adopted it and all three versions served again, with unchanged pod
UIDs and zero restarts. The final pointer restore timestamp is
`2026-10-09T01:38:45Z`; its catalog bytes/hash are unchanged. Temporary rollback
pointer `ca91279d-478e-4003-96fa-d6478c9f0d14` and GCS object generation
`1791498264034754` were independently verified unchanged.

The manually invoked in-process check
was flagged by Dagster's Kubernetes run monitor because no run-worker Job existed;
the actual process continued and the final recorded status was `SUCCESS`.
The audit trail contains both the monitor's `PIPELINE_FAILURE` event and the
actual final `PIPELINE_SUCCESS`. This invocation caveat is not evidence that the
normal Kubernetes run-launcher/scheduler path was tested by this manual check.

## Caveats and follow-up

- Reader rollouts caused brief public 503s while load-balancer endpoints
  converged. A missing feature-server zone backend was repaired and the IaC zone
  variable now includes all four zones. Graceful endpoint draining/preStop remains
  a separate availability improvement; this was not a zero-downtime deployment.
- Existing 90 failed-quality records, unknown/world source extents and sparse
  style/thumbnail coverage remain. Successful serving does not repair source data.
- Existing sitemap/AI-discovery HTTP links redirect successfully to HTTPS; their
  canonical scheme should be cleaned up separately.
- Live STAC clients should use the `/stac` service or resolve the release pointer's
  `root_key` for a static tree. The bucket-root `catalog.json` is the initial
  candidate snapshot, not an automatically updated latest-release alias. It was
  verified still linking to `b68bd01a` after the new release; the deployed readers
  follow `_catalog/current.json` and are not affected.
- One existing sitemap unit test timed out during PR 64 CI, then passed on rerun;
  no timeout workaround or unrelated test change was added.
- Temporary buckets still duplicate roughly 560 GiB per copied data tier while
  retained for rollback. Cleanup needs a separate retention/legacy-URL decision.

Generation-pinned inventories, copy journals, pointer/writer snapshots and
executable acceptance probes were retained in the workspace's ignored
`.worktrees/cutover-evidence-20261008/` directory. Working copies remain under
`/private/tmp/hifld-cutover-20261008.o9tFEE`. Evidence files are not committed or
uploaded as CI artifacts; preserve the workspace copy for rollback audit.
