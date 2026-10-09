# HIFLD Next

HIFLD Next publishes and serves versioned geospatial datasets using a Portolan
STAC catalog and its derived SQLite index.

## Services

- `webapp/`: TanStack Start frontend, catalog/search/schema API, STAC endpoints,
  downloads, and same-origin MCP/query proxy.
- `dataset-mcp/`: dataset discovery and query tools, MCP map application, and
  ClickHouse-backed spatial queries.
- `feature-server/`: pygeoapi OGC API - Features backed by DuckDB and published
  GeoParquet.
- `../hifld-next-datasets`: Dagster ingestion, conversions, quality checks,
  immutable promotion, STAC rendering, and SQLite publication.
- `../hifld-next-iac`: production infrastructure and deployment workflows.

The catalog is stored with the data, not in a separate catalog database service.
Production readers resolve
`https://storage.googleapis.com/hifld-next-datasets-prod/_catalog/current.json`
and refresh in-process. The pointer selects a complete STAC/SQLite generation;
canonical dataset assets are shared between catalog generations.

## Local development

SeaweedFS is the supported local storage backend:

```bash
cp .env.example .env
docker compose up -d seaweedfs-master seaweedfs-volume seaweedfs-filer clickhouse
npm ci
source ops/local-portolan.env.example
cd webapp
npm run dev
```

Bootstrap and promote the pinned source fixtures with the publisher repository
before starting catalog consumers. Follow [the local Portolan workflow](docs/local-portolan.md)
for Dagster, the feature server, MCP, and hot-refresh acceptance checks.
Configure `CATALOG_RELEASE_POINTER_URL`, `CATALOG_SQLITE_URL`, or
`CATALOG_SQLITE_PATH`; the webapp fails closed when no catalog is available.

## Verification

```bash
npm run test:frontend-workspace
npm run --workspace webapp check
npm run --workspace webapp typecheck
npm run --workspace webapp test
npm run --workspace webapp build
```

For each Python service, run from its directory:

```bash
uv sync --frozen
uv run ruff check .
uv run ruff format --check .
uv run pyright
uv run basedpyright
uv run pytest
```

The dataset MCP tests need its built UI assets; run
`npm run --workspace @hifld/dataset-mcp-ui build` first. Optional cloud/SeaweedFS
integration tests require their documented local fixtures and configuration.

## Production

Application images are published for webapp, dataset-mcp, ClickHouse, and
feature-server. Infrastructure workflows deploy pinned revisions. The public
load balancer routes the webapp, MCP and feature server; published storage assets
are served directly from GCS.

Runtime browser settings such as PostHog are served by `/runtime-config.js`, not
baked into images. Catalog/storage configuration and query secrets remain
server-side.

See [architecture](docs/architecture.md), [cutover evidence](docs/production-cutover-2026-10-08.md),
and [legacy retirement](docs/legacy-retirement.md). Removing service code does not
uninstall an existing deployment or delete its database, storage, or local
volumes. Retirement requires the coordinated rollout described in that guide.
