# Portolan GeoParquet Feature Server Design

## Goal

Add an OGC API - Features service that exposes every queryable GeoParquet
version in the HIFLD Portolan catalog through pygeoapi and DuckDB. The service
must discover newly published versions from the shared SQLite catalog, add them
without an image rebuild or process restart, support overwrites of version labels,
provide a stable latest alias, and select trusted GCS or SeaweedFS assets without
accepting arbitrary client URLs.

This design depends on
[`2026-09-07-portolan-catalog-migration-design.md`](2026-09-07-portolan-catalog-migration-design.md).
That design owns catalog generation, storage metadata, schema metadata, and the
single `_catalog/catalog.sqlite` artifact.

## Decision summary

- Run pygeoapi as a separate `feature-server` service. It is not part of the
  webapp and does not replace the dataset MCP.
- Implement one custom pygeoapi feature provider backed by DuckDB over trusted
  GeoParquet assets.
- Do not implement a Portolan-to-pygeoapi HATEOAS proxy and do not use
  pygeoapi's STAC provider. Static Portolan and OGC feature access are separate,
  linked representations.
- Do not generate a per-catalog `pygeoapi.yml`. A small source-controlled
  `pygeoapi-base.yml` contains only static server settings.
- Build pygeoapi's dynamic `resources` dictionary and OpenAPI document in memory
  from the shared SQLite database.
- Replace pygeoapi's fixed application global with an atomic, immutable API
  snapshot registry. New catalog generations are built off the request path and
  swapped without restarting workers.
- Advertise a version-addressed OGC collection for every queryable spatial version and a stable
  latest alias for every collection-scoped logical file.
- Use `{collection_slug}~{dataset_slug}~{file_slug}~{version}` for versioned OGC
  IDs and `{collection_slug}~{dataset_slug}~{file_slug}` for latest aliases.
- Pin pygeoapi and DuckDB versions and test the custom application boundary,
  because pygeoapi does not currently expose a supported in-process reload
  factory.
- Evaluate the community `pygeoapi-duckdb-geoparquet` provider as source material,
  but do not depend on it unmodified. Adopt, fork, or rewrite only after contract,
  security, and performance tests.
- Use the catalog migration's four-dataset SeaweedFS fixture suite as a required
  end-to-end gate, including a new dataset promoted while the feature server is
  running.
- Poll the SQLite object directly by ETag/generation; there is no separate
  catalog state marker.
- Use full slug/asset identities throughout. No numeric catalog IDs or
  `/by-slug` routes are required.
- Derive API-only feature IDs from DuckDB's originating filename and physical
  file-row number, with an object revision discriminator. No source ID column
  is required and no identifier column is added to Parquet.
- Preserve non-spatial datasets in the catalog but omit them from feature
  resources. Transform spatial request bounds and output CRS in DuckDB at runtime.

## Scope

The first release includes:

- OGC API - Features landing, conformance, collections, collection detail,
  queryables/schema, feature list, and feature-by-ID endpoints.
- GeoJSON responses.
- Offset/limit paging with bounded limits.
- Bounding-box filtering that uses GeoParquet row-group spatial statistics.
- Attribute selection and equality filters supported by pygeoapi's feature
  contract.
- A documented, tested CQL2 subset translated into parameterized DuckDB SQL.
- Replaceable version collections and latest aliases.
- GCS HTTPS range reads and local SeaweedFS S3-compatible reads.
- Single-file and catalog-declared partitioned GeoParquet sources.
- Hot in-process catalog refresh from the shared SQLite object, including
  same-version replacements and cache invalidation.
- Links from OGC collections to their canonical Portolan Collection documents.
- Health, readiness, metrics, timeouts, memory limits, and query concurrency
  limits suitable for a public endpoint.

The first release does not include:

- OGC transactions or writes.
- Arbitrary SQL submitted through the feature API.
- Joins across datasets. Those remain a dataset MCP capability.
- Arbitrary client-provided paths, URLs, buckets, endpoints, or credentials.
- STAC API, pygeoapi HATEOAS browsing, or a Portolan service.
- OGC Tiles or replacement of existing PMTiles delivery.
- GeoServer integration.
- Serving Shapefile, GeoPackage, File Geodatabase, or GeoJSON directly through
  DuckDB. Those remain downloadable Portolan assets; the feature service reads
  the canonical GeoParquet representation.
- Spatial feature endpoints for non-spatial or all-null-geometry tables. These
  remain discoverable and downloadable through the HIFLD catalog.
