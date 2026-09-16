# ClickHouse query engine

ClickHouse executes catalog-scoped Parquet queries without importing datasets or
creating persistent user views. Each HTTP request has its own query ID and SQL
source subqueries. There are no ClickHouse HTTP sessions. The filesystem cache
is shared; query-result caching is disabled. Losing the cache requires fresh
object reads, not query-token regeneration.

## Parquet pruning and map preparation

GeoParquet bindings cache a schema-only (`LIMIT 0`) source description for 60
seconds. Explicit-column queries bind WKB as bytes and expose scalar numeric
tuple leaves to the Parquet reader, preserving row-group statistics pruning
through reprojection. The original tuple remains available to SQL. No dataset
paths, partition values, or geographic regions are hard-coded. Native object
glob discovery remains inside ClickHouse.

User projection wildcards (`SELECT *` or `source.*`) retain native bindings so
internal scan columns cannot change the returned schema or join/star semantics.
Complex tuples and existing dotted-column name collisions also retain native
tuple handling. Use explicit selected columns for the optimized map-query path.

Map/URL preparation still checks for matching rows and validates the geometry
schema, but does not read/reproject selected geometry just to calculate its byte
length. Preview geometry values are marked `{"$type":"geometry","omitted":true}`
and carry the `geometry_values_not_materialized` warning. Ordinary paginated
queries retain geometry byte-length summaries. Spatial predicates, joins,
sorting, or grouping in user SQL may still require geometry evaluation.

Each query caps S3-compatible socket reads at five seconds (or its smaller
remaining deadline), connection attempts at one second, and retry budgets at
one. These complement, rather than replace, the overall query deadline and
explicit cancellation. They do not guarantee instantaneous cancellation of
every underlying operation.

## Local development

From the repository root:

```sh
docker compose up -d --build clickhouse
```

Copy the `CLICKHOUSE_*` and `DATASET_MCP_CLICKHOUSE_*` settings from `.env.example`
into your local environment. Local MCP uses port 8123. When ClickHouse reads
SeaweedFS, its endpoint is `http://seaweedfs-filer:8333`; MCP's footer reader uses
the catalog's host-local endpoint. SeaweedFS remains the local storage service.

The Compose credentials are development defaults, never production secrets.
Only the loopback interface exposes ClickHouse. GCS sources use unsigned public
reads. Local SeaweedFS in this Compose setup allows unsigned reads; authenticated
private storage is not yet supported by the new adapter.

## CRS behavior

- `query_parquet` preserves native geometry unless `result_crs` is supplied.
- Map/MVT queries default their working CRS to EPSG:4326.
- Explicit `result_crs` transforms each geometry source into that working CRS
  **before** SQL executes. Geometry literals must use the same coordinate system.
- Native bbox columns retain their source CRS. Do not apply working-CRS values
  to those columns without converting the envelope.
- The final map result is converted to geographic XY before native MVT encoding.
- GeoParquet's omitted CRS means OGC:CRS84; explicit null means unknown and cannot
  be silently normalized. Files in a source are assumed to share geometry metadata;
  interactive requests do not validate every partition.

Projection uses fixed Python/PROJ/Shapely executable functions, not user scripts.
PROJ networking is disabled. Authority CRS codes are validated. Individual WKB
values are capped at 32 MiB and serialized projection batches at 128 MiB.
Batch output spills after 1 MiB instead of retaining the entire batch in memory.

## SQL and bounded responses

Query and tile deadlines default to 60 seconds, matching the ClickHouse query
profile's execution ceiling. Cancellation cleanup retains its separate five-second
budget; memory limits are unchanged. Ingress allows 120 seconds so it does not
cut off the application deadline first.

Common SELECT/CTE/join/aggregate syntax is parsed with the existing SQL dialect
and compiled for ClickHouse. This is not full DuckDB function compatibility.
Supported spatial expressions currently include ST_Intersects, ST_GeomFromText,
ST_AsHexWKB, ST_GeomFromHexWKB, and constant ST_MakeEnvelope. Unsupported spatial
functions are rejected explicitly. ST_Transform is unnecessary for normalized
map sources and is not exposed.

Raw geometry columns return bounded geometry summaries; use ST_AsHexWKB for
hexadecimal WKB, subject to normal cell truncation. Binary WKB strings are not
sent through JSON, which would corrupt arbitrary bytes.

