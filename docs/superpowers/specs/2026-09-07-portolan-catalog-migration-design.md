# Portolan Catalog Migration Design

## Goal

Replace the mutable `dataset-api` catalog database and object-storage discovery
jobs with a Portolan-conformant static catalog plus one generated SQLite search
projection. Keep the existing webapp, public HIFLD catalog routes, dataset MCP,
converted data products, version paths, and local SeaweedFS support.

The target state has no Portolan browser or Portolan service. HIFLD implements
the Portolan specification as files in object storage. The webapp owns the
existing HIFLD HTTP catalog contract, and the dataset MCP remains a separate
consumer of that contract.

This design is paired with
[`2026-09-07-portolan-feature-server-design.md`](2026-09-07-portolan-feature-server-design.md),
which adds OGC API - Features over the GeoParquet assets described here.

## Decision summary

- Portolan/STAC JSON is the canonical, portable metadata representation.
- `hifld-next-datasets` creates catalog metadata during conversion and publish;
  the runtime no longer discovers meaning by recursively inspecting storage.
- The existing `{dataset_slug}/{file_slug}/{version}/{format}` data paths do not
  change.
- A version is an immutable Portolan Collection with ID
  `{dataset_slug}/{file_slug}/{version}`. Dataset and file directories above it
  are Portolan Catalogs.
- The existing HIFLD `Collection` grouping remains explicit metadata and an
  indexed relationship; it is not added to the immutable collection ID.
- Original Shapefile, GeoPackage, File Geodatabase, and GeoJSON outputs remain
  downloadable assets. GeoParquet is the primary cloud-native vector asset and
  PMTiles is its visual derivative.
- Schema uses the STAC Table extension. Storage replicas use the Alternate
  Assets extension. Dataset versions use the STAC Version extension.
- HIFLD-specific quality and compatibility fields use a small, versioned HIFLD
  STAC extension instead of unvalidated free-form properties.
- Dagster produces a single stable `_catalog/catalog.sqlite` object. It does not
  retain one database per generation.
- `_catalog/catalog-state.json` is an HIFLD control-plane file, not Portolan. It
  is the atomic commit marker for hot reloads.
- The webapp downloads SQLite, validates it, and atomically swaps its read-only
  catalog connection without restarting.
- The webapp takes over the current public catalog routes. The PostgreSQL-backed
  `dataset-api`, its discovery/config jobs, and its deployment are removed after
  a compatibility cutover.
- The dataset MCP remains. Its catalog base URL moves from `dataset-api` to the
  webapp's compatible catalog API.

## Scope

This migration includes:

- Portolan metadata generation in `../hifld-next-datasets`.
- A recoverable full catalog build and an idempotent incremental catalog update.
- A read-only SQLite schema for browse, search, schema, quality, version, asset,
  and storage-location queries.
- Hot catalog refresh in the webapp.
- Compatibility implementations for the webapp's existing public catalog API.
- Dataset MCP catalog-client cutover.
- Removal of the production dataset API, PostgreSQL catalog, and discovery
  CronJobs after parity is proven.
- Portolan structural, metadata, and data validation in the publishing gates.

This migration does not include:

- Running Portolan Browser, a STAC API, or a HATEOAS proxy.
- Replacing the HIFLD frontend with Portolan Browser.
- Moving or duplicating published geospatial data.
- Moving data-quality checks or file conversion out of
  `../hifld-next-datasets`.
- Replacing the dataset MCP or its bounded DuckDB analytics and map-tile
  capabilities.
- Adding new GeoServer coupling. GeoServer metadata is legacy and is not carried
  forward as an active serving backend.
- Making the static Portolan files provide full-text search. SQLite remains the
  deliberately disposable search projection.

## Current system

`hifld-next-datasets` performs ingest, conversion, quality analysis, and publish.
It writes versioned formats under
`{dataset_slug}/{file_slug}/{version}/{format}` and writes
`quality_manifest.json`, `data_dictionary.json`, and `source_manifest.json`
beside those products.

