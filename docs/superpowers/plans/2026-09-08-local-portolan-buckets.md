# Local Portolan Buckets Implementation Plan

> **For agentic workers:** Use subagent-driven-development with bounded parallel ownership and focused test-first checks.

**Goal:** Populate separate SeaweedFS staging and published catalogs with varied real source formats and expose STAC metadata and column schemas in the webapp.

**Architecture:** Preserve existing buckets. Bootstrap pinned original assets into `hifld-local-staging` using collection/dataset/file/version paths and a STAC tree. Execute real Dagster conversion, promotion, and catalog publication into `hifld-local-published`; publish the database last. STAC is the metadata authority; database columns are its derived query projection.

**Tech Stack:** Python/Dagster, SeaweedFS S3, GDAL, Arrow, STAC/Portolan, SQLite adapters, TypeScript webapp.

### 1. Source fixtures (publisher worktree ops/acceptance) — complete

- [x] Inventory original source objects read-only, select modest point/line/polygon and multilayer examples with FileGDB, Shapefile, GeoJSON and GeoPackage represented.
- [x] Test manifest parsing and canonical path construction before implementation; preserve every available original format for selected logical datasets.
- [x] Add repeatable bootstrap with fixed revisions/checksums, separate bucket defaults, and no deletion or production writes.

### 2. Publisher integration (publisher worktree src/dagster_hifld) — complete

- [x] Add regression coverage for real terminal publication, populated STAC column metadata, complete parent links across multiple records, and staging/published separation.
- [x] Replace synthetic-only terminal path for this workflow with real Dagster operations using existing converters and storage resources. Preserve original formats; write STAC before the complete database.
- [x] Run focused tests then `uv run python -m unittest discover tests`.

### 3. Consumer metadata/schema (webapp) — complete

- [x] Reproduce missing schema and metadata contract; add tests for STAC metadata links and real column descriptions.
- [x] Use trusted catalog STAC URLs for metadata and STAC column information for schema, without dataset-api or a second metadata document.
- [x] Run targeted tests then `npm run check`, `npm run typecheck`, `npm test`, and `npm run build`.

### 4. Local integration (root) — complete

- [x] Bootstrap new staging bucket and execute Dagster against new published bucket.
- [x] Verify originals, generated GeoParquet/PMTiles, STAC links, nonempty schemas, database rows, and consumer generation agreement.
- [x] Configure local consumer launch instructions for published bucket; record exact commands and verification, preserving existing buckets and uncommitted work.

Execution evidence and exact recovery history: [Local Portolan workflow](../../local-portolan.md).