Data glob expansion stays inside ClickHouse's `s3()` table function, including
GCS HTTPS paths. CRS discovery also asks ClickHouse for matching file identities
using ParquetMetadata with LIMIT 1, then reads one representative file's bounded
footer ranges. This metadata path is cached for 60 seconds (32 source definitions)
and has a 16-MiB-per-footer safety limit. It does not rewrite data scans into
application-generated object lists. Cold metadata inspection still has a cost.

Automatic native-covering pruning is restricted to direct single-source SELECTs
without limits, nested queries, joins, aggregates, or windows. Other queries
retain their semantics and should include explicit source filters.

## Deployment and permissions

The existing image workflow builds/publishes the ClickHouse image. The MCP Helm
chart creates an internal ClickHouse Service/Deployment and network policy.
Create the configured secret (`dataset-mcp-clickhouse` by default) containing
`query-password` and `control-password` before deploying through IaC.

`hifld_query` has read-only settings and the S3/table-function privileges needed
for external Parquet reads, not access to other users' query logs. The fixed
control client uses separate credentials with system.processes/KILL QUERY
permissions solely to cancel generated query IDs. It has a separate HTTP pool
so saturated data connections cannot prevent cancellation.

The pod stores only disposable cache/logs in bounded emptyDir volumes; there is
no Keeper or database replication requirement. A replacement pod starts cold.
Resource limits bound the whole pod, including projection subprocesses; per-query
limits alone do not bound aggregate concurrent memory. Load testing is required
before raising concurrency or scaling production.

### Admission and horizontal scaling

Each pod enforces `CLICKHOUSE_MAX_CONCURRENT_QUERIES` (default 2) for the query
user across **all** MCP clients. The control user is separate so cancellation
can run when both query slots are occupied. The client retries only explicit
ClickHouse admission refusals, with backoff inside the original query deadline;
it never retries ambiguous transport failures. At most 64 running/waiting calls
are admitted per MCP client (`DATASET_MCP_CLICKHOUSE_MAX_PENDING_QUERIES`).
Overflow gets an explicit queue-full error. There is no durable queue.

Set `clickhouse.replicaCount` to scale independent ClickHouse pods. The chart uses
a headless Service; MCP refreshes ready pod addresses every five seconds and
round-robins each query attempt. Cancellation is pinned to the chosen pod address,
not sent through a load-balanced Service. Each replica has a disposable local
cache, not shared database state. In-flight queries are not migrated or replayed
when a pod disappears. New requests discover replacement pods after DNS refresh.

Optional `clickhouse.autoscaling.enabled=true` enables CPU-based HPA with
configurable min/max replicas and target utilization. This is not queue-aware
autoscaling: I/O-bound queued work may not trigger CPU scaling; choose sufficient
minimum replicas and monitor latency. No production scaling is enabled by default.

External URLs default to single-server routing; use a direct server endpoint,
not an arbitrary load balancer (which cannot guarantee cancellation affinity).
`DATASET_MCP_CLICKHOUSE_DISCOVER_REPLICAS=true` is only for a trusted internal
HTTP headless-service origin, not TLS/public endpoint discovery.

## Verification

```sh
cd dataset-mcp
uv run ruff check .
uv run ruff format --check .
uv run pyright
uv run basedpyright
uv run pytest
```

Opt-in public GCS integration tests require `CLICKHOUSE_TEST_URL`,
`CLICKHOUSE_TEST_PASSWORD`, and `CLICKHOUSE_TEST_CONTROL_PASSWORD`:

```sh
uv run pytest tests/integration/test_clickhouse_live.py -v
```

Install the repository's Node dependencies first: live tile tests decode MVT
with the same `@mapbox/vector-tile` library used by the frontend. To also test
mixed-CRS joins and concurrent aliases against disposable Seaweed fixtures, set
`SEAWEED_TEST_URL=http://127.0.0.1:8333` and
`CLICKHOUSE_TEST_SEAWEED_URL=http://seaweedfs-filer:8333`. The test creates a
unique bucket and removes its objects and bucket afterward.

Legacy DuckDB workers remain only as regression-reference code/dev dependencies;
the production image does not install DuckDB or its extensions.