- Rewriting Parquet or adding columns to supply OGC feature identifiers.
- Historical-byte retention or stable feature links across object replacements.
- Literal simultaneous activation across all worker processes. Workers converge
  within the refresh objective and report their active generation.

## Service boundary

```text
Portolan catalog + catalog.sqlite
               |
               v
      feature-server catalog watcher
               |
               v
       immutable API snapshot
      +-----------------------+
      | pygeoapi config       |
      | generated OpenAPI     |
      | catalog generation    |
      +-----------------------+
               |
               v
      DuckDB GeoParquet provider
               |
        trusted storage resolver
          /                 \
         v                   v
    GCS/HTTPS           SeaweedFS/S3
```

The feature server is a read-only adapter. It owns no catalog database and
writes no catalog metadata. Its only durable inputs are the static base
configuration and the generated catalog artifacts. Its local SQLite copy and
DuckDB caches are disposable.

The webapp links to this service for standards-based feature access where useful.
The dataset MCP continues to provide agent tools, multi-dataset SQL, result
paging, and MVT generation. Neither service calls the other for query execution.

## Repository and deployment shape

The implementation adds a focused Python service:

```text
feature-server/
  app/                    reloadable ASGI application and health routes
  catalog/                SQLite object polling, parsing, resource projection
  provider/               DuckDB GeoParquet pygeoapi provider
  storage/                trusted environment storage policy
  tests/                  contract, security, reload, and integration tests
  pygeoapi-base.yml       static pygeoapi configuration
  pyproject.toml
  Dockerfile

charts/feature-server/    Deployment, Service, NetworkPolicy, probes, resources
```

Use pygeoapi's Starlette/ASGI integration so the reloadable application and
health endpoints share one lifecycle. The service image preinstalls pinned
DuckDB `spatial` and `httpfs` extensions; production never runs `INSTALL` from a
request or contacts an extension repository.

The public load balancer exposes the OGC endpoint under a dedicated prefix or
hostname selected during implementation. It must not shadow the webapp's
existing `/api` routes.

## Collection identity and version behavior

Portolan and OGC use related but deliberately different identifiers:

| Meaning | Identifier |
| --- | --- |
| Portolan version Collection | `hifld/electric-substations/substations/v1.0.0` |
| OGC version collection | `hifld~electric-substations~substations~v1.0.0` |
| OGC latest alias | `hifld~electric-substations~substations` |

The tilde delimiter is URI path-safe and is excluded from current slug and
version syntax, so the mapping is reversible and collision-free. Current
pygeoapi supports slash-containing collection IDs, but the flattened form avoids
depending on hierarchical-ID behavior in general OGC clients.

The first component is the current dataset-api Collection namespace, not the
STAC Collection type. Including it allows two collection namespaces to reuse the
same dataset and file slugs without producing the same OGC ID. Collection slugs
are stable namespaces, independently of replaceable asset bytes; a
renamed namespace is published as a new identity rather than silently retargeting
existing OGC URLs.

Every OGC collection response also carries the components separately in links
or extension metadata:

- HIFLD collection slug
- dataset slug
- file slug
- version label
- whether the identifier is a latest alias
- canonical Portolan Collection href

The versioned ID resolves to the currently published bytes for that version
label; the publisher may overwrite them. The latest alias is generated from
SQLite's `is_latest` row, derived from the file Catalog's latest-version link,
and changes with catalog refresh. It is not computed by lexical version sorting.

Both identifiers are advertised in `/collections`. The latest response links to
the versioned OGC collection it currently represents, but neither URL guarantees
historical reproducibility. A replacement updates catalog generation, source
revisions, schema, counts, extents, and query caches. A metadata snapshot is
immutable in memory; that does not imply the referenced object bytes are immutable.

## Dynamic pygeoapi configuration

Resource projection depends on a database-neutral, typed catalog repository
interface. The initial SQLite adapter owns SQL and returns normalized spatial
version, column, asset, and object records; the projector does not open SQL
connections or contain SQLite queries. A future PostgreSQL adapter can provide
the same records. SQLite object polling and validation remain outside this
interface in the current bootstrap/refresh implementation.

`pygeoapi-base.yml` contains only settings that genuinely require application
startup:

- server URL and bind configuration;
- language, response encoding, gzip, limits, and CORS;
- service title, description, provider, contact, and license;
- logging and template settings; and
- disabled Admin API and disabled transactional behavior.

