# Dataset MCP app server design

## Goal

Add a public, stateless MCP Apps server that lets coding agents discover HIFLD
datasets, inspect dataset and GeoParquet metadata, read bounded row pages, run
arbitrary read-only DuckDB queries across explicitly selected GeoParquet
sources, inspect results in an interactive table, and render geospatial query
results on an interactive map.

DuckDB always executes on the server. The sandboxed React app never reads
GeoParquet directly and never runs DuckDB-Wasm. Query results are not
materialized or persisted. Each table page or map tile is a bounded execution
against the source GeoParquet objects in cloud storage.

## Product decisions

- Create a new top-level `dataset-mcp/` service rather than adding a public MCP
  endpoint to the internal `dataset-api` process.
- Use FastMCP with stateless Streamable HTTP transport at `/mcp/`.
- Use one custom React MCP App resource for dataset, table, and map views.
- Execute DuckDB only in a bounded worker process, never in the FastMCP request
  process or iframe.
- Permit arbitrary relational `SELECT` and `WITH ... SELECT` SQL over
  server-registered aliases. Do not permit arbitrary DuckDB programs, paths,
  URLs, filesystems, extensions, configuration, or secrets.
- Support complex joins, CTEs, aggregation, windows, and approved spatial
  functions.
- Re-execute the query for each page. Page consistency across source changes is
  not guaranteed and no exact result count is calculated automatically.
- Use signed, self-contained query tokens for cross-request query state. Do not
  add Valkey, server sessions, live query cursors, or a query-result registry.
- Generate vector tiles directly from GeoParquet for mapped queries. Every tile
  execution is constrained to the tile envelope before clipping and encoding.
- Do not add authentication in this phase. Treat the service as public and
  enforce ingress, concurrency, query, memory, time, and output limits.

## Scope

The first release includes:

- Dataset search with the current catalog filters and offset pagination.
- Dataset, file, format, source, schema, quality, version, and spatial metadata.
- GeoParquet source selection by catalog identity, not by user-supplied URL.
- Bounded direct row reads for one GeoParquet source.
- Bounded SQL queries across as many as eight selected GeoParquet sources.
- UI-only page fetching from the sandboxed app through the MCP Apps host
  bridge.
- Virtualized interactive result tables.
- MapLibre maps backed by server-generated MVT tiles.
- Text and structured-data fallbacks for MCP clients without MCP Apps support.
- Public GCS reads, AWS S3-compatible reads, and local SeaweedFS reads.
- Metrics and structured errors sufficient to tune query limits after launch.

The first release does not include:

- Authentication, per-user authorization, private datasets, or user-provided
  cloud credentials.
- Persisted queries, result materialization, saved views, exports, downloads,
  or query history.
- Exact result counts or generic keyset pagination for arbitrary SQL.
- Asynchronous jobs, background query status, or cross-request cancellation.
- Server-side table-page or tile caches.
- DuckDB-Wasm, direct GeoParquet reads from the iframe, or direct iframe access
  to the internal dataset API.
- GeoServer integration.

## Repository and deployment shape

`dataset-mcp/` is an independently built Python service with a nested React UI
package:

```text
dataset-mcp/
  app/                 FastMCP, HTTP routes, catalog client, SQL policy
  query_worker/        DuckDB worker protocol and execution
  tests/               unit, integration, security, and protocol tests
  ui/                  React MCP App source and tests
  pyproject.toml
  Dockerfile
charts/dataset-mcp/    Kubernetes deployment, service, and ingress values
```

The deployment exposes `/mcp/`, `/tiles/`, `/assets/`, and `/healthz` through a
public HTTPS origin. It calls `dataset-api` through its existing internal
service URL. It does not connect directly to the catalog database.

FastMCP runs with stateless HTTP enabled so any request can reach any replica.
The service must not depend on cookies, load-balancer affinity, or in-memory MCP
sessions. The FastMCP ASGI app is mounted into a small FastAPI application so
MCP transport and tile/health/asset routes share one deployment and lifespan.

## Component boundaries

### Catalog client

The catalog client wraps the existing dataset API and parses every response
into narrow Pydantic models. It supports collection and dataset search, dataset
detail, and file detail with formats and expanded sources.