`dataset-api` then scans storage, interprets path structure, reads those nested
metadata files, and upserts PostgreSQL rows for Collections, Datasets, Files,
Formats, FileSources, and StorageLocations. The runtime database adds search,
pagination, joins, stable response shaping, and trusted storage resolution, but
it duplicates metadata already known by the publishing pipeline.

The webapp calls `dataset-api` from server loaders and reshapes those results
into the public slug-based catalog routes. The dataset MCP also calls the
dataset API and applies a fail-closed source resolver before DuckDB sees any
object URI.

The architectural problem is not that SQLite or PostgreSQL exists. It is that a
second cataloging system discovers and owns records after publication. In the
target design, the pipeline owns the records and SQLite is only a generated
index of the same records.

## Target architecture

```text
hifld-next-datasets
  ingest -> convert -> quality -> publish version
                                  |
                                  +-> Portolan JSON/Markdown
                                  +-> update catalog.sqlite
                                  +-> update catalog-state.json last

Object storage
  catalog.json + nested Portolan tree + data assets
  _catalog/catalog.sqlite
  _catalog/catalog-state.json
             |
             +-----------------------+
             |                       |
             v                       v
       HIFLD webapp             OGC feature server
       catalog routes           pygeoapi + DuckDB
             |
             v
       dataset MCP catalog client
```

The Portolan tree and SQLite database contain equivalent catalog facts but serve
different access patterns. Portolan is canonical for interchange and direct
object-storage browsing. SQLite is canonical only for a particular generated
index generation and can always be rebuilt from the Portolan tree and pipeline
metadata.

## Object layout

There is no dedicated `portolan/` prefix. The Portolan root is the bucket root,
and the current data hierarchy becomes the catalog hierarchy:

```text
catalog.json
README.md
AGENTS.md

{dataset_slug}/
  catalog.json
  README.md
  AGENTS.md

  {file_slug}/
    catalog.json
    README.md
    AGENTS.md

    {version}/
      collection.json
      README.md
      AGENTS.md

      geoparquet/...
      pmtiles/...
      geopackage/...
      geojson/...
      shapefile/...
      file_geodatabase/...
      metadata/
        quality_manifest.json
        data_dictionary.json
        source_manifest.json

_catalog/
  catalog.sqlite
  catalog-state.json
```

Portolan requires `README.md` and `AGENTS.md` in every Catalog and Collection
directory. These are generated deterministically from the same typed records as
the JSON. Version directories are Collections and therefore need both files;
they are not created for individual format subdirectories.

The root may have more than Portolan's recommended twenty direct children.
Keeping dataset slugs at the root preserves current data paths and the agreed
collection IDs. This is an intentional SHOULD-level deviation, not a structural
violation. If catalog size later makes grouping necessary, link-defined
subcatalogs can be introduced without changing asset paths or the HIFLD API.

## Portolan mapping

| Existing concept | Portolan representation |
| --- | --- |
| Catalog root | Root STAC Catalog |
| HIFLD Collection grouping | Themes plus `hifld:collection_slug` metadata |
| Dataset | Intermediate STAC Catalog |
| File/layer | Intermediate STAC Catalog |
| Immutable file version | Leaf STAC Collection |
| Published format | Collection-level Asset |
| Partitioned GeoParquet | Collection asset plus Portolan Partition extension |
| Version history | STAC Version extension and predecessor/latest links |
| Data dictionary | `table:columns` plus a metadata asset |
| Quality manifest | Metadata asset plus `hifld:quality` summary |
| Storage replica | Canonical HTTPS `href` plus Alternate Assets entries |
| Upstream source | `via` link and, when downloadable, a `source` asset |

### IDs and versions

The immutable Portolan Collection ID is:

```text
{dataset_slug}/{file_slug}/{version}
```

For example:

```text
electric-substations/substations/v1.0.0
```

IDs use the existing slugs and version string without inventing a separate
opaque identifier. Version strings must use the existing path-safe slug
character policy, must not equal `.` or `..`, and may not contain `/` or `~`.