It contains no generated dataset `resources` section. At refresh time, the
catalog projector reads typed rows from SQLite and constructs one pygeoapi
resource definition for each eligible spatial GeoParquet version plus one latest
alias per collection-scoped file whose selected latest version is eligible.
Non-spatial and all-null-geometry records are intentionally skipped, not treated
as invalid catalog generations. If latest is non-spatial, do not silently point
the alias at an older spatial version; older eligible version routes may remain.

A projected resource contains:

- title, description, keywords, and links;
- spatial and temporal extents;
- schema and queryable fields already computed by the pipeline;
- storage CRS and geometry column;
- physical-row feature-ID encoding policy (no persisted ID column);
- feature count and quality status;
- exact GeoParquet objects, their logical relative paths and current revisions,
  and available partition/covering metadata;
- selected storage-location slug; and
- provider limits.

No YAML serialization is required. The resource dictionary is passed directly
to pygeoapi's `API` and OpenAPI generation functions.

## Reloadable application module

Stock pygeoapi application modules load configuration, OpenAPI, and an `API`
object into module globals. Updating YAML alone does not update an existing
worker. The custom application module changes only that ownership boundary; it
does not fork pygeoapi's OGC handlers.

The module owns an immutable snapshot:

```text
ApiSnapshot
  generation
  catalog repository
  pygeoapi API instance
  generated OpenAPI document
  storage policy
  creation time
```

Every request captures `registry.current` once before it constructs the
pygeoapi request object. The normal pygeoapi handler receives that captured API
instance. It cannot observe a mixture of old and new resource dictionaries
within one request.

The background refresh sequence is:

1. Poll `_catalog/catalog.sqlite` directly using the conditional object-read
   protocol in the catalog migration spec. No state-marker file exists.
2. If unchanged from the active validated object, do nothing.
3. Download the complete changed SQLite object to a temporary local file, tying
   its size/checksum metadata to the same revision through a conditional or
   generation-addressed read. Retry an object-replacement race.
4. Verify size, checksum, SQLite application ID, supported schema version,
   embedded catalog generation, and `PRAGMA quick_check`.
5. Parse all dynamic resources through narrow typed models.
6. Resolve each asset through the environment's allowlisted storage policy.
7. Build the candidate pygeoapi configuration and OpenAPI document off the
   request thread.
8. Instantiate the candidate API and run metadata-level smoke checks.
9. Atomically assign the candidate snapshot to `registry.current` and record its
   ETag/generation as active only after successful activation. Failed candidates
   remain retryable even if the object ETag has not changed again.
10. Retire the old SQLite repository and generation-scoped DuckDB pools only
    after in-flight references are released. A grace period cannot close
    resources still owned by a request.

Any failure leaves the current snapshot untouched. A cold-start instance does
not become ready until it has one valid snapshot.

### Multiple workers

Gunicorn or another ASGI process manager gives each worker separate memory. Each
worker therefore runs the same lightweight SQLite object watcher and independently
builds the same metadata generation. Database downloads are conditional and
infrequent; they are not performed per request.

During convergence, different workers may serve adjacent catalog generations.
Every response includes `X-Catalog-Generation`, and readiness reports the active
generation. The deployment is healthy when every worker has a valid generation;
metrics alert when workers remain behind the published generation longer than
the refresh objective.

Strict cross-process activation would require a coordinator and request routing
barrier. The service instead permits bounded convergence and detects stale asset
revisions. No individual request sees a mixed metadata snapshot; an overlapping
asset overwrite may require a bounded stale-source response. Unchanged assets
continue serving normally. Do not claim synchronized activation or frozen bytes.

### pygeoapi compatibility boundary

The custom module relies on two current pygeoapi properties:

- routes are generic over `collection_id`, so adding a collection does not
  require registering a new web route; and
- feature handlers use the `API` object supplied to them and load the configured
  provider for that request.

Pin pygeoapi to an exact compatible version. Contract tests exercise every used
handler against the reloadable module. An upgrade is blocked until those tests
pass. If feasible, contribute an application-factory or API-provider hook
upstream; the first release must not depend on that contribution being accepted.

## DuckDB GeoParquet provider

The provider implements pygeoapi's feature-provider interface while keeping SQL
construction private. It supports:

- `query` with offset, limit, result type, bbox, datetime when configured,
  selected properties, property predicates, approved sorting, and the approved
  CQL2 subset;
