# Local Portolan workflow

## Storage boundaries

`hifld-local-staging` contains pinned original assets arranged as a Portolan
catalog. `hifld-local-published` contains the promoted originals, generated
GeoParquet/PMTiles, STAC metadata and the final catalog database. The original
acceptance bucket and production bucket are not modified by this workflow.

The publisher implementation is currently in the linked datasets-repository
worktree `.worktrees/portolan-publisher`. Its changes must be integrated separately
from the `hifld-next` repository; the original sibling checkout is untouched.

## Published metadata refreshes

The publisher writes absolute STAC navigation and asset URLs when a public root
is configured, for either GCS or SeaweedFS. Offline rendering can retain relative
links. Webapp metadata endpoints continue to return the authored documents verbatim.

For production-inventory builds, pass `--production-datasets` alongside
`--production-collections` to preserve catalog timestamps from the production
exports. Missing source dates remain absent; catalog build time is not a source date.

`scripts/portolan_gcp_upload_catalog.py --replace-existing` refreshes generated
catalog documents in the dedicated migration buckets using generation-conditional
writes, skips unchanged content, and uploads SQLite last. Keep the prior local
build for comparison. This command does not refresh or transform dataset assets.

## Bootstrap and run Dagster

Start SeaweedFS with the root Compose project, then run from the repository root:

```bash
source ops/local-portolan.env.example
cd .worktrees/portolan-publisher
uv run python -m ops.acceptance.bootstrap
uv run python -m dagster_hifld.portolan.cli promote \
  --manifest ops/acceptance/manifest.json \
  --dagster-home .local/dagster
```

Bootstrap verifies generation-pinned source downloads and caches them. The
publication command executes a Dagster job and retains its run/event state in
the specified directory. It does not call dataset-api. Source fixtures and
published artifacts are deliberately in different buckets.

If conversion/promotion has already completed and only metadata needs repair,
add `--catalog-only`. This still executes a recorded Dagster job, reads the
generated GeoParquet and promoted objects, and publishes the STAC tree and
database without running conversion again.

To inspect these runs in Dagster, from the publisher worktree with the same
environment loaded:

```bash
DAGSTER_HOME="$PWD/.local/dagster" uv run dagster dev \
  -m dagster_hifld.portolan.workflow -p 3001
```

Port 3001 avoids the webapp's port 3000. The normal full command intentionally
regenerates GeoParquet/PMTiles; use catalog-only mode for metadata fixes.

The fixture set contains:

- Agricultural Minerals Operations: 236 points; FileGDB, GeoJSON, GeoPackage and Shapefile.
- USCG Sectors: 37 polygons; FileGDB, GeoJSON, GeoPackage and Shapefile.
- Uniform Hazard Ground Motion: separate line and polygon files; GeoJSON,
  GeoPackage and Shapefile for each.
- Hospitals: both production versions for version comparison. `v1.0.0` includes
  FileGDB, GeoJSON, GeoPackage, GeoParquet, PMTiles, and Shapefile; `v1.1.0`
  includes GeoPackage, GeoParquet, PMTiles, and Shapefile. Catalog-only promotion
  preserves the generation-pinned production bytes for every format.

There are 24 pinned source assets (about 136 MB), including two pinned
GeoParquet and two pinned PMTiles hospital assets. Each bucket has 17 navigable STAC JSON
documents. Staging metadata identifies itself as unverified source inventory;
it does not claim that unpublished source files passed pipeline quality checks.

## Consumers

From the root of `hifld-next`, configure and start a host webapp:

```bash
source ops/local-portolan.env.example
cd webapp
npm run build
HOST=127.0.0.1 PORT=3000 node .output/server/index.mjs
```

In another shell, start a host feature server:

```bash
source ops/local-portolan.env.example
cd feature-server
uv run uvicorn app.asgi:app --host 127.0.0.1 --port 8003
```

The webapp's data table also needs the current local query service:

```bash
source ops/local-portolan.env.example
cd dataset-mcp
uv run uvicorn main:app --host 127.0.0.1 --port 8004
```

The development entry point installs its DuckDB extensions and supplies local
SeaweedFS credentials. Port 8004 avoids relying on an older deployed service
through a port forward. The webapp sends same-origin query requests to it.

Alternatively, from a fresh shell (without the host-specific environment), use
`docker compose --profile feature-server up --build -d feature-server` to serve
features on port 8002. Compose uses the internal Docker S3 hostname, while the
host example uses localhost. Do not mix those two endpoint configurations.

The host example deliberately points `DATASET_API_URL` at an unavailable port so
catalog smoke checks cannot silently fall back to the old service.

## Metadata