Each version Collection declares the STAC Version extension. A newly published
version links to its predecessor and to the latest version. Older documents do
not have to be rewritten merely to add successor links. SQLite carries an
explicit `is_latest` value selected by the pipeline; clients must not infer
latest by lexically sorting version strings.

The public webapp continues to identify a logical file with collection, dataset,
and file slugs. The feature-server mapping is defined in the paired design.

### Assets and original formats

GeoParquet is the primary vector `data` asset. PMTiles is a `visual` asset and is
also registered through the Web Map Links extension. Published GeoPackage and
GeoJSON derivatives remain collection-level alternate representations. Hosted
copies of source Shapefiles and File Geodatabases retain their ZIP packaging and
use the Portolan `source` role when they are the upstream original.

Every asset has an `href`, media type, at least one role, human-readable title,
and, when the pipeline owns the bytes, `file:size` and a multihash
`file:checksum`. Absolute primary hrefs use HTTPS so browsers can fetch them.
The current object path is preserved even when the metadata document moves.

A File Geodatabase or GeoPackage with multiple layers continues to produce one
HIFLD file slug per layer. Each layer/version Collection can link back to the
common original through `hifld:source_file_path` and a source asset. This
preserves the dataset API's current layer model instead of treating a multi-layer
container as one queryable table.

Portolan recommends a directly usable MapLibre style for vector collections.
The pipeline generates a conservative default style from geometry type and
registers it as a `style` asset. Dataset configuration may replace that default
with curated styles. Thumbnail generation remains optional and must not block an
otherwise valid catalog publication.

### Providers, license, and provenance

Portolan requires provider metadata that the current dataset API does not model
completely. The pipeline's dataset definition must therefore add structured
provider and license fields before a version can claim Portolan conformance.

Each Collection identifies at least one `producer` and exactly one `host`, with
the host last as required by Portolan. A provider has a human-readable name and a
URL or email. The Collection uses a valid SPDX license identifier when possible;
`other` requires a license link.

The existing source manifest supplies acquisition and conversion provenance. A
mirror includes a `via` link to the upstream landing page or API and a `source`
asset when the upstream original is directly downloadable. HIFLD's conversion
software and the storage operator are recorded separately from the upstream
producer.

Missing provider, license, or required provenance is a migration error, not a
value silently invented by the catalog generator. This is one of the material
metadata gaps between the current database model and Portolan.

### Multiple storage locations

Each logical asset has one canonical browser-readable HTTPS `href`. The STAC
Alternate Assets extension carries equivalent GCS, S3-compatible, and SeaweedFS
locations when they exist. Each alternate includes a stable storage-location
slug and enough non-secret endpoint information for an authorized server to
select it.

Credentials, Kubernetes Secret names, signed URLs, and private endpoint details
are never published in Portolan. Runtime services map the public storage slug to
server-controlled credentials and endpoints. A client cannot submit an asset URL
or storage endpoint and have the server query it.

The publisher verifies that alternates refer to equivalent bytes by checksum.
An alternate with a different checksum is a separate asset, not a replica.

### Schema metadata

Vector Collections declare the STAC Table extension and expose
`table:columns`. Each column includes its name, type, and description when
available. The existing `data_dictionary.json` remains a `metadata` asset during
and after migration because it contains richer statistics such as null counts,
unique counts, examples, ranges, lengths, and possible values.

SQLite stores both the standard Table fields and the richer statistics so the
current paginated schema route does not need to download or parse JSON at request
time. A `columns_hash` detects schema equality across formats and versions.

Collection spatial extents are always finite WGS84 bounds even when the stored
data uses another CRS. The publishing gate rejects sentinel, inverted, or
out-of-range extents before updating any parent catalog.

### Quality metadata and the HIFLD extension

Portolan intentionally defines no `portolan:*` fields and reserves that prefix.
HIFLD therefore publishes a small STAC extension for fields that have no suitable
standard extension. Its schema is versioned, source-controlled, and declared in
the Collection's `stac_extensions` list.

The initial extension covers:

- `hifld:collection_slug`
- `hifld:dataset_slug`
- `hifld:file_slug`
- `hifld:layer_name`
- `hifld:source_file_path`
- `hifld:quality`, containing the quality policy version, pass/fail result,
  invalid-geometry count, and columns hash