- `get` by API-only physical-row feature ID;
- queryable/schema reporting from catalog metadata; and
- accurate `numberReturned`, with `numberMatched` only when requested or cheap
  enough under the configured policy.

The provider receives a fully resolved, typed configuration from the catalog
projector. It never reads Portolan JSON, discovers bucket paths, or accepts a
connection string from request input.

### Community provider evaluation

`pygeoapi-duckdb-geoparquet` demonstrates remote GeoParquet, bbox pruning, CQL2,
CRS handling, supplied schemas, and precomputed metadata. It is useful source
material but is currently a small external project without the release and test
history required for this public service.

Before reuse, test it against this contract:

- exact supported pygeoapi and DuckDB versions;
- no runtime extension installation;
- no arbitrary source URLs or SQL;
- correct identifier quoting and parameter binding;
- physical-row feature IDs consistent across filters, sorting, paging, and
  multi-file scans of unchanged objects;
- bounded counts, offsets, memory, threads, and temporary storage;
- GCS and SeaweedFS behavior;
- partitioned GeoParquet behavior;
- constructor behavior that does not open every remote asset during snapshot
  generation; and
- clean concurrent connection handling.

If the implementation passes with small patches, pin a reviewed fork and propose
the changes upstream. Otherwise, write the narrower HIFLD provider using the
community project and the existing dataset MCP DuckDB code as references.

### Provider construction and caching

Pygeoapi normally creates a provider from a resource definition during a feature
request and also constructs providers while generating collection-specific
OpenAPI. The HIFLD provider constructor must therefore be metadata-only. It uses
the fields, bounds, CRS, and feature count supplied by SQLite and performs no
remote Parquet read.

A process-level pool registry owns bounded DuckDB connections keyed by catalog
generation and storage profile. Providers borrow a connection for one request
and return it afterward. A connection handles one query at a time. Horizontal
replicas are the primary scaling mechanism; increasing per-pod concurrency
requires proportionally increasing memory and spill storage.

Connections may retain DuckDB's external-file and Parquet metadata caches. They
must not retain request-specific views, results, filters, or client state.

## Source feature IDs and API-only physical-row fallback

Prefer an existing `id` or `objectid` column (case-insensitive name matching,
retaining its exact source name) when publication verifies non-null, unique
string or integer values across the complete selected asset, including every
partition. Prefer `id` when both qualify. A conventional column name alone is
not sufficient evidence. Record the selected column in the generated runtime
metadata and revalidate on replacement; provider construction must not scan
remote data to rediscover this choice. If neither qualifies, use the physical-row
fallback below. No identifier field is added to the source files.

For the native strategy, use the source value as the top-level GeoJSON `id` and
resolve item requests against that column using bound parameters. Property
selection does not remove the identifier. Native identifiers represent the
upstream entity and can survive overwrites when the source retains that key;
they do not promise historical feature contents. Paging remains revision-bound
for either strategy. When the selected strategy changes, do not reinterpret an
old opaque physical identifier as a native key.

Datasets need no existing unique identifier column. GeoParquet preserves the
source attributes; neither the publisher nor the feature service adds `hifld_id`
or another feature-ID column to the stored files. For the fallback, the provider derives an
identifier while reading using DuckDB's `filename` and `file_row_number`
metadata, enabled by `read_parquet(..., filename=true, file_row_number=true)`.
These are virtual read-time values, not changes to the Parquet schema.

The identifier encodes a versioned tuple:

```text
(asset key, catalog-relative object path, object content revision, physical row position)
```

The OGC collection path supplies collection/dataset/file/version scope. The
object path is the full path within the selected logical asset, including
partition directories, not just a basename or a file-list ordinal. It is
independent of storage endpoint and replica. The content revision is a
catalog-recorded checksum shared by equivalent replicas; storage-specific
generation/ETag values bind actual reads to the selected replica's bytes.
Use a reversible, versioned, URL-safe string encoding with bounded length and
strict parsing. Do not expose raw storage credentials or accept arbitrary URLs.

For example, a query spanning multiple files can return:

| Originating relative object | Physical row position | Distinguishing identity components |
| --- | ---: | --- |
| `state=NY/part-000.parquet` | 42 | NY/part-000, its revision, 42 |
| `state=CA/part-000.parquet` | 42 | CA/part-000, its revision, 42 |
| `state=NY/part-001.parquet` | 42 | NY/part-001, its revision, 42 |