The root published catalog is
`http://localhost:8333/hifld-local-published/catalog.json`. Follow its child links
to the dataset, logical file and version STAC documents. Version Collections
contain asset links and `table:columns`; they are the metadata documents exposed
by the webapp. Column information in the SQLite catalog is a derived projection,
not a separately authored schema source.

Bootstrap also preserves 19 generation-pinned production metadata files: the
source manifest, data dictionary and quality manifest for each logical version,
plus the three dataset and four file manifests. Collection identity is an exact,
SHA-256-pinned response captured from the production collections API; its source
URL is recorded in the fixture manifest. No collection bucket manifest was located.
Their original bytes live under `metadata/source/` in both buckets. Publication
uses the production dictionary's field names, order, types and nullability for
version-level `table:columns` and schema comparison, retaining descriptions,
examples, possible values, lengths and ranges in STAC and its database projection.
Converted Parquet fields do not replace or extend this source schema. Feature
counts and bounds are still inspected from GeoParquet. Unknown source
statistics stay unknown; the UI displays available examples and quality status.
Metadata-only publication also promotes these source documents so provenance
links remain resolvable without regenerating data.

Fixture asset records contain no manually written names, descriptions, publishers
or tags. Dataset metadata comes from its own production manifest, not a file or
version substitute. Republish updates existing collection/dataset/file metadata.
Original tag keys are preserved; filters use AND across keys and OR across values
within a key, before counting and pagination. Text search includes tag values,
and results are ordered by title and dataset path for stable offset pagination.

`GET /api/collections` returns the root STAC Catalog verbatim, and
`GET /api/collections/{slug}` returns that collection's STAC Catalog verbatim.
Their `Content-Location` headers identify the canonical bucket documents for
resolving relative links. Searchable, paginated dataset listings are separate:
`GET /api/collections/{slug}/datasets?query=water&limit=25`.

Example UI: [Agricultural Minerals schema](http://localhost:3000/collections/hifld/datasets/agricultural-minerals-operations/files/agricultural-minerals-operations/schema).
Its metadata link returns the exact published STAC Collection bytes. File metadata
supports `?version=v1.0.0`; without it, the selected latest version is returned.

## Verification recorded for this local setup

- Crawled both STAC trees and resolved all 14 staging / 22 published asset URLs.
- Checked source archive contents and pinned checksums.
- Verified every promoted original against its pinned source MD5 byte-for-byte;
  existing Shapefile ZIPs are preserved rather than repacked.
- Checked metadata byte equality between the webapp and bucket STAC files.
- Verified populated schemas for all four logical files (12, 12, 7 and 10 columns).
- Browser check confirmed the schema table and metadata link render.
- Feature collection/queryables/page/item-by-ID checks passed for all four files,
  using a verified native ID when available and physical IDs otherwise.
- Webapp: `npm run check`, `npm run typecheck`, 413 tests and production build passed.
- Feature server: Ruff check/format, Pyright, BasedPyright and 19 tests passed.
- Publisher: full unittest run completed with 369 tests, OK, 1 skipped.
- MCP: Ruff check/format, Pyright, BasedPyright and 259 tests passed, 5 skipped.
- Verified all 19 published source metadata documents against pinned production
  size/MD5, and examples plus actual quality status in all four schema responses.

The initial full Dagster run converted and promoted all four logical files but
failed during database creation, exposing a media-type uniqueness bug. After
fixing that and the metadata issues found by the live checks, catalog-only
recovery completed successfully without regenerating data. The final successful
run before rich metadata import was `72760f3d-6e91-414f-b128-7da6468cfb3f`.
The subsequent rich-metadata publication run is
`a006e73c-b362-4af7-9df7-336700836a70`, generation
`03210945-9568-482a-b388-f785b94d5e96`. Verification checked all 22 asset
sizes/checksums against object metadata, exact STAC metadata responses and all
four feature page/item round-trips. Regression tests cover preserving original
ZIPs, missing GeoParquet footer bounds, and stable asset keys on repeated catalog
publication.

The authoritative parent-metadata/tag repair was subsequently published by run
`0f6f2afe-004a-4479-a85b-d442e4f7ed26`, generation
`c9fff48c-3258-445f-9375-6bfb664ad905`. Live verification confirmed exact production
dataset descriptions, original tag groups and filtered pagination, visible
PMTiles rendering, and table queries returning rows 1–5 then 6–10. The captured
production collection response and all 19 source metadata documents match their
recorded checksums.

The broader migration still has outstanding production-hardening and conformance
work described in the implementation checkpoint. This local fixture workflow is
not permission to retire dataset-api or deploy the feature service publicly.