Query sources are never arbitrary paths. A `QuerySourceRef` contains:

- `alias`: SQL identifier chosen by the agent.
- `collection_id`, `dataset_id`, and `file_id`: catalog context.
- `file_source_id`: exact versioned GeoParquet source.

The resolver fetches the file detail, verifies that the source belongs to that
file, verifies that its format is GeoParquet and its source type is `file`, and
returns the explicit objects or trusted glob expansion published by the
catalog. A source that disappeared, changed format, or no longer belongs to the
requested file fails closed.

The catalog remains the source of truth for dataset metadata and object paths.
The MCP service owns only execution-specific storage configuration and
credentials.

### Storage resolver

The storage resolver maps the catalog storage-location slug and type to a
server-managed DuckDB access profile. Agent input cannot supply an endpoint,
bucket, credential, or secret name.

- Public GCS sources use explicit HTTPS object URLs. DuckDB uses Parquet
  metadata and HTTP range requests without credentials.
- AWS S3 sources use native `s3://` URIs and a temporary DuckDB secret scoped
  to the configured bucket or prefix.
- SeaweedFS uses its S3-compatible endpoint, path-style URLs, local credentials,
  and the existing supported local bucket layout.
- Private GCS is disabled initially. It can later use a server-configured HMAC
  secret or a separately evaluated `gcsfs`/ADC path without changing tool
  contracts.

Only exact object lists or catalog-produced expansions are passed to
`read_parquet`; agents cannot use DuckDB globbing. Storage credentials are
loaded by the server and are never included in a tool result, query token, log,
or iframe message.

### SQL policy

The SQL policy parses input with SQLGlot's DuckDB dialect and accepts one
statement whose root is `SELECT` or `WITH ... SELECT`. It allows joins,
subqueries, set operations, aggregates, windows, ordering, and an explicit
allowlist of scalar and spatial functions.

The policy rejects:

- DDL and DML.
- `PRAGMA`, `SET`, `ATTACH`, `DETACH`, `COPY`, `EXPORT`, `IMPORT`, and `CALL`.
- `INSTALL`, `LOAD`, secret management, and extension management.
- Direct file/network functions including `read_*`, `parquet_scan`, `glob`,
  and functions that execute dynamically generated SQL.
- Table references other than the aliases registered for this call.
- Qualified catalog/database names, replacement scans, and direct path
  relations.
- Multiple statements, comments used to hide trailing statements, and SQL
  larger than 8 KiB after UTF-8 encoding.

SQLGlot is a policy and error-reporting layer, not the security boundary. The
query is also prepared by DuckDB only after the trusted source views exist, and
the worker/container provides the resource and process boundary. A regression
corpus must cover parser ambiguities and attempted policy bypasses.

### Query-token codec

The initial row or SQL tool returns a versioned token containing the canonical
SQL, source references and aliases, optional geometry settings, issue time, and
expiry. The token is compressed, base64url encoded, and authenticated with an
HMAC key loaded from configuration.

Tokens expire two hours after issue. The server validates version, signature,
expiry, decoded size, source count, and SQL policy on every use. A token does
not contain physical URLs, credentials, or query results. It is not encrypted
because this phase handles public data and does not treat SQL as secret.

The encoded token must not exceed 8 KiB. Table queries that exceed that limit
return a normal bounded preview but cannot open an interactive paginated or map
view until the agent shortens the query. This keeps MCP payloads and tile
request headers within explicit ingress limits.

### DuckDB worker pool

FastMCP sends validated execution requests to a bounded pool of worker
processes. Each worker handles one query at a time and owns one long-lived
DuckDB database/connection. Workers preload the pinned `httpfs` and `spatial`
extensions, configure storage profiles, and then lock configuration before
accepting agent SQL.

Each replica starts one worker by default and therefore accepts one active
DuckDB query. Horizontal replicas provide normal production concurrency. A
larger per-replica worker count is allowed only when the configured pod memory
and spill volumes are increased proportionally; it is not the default scaling
mechanism.