Filtering, bbox selection, sorting, projection, and paging do not change those
physical positions. Every row retains its originating object when multiple
partitions are scanned together. The provider never uses result-set
`row_number()`, response offsets, partition-list order, or thread execution order
to construct an ID. IDs refer to original file positions before filtering,
including when DuckDB prunes row groups.

Feature responses expose the encoded string as the top-level GeoJSON `id`.
Source properties remain unchanged, including any original `id`, `filename`, or
`file_row_number` attribute. Internal metadata names must be collision-safe;
the spike must prove how to obtain virtual metadata when a source uses those
names. Do not silently shadow or rename source attributes. Queryable/schema
metadata distinguishes the API identifier from source columns; selecting a
subset of properties does not remove the top-level feature ID.

For `GET /collections/{collectionId}/items/{featureId}`, decode the tuple,
validate it against that collection's current approved asset/object records,
resolve the object through storage policy, and select its physical row. Validate
the row position as a non-negative integer. Malformed IDs return a safe 400;
unknown objects/rows or IDs for obsolete content revisions return 404. Never
resolve a decoded path outside the approved catalog object set. Echo the same ID
in the returned feature.

IDs remain stable across queries, replicas with equivalent bytes, and process
restarts while the object path and contents are unchanged. Overwriting or
repartitioning may invalidate them, even without a version-label change. No
historical files or cross-publication feature registry are retained for this
purpose. A content revision discriminator prevents an old link from silently
returning a different row after replacement.

The implementation spike must test virtual-row numbering with filtering,
row-group pruning, multi-partition scans, sorting, and pagination; confirm
metadata-name collision handling; and benchmark item-by-ID against large remote
files. A physical-row predicate is not assumed to be an efficient indexed seek.

### Paging and overwrites

Use deterministic order with object path and physical row position as unique
tie-breakers, including for property sorting. A next link targets the resolved
versioned collection and carries an opaque fingerprint of the selected asset
object set/revisions. Subsequent pages reject a changed fingerprint with a safe
409 stale-result response and instructions to restart. A catalog update unrelated
to those objects need not invalidate a traversal. This does not retain old bytes
or guarantee continuation across overwrites.

Connection/file metadata caches are scoped by source object revision as well as
catalog/storage configuration. Pin reads to a storage revision where supported;
otherwise the spike must establish revision checks and safe failure on concurrent
replacement. An asset modified before its updated SQLite index is published
must not be queried using stale schema metadata or mislabeled feature IDs.

## Spatial query execution

The provider builds a relation only from catalog-approved GeoParquet objects.
For bbox requests it uses the GeoParquet covering/native spatial statistics to
prune row groups before applying exact geometry intersection. The pipeline's
Portolan data gate ensures the required statistics and spatial ordering exist.

The request bbox is interpreted in CRS84 unless an enabled OGC CRS parameter
declares another supported CRS. DuckDB transforms request bounds into the
storage CRS before applying numeric covering predicates. Exact intersection
then uses geometries in a common CRS, and output geometry is transformed on the
fly to CRS84 by default or another explicitly supported response CRS. No
reprojection of stored Parquet is required for feature serving. Never compare
CRS84 numbers directly to projected bbox columns. Handle axis order,
antimeridian crossing, and conservative transformed envelopes explicitly. The
catalog supplies authoritative storage CRS; unknown CRS is not assumed to be
WGS84. Portolan Collection extents remain separately transformed WGS84 metadata.

Partitioned datasets use only the exact objects projected from the catalog's
declared partition metadata. Resolve the set at publication/rebuild time, not
by a request-time arbitrary glob. Client text never reaches DuckDB's
`read_parquet` path argument without catalog membership resolution.
The provider selects candidate partitions using catalog metadata before opening
them where the partition scheme permits.

DuckDB identifiers are validated and quoted. Literal values are bound as
parameters. CQL2 is parsed into a restricted expression tree and translated to
SQL; raw CQL text is never concatenated into a query.

## Storage resolution and security

The resource projector selects one replica according to server configuration,
not client input:

- production prefers the approved GCS/HTTPS location;
- local development prefers the approved SeaweedFS S3-compatible location; and
- optional fallback is allowed only among alternates whose checksum matches the
  canonical asset.

The storage policy maps a catalog storage slug to endpoint, bucket/prefix,
authentication mode, and DuckDB secret configuration. Secrets are created from
environment or Kubernetes Secret values and are never returned in OGC metadata,
logs, errors, or response headers.

The service rejects:

