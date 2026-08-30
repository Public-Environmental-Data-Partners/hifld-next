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