The complete quality report remains `metadata/quality_manifest.json`, linked as
a `metadata` asset. The extension contains only fields needed for discovery and
summary display. This lets Portolan carry arbitrary HIFLD metadata without
pretending those fields are native Portolan behavior.

The extension schema is source-controlled and published at a stable versioned
URL such as `/_schemas/hifld/v1.0.0/schema.json`. It is a shared schema artifact,
not a generated file copied into every dataset directory.

### Pinned extension set

The initial projection targets the current Portolan v0.2.0 profile and pins the
extension versions that profile identifies: File Info v2.1.0, Web Map Links
v1.3.0, Version v1.2.0, Table v1.2.0, Alternate Assets v1.2.0, and Partition
v1.0.0 when partitioned GeoParquet is present. Projection v2.0.0 is included
when CRS detail beyond core extent metadata is published. The HIFLD extension is
pinned independently.

These pins are updated only through an explicit catalog schema migration and a
full validation run.

## Portolan tooling boundary

HIFLD does not replace its Dagster conversion pipeline with Portolan's example
CLI. The existing pipeline already handles source acquisition, multi-layer
Shapefiles/GeoPackages/File Geodatabases, HIFLD quality policy, GeoParquet
layout, PMTiles, all alternate downloads, version partitions, and multiple
storage locations.

Portolan tooling is used for validation and as a reference implementation for
STAC document construction. Its structural, metadata, data, link, CORS, and
range-request checks become publishing gates. It does not become a second
uploader, version registry, scheduler, indexer, or source of catalog truth.

## Generated human and agent documentation

The pipeline renders `README.md` and `AGENTS.md` from versioned templates.

- Root documentation explains the catalog, licenses, navigation, and preferred
  access methods.
- Dataset and file documentation uses the human-readable names and descriptions
  already maintained by the pipeline.
- Version documentation includes formats, schema, quality, CRS, bounds, version
  provenance, and small DuckDB/GeoParquet usage examples.
- Agent guidance identifies the Portolan root, recommends HTTP range reads,
  describes the schema and storage alternates, and links to the HIFLD API and
  dataset MCP where server-side querying is preferable.

Generated documentation is deterministic and validated for broken links. Manual
prose belongs in pipeline source metadata and templates, not hand-edited objects
in the published bucket.

## Normalized publishing model

The pipeline introduces one typed catalog record model at the boundary between
quality/conversion and publication. It contains the complete identity,
descriptive metadata, versions, formats, schemas, quality summary, provenance,
and storage replicas for one file version.

Both Portolan documents and SQLite rows are projections of this model. The
publisher must not generate Portolan, then recursively parse its own JSON to
create SQLite during the normal incremental path.

Normal publication is incremental:

1. Conversion and quality checks produce a candidate version record.
2. The publisher writes all data assets and version-level Portolan files.
3. It downloads the current SQLite database, or creates it for the first run.
4. It applies an idempotent transaction for that version and rebuilds affected
   aggregate rows and FTS entries.
5. It renders affected parent Catalog documents and documentation from the
   candidate database.
6. It validates the Portolan metadata, database schema, and referential
   integrity.
7. It overwrites `_catalog/catalog.sqlite`.
8. It overwrites `_catalog/catalog-state.json` last.

Catalog publication is serialized with a Dagster concurrency key. The object
write also uses the storage backend's conditional-generation or ETag mechanism
where supported, so stale concurrent writers fail instead of losing updates.

A separate recovery command rebuilds everything by walking the Portolan tree.
That full scan is slower by design and is used for bootstrap, audits, and repair,
not for every new version.

## SQLite projection

SQLite is read-only outside the publishing pipeline. It contains normalized
tables rather than serialized API responses:

- `catalog_metadata`: schema version, catalog generation, Portolan profile URI,
  created time, and source root.
- `collections`: current HIFLD Collection groupings.
- `datasets`: dataset identity, display metadata, timestamps, and collection
  membership.