- resources outside configured bucket/prefix allowlists;
- non-HTTPS public URLs;
- alternates with an unexpected endpoint;
- paths containing unresolved traversal segments;
- decoded feature IDs outside the selected collection/asset or referring to a
  different object revision;
- catalog records with conflicting checksums or storage identities;
- request parameters that attempt to name a file, table, URL, or DuckDB
  function; and
- write, extension-management, attach, copy, export, or secret statements.

The pod runs as non-root with a read-only root filesystem, a size-limited
temporary volume, and egress restricted to DNS plus configured storage
endpoints. DuckDB has explicit memory, thread, timeout, and spill limits.

## OGC and Portolan linking

The OGC service is not the Portolan catalog. Each OGC collection description
links to:

- its canonical Portolan `collection.json`;
- the HIFLD webapp dataset/file page;
- the version-addressed OGC collection when the identifier is a latest alias;
- downloadable non-GeoParquet formats through the webapp or Portolan metadata;
  and
- the PMTiles visual derivative when available.

The Portolan Collection may reciprocally include a service link to the OGC
collection endpoint if the service URL is stable. Static Portolan remains fully
usable when the feature service is unavailable.

Pygeoapi's HATEOAS provider and STAC routes are disabled. They would proxy or
browse metadata that is already directly available from object storage and
would not create the DuckDB feature semantics required here.

## Limits and error behavior

Initial limits are configuration, not API promises, but must include:

- a small default feature page and an explicit maximum page size;
- a maximum offset, with guidance toward feature IDs for deep access;
- bounded concurrent DuckDB queries per replica;
- bounded DuckDB threads, memory, and temporary spill;
- query and hard-cancellation timeouts;
- maximum selected properties and filter complexity;
- maximum serialized response size; and
- bounded count execution.

Errors use OGC problem responses without exposing SQL, filesystem paths,
credentials, internal endpoints, or raw DuckDB exceptions. A timeout interrupts
the connection; a connection that cannot be safely reused is discarded.

Quality status is metadata, not an implicit access switch. A failed-quality
Collection remains discoverable and queryable if the pipeline published it,
unless a separate publication policy marks it unavailable. The response clearly
links to its quality report.

## Performance design

Catalog refresh is metadata work. SQLite parsing and Python resource creation
are linear in the number of advertised spatial versions and aliases. YAML
serialization is absent. OpenAPI generation is also linear but may instantiate
each provider, which is why provider construction must remain local and lazy.

Candidate snapshots are built off the request path. A slow refresh delays only
the appearance of the new generation; it does not block feature requests using
the current snapshot.

The implementation spike benchmarks at least 100, 1,000, and 5,000 advertised
resources and records:

- SQLite download and validation time;
- typed resource projection time;
- OpenAPI generation time and output size;
- candidate API construction time;
- peak refresh memory;
- collection-list latency; and
- cold and warm bbox query latency against representative small, large, and
  partitioned remote GeoParquet assets.

The release gate requires refresh to fit comfortably inside the configured poll
interval on production pod resources and requires metadata requests to continue
meeting their latency objective during refresh. Query objectives are set from
the spike rather than guessed in this design.

Remote feature performance depends primarily on GeoParquet layout, storage
range-read latency, bbox selectivity, and whether DuckDB metadata is warm—not on
catalog or YAML generation. Existing pipeline spatial ordering and row-group
statistics are therefore prerequisites, not optional tuning.

## Observability and health

`/healthz` reports process liveness. `/readyz` succeeds only when the worker has
a valid catalog snapshot and can initialize its provider runtime.

Metrics include:

- published and active catalog generations;
- refresh checks, successes, failures, and duration by phase;
- resource and alias counts;
- workers behind the published generation;
- provider construction and pool wait time;
- query duration, timeout, rows returned, bytes returned, and result type;
- remote bytes/range requests when DuckDB exposes them;
- DuckDB connection recycle reasons; and
- errors by stable safe code.

Structured logs include collection ID, version label, catalog generation,
storage-location slug, request class, duration, and safe outcome. They exclude
SQL text, property values, signed URLs, credentials, and raw storage exceptions.

## Failure and consistency behavior

- A failed refresh never mutates the active snapshot.
- Missing or invalid GeoParquet metadata prevents only the candidate generation
  from activating; it does not evict the previous generation.
- An individual remote asset failure returns a bounded service error for that
  collection and does not make catalog metadata endpoints unavailable.
