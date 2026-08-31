# dataset-mcp

Stateless FastMCP Apps service for catalog discovery and bounded server-side
DuckDB queries. The production image builds the nested React app, installs
DuckDB `httpfs` and `spatial` extensions at image-build time, and runs as a
non-root user with a read-only root filesystem. Runtime scratch space is the
dedicated 4 GiB spill volume configured by the Helm chart.

The service is configured through the `DATASET_MCP_` environment prefix and is
exposed on port 8000. Required settings are:

- `DATASET_MCP_CATALOG_BASE_URL`: the internal dataset-api base URL.
- `DATASET_MCP_QUERY_TOKEN_SECRET`: at least 32 bytes, used to sign stateless
  query and tile tokens.
- `DATASET_MCP_STORAGE_SETTINGS`: JSON matching `StorageSettings`, containing
  the server-owned storage profiles keyed by catalog storage slug. Keep this
  value in a Kubernetes Secret; it can contain S3 or SeaweedFS credentials.

`DATASET_MCP_PUBLIC_ORIGIN` is optional. DuckDB's `httpfs` and `spatial`
extensions are installed into `/opt/duckdb/extensions` while the image is
built; the container never downloads extensions at startup. `/healthz` is the
Kubernetes and container health endpoint; MCP traffic is served at `/mcp/`.

The first-party webapp keeps the MCP transport same-origin by default. Its
server-only `DATASET_MCP_QUERY_API_URL` points to this internal service, while
the optional server-only `DATASET_MCP_PUBLIC_ENDPOINT` overrides only the
public endpoint advertised by the webapp's MCP Server Card. Neither setting is
exposed as browser client configuration.

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

For example, a storage-settings secret can contain:

```json
{"profiles":{"public-gcs":{"type":"public_gcs","slug":"public-gcs","bucket":"public-datasets","prefix":"geoparquet"}}}
```

The Helm chart reads the catalog URL from `catalog.baseUrl`, references
`tokenSecret` for the query-token secret, and references
`storage.settingsSecret` for this JSON. Add `storage.allowedCidrs` (and, when
needed, `storage.allowedPorts`) for the object-store network ranges; use
`networkPolicy.extraEgress` for an in-cluster S3-compatible endpoint. Do not
allow arbitrary egress or pass storage URLs through tool arguments.

## Map result contract

Mappable query results include `map_configuration` in structured content. The
server should emit these keys:

- `tile_url`: absolute `http`/`https` URL with `{z}`, `{x}`, and `{y}`
  placeholders, normally `${publicOrigin}/tiles/{z}/{x}/{y}.mvt`.
- `worker_url`: absolute URL for the matching MapLibre worker asset,
  normally `${publicOrigin}/assets/maplibre-gl-worker.mjs`.
- `geometry_type`: optional geometry-type styling hint; mixed geometry results
  are supported when omitted.
- `source_layer`: the MVT source layer, `hifld` for the built-in tile encoder.
- `bounds`: optional `[west, south, east, north]` initial viewport.

For local or proxied deployments, `tile_origin` may be supplied with relative
asset paths, but the UI never resolves `/tiles` or `/assets` against its
sandboxed iframe origin by default. Tile requests carry the signed query token
in `X-HIFLD-Query-Token`.

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