- `files`: file/layer identity, display metadata, source container, and dataset
  relationship.
- `versions`: immutable version identity, Portolan href, timestamps, bounds,
  CRS, geometry type, feature count, and explicit latest flag.
- `formats`: normalized format definitions and media types.
- `assets`: version/format assets, roles, sizes, checksums, and paths.
- `asset_locations`: canonical and alternate storage locations.
- `columns`: ordered schema plus quality/statistical fields.
- `quality`: version-level quality summary and manifest href.
- `tags`: normalized searchable tag key/value rows.
- `legacy_ids`: compatibility IDs imported during cutover or deterministically
  assigned for new entities.
- FTS5 tables for dataset and file name, description, tags, and slugs.

Foreign keys, uniqueness constraints, and indexes enforce the catalog identity
rules. The database is built with a fixed application ID and schema version.
Consumers reject unsupported schema versions before opening it for traffic.

The database does not contain credentials, signed URLs, or environment-specific
secrets. Asset locations are logical, catalog-owned locations that a runtime
storage policy resolves.

### Compatibility numeric IDs

Slugs remain canonical. The current APIs nevertheless expose numeric collection,
dataset, file, format, and source IDs, and some compatibility routes accept them.
A one-time migration exports existing IDs into `legacy_ids`. New identities use
a deterministic positive 63-bit value derived from the entity kind and canonical
slug path, with collision detection during publication.

This preserves existing numeric routes for known records without making numeric
IDs part of Portolan. New consumers should use slug-based links. Numeric routes
remain compatibility endpoints and can be deprecated separately after usage is
measured.

## Atomic publication with one SQLite object

`_catalog/catalog-state.json` is deliberately outside Portolan. It contains:

```json
{
  "schema_version": 1,
  "generation": "2026-09-07T18:42:00Z",
  "sqlite": {
    "href": "./catalog.sqlite",
    "sha256": "...",
    "size": 1234567,
    "storage_generation": "..."
  },
  "portolan_root": "../catalog.json"
}
```

The publisher uploads the validated database first and the state file last. A
consumer polls the state file with `If-None-Match`. On change it downloads the
stable SQLite object to a temporary local path and verifies the advertised hash,
size, SQLite application ID, schema version, generation, and `PRAGMA quick_check`.

If the old state file is observed with the new database during the short publish
window, the checksum does not match and the consumer retries without switching.
Object storage contains only one named SQLite catalog. A consumer temporarily
retains its old local file while the candidate is validated and while in-flight
requests finish; that local overlap is required for zero-downtime replacement
and is not cloud-storage retention.

The state file may later include equivalent index replicas, but services still
select locations through allowlisted environment configuration. It is not a
general URL-fetch manifest.

## Webapp catalog runtime

The webapp adds a server-only catalog repository and lifecycle manager. On
startup it must obtain and validate a usable database before reporting ready.
For local development it can open a configured filesystem path or fetch the
catalog from SeaweedFS. Production fetches the configured state URL and SQLite
object.

The lifecycle manager:

- polls the state object at a configurable interval;
- downloads only when its ETag or generation changes;
- builds prepared, read-only query objects for the candidate;
- atomically swaps the active repository reference;
- lets in-flight requests finish against the old repository;
- closes and unlinks the retired local database afterward;
- keeps serving the last-known-good generation when refresh fails; and
- exposes active generation, last successful refresh, and last error in health
  and metrics.

The initial implementation should use Node's SQLite support if it satisfies the
deployed Node 22 runtime and Nitro bundling tests. If it does not, use a pinned
`better-sqlite3` build. Either choice is hidden behind a narrow typed repository
interface and opens the database read-only. External SQLite values are parsed
through explicit schemas before becoming application models.

## Public API compatibility

The webapp keeps its existing public, same-origin API and moves query execution
from HTTP calls to the local catalog repository. This includes:

- collection list and detail;
- collection-scoped dataset search, tag filters, omission, pagination, and URL
  inclusion;