- Version collections remain addressable after a latest alias moves while their
  assets remain published, but same-version overwrites may change their content.
- Overwrites invalidate source caches and old physical-row IDs; stale pagination
  fingerprints fail explicitly rather than mixing revisions across pages.
- If one worker lags, the generation header makes the condition visible and an
  alert triggers after the allowed convergence interval.
- Retired snapshots remain alive for in-flight requests, then close their SQLite
  handles and generation-scoped DuckDB pools.
- A process restart bootstraps from the stable SQLite object; no generated YAML
  or local mutable database is required for recovery.

## Verification and acceptance criteria

- OGC conformance tests pass for every claimed OGC API - Features conformance
  class.
- Collection list, collection detail, queryables/schema, item list, hits, and
  item-by-ID work for both versioned collection IDs and latest aliases.
- IDs map reversibly to collection slug, dataset slug, file slug, and version,
  and tilde is rejected inside each component.
- Repeated dataset, file, and version slugs under different collection
  namespaces produce distinct OGC resources and never share a latest alias.
- The latest alias follows SQLite's explicit latest record after refresh while
  previously published version paths remain distinct.
- Publishing a new or replaced spatial GeoParquet version becomes queryable on
  running workers without an image rebuild or process restart.
- A request started before a snapshot swap uses its captured metadata generation;
  unchanged assets finish normally and an overlapping overwrite returns a safe
  stale-source error if the expected bytes are unavailable.
- Bad checksums, corrupt SQLite, invalid resource definitions, and failed
  OpenAPI generation leave the previous snapshot active.
- Direct conditional SQLite refresh and cold start work without a state marker,
  including a publisher crash before/after object replacement, failed-precondition
  races, and retry of an unchanged but previously failed candidate.
- Provider constructors perform no remote Parquet reads during OpenAPI or
  snapshot generation.
- Bbox tests prove row-group pruning and exact intersection behavior for native
  geographic and projected CRS, with on-the-fly output transformation. In
  particular, CRS84 bbox coordinates must not be compared directly to EPSG:3857
  covering values. Test axis order and antimeridian cases.
- Feature IDs are stable across sorting, property selection, paging, filtering,
  row-group pruning, worker processes, and restarts for unchanged object bytes.
- A query spanning multiple partitions returns distinct IDs for equal physical
  row numbers in different objects, including repeated basenames. Partition
  enumeration order and worker concurrency do not affect IDs.
- Item-by-ID returns the same feature observed in a filtered/multi-file result;
  wrong-collection, malformed, out-of-range, and obsolete-revision IDs fail safely.
- Source schemas and Parquet bytes are not modified to provide feature IDs.
  Datasets without a unique field work; original attributes named `id`,
  `filename`, and `file_row_number` are preserved without metadata collisions.
- An overwrite under the same version label refreshes schema/counts/extents and
  invalidates caches and obsolete IDs. Paging across changed object sets returns
  an explicit stale-result error instead of silently mixing revisions.
- Non-spatial and all-null-geometry datasets remain in the webapp catalog but
  are absent from feature collections and aliases. They do not prevent refresh.
- CQL/property-filter security tests reject injection, direct file access,
  unsupported functions, excessive complexity, and path substitution.
- GCS and SeaweedFS integration tests return equivalent features for matching
  asset replicas.
- The shared SeaweedFS acceptance suite queries the initial boundary, hazard
  line, and hazard polygon resources through DuckDB using only catalog-approved
  SeaweedFS S3 URIs.
- After the held-back fueling-stations GeoPackage is promoted and its
  GeoParquet/catalog generation is published, the already-running feature server
  advertises and queries its point features within the configured refresh TTL.
- The hot update changes neither the bytes nor results of the three initial
  baseline OGC collections, and requests that overlap this additive swap finish
  on their captured generation. A separate overwrite wave tests changed bytes
  and stale-reference behavior; baseline continuity is not an immutability rule.
- The acceptance suite checks collection listing and detail, queryables, first
  page, item-by-ID, bbox filtering, attribute filtering, limits, Portolan links,
  and `X-Catalog-Generation` for each applicable fixture.
- Partitioned GeoParquet tests use only catalog-approved objects.
- Resource, concurrency, timeout, and response-size limits fail closed.
- Every OGC collection links to the correct Portolan document.
- The dataset MCP still performs bounded analytics and MVT generation after the
  feature service is deployed.

## Migration and rollout

### Phase 1: provider and reload spike

