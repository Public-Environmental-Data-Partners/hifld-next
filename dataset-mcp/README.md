# dataset-mcp

Stateless FastMCP Apps service for catalog discovery and bounded server-side
DuckDB queries. The production image builds the nested React app, installs
DuckDB `httpfs` and `spatial` extensions at image-build time, and runs as a
non-root user with a read-only root filesystem. Runtime scratch space is the
dedicated 4 GiB spill volume configured by the Helm chart.

## Local development

Start the service on port 8001 with no configuration:

```bash
cd dataset-mcp
uv run fastapi dev
```

Local development defaults the dataset-api URL to `http://127.0.0.1:8000` and
uses the fixed `access` / `secret` credentials from the repository's local
SeaweedFS setup. Set `DATASET_MCP_CATALOG_BASE_URL` only when dataset-api is
running elsewhere. Object locations and non-secret storage configuration come
from dataset-api; dataset-mcp does not maintain a second storage-profile
configuration.

The production service is configured through the `DATASET_MCP_` environment
prefix and is exposed on port 8000. Required settings are:

- `DATASET_MCP_CATALOG_BASE_URL`: the internal dataset-api base URL.
- `DATASET_MCP_QUERY_TOKEN_SECRET`: at least 32 bytes, used to sign stateless
  query and tile tokens.

`DATASET_MCP_PUBLIC_ORIGIN` is optional. DuckDB's `httpfs` and `spatial`
extensions are installed into `/opt/duckdb/extensions` while the image is
built; the container never downloads extensions at startup. `/healthz` is the
Kubernetes and container health endpoint; MCP traffic is served at `/mcp`.

The first-party webapp keeps the MCP transport same-origin by default. Its
server-only `DATASET_MCP_QUERY_API_URL` points to this internal service, while
the optional server-only `DATASET_MCP_PUBLIC_ENDPOINT` overrides only the
public endpoint advertised by the webapp's MCP Server Card. Neither setting is
exposed as browser client configuration.

## Docker image builds

Build from the repository root so the image can include the shared
`packages/map-core` and `packages/map-ui` packages:

```bash
docker build -f webapp/Dockerfile -t hifld-webapp:test .
docker build -f dataset-mcp/Dockerfile -t hifld-dataset-mcp:test .
```

The dataset-mcp image builds and serves the UI as a single-file bundle.

## Webapp query HTTP resources

The first-party webapp can proxy two bounded, stateless resources to this
service:

- `POST /api/queries` starts a query using catalog source identities and
  returns a signed token plus an opaque, non-secret `query_id`.
- `POST /api/queries/{query_id}/pages` re-executes a page. It requires the
  token in `X-HIFLD-Query-Token`; the path `query_id` must match that token.
  `offset` is non-negative and `page_size` is 1 through 1,000.

Stable problem codes are returned for policy, timeout, capacity, token, and
geometry failures. They do not expose DuckDB errors, SQL, object paths,
credentials, or token values. Query MVT is loaded directly from the public
`GET /api/queries/{query_id}/tiles/{z}/{x}/{y}.mvt` URL, with the same token
header; the webapp does not proxy tiles. Query IDs do not identify persisted
results: there is no Valkey, result store, cursor, or query-history registry.

Set `DATASET_MCP_WEBAPP_ORIGINS` to a comma-separated allowlist of deployed
webapp origins for the public query-tile CORS path. Production entries must be
HTTPS origins; local `http://localhost` or `http://127.0.0.1` is supported only
for development. This service continues to support the existing local
SeaweedFS S3-compatible and public GCS storage configurations; never put
storage credentials, source paths, or internal service URLs in browser config.

The Helm chart reads the catalog URL from `catalog.baseUrl`, references
`tokenSecret` for the query-token secret. Add `storage.allowedCidrs` (and,
when needed, `storage.allowedPorts`) for the object-store network ranges; use
`networkPolicy.extraEgress` for an in-cluster S3-compatible endpoint. Do not
allow arbitrary egress or pass storage URLs through tool arguments.

## Interactive query maps

Regular discovery, metadata, row, and query tools return text and structured
content without opening an app. `view_query_map` opens the map-only MCP App and
accepts one through eight named spatial query layers. Each layer contains the
same trusted `sources`, safe read-only `sql`, optional geometry/CRS selection,
and constrained style accepted by `query_geoparquet`. The agent must provide a
meaningful map title and unique layer names; query-ID labels are never
generated.

The server executes a bounded validation page for each layer and creates its
signed query token internally. Agents never copy tokens into the map tool. The
self-contained layer result includes that exact token, its expiration, and a
durable map definition. Before the earliest token expires, the component calls
the app-only `refresh_query_map` tool to re-run that definition and replace all
runtime query IDs and tokens. This also restores maps from saved conversations
when the host restores the MCP App result and supports proxied server-tool
calls. Nothing is stored in memory, Valkey, or a result registry.

Each layer receives an absolute sandbox-compatible
`${publicOrigin}/tiles/{query_id}/{z}/{x}/{y}.mvt` URL. The component matches
that query ID to its layer token and sends `X-HIFLD-Query-Token`; the server
verifies that the path ID matches the signed token before re-running the
bounded DuckDB tile query. The component renders independent MapLibre sources
in input order, fits their combined bounds unless the agent supplies a camera,
and displays one named solid-color legend group per layer.

`view_query_map` defaults to the same OpenFreeMap Bright street basemap as the
HIFLD webapp and also supports its Esri World Imagery satellite mode. Arbitrary
style URLs, raw MapLibre expressions, partial maps, GeoJSON conversion, and
alternate tile fallbacks are not accepted.

## Opt-in storage acceptance tests

The normal test suite does not require network access. To exercise a real
public GCS object through the DuckDB worker, set:

```bash
HIFLD_TEST_GCS_BUCKET=public-datasets \
HIFLD_TEST_GCS_OBJECT=path/to/data.parquet \
HIFLD_TEST_DUCKDB_EXTENSION_DIRECTORY=/path/to/duckdb/extensions \
uv run pytest tests/integration/test_public_gcs.py -q
```

For a local SeaweedFS S3 endpoint, use:

```bash
HIFLD_TEST_SEAWEED_ENDPOINT=http://localhost:8333 \
HIFLD_TEST_SEAWEED_BUCKET=datasets \
HIFLD_TEST_SEAWEED_OBJECT=path/to/data.parquet \
HIFLD_TEST_DUCKDB_EXTENSION_DIRECTORY=/path/to/duckdb/extensions \
uv run pytest tests/integration/test_seaweedfs.py -q
```

The optional `HIFLD_TEST_SEAWEED_ACCESS_KEY` and
`HIFLD_TEST_SEAWEED_SECRET_KEY` variables default to the local development
credentials `access` and `secret`.