- global dataset list and stats;
- dataset and file detail by slug;
- version and format/source expansion;
- schema and data-dictionary paging;
- quality summaries;
- ZIP-download redirects for Shapefiles and File Geodatabases;
- sitemap, OpenAPI, agent-discovery, and WebMCP metadata derived from the same
  catalog; and
- compatibility numeric-ID routes during migration.

Response fields and route paths remain stable through the cutover. Select and
compare continue to run in the frontend; the server supplies the same metadata
and source URLs they use today. Download routes resolve the requested source ID
through SQLite and redirect only to a trusted catalog asset.

The server-side `DATASET_API_URL` remains available only during dual-read and
rollback. The final runtime replaces it with catalog state/storage settings.

## Dataset MCP integration

The dataset MCP remains an independently deployed service. Its typed
`CatalogClient` continues to use the current HIFLD HTTP response contract, but
its base URL changes to the webapp's internal Service URL. This minimizes the
cutover and preserves one response-shaping implementation.

The MCP source resolver remains fail-closed. It verifies collection, dataset,
file, source, format, version, and storage ownership before returning exact
GeoParquet object URIs. The webapp catalog endpoint must therefore expose the
same storage-location and object-list information currently supplied by
`dataset-api`.

The MCP does not query Portolan JSON or SQLite directly in the first migration.
That can be reconsidered only if removing the HTTP dependency provides a measured
benefit. Its query execution, tokens, paging, and MVT routes are otherwise
unchanged.

## Freshness and failure behavior

A newly published version becomes visible when the version files, parent
catalog links, SQLite object, and state marker have been published in order. No
webapp rebuild or restart is required. The freshness objective is the configured
poll interval plus one database download and validation.

Failure rules are:

- Never publish the state marker for a failed catalog build.
- Never swap a consumer to a database with a bad checksum, unsupported schema,
  failed integrity check, or mismatched generation.
- Continue serving the last-known-good local database after a refresh error.
- Fail readiness at cold start if no valid database exists.
- Report catalog staleness without taking a healthy instance out of service
  merely because one refresh attempt failed.
- Treat a missing asset target, invalid Portolan link, or conflicting latest
  version as a publishing failure.

Because the stable cloud SQLite object is overwritten, durable rollback means
rebuilding and republishing a prior catalog state. Optional provider object
versioning may retain a short operational window, but the application does not
depend on multiple named databases or indefinite historical index retention.
The immutable data versions and Portolan Collections remain the source for a
rebuild.

If bucket-level object versioning is enabled, a lifecycle rule expires
noncurrent `_catalog/catalog.sqlite` generations promptly. Long-lived provider
version retention is not part of the design.

## Portolan conformance and validation

The implementation pins one Portolan profile URI rather than following `main`.
Portolan is pre-1.0 and its profile currently describes itself as work in
progress, so upgrades require an explicit compatibility review.

Publishing gates run:

1. STAC 1.1 structural validation.
2. Portolan metadata validation, including required links, titles, providers,
   licenses, asset media types/roles, README files, and AGENTS files.
3. Link resolution across the uploaded candidate tree.
4. Portolan data validation for GeoParquet spatial ordering, row-group sizes,
   spatial statistics, compression, and range-readable hosting.
5. HIFLD extension validation.
6. SQLite schema, integrity, foreign-key, FTS, latest-version, and response-shape
   validation.
7. HTTP probes for CORS and byte-range support on canonical cloud-native assets.

The existing conversion and quality checks remain authoritative. Portolan's data
validator adds conformance checks; it does not replace HIFLD's domain-specific
quality policy.

## Migration and cutover

### Phase 1: contract capture

Capture representative `dataset-api` responses for all public routes, including
multiple files, multiple versions, every supported format, partitioned
GeoParquet, missing optional metadata, failed quality, and multiple storage
locations. Export current numeric IDs for compatibility.

### Phase 2: dual publication

Add typed Portolan and SQLite projections to `hifld-next-datasets` while keeping
the current published files and discovery jobs. Validate generated catalog
records against the captured database for completeness and identity parity.

### Phase 3: webapp dual read

