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
and constrained style accepted by `query_parquet`. The agent must provide a
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

The app uses a bundled classic worker (`maplibre-gl-worker.cjs`) because module
Blob workers fail to initialize in opaque-origin sandboxed iframes. The existing
module-worker assets remain available. Browser tests exercise the built UI,
worker, MVT decoding, token headers, and point selection in both sandbox modes:

```bash
npm run --workspace @hifld/dataset-mcp-ui build
npx playwright install chromium
npm run --workspace @hifld/dataset-mcp-ui test:browser
```

### Query tools without the map UI

`query_parquet` replaces the MCP tool name `query_geoparquet`; reconnect clients
to refresh tool discovery. Its arguments and paginated response are unchanged.
Raw geometry values remain size summaries. For bounded geometry output, select
`ST_AsGeoJSON(geometry)` (a JSON string) and transform to EPSG:4326 first when
needed. Cell and response byte limits still apply. Catalog source resolution
and the list of supported catalog formats are unchanged by this rename.

`generate_mvt_tile_url(sources, sql, geometry_column?, result_crs?)` returns only:

```json
{
  "tile_url": "https://example.org/tiles/query-id/{z}/{x}/{y}.mvt",
  "headers": {"X-HIFLD-Query-Token": "signed-query-token"},
  "expires_at": "2026-09-10T22:00:00Z",
  "source_layer": "hifld",
  "geometry_column": "geometry",
  "result_crs": "EPSG:3857"
}
```

The SQL must return a GEOMETRY column. CRS-tagged geometry is inferred; otherwise
provide the SQL result's CRS explicitly. This tool does not guess CRS from source
coordinates or convert GeoJSON text back into geometry. Specify geometry_column
when more than one geometry is returned. Send the returned headers on tile GETs
and regenerate the URL after expiry. The token is a capability: keep it out of
logs and do not append it to the URL. A one-row validation probe preserves the
full SQL for per-tile execution; it does not impose SQL LIMIT 1 on the tiles.
No full result cache, global bounds scan, or feature collection is created.
Existing SQL restrictions, tile feature/byte caps, deadlines, source
revalidation, and worker memory limits apply.

Examples: `SELECT NAME, geometry FROM hospitals WHERE COUNTYFIPS = '36061'`
with EPSG:3857 for source 21101; `SELECT geometry FROM roads WHERE class = 'primary'`
with that result's CRS; or a spatial join that selects one named geometry from
the joined tables. Use query_parquet instead for scalar aggregates.

## Temporary map argument diagnostics

`view_query_map` HTTP calls emit `mcp_argument_types` JSON log records at
`http_ingress` (decoded HTTP JSON) and `tool_dispatch` (FastMCP's public middleware
hook before tool-specific Pydantic validation). Match the generated `request_id`
across both records. The Helm chart sets `DATASET_MCP_BUILD_REVISION` from the image
tag; local runs report `unknown` unless this environment variable is set.

Only the fixed tool name, stage, generated ID, revision, and the types of `layers`
and `camera` are logged. `missing` differs from `null`. No argument values, SQL,
client request IDs, or headers are added to these records. Existing framework
validation warnings are unchanged and may still include invalid input values.

After deployment through the normal workflow, retry a simple Claude map and a
direct MCP call, then inspect:

```bash
kubectl -n hifld-next logs deployment/dataset-mcp --since=10m | rg mcp_argument_types
```

A string at ingress places the conversion upstream of the application. An array
at ingress and string at dispatch places it between those boundaries. Arrays at
both boundaries require investigating the remaining dispatch/validation path;
the dispatch hook is not instrumentation inside Pydantic itself.

At validation, view_query_map now also accepts one JSON-encoded layers or camera
parameter for connector compatibility. Correctly typed values are unchanged;
decoded values still undergo the same shape, range, and query checks. Malformed
JSON, double encoding, and invalid layer/camera shapes remain errors. The
advertised schemas still ask clients for actual arrays/objects. Diagnostics
observe the original input types before this compatibility decoding.

Capture tees incoming chunks unchanged and is capped at 1 MiB per request. Invalid
or oversized JSON skips the ingress record without changing normal processing;
a missing ingress record is not evidence of conversion. Non-map tools are not
logged. Remove the two diagnostic middleware registrations, their module, and
the chart revision variable after the investigation.

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