Long-lived workers may retain DuckDB extension state, Parquet metadata, and
external-file cache entries. They must not retain tables, query results, live
cursors, aliases, or user session state between requests. Trusted setup creates
request-unique temporary views, executes the query, and removes the views in a
`finally` path. Workers are periodically recycled and are replaced after a
timeout, interrupt failure, unexpected exception, or memory threshold breach.

Initial configurable execution limits are:

| Limit | Default |
| --- | --- |
| Worker processes per replica | 1 |
| Active queries per worker | 1 |
| DuckDB threads per query | 2 |
| DuckDB memory limit | 1 GiB |
| Pod/container memory | 2 GiB with the default one-worker replica |
| Temporary spill storage | 4 GiB per worker |
| Normal query timeout | 30 seconds |
| Hard worker termination | 60 seconds |
| Tile timeout | 10 seconds |
| Selected sources | 8 |
| Output columns | 200 |
| Default UI page | 250 rows |
| Maximum UI page | 1,000 rows |
| Maximum offset | 50,000 rows |
| Maximum serialized tool result | 4 MiB |
| Maximum serialized cell | 64 KiB |

The container memory limit is authoritative because DuckDB's memory setting
does not cover every allocation. The worker runs as non-root with a read-only
root filesystem, a size-limited temporary volume, no host mounts, and only the
network egress required for the catalog and configured storage backends.

## MCP tools and resource

All application tools link to `ui://hifld/dataset-explorer.html`. The resource
contains a Vite-built React application using the MCP Apps React bridge.

### Model-visible tools

`list_collections`

- Has no required inputs.
- Returns the catalog's collection IDs, slugs, names, and descriptions.
- Is visible to both the model and app and provides the starting point for
  dataset discovery.

`search_datasets`

- Inputs: search text, collection, tag filters, limit, and offset.
- Calls the existing catalog pagination API.
- Returns compact dataset summaries and pagination metadata.
- Is visible to both the model and app so the dataset browser can paginate.

`get_dataset`

- Inputs: collection and dataset identity.
- Returns dataset metadata plus compact file/format/source summaries.
- Is visible to both the model and app.

`read_geoparquet_rows`

- Inputs: one `QuerySourceRef`, optional projected columns, page size, and
  offset.
- Synthesizes a trusted `SELECT` instead of accepting SQL.
- Returns schema, at most 20 preview rows for model context, page metadata, and
  a signed query token.
- Opens the interactive table app when MCP Apps are supported.

`query_geoparquet`

- Inputs: up to eight `QuerySourceRef` values, SQL, page size, optional geometry
  column, and optional result CRS.
- Validates and runs the first bounded page.
- Returns resolved source versions, schema, execution warnings, at most 20
  preview rows for model context, and a signed query token.
- Opens the interactive table/map app when MCP Apps are supported.

### App-only tools

`get_query_page`

- Inputs: signed query token, offset, and page size.
- Revalidates the token and sources, reruns the canonical query as a subquery,
  and applies `LIMIT page_size + 1 OFFSET offset`.
- Returns at most `page_size` rows plus `has_more`, offset, elapsed time, and
  bytes-read metrics.
- Is registered with `visibility=["app"]`, so paging results return through the
  iframe-to-host MCP bridge without becoming normal agent tools.

`get_map_features`

- Inputs: signed query token, viewport bbox, zoom, and a requested feature cap
  no greater than 2,000.
- Revalidates the token and sources, reruns the canonical query with the same
  viewport predicate used by tiles, simplifies geometry for the zoom, and
  returns a GeoJSON feature collection no larger than 4 MiB.
- Is registered with `visibility=["app"]` and provides the compatibility path
  when the host cannot run the MapLibre worker or cannot make direct tile
  requests.

The initial model-visible response deliberately contains only 20 preview rows.
After the iframe connects and confirms the host's `serverTools` capability, it
calls `get_query_page` to load the larger UI page. Hosts without that capability
render the initial preview and a clear static-mode message.

Every model-visible tool also returns concise text content for clients without
MCP Apps support. Full geometry values are excluded from text previews and
represented by type, nullability, and bounds.

### Result value encoding