Prove the pygeoapi provider contract, exact dependency versions, reloadable ASGI
boundary, physical-row feature-ID strategy without Parquet mutation, GCS and
SeaweedFS revision-safe reads, and direct SQLite generation swap.
Benchmark full OpenAPI projection at the expected catalog cardinality before
committing to an external provider fork.

The SeaweedFS portion uses the shared manifest and bucket defined by the catalog
migration design. It must not maintain a separate feature-server fixture catalog
or bypass the Dagster-generated SQLite database.

### Phase 2: private deployment

Deploy the service internally, consume the shadow SQLite catalog, and run OGC,
security, and query-parity tests against representative small, large, and
partitioned datasets.

Run the complete local acceptance sequence first: start the webapp and feature
server after the initial three promotions, then publish the held-back fourth
dataset without stopping either service. This proves real SeaweedFS range reads
and dynamic resource projection together rather than testing reload with a
hand-authored SQLite fixture.

### Phase 3: catalog refresh validation

Publish new versions and overwrite existing version labels while traffic runs.
Verify per-worker convergence, in-flight revision handling, latest-alias movement,
source-cache invalidation, obsolete feature IDs, stale paging, failed-refresh
fallback, and database cleanup. Do not require historical asset retention.

### Phase 4: public exposure

Add the load-balancer route or hostname and link the service from Portolan and
the HIFLD webapp. Start with conservative limits and tune them from observed
range-read, memory, and latency metrics.

Rollback removes public routing while leaving Portolan, the webapp catalog, and
the dataset MCP unchanged.

## Risks and mitigations

### Portolan and pygeoapi are not one stack

There is no standard Portolan-to-pygeoapi feature adapter. Keep the mapping in a
small typed projector sourced from SQLite and link the two representations rather
than claiming pygeoapi natively serves Portolan assets.

### pygeoapi application internals

The in-process swap relies on pygeoapi handlers accepting an API object and on
generic collection routes. Pin the version, keep the custom module narrow, add
contract tests around every used handler, and pursue an upstream app-factory or
API-provider hook.

### Provider maturity

The community DuckDB provider may reduce implementation time but is not yet a
sufficient production dependency by itself. Use a reviewed fork or a focused
implementation based on measured test results.

### Large OpenAPI documents

Advertising every currently published version increases resource count and OpenAPI size.
Build off-thread, use lazy provider construction, benchmark 5,000 resources, and
compress responses. Do not silently remove published spatial versions merely to reduce
the document.

### Remote-query variance

Cold object metadata, broad bboxes, and unselective counts can be slow. Enforce
limits, keep count behavior explicit, depend on Portolan-compliant spatial
statistics, and expose cold/warm telemetry.

### Cross-worker convergence

Workers refresh independently and may briefly disagree about the latest alias.
Per-response generation headers, object revision checks, stale-reference errors,
last-known-good metadata snapshots, and a bounded convergence alert make that
behavior explicit without adding a catalog coordinator. Metadata snapshots do
not preserve overwritten asset bytes.

## Result

The feature server adds standards-based feature access without becoming another
catalog authority. Portolan describes spatial and non-spatial data, the one generated
SQLite database supplies fast runtime metadata, pygeoapi implements OGC
semantics, and the custom DuckDB provider reads only trusted GeoParquet
spatial assets. DuckDB supplies physical file/row metadata for API-only feature
IDs and transforms CRS at query time, without adding fields to Parquet. New and
replaced versions become available through direct SQLite object refresh and an
atomic in-process metadata snapshot swap, with no state marker, generated
pygeoapi files, container rebuild, or worker restart.

## References

- [pygeoapi configuration](https://docs.pygeoapi.io/en/latest/configuration.html)
- [pygeoapi Admin API and documented file reload](https://docs.pygeoapi.io/en/stable/admin-api.html)
- [pygeoapi Flask application globals and generic collection routes](https://github.com/geopython/pygeoapi/blob/master/pygeoapi/flask_app.py)
- [pygeoapi feature request handling](https://github.com/geopython/pygeoapi/blob/master/pygeoapi/api/itemtypes.py)
- [Community DuckDB GeoParquet provider](https://github.com/waystones-nexus/pygeoapi-duckdb-geoparquet)
- [DuckDB Parquet virtual filename and file-row metadata](https://duckdb.org/docs/lts/data/parquet/overview)
- [OGC API - Features Core feature resources](https://docs.ogc.org/is/17-069r4/17-069r4.html#_feature)