Add the SQLite repository behind a runtime switch. In shadow mode, serve existing
responses from `dataset-api`, query SQLite in parallel for sampled requests, and
record semantic differences without logging sensitive values. Resolve all
differences or document intentional ordering changes.

### Phase 4: consumer cutover

Make SQLite the webapp source of truth, point dataset MCP at the webapp catalog
API, and verify downloads, schema pages, compare, maps, MCP search, MCP source
resolution, and sitemap generation. Retain the dataset API as a rollback target
for a bounded observation window.

### Phase 5: retirement

Remove the `dataset-api` and `dataset-discovery` Helm releases, PostgreSQL catalog
resources, discovery/config CronJobs, database migrations, and deployment
workflow steps. Remove `DATASET_API_URL` after rollback is formally closed.

The `dataset-api/` source can be deleted in the same retirement change or kept
for one release as non-deployed reference code. It must not remain an active
second writer.

## Verification and acceptance criteria

- Every published root, Catalog, and Collection validates against the pinned
  Portolan and STAC versions.
- Every existing logical dataset/file/version appears exactly once in Portolan
  and SQLite.
- Shapefile, GeoPackage, File Geodatabase, GeoJSON, GeoParquet, and PMTiles
  downloads remain available with correct media types and roles.
- Schema, quality, feature count, bounds, CRS, geometry type, tags, provenance,
  and all storage replicas survive migration.
- Search and tag-filter result sets match the current API for the captured
  fixtures; pagination order is deterministic.
- Every public webapp catalog route preserves its response schema and link
  contract.
- Dataset MCP can search, inspect schema, resolve trusted GeoParquet sources, run
  a bounded query, page results, and render a tile after cutover.
- Publishing a new version updates a running webapp within the configured refresh
  interval without rebuilding or restarting it.
- A corrupt or partially published database never replaces the active
  last-known-good database.
- GCS production and SeaweedFS local-development catalog refreshes both pass.
- No runtime component performs a recursive object-storage discovery scan during
  normal startup or refresh.
- Object storage contains one named SQLite index, not an accumulating generation
  directory.

## Risks and mitigations

### Portolan stability

Portolan is evolving before 1.0. Pin the schema URI and validator version, keep
the projection isolated in the pipeline, and treat upgrades like data-contract
migrations.

### Static-catalog update consistency

Multiple parent Catalog JSON files cannot change in one object-store transaction.
All new links target immutable, already-uploaded objects, so a crawler may briefly
see either the old or expanded tree but never a link to an unpublished version.
Internal services switch only on the state marker.

### SQLite as a generated artifact

A publisher bug could produce an incomplete index. Contract fixtures, foreign
keys, counts, Portolan-to-SQLite reconciliation, and last-known-good consumer
behavior prevent a bad candidate from taking traffic. The full rebuild command
provides recovery.

### Incremental writer concurrency

Concurrent version publications could overwrite each other. Serialize the
catalog-update asset and use conditional object writes. Each update is
idempotent by canonical version ID.

### Node SQLite deployment

Native SQLite bindings can conflict with Nitro bundling or container ABI. Prove
the selected implementation in a deployment spike and keep it behind a narrow
repository interface.

### Compatibility IDs

Portolan uses string IDs while legacy responses expose integers. Preserve known
IDs through the one-time export and detect deterministic-ID collisions at
publish time. New links should prefer slugs.

## Result

HIFLD keeps the useful parts of its existing system—its frontend, API contract,
dataset MCP, format coverage, quality metadata, schemas, versions, and storage
selection—while removing the duplicate database-backed cataloging authority.
Portolan becomes the interoperable catalog on object storage, SQLite provides
fast local indexing, and Dagster is the only normal writer of catalog truth.

## References

- [Portolan core specification](https://github.com/portolan-sdi/portolan-spec/blob/main/specs/portolan/core.md)
- [Portolan format requirements](https://github.com/portolan-sdi/portolan-spec/blob/main/specs/portolan/formats.md)
- [Portolan STAC profile](https://github.com/portolan-sdi/portolan-spec/blob/main/stac/README.md)
- [STAC specification](https://github.com/radiantearth/stac-spec)