Tool rows use a typed JSON-compatible encoding. Nulls, booleans, strings, and
JSON-safe numbers remain native JSON values. Dates, times, intervals, decimals,
UUIDs, and integers outside JavaScript's safe integer range are strings whose
DuckDB logical type remains present in the column schema. Lists and structs are
encoded recursively. Binary values and geometries become tagged summaries with
byte length, geometry type, and bounds where available; raw WKB is never placed
in table or model payloads. `get_map_features` is the explicit exception: its
bounded response encodes the selected geometry as GeoJSON for rendering rather
than as a table cell.

No encoded cell may exceed 64 KiB. Oversized strings or nested values become a
tagged truncated value with their original byte length. No tool result may
exceed 4 MiB. If the response-size limit is reached before `page_size`, the
server returns the rows that fit, sets `response_truncated=true`, and computes
the next offset from the number of source rows returned. It never silently
skips a row.

## Pagination semantics

Every page is a new execution over cloud GeoParquet. The service does not hold
a DuckDB result cursor and does not materialize a prior result. The React app
caches pages already visited during that iframe's lifetime, so back-navigation
does not repeat a call.

Offset pagination is the generic contract because arbitrary query results do
not provide a safe, inferable keyset. Agents should include a deterministic
`ORDER BY` when page order matters. Without one, the response sets
`deterministic_order=false` and the UI displays a warning. The server does not
add an implicit sort because doing so could be expensive or change query
semantics.

`LIMIT` and `OFFSET` are applied outside the agent query. A `LIMIT` inside the
agent query remains part of its semantics. No separate `COUNT(*)` is run.
`has_more` is determined by requesting one extra row. The UI reports the
current offset and whether more rows are available, not a fabricated total.

The 50,000-row offset cap prevents accidental repeated full scans at arbitrary
depth. A user who reaches it must narrow the query. Dataset-specific keyset
pagination can be added later to `read_geoparquet_rows` without changing SQL
query pagination.

## Map and tile behavior

A SQL result is mappable when it contains exactly one DuckDB `GEOMETRY` column
or the caller explicitly names one. If more than one geometry column exists,
`geometry_column` is required. GeoParquet CRS metadata is used when it remains
unambiguous; otherwise `result_crs` is required. Derived geometry is never
silently assumed to be EPSG:4326.

The React app renders MapLibre and requests MVT from:

```text
GET /tiles/{z}/{x}/{y}.mvt
X-HIFLD-Query-Token: <signed query token>
```

The tile route accepts zooms 0 through 22, validates the token and sources, and
runs the canonical query in a worker. It constructs the tile envelope in
EPSG:3857, transforms bounds to the result CRS, and restricts candidate rows to
that envelope. If the result includes a valid GeoParquet-style `bbox` struct,
the route applies the inexpensive bbox-overlap predicate before exact geometry
work. It always applies exact intersection/clipping before encoding, so no
feature outside the tile is rendered.

The geometry is transformed to EPSG:3857, clipped and quantized with
`ST_AsMVTGeom`, and encoded with `ST_AsMVT`. Geometry and bbox columns are not
duplicated into feature properties. Unsupported nested values are omitted;
supported scalar properties retain their result-column names.

The tile-envelope predicate bounds the output correctly, but it cannot
guarantee that DuckDB pushes the predicate through every arbitrary join,
aggregate, or derived-geometry expression. A query that performs a global
blocking operation may repeat that global work for each tile. The UI surfaces
the query's map-performance warning, and the agent-facing tool description
encourages preserving source bbox columns and applying spatial filters before
large joins.

Each tile is limited to 20,000 features and 1 MiB after encoding. A dense tile
returns a typed `tile_too_dense` response rather than silently returning an
invalid tile; the map displays a message asking the user or agent to aggregate,
filter, or zoom in.

The tile origin is declared in the UI resource's `connectDomains`. With no
cookies or private data, tile CORS uses `Access-Control-Allow-Origin: *` and
allows only the query-token request header. Responses vary on the query token
and may use browser caching, but the service and CDN do not maintain a query
result or tile cache in this phase.

The resource metadata also declares the configured basemap origins in
`connectDomains`/`resourceDomains` and the versioned MapLibre worker origin in
`resourceDomains`. Production does not load React, MapLibre, fonts, or other
application code from an unpinned third-party CDN.

MapLibre requires a worker under strict CSP. The React HTML remains a
single-file Vite bundle, while the matching MapLibre worker is served as a
versioned immutable asset from `/assets/` and configured with an explicit HTTPS
URL. The implementation must prove that worker startup, WebGL, tiles, and
fullscreen mode work under Claude's enforced iframe CSP before the map is
considered complete. If the host blocks the required worker behavior, the app
falls back to a bounded GeoJSON view and reports the compatibility limitation;
it must not relax CSP with `unsafe-eval`.

## React app

The custom UI uses:

- `@modelcontextprotocol/ext-apps/react` for lifecycle, host context, tool
  results, app-only server calls, theme variables, and display modes.
- React and Zod for state and boundary validation.
- TanStack Table plus TanStack Virtual for a virtualized, schema-driven table.
- MapLibre GL JS for the map, subject to the CSP compatibility gate above.
- A Vite single-file HTML build for the MCP resource.

Dependencies are installed through the package manager during implementation;
the spec does not hardcode versions from memory. The package lock records the
resolved versions.

The app registers all handlers before connecting. It validates the initial
tool result and every app-only result with Zod. It applies host theme and font
variables, respects safe-area insets and container dimensions, requests
fullscreen only when advertised, and pauses MapLibre rendering when the app is
not visible.

The table supports column visibility, resizing, local sorting of the loaded
page, cell inspection, and next/previous page navigation. Local sorting is
clearly labeled as page-only; changing the server query requires the agent to
issue a new SQL tool call. Geometry cells show a compact summary rather than
serializing full WKB/WKT into the grid.

The app keeps its query token, current page, visited-page cache, table state,
and map viewport in React memory. Reloading the iframe may discard visited
pages; the initial tool result is sufficient to reconstruct the view.

## Security and abuse controls

The public endpoint has no user identity, so it cannot promise per-user quotas.
The deployment applies global request-rate and concurrency limits at ingress
and inside the worker pool. Source-count, SQL-size, page, offset, tile, memory,
spill, and wall-time limits are enforced server-side and cannot be raised by
tool input.

DuckDB is configured to disable extension autoinstallation and autoloading,
community extensions, persistent secrets, and unapproved external access.
Local access is restricted with DuckDB's path allowlists to the immutable
extension directory and the dedicated spill directory. Required extensions are
installed into the image and loaded by trusted bootstrap before configuration
is locked. Only the storage resolver can create and remove temporary scoped
secrets and source views.

The server logs a query hash, source IDs and versions, latency, bytes read,
files read, rows returned, peak memory, spill use, error code, and token
version. It does not log full SQL, token contents, credentials, row values,
geometry, or arbitrary literals. Metrics distinguish catalog, policy, queue,
DuckDB, storage, serialization, and tile time.

## Errors

Errors use stable codes with a short safe message and optional structured
details:

- `catalog_not_found`
- `source_not_geoparquet`
- `source_changed`
- `invalid_alias`
- `sql_rejected`
- `query_token_invalid`
- `query_token_expired`
- `query_token_too_large`
- `query_timeout`
- `query_memory_limit`
- `query_spill_limit`
- `query_offset_limit`
- `storage_unavailable`
- `geometry_ambiguous`
- `geometry_crs_required`
- `map_not_supported`
- `tile_too_dense`
- `host_interactivity_unavailable`

Parser, DuckDB, filesystem, and credential details are logged safely on the
server but are not returned verbatim. A failed page or tile does not invalidate
the token; retrying is safe because all operations are read-only and
stateless.

## Testing and verification

### Server tests

- Catalog-client contract tests for search, dataset detail, file detail, glob
  expansion, exact version selection, and changed or missing sources.
- Storage-resolver tests for public GCS HTTPS, AWS S3, and SeaweedFS endpoint,
  scope, path-style, and TLS settings.
- SQL-policy allow tests for joins, CTEs, aggregates, windows, unions, and
  spatial functions.
- SQL-policy denial tests for every forbidden statement, file function,
  qualified relation, dynamic SQL path, comment/multistatement bypass, and
  unknown alias.
- Token tests for deterministic canonicalization, tampering, expiry, oversized
  payloads, version changes, and malformed compression.
- Query-wrapper tests for projection, `LIMIT + 1`, offset, inner limits,
  deterministic-order warnings, and omitted exact counts.
- Worker tests for timeout interruption, forced replacement, memory/spill
  limits, view cleanup, sequential isolation, and warm metadata caching without
  retained result state.
- Tile tests proving bbox filtering, CRS transformation, exact clipping,
  property shaping, invalid tile coordinates, feature caps, and dense-tile
  errors.
- MCP protocol tests for tool schemas, model/app visibility, resource linkage,
  MIME type, structured content, and text fallbacks.

### UI tests

- Zod boundary tests for every tool-result variant.
- Table paging, page cache, local sort labeling, column visibility, geometry
  summaries, errors, loading, and static-host fallback.
- MCP bridge tests proving the iframe calls only app-visible tools.
- Host theme, safe-area, container-size, visibility pause, and fullscreen tests.
- Map initialization, worker startup, tile headers, bounds, CRS errors,
  dense-tile messaging, and GeoJSON fallback tests.
- Accessibility tests for keyboard paging, focus, table semantics, error
  announcements, and map alternatives.

### Integration and performance tests

- Run the app with FastMCP's app development host and the MCP Apps reference
  basic host.
- Run a manual Claude web connector test for resource rendering, app-to-server
  tool calls, CSP/CORS, MapLibre worker behavior, vector tiles, and fullscreen.
- Run SeaweedFS integration tests using the repository's supported local
  storage backend.
- Run public GCS tests against representative partitioned GeoParquet data.
- Benchmark page 1, 2, 20, and 200 for a scan, selective filter, ordered query,
  aggregation, and representative complex join. Record latency, requests,
  bytes read, and files read rather than inventing one universal paging target.
- Benchmark cold and warm workers separately.
- Benchmark representative tiles at low, medium, and high zoom, including a
  complex join whose outer result is bbox filtered.

The new `dataset-mcp` package receives its own Ruff, formatting, Pyright,
BasedPyright, pytest, UI check, TypeScript, Vitest, and production-build gates.
Changes made to `dataset-api` or `webapp` during implementation must also pass
the repository-wide gates in `AGENTS.md`.

## Acceptance criteria

- Claude can connect to the public stateless FastMCP endpoint without sticky
  sessions.
- An agent can search datasets, inspect one dataset, select exact GeoParquet
  sources, read rows, and execute a complex multi-source join.
- Unsafe SQL and unregistered relations fail before DuckDB execution.
- The model receives no more than 20 preview rows, while the app can fetch pages
  of up to 1,000 rows through the host bridge.
- Fetching another page performs a new bounded DuckDB query and no query result
  or server session is stored.
- A mappable query opens an interactive map and every tile execution applies a
  tile-envelope predicate and geometry clipping.
- Public GCS, configured S3, and local SeaweedFS sources use server-selected
  connection settings; no storage credential reaches SQL or the iframe.
- Tampered or expired query tokens are rejected.
- A timed-out or failed query cannot poison another request and its worker is
  recoverable or replaced.
- Clients without MCP Apps or app-to-server tool support receive a useful
  bounded text/structured-data result.
- Metrics make repeated-page and repeated-tile costs visible without logging
  SQL or data values.

## Deferred decisions

Authentication will determine the eventual identity, authorization, private
storage, and per-user quota model. Performance measurements will determine
whether a later release needs result materialization, a query registry, a
distributed cache, keyset pagination, or asynchronous tasks. None of those
future choices are prerequisites for this stateless public-data release.

## References

- [FastMCP custom HTML apps](https://gofastmcp.com/apps/low-level)
- [FastMCP stateless HTTP deployment](https://gofastmcp.com/v2/deployment/http)
- [MCP Apps specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
- [DuckDB security guidance](https://duckdb.org/docs/current/operations_manual/securing_duckdb/overview)
- [DuckDB Parquet pushdown](https://duckdb.org/docs/lts/data/parquet/overview)
- [DuckDB HTTP partial reads](https://duckdb.org/docs/lts/core_extensions/httpfs/https)
- [DuckDB workload tuning](https://duckdb.org/docs/current/guides/performance/how_to_tune_workloads)
- [MapLibre CSP and worker guidance](https://maplibre.org/maplibre-gl-js/docs/)
