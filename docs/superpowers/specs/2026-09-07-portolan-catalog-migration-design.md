# Portolan Catalog Migration Design

## Goal

Replace the mutable `dataset-api` catalog database and object-storage discovery
jobs with a Portolan-conformant static catalog plus one generated SQLite search
projection. Keep the existing webapp, slug-based HIFLD catalog routes, dataset
MCP, converted data products, version labels, and local SeaweedFS support.

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
- Published paths become
  `{collection_slug}/{dataset_slug}/{file_slug}/{version}/{format}`. Existing
  unprefixed HIFLD objects are migrated once and retained only for a bounded
  rollback window.
- A version is a replaceable Portolan Collection with ID
  `{collection_slug}/{dataset_slug}/{file_slug}/{version}`. The existing
  dataset-api `Collection` becomes a first-level Portolan Catalog; dataset and
  file directories below it are nested Portolan Catalogs.
- The bucket-root Portolan Catalog is an umbrella for one or more current-style
  Collections, including the initial `hifld` Catalog.
- Original Shapefile, GeoPackage, File Geodatabase, and GeoJSON outputs remain
  downloadable assets. GeoParquet is the primary cloud-native vector asset and
  PMTiles is its visual derivative.
- Schema uses the STAC Table extension. Storage replicas use the Alternate
  Assets extension. Dataset versions use the STAC Version extension.
- Standard descriptive, provider, license, provenance, timestamp, schema-summary,
  and quality-summary metadata is written directly into standard STAC/Portolan
  fields and links. Detailed HIFLD quality and data-dictionary documents remain
  typed metadata assets. `source_manifest.json` is retired, and
  `geoparquet_layout.json` remains an unlinked pipeline control artifact. The
  initial catalog defines no custom STAC fields or HIFLD STAC extension.
- Dagster produces a single stable `_catalog/catalog.sqlite` object. It does not
  retain one database per generation.
- The SQLite object is the sole runtime catalog publication unit. Its object
  ETag/generation drives hot reloads; there is no separate state-marker file.
- Full slug paths identify catalog entities. Asset keys and storage-location
  slugs identify representations and replicas; public numeric catalog IDs and
  `/by-slug` routes are retired as part of the consumer migration.
- Version labels do not promise immutable bytes. Replacements update asset
  revisions, metadata, and the SQLite projection.
- Non-spatial datasets remain in the catalog as tabular data. The feature server
  advertises only eligible spatial GeoParquet assets.
- License terms are authored as dataset- or catalog-level files and referenced
  through the required STAC license field and links.
- The webapp downloads SQLite, validates it, and atomically swaps its read-only
  catalog connection without restarting.
- The webapp retains the slug-based public catalog routes. The PostgreSQL-backed
  `dataset-api`, its discovery/config jobs, and its deployment are removed after
  a compatibility cutover.
- The dataset MCP remains. Its catalog base URL moves from `dataset-api` to the
  webapp's slug-based catalog API, with a corresponding client adaptation.
- A required local acceptance workflow seeds a small, varied set of production
  GeoPackages into a dedicated SeaweedFS bucket, promotes them into the new
  layout with local Dagster, and proves that running consumers observe a later
  promotion without restarting.

## Scope

This migration includes:

- Portolan metadata generation in `../hifld-next-datasets`.
- A one-time namespace migration from unprefixed HIFLD object keys to
  collection-prefixed canonical keys.
- A recoverable full catalog build and an idempotent incremental catalog update.
- A read-only SQLite schema for browse, search, schema, quality, version, asset,
  and storage-location queries.
- Hot catalog refresh in the webapp.
- Preservation of slug-based catalog navigation and non-identity metadata,
  alongside the coordinated replacement of numeric identity contracts.
- Dataset MCP catalog-client cutover.
- Removal of the production dataset API, PostgreSQL catalog, and discovery
  CronJobs after parity is proven.
- Portolan structural, metadata, and data validation in the publishing gates.
- A repeatable, manifest-driven SeaweedFS acceptance environment shared by
  Dagster, the webapp, and the feature server.

This migration does not include:

- Running Portolan Browser, a STAC API, or a HATEOAS proxy.
- Replacing the HIFLD frontend with Portolan Browser.
- Permanently duplicating published geospatial data. A bounded one-time copy to
  collection-prefixed keys is part of migration because object storage has no
  atomic rename.
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

A 2026-09-07 audit of the production bucket found 1,368
`source_manifest.json` objects. All 855 dataset/file authoring manifests contain
only `title`, `description`, and `tags`. The other 513 are resolved version
copies containing those same values plus manifest-resolution bookkeeping. None
contains publisher, agency, license, source URL, or date fields. Those richer
legacy values, when present, are currently duplicated into
`data_dictionary.json` from the legacy inventory. Consequently, the source
manifest is a discovery input today, but it is not a necessary independent
catalog artifact in the target architecture.

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
                                  +-> replace catalog.sqlite last

Object storage
  catalog.json + nested Portolan tree + data assets
  _catalog/catalog.sqlite
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

## Local SeaweedFS acceptance environment

The migration has one required end-to-end acceptance path that uses the same
local SeaweedFS instance for legacy input, canonical output, catalog metadata,
and consumer reads. It uses a dedicated `hifld-acceptance` bucket so the test
can exercise an in-place namespace migration without colliding with the normal
developer `hifld` bucket or requiring destructive prefix cleanup.

The checked-in fixture manifest lives in `../hifld-next-datasets`. It contains
metadata only: collection, dataset, file, and version identifiers; the exact
production GCS GeoPackage URI; object generation; byte size; checksum; expected
geometry family; and whether the case is promoted in the initial or hot-update
wave. GeoPackage bytes are never committed to Git. The bootstrap command reads
production but has no production write capability. It downloads an object only
when the local cached copy or SeaweedFS object is absent or fails its pinned
size and checksum. The manifest's complete object key is authoritative; the
bootstrap must not derive the filename from the file slug because production
filenames are not uniformly slug-shaped.

The initial fixture suite is deliberately small enough for routine local use but
varied enough to test meaningful behavior:

| Promotion wave | Dataset/file | Approximate source size | Coverage |
| --- | --- | ---: | --- |
| Initial | `12nm-territorial-sea/12nm-territorial-sea` | 1.6 MiB | Small independent boundary dataset and simple hierarchy |
| Initial | `uniform-hazard-ground-motion/us-pga-10pct50yrs-bc-arc` | 8.7 MiB | Line geometry and first child of a multi-file dataset |
| Initial | `uniform-hazard-ground-motion/us-pga-10pct50yrs-bc-poly` | 13.6 MiB | Polygon geometry and sibling-file identity/compare behavior |
| Hot update | `alternative-fueling-stations/alternative-fueling-stations` | 48.3 MiB | Point geometry, higher feature count, and live catalog expansion |

All four are production `v1.0.0` GeoPackages. The manifest pins the observed
object metadata rather than relying on the approximate sizes above. If a
production object changes, fixture refresh is an explicit reviewed operation;
the acceptance bootstrap does not silently bless new bytes.

### In-place layout and promotion

Bootstrap uploads only the source GeoPackages under their current unprefixed
paths in the dedicated bucket:

```text
{dataset_slug}/{file_slug}/v1.0.0/geopackage/{name}.gpkg
```

The acceptance runner registers exactly those manifest entries as Dagster
publish partitions. It does not recursively discover arbitrary objects. Local
Dagster reads the unprefixed GeoPackage through SeaweedFS and writes the normal
quality, schema, conversion, and promotion outputs back to the same bucket under
the canonical collection-prefixed paths:

```text
hifld/{dataset_slug}/{file_slug}/v1.0.0/...
```

The original GeoPackage is preserved as a canonical downloadable asset;
GeoParquet, PMTiles, Shapefile ZIP, quality metadata, data dictionary, Portolan
documents, and generated human/agent documentation follow the normal pipeline
rules. The unprefixed fixture remains only as acceptance input and must never be
referenced by a Portolan link or SQLite asset row.

`StagingStorageResource` and `PublishedStorageResource` therefore gain a typed
S3-compatible backend configuration that supports a fixed endpoint, bucket,
credentials, region, path-style addressing, and HTTP/TLS mode. Existing GCS and
filesystem configurations remain supported. The local acceptance profile points
both logical resources at `hifld-acceptance`, but applies their distinct legacy
input and canonical output path rules. It must exercise object reads, writes,
listings, conditional replacement, snapshots/checksums, and temporary local
materialization through SeaweedFS rather than mounting the filer as a local
directory.

### Acceptance sequence

One repository-level acceptance command orchestrates the flow while still
allowing each stage to be run independently for diagnosis:

1. Start SeaweedFS and create or verify the dedicated bucket.
2. Bootstrap all four pinned production GeoPackages into their legacy paths.
3. Promote the three initial-wave partitions with local Dagster.
4. Validate every canonical data object and Portolan document, then atomically
   replace the stable SQLite object as the final runtime publication step.
5. Start the webapp and feature server against the SeaweedFS filer/S3 endpoints
   and wait for both to report the active catalog generation.
6. Run initial webapp, catalog API, download, and OGC feature assertions.
7. While both services remain running, promote the held-back point dataset and
   publish the next catalog generation.
8. Verify that both services adopt that generation within their configured TTL,
   expose the new dataset, and continue serving the initial unchanged versions.
9. Rerun the selected Dagster partitions and catalog publication to prove that
   promotion is idempotent and does not create duplicate catalog or SQLite rows.

The runner reports generated object paths, catalog generations, checksums, and
service refresh timings. Cleanup targets only the exact dedicated local bucket
and is a separate explicit operation; a failed test leaves its objects available
for inspection.

## Object layout

There is no dedicated `portolan/` prefix. The Portolan root is an umbrella at
the bucket root. Each current dataset-api `Collection` is a first-level
subcatalog and namespace for all of its datasets:

```text
catalog.json
README.md
AGENTS.md
LICENSE.md                    # when terms apply at umbrella scope

{collection_slug}/
  catalog.json
  README.md
  AGENTS.md
  LICENSE.md                  # when terms apply at collection-catalog scope

  {dataset_slug}/
    catalog.json
    README.md
    AGENTS.md
    LICENSE.md                # optional dataset-specific terms

    {file_slug}/
      catalog.json
      README.md
      AGENTS.md

      {version}/
        collection.json
        README.md
        AGENTS.md

        geoparquet/...
        parquet/...           # non-spatial tabular representation
        pmtiles/...
        geopackage/...
        geojson/...
        shapefile/...
        file_geodatabase/...
        metadata/
          quality_manifest.json
          data_dictionary.json
          geoparquet_layout.json  # pipeline-internal; not a STAC asset

_catalog/
  catalog.sqlite
```

Portolan requires `README.md` and `AGENTS.md` in every Catalog and Collection
directory. These are generated deterministically from the same typed records as
the JSON. Collection, dataset, and file directories are Catalogs. Version
directories are Collections and therefore need both files; documentation is not
created for individual format subdirectories.

The root Catalog has a stable umbrella ID such as `hifld-next`; `hifld` is the
ID and directory name of the initial first-level Catalog. A collection Catalog
may have more than Portolan's recommended twenty direct dataset children.
Keeping the hierarchy aligned with stable application identities is an
intentional SHOULD-level deviation, not a structural violation. Adding thematic
directories later would change descendant Portolan IDs, so themes remain
metadata unless introduced as part of an explicit identity migration.

## Portolan mapping

| Existing concept | Portolan representation |
| --- | --- |
| Entire catalog service | Root umbrella STAC Catalog |
| dataset-api Collection such as `hifld` | First-level STAC Catalog and ID namespace |
| Dataset | Intermediate STAC Catalog |
| File/layer | Intermediate STAC Catalog |
| Replaceable file version | Leaf STAC Collection |
| Published format | Collection-level Asset |
| Partitioned GeoParquet | Collection asset plus Portolan Partition extension |
| Version history | STAC Version extension and predecessor/latest links |
| Data dictionary | `table:columns` plus a metadata asset |
| Quality manifest | Versioned `quality` metadata asset |
| Source-manifest title and description | Catalog/Collection `title` and `description` |
| Source-manifest category tags | Catalog/Collection `keywords` |
| Storage replica | Canonical HTTPS `href` plus Alternate Assets entries |
| Upstream source | `via` link and, when downloadable, a `source` asset |

The phrase "Portolan catalog metadata" refers to the whole linked STAC tree,
not only the root `catalog.json`. Intermediate Catalogs carry grouping identity,
title, description, and links. The leaf `collection.json` is authoritative for
the richer version-level metadata and assets.

The generator promotes current sidecar values as follows:

| Current field | Canonical Portolan/STAC field |
| --- | --- |
| Dataset manifest `title`, `description` | Dataset Catalog `title`, `description` |
| File manifest `title`, `description` | File Catalog and version Collection `title`, `description` |
| Dataset/file `tags.categories` and legacy `keywords` | Deduplicated Catalog/Collection `keywords` |
| `publisher`, `agency`, `office` | Normalized Collection `providers` |
| `source_url` | Collection `via` link and source-asset `href` when directly downloadable |
| Dataset/catalog license file | Collection `license` and explicit `license` link |
| `date_issued`, `date_modified` | Version Collection `hifld:source_dates.issued` and `.modified`, with `metadata_resolved_from` provenance |
| Authored `temporal_start`, `temporal_end` | Version Collection `extent.temporal.interval` |
| Quality `feature_count` | `table:row_count` and SQLite quality summary |
| Native bounds plus source CRS | Transformed CRS84 Collection `extent.spatial.bbox` |
| Data-dictionary column name, type, description | `table:columns` |
| Detailed column statistics and HIFLD quality findings | Metadata assets and SQLite |

Date-only source values retain their original day-level precision; they are not
converted into invented midnight timestamps. Unknown data coverage is
`[[null, null]]`, and publication rejects a backwards authored coverage
interval. `tags.inventory_name` is
not written into STAC when it duplicates the dataset slug; SQLite and the
compatibility API derive it from that slug so existing responses and filters do
not change. Other fields with no consumer or interoperable meaning are dropped
rather than copied into unprefixed custom fields.

### IDs and versions

The Portolan Collection ID is:

```text
{collection_slug}/{dataset_slug}/{file_slug}/{version}
```

For example:

```text
hifld/electric-substations/substations/v1.0.0
```

IDs use the existing collection, dataset, and file slugs plus the version string
without inventing a separate opaque identifier. Every component uses the
existing path-safe slug character policy, must not equal `.` or `..`, and may
not contain `/` or `~`. Collection slugs are immutable namespaces: renaming one
creates a new canonical namespace and requires an explicit migration rather than
silently changing all descendant IDs.

Dataset slugs need only be unique within a collection, and file slugs need only
be unique within a dataset. The full four-part path is unique within the
umbrella Portolan catalog. The first segment also maps directly to the existing
`/api/collections/{collectionSlug}` route hierarchy.

Each version Collection declares the STAC Version extension. A version label
identifies a published revision slot, not immutable bytes. The publisher may
replace its data and metadata without assigning another version label. Every
replacement updates sizes, checksums, object revisions, and catalog generation;
cached schemas and feature-query metadata must be refreshed accordingly. Equal
input and output may be reused without duplicate records.

The file Catalog contains one `latest-version` link to the selected version
Collection. Version Collections link to their predecessor when applicable and
to the file Catalog with `version-history`; they do not retain stale direct
latest links. SQLite derives `is_latest` from that durable file-level selection.
Clients and recovery commands must not infer latest by lexical version sorting.
Version metadata is editable, and historical-byte retention is not a requirement.

The public webapp continues to identify a logical file with collection, dataset,
and file slugs. The feature-server mapping is defined in the paired design.

### Assets and original formats

GeoParquet is the primary vector `data` asset. PMTiles is a `visual` asset and is
also registered through the Web Map Links extension. Published GeoPackage and
GeoJSON derivatives remain collection-level alternate representations. Hosted
copies of source Shapefiles and File Geodatabases retain their ZIP packaging and
use the Portolan `source` role when they are the upstream original.

Shapefile and File Geodatabase representations are published as exactly one ZIP
asset per format for a logical file version. Exploded component files are not
advertised as separate assets and are not served by the webapp. GeoPackage is a
single `.gpkg` asset.

Every asset has an `href`, media type, at least one role, human-readable title,
and, when the pipeline owns the bytes, `file:size` and a multihash
`file:checksum`. Absolute primary hrefs use HTTPS so browsers can fetch them.
The catalog asset path includes the collection namespace. During cutover, an
old unprefixed object and its new prefixed copy are equivalent only when their
checksums match.

A File Geodatabase or GeoPackage with multiple layers continues to produce one
HIFLD file slug per published layer. Each layer/version Collection links to the
common original with a standard `source` asset. The pipeline may retain the
original input layer name in its conversion/layout manifest so it can reproduce
the conversion, but neither that name nor a separate source-file path is part of
the Portolan or SQLite catalog contract.

Portolan recommends a directly usable MapLibre style for vector collections.
The pipeline generates a conservative default style from geometry type and
registers it as a `style` asset. Dataset configuration may replace that default
with curated styles. Thumbnail generation remains optional and must not block an
otherwise valid catalog publication.

### Providers, license, and provenance

Portolan requires provider metadata that the current dataset API does not model
completely. The pipeline's dataset definition must therefore add structured
provider metadata before a version can claim Portolan conformance. A
one-time migration imports useful legacy values from the dataset/file source
manifests and version data dictionaries into the normalized publishing record;
future publications author them directly in that typed record.

Each Collection identifies at least one `producer` and exactly one `host`, with
the host last as required by Portolan. A provider has a human-readable name and a
URL or email.

License terms, when verified, are authored as `LICENSE` or `LICENSE.md` files at
dataset or catalog scope, following a repository-style convention. A
dataset-specific file takes precedence over an applicable parent catalog file.
The publisher resolves that choice and emits an explicit `rel: "license"` link
on each leaf Collection; STAC clients do not have to infer inheritance through
Catalog parents. The required Collection `license` field uses the applicable
SPDX identifier when known, otherwise `other` with the file link required by
Portolan. The file is the source of the terms; no parallel license-text
database or populated legacy license column is required. A shared file must
actually apply to its referenced datasets, and the generator must not invent
license terms. Changes to a shared file trigger regeneration of affected
catalog metadata where needed. The repository's software license is not a
default for third-party datasets; an umbrella data license is used only if its
scope is verified.

For the operator-confirmed archived HIFLD Open cohort, HIFLD Next publishes a
collection-scoped `LICENSE.md` notice identifying the snapshot and its format
conversions with Creative Commons Public Domain Mark 1.0 (`CC-PDM-1.0`). The
mark records the asserted public-domain status; it is not a new license grant
or independent legal verification. Each archived leaf Collection uses
`license: "CC-PDM-1.0"` and links directly to that notice. A dataset-specific
rights file or source notice takes precedence. The one-time inventory migration
marks the archived HIFLD records, and ordinary publishing runs do so only with
an explicit archive opt-in. Later uploads are never marked by default.

Outside that attested cohort, an unverified license does not block publication. Such a
Collection retains `license: "other"` without a fabricated license link and is
listed in the migration validation report with the Portolan rule `PTL-LIC-002`,
its version path, and the missing evidence. The publisher and cutover review
must report the exception count; they must not claim strict
Portolan conformance for those Collections. The exception is retired only when
an applicable, verified LICENSE file is supplied and linked.

The normalized publishing record supplies acquisition and conversion
provenance. A mirror includes a `via` link to the upstream landing page or API
and a `source` asset when the upstream original is directly downloadable.
HIFLD's conversion software and the storage operator are recorded separately
from the upstream producer. Legacy `publisher`, `agency`, and `office` values
are normalized into provider objects instead of being copied as parallel custom
fields. Where an organizational subdivision is useful, it is retained in the
provider name or description.

Inventory `date_issued` and `date_modified` are reported source metadata, not
HIFLD catalog lifecycle dates or data temporal coverage. They remain unchanged
in the version Collection's `hifld:source_dates` object, with their resolved
provenance. They are not placed on a `via` link or source asset unless separate
evidence establishes that the date applies to that linked resource. A top-level
`updated` may be supplied only from an actual HIFLD mirror synchronization
timestamp, not these inventory fields. Other migration bookkeeping such as
`metadata_sources`, `manifest_keys`, `manifest_role`,
`schema_version`, and `inventory_match_type` are migration or pipeline
bookkeeping and are not published as catalog metadata.

Missing provider or required provenance is a publication validation error. An
unresolved applicable license file is a documented migration exception, not an
error that stops publication. An empty legacy license field is not a migration
error when the applicable terms are supplied through the file model.

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

The Collection is authoritative for title, description, keywords, providers,
license, source links, and source timestamps. Existing data dictionaries may
retain duplicate descriptive or provenance fields during the compatibility
window, but both projections must come from the same normalized record and the
publishing gate must reject disagreement. A later data-dictionary schema
revision may remove those duplicates without changing the Portolan contract.

SQLite stores both the standard Table fields and the richer statistics so the
current paginated schema route does not need to download or parse JSON at request
time. A `columns_hash` detects schema equality across formats and versions.

Collection spatial extents are always finite WGS84 bounds even when the stored
data uses another CRS. Native quality bounds must not be copied directly into
STAC. The publisher reads the authoritative source/Parquet CRS and records the
native CRS, geometry column, native bounds, and separately transformed CRS84
extent. Extent transformation must conservatively enclose the data and handle
axis order and antimeridian crossing. Unknown CRS and invalid coordinates need
explicit validation; the publisher must not assume EPSG:4326 for an unknown CRS.
Stored geometry need not be reprojected for feature serving: DuckDB transforms
request bounds and returned geometry at query time as specified in the paired
feature-server design.

### Non-spatial datasets and source schema preservation

The catalog includes both spatial and non-spatial datasets. Non-spatial tables
retain their schema, descriptive metadata, quality report, and original
downloads, and are published as plain Parquet under the Portolan tabular rules.
The publisher classifies all-null-geometry sources explicitly rather than
inventing geometries or silently omitting their records. Tabular Collection
extents describe a justified area of interest, not a fabricated geometric
footprint. Temporal extents describe data applicability when known; an unknown
interval is explicit and is not inferred from conversion timestamps.

Only assets classified as eligible spatial GeoParquet are projected into OGC
feature resources. Absence of geometry does not make a catalog publication fail
or remove a dataset from webapp/MCP discovery. Tabular Parquet is not advertised
as a spatial source; consumers use its explicit media/format and capability
metadata. Supporting bounded tabular analytics is independent of OGC exposure.

GeoParquet remains a conversion of source material. Feature serving must not add
an identifier column, rewrite source attributes, or require an upstream unique
key. Prefer a source `id` or `objectid` field only after verifying non-null,
unique string/integer values across the complete asset, including all partitions;
record that selection as nullable `feature_id_column` runtime metadata. Otherwise,
API feature IDs are derived at read time from physical Parquet object/row
metadata. Revalidate the selection on overwrite. Existing format-required geometry encoding and spatial layout remain
conversion concerns; the feature service adds no persisted schema fields.

### Metadata assets and custom fields

The initial catalog adds no custom fields to STAC objects and publishes no HIFLD
STAC extension. Collection, dataset, and file slugs are already encoded in the
Portolan ID and parent hierarchy; duplicating them as fields would create two
sources of identity. Input layer names and source paths are conversion concerns,
not properties needed to consume the published layer.

Detailed metadata is attached with ordinary, locally named assets:

- `quality` points to `metadata/quality_manifest.json`;
- `data_dictionary` points to `metadata/data_dictionary.json`.

These asset keys need no prefix because they are local keys within an `assets`
map. Each asset has an explicit media type, `metadata` role, title, description,
and schema/version information inside the referenced document where applicable.
The metadata documents use their own typed schemas; their internal fields are not
STAC extension fields.

`source_manifest.json` is neither copied into the canonical collection path nor
advertised as an asset. Its useful values are represented by standard
Catalog/Collection fields, providers, links, assets, and timestamps.
`geoparquet_layout.json` may remain at its existing storage path because the
pipeline uses it for GeoParquet reuse and audit, but it is not part of the
Portolan contract, is not listed in `assets`, and is ignored by webapp, MCP, and
feature-server consumers.

The normalized pipeline record supplies quality summaries directly to SQLite.
The webapp and feature server therefore do not parse metadata assets at request
time, and an inline quality property is unnecessary. If a future requirement
needs interoperable inline metadata, first adopt an established STAC extension;
creating a new prefixed extension requires a separate schema-design decision.

### Pinned extension set

The initial projection targets the current Portolan v0.2.0 profile and pins the
extension versions that profile identifies: File Info v2.1.0, Web Map Links
v1.3.0, Version v1.2.0, Table v1.2.0, Alternate Assets v1.2.0, and Partition
v1.0.0 when partitioned GeoParquet is present. Projection v2.0.0 is included
when CRS detail beyond core extent metadata is published. The generator
additionally declares Timestamps v1.1.0 when an upstream publication date is
available.

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

### TypeScript STAC schema handling

The webapp's normal catalog request path reads the generated SQLite projection;
it does not crawl or parse the Portolan tree and therefore needs no STAC library
on that path. If TypeScript code reads STAC documents for migration comparison,
diagnostics, or a future recovery tool, it must not maintain a handwritten copy
of the STAC schema.

That TypeScript boundary uses the exact pinned STAC 1.1, Portolan profile, and
declared extension JSON Schemas as its source of truth. A lockfile-pinned
`stac-node-validator` 2.x release validates each externally loaded document,
with a pinned schema map for the Portolan profile and extensions. The exact
schema files are vendored in the repository. TypeScript declarations are
generated from those same files with a lockfile-pinned
`json-schema-to-typescript`, checked into the repository, and regenerated only
as part of an explicit catalog-schema upgrade. The running webapp never fetches
schema definitions from the internet.

Generated external-document types remain behind a narrow adapter that produces
the webapp's explicit catalog models. Application code must not bypass runtime
validation by asserting that `response.json()` is a generated STAC type.

The initial implementation does not use `stac-ts`. Its current public types
hard-code STAC `1.0.0` and retain older field semantics, while this design pins
STAC 1.1. It may replace generated base STAC types later only after a version
supports the pinned STAC release and passes the same Portolan fixture and type
checks. Even then, runtime validation against the official JSON Schemas remains
required because TypeScript declarations do not validate external JSON.

## Generated human and agent documentation

The pipeline renders `README.md` and `AGENTS.md` from versioned templates.

- Root documentation explains the umbrella catalog, navigation, and preferred
  access methods.
- Collection documentation uses the current Collection name and description and
  explains its providers and licensing policy.
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
descriptive metadata, collection namespace, versions, formats, schemas, quality
summary, provenance, and storage replicas for one file version.

For migrated records, the importer combines dataset/file titles, descriptions,
and category tags from the existing source manifests with richer provider,
keyword, source URL, and date values available in existing data dictionaries.
License references are resolved from dataset/catalog license files. It
normalizes and deduplicates those values before creating the
typed record. Once parity is proven, source manifests are no longer an input for
new publication.

Both Portolan documents and SQLite rows are projections of this model. The
publisher must not generate Portolan, then recursively parse its own JSON to
create SQLite during the normal incremental path.

Normal publication is incremental:

1. Conversion and quality checks produce a candidate version record.
2. The publisher writes all data assets and version-level Portolan files under
   the collection-prefixed path.
3. It downloads the current SQLite database, or creates it for the first run.
4. It applies an idempotent transaction for that version and rebuilds affected
   aggregate rows and FTS entries.
5. It renders the affected file, dataset, collection, and root Catalog documents
   and documentation from the candidate database.
6. It validates the Portolan metadata, database schema, and referential
   integrity.
7. It checkpoints/closes the candidate SQLite database so no WAL sidecar is
   needed, computes its checksum, and conditionally replaces
   `_catalog/catalog.sqlite` with those complete bytes and checksum metadata in
   the same object upload. This is the final runtime publication step.

Catalog publication is serialized with a Dagster concurrency key. The object
write also uses the storage backend's conditional-generation or ETag mechanism
where supported, so stale concurrent writers fail instead of losing updates.

A separate recovery command rebuilds everything by walking the Portolan tree.
That full scan is slower by design and is used for bootstrap, audits, and repair,
not for every new version.

The recovery input is the current Portolan tree, linked typed metadata assets,
and current object metadata, including the file Catalog's latest-version link.
The runtime projection must not contain irreplaceable public identity or selection
facts. Exact partition object paths, revisions, sizes, checksums, and spatial
metadata must be recoverable from declared assets/partition paths and object
footers during this offline rebuild. A rebuild may enumerate those paths;
normal runtime refresh must not. Rebuilding restores the current publication,
not overwritten historical bytes. Conditional-write conflicts require reloading
and rebasing the candidate; a stale writer may not overwrite a newer index.

## SQLite projection

### Database-neutral application boundary

Catalog records and repository operations are independent of the database engine.
Consumers use a typed repository interface for collection/dataset/file discovery,
version and asset resolution, schema, quality, tags, and spatial-resource metadata.
SQL, row decoding, FTS syntax, and connection management belong inside the concrete
adapter, not route handlers or feature-resource projection. SQLite is the initial
adapter, not part of the application-facing repository contract. A PostgreSQL
adapter can later implement the same operations without changing public identities
or response shaping. Contract tests exercise the repository behavior independently
of SQLite-specific artifact validation.

Object download, SQLite PRAGMAs, checksums, local files, and snapshot replacement
remain a separate SQLite lifecycle implementation. A future PostgreSQL deployment
would supply its own connection/transaction lifecycle and publication strategy;
it would not emulate downloading a SQLite file. This requirement does not add an
unused PostgreSQL service, dual writes, or a generic database query language now.
The publisher's normalized typed records remain the portable input; the generated
SQLite artifact is an explicitly engine-specific output projection.

SQLite is read-only outside the publishing pipeline. It contains normalized
tables rather than serialized API responses:

- `catalog_metadata`: schema version, catalog generation, Portolan profile URI,
  created time, and source root.
- `collections`: first-level Portolan Catalogs corresponding to current
  dataset-api Collections, including their Portolan hrefs.
- `datasets`: dataset identity, display metadata, timestamps, and collection
  membership.
- `files`: file/layer identity, display metadata, and dataset relationship. It
  does not contain `layer_name` or `source_file_path` columns.
- `versions`: collection-scoped version path, Portolan href, timestamps, spatial
  classification, native and CRS84 bounds, CRS, geometry column/type, feature
  count, and latest flag derived from the file Catalog.
- `formats`: normalized format definitions and media types.
- `assets`: version/format assets, roles, sizes, checksums, and paths.
- `asset_locations`: canonical and alternate storage locations.
- `asset_objects`: exact catalog-relative objects for each asset, their current
  storage revisions/checksums and sizes, and available partition/covering
  metadata. Equivalent replicas map to the same logical object identity.
- `columns`: ordered schema plus quality/statistical fields.
- `quality`: version-level quality summary and manifest href.
- `tags`: normalized searchable tag key/value rows.
- FTS5 tables for dataset and file name, description, tags, and slugs.

Foreign keys, uniqueness constraints, and indexes enforce the catalog identity
rules. The database is built with a fixed application ID and schema version.
Consumers reject unsupported schema versions before opening it for traffic.

The database does not contain credentials, signed URLs, or environment-specific
secrets. Asset locations are logical, catalog-owned locations that a runtime
storage policy resolves.

### Slug and asset identities

Full collection/dataset/file slug paths are the public catalog identities.
Version labels and STAC asset keys select a representation; a storage-location
slug selects an explicit replica when needed. For example:

```text
file:     hifld/12nm-territorial-sea/12nm-territorial-sea
version:  v1.0.0
asset:    geoparquet
storage:  gcs-hifld-next-datasets-prod
```

An asset may resolve to one object or a complete declared partition set. An
individual-object selector, when needed for a download/preview, is relative to
that catalog asset and must be validated against its approved object list.
Clients never supply arbitrary storage URLs as identities.

Remove public numeric collection, dataset, file, format, source, storage, and
join IDs, as well as numeric lookup routes and `/by-slug` routes. Update webapp,
MCP/WebMCP, source selectors, map descriptors, downloads, OpenAPI, and query-token
schemas together. There is no deterministic numeric-ID generator, `legacy_ids`
table, or permanent ID-mapping file. SQLite may use internal integer join keys,
but those keys never leave the repository boundary and may change on rebuild.

This is an intentional identity-contract change. Existing slug-based page routes
remain stable. Old numeric download links and map descriptors require migration
or an explicit unsupported/stale response; they must not resolve accidentally to
another source. Version the query-token format and make old tokens expire or
fail clearly at cutover. The migration does not promise indefinite support for
numeric API consumers.

## Atomic publication with one SQLite object

There is no separate state-marker object. `_catalog/catalog.sqlite` contains its
application ID, schema version, unique catalog generation, creation time, and
Portolan root reference. The publisher uploads the complete validated database
last. Object replacement exposes either the previous complete database or the
new complete database, eliminating a database/marker mismatch after a crash.

The upload sets content type, content length, and SHA-256 object metadata together
with the bytes. An ETag is a change validator, not assumed to be a checksum.
Consumers use a conditional GET with `If-None-Match`, or HEAD followed by a
generation-addressed/`If-Match` GET, against a server-configured SQLite location.
Downloaded bytes and checksum/size metadata must refer to the same object
revision. A failed precondition triggers a fresh check rather than combining
old metadata with new bytes. GCS and SeaweedFS must both prove these semantics.
No historical SQLite generation is needed for normal cold start or recovery.

On change, download to a temporary path; verify checksum, size, SQLite application
ID, supported schema version, embedded catalog generation, and
`PRAGMA quick_check` before activating it. Record an ETag as active only after
successful validation and activation. A failed candidate remains retryable even
if the remote object has not changed. An unchanged valid object needs no download.

Serve mutable SQLite and STAC metadata with explicit revalidation/no-cache
policies so HTTP caches do not defeat the refresh interval. Credentials and
replica endpoints remain in allowlisted server configuration. Do not infer a
fetch URL from untrusted catalog content.

A consumer retains its old local database while validating a candidate and until
in-flight readers release it. This local overlap supports atomic repository
replacement; it does not require multiple named cloud indexes. At cold start the
consumer loads the latest complete SQLite object. A crash before its upload
leaves the prior index usable; interrupted STAC/data writes are reconciled by the
publisher. SQLite atomicity does not make data overwrites or the static tree a
multi-object transaction.

## Webapp catalog runtime

The webapp adds a server-only catalog repository and lifecycle manager. On
startup it must obtain and validate a usable database before reporting ready.
For local development it can open a configured filesystem path or fetch the
catalog from SeaweedFS. Production fetches the configured SQLite object directly.

The lifecycle manager:

- polls the SQLite object's ETag/generation at a configurable interval;
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
- asset-based ZIP-download redirects for Shapefiles and File Geodatabases;
- sitemap, OpenAPI, agent-discovery, and WebMCP metadata derived from the same
  catalog; and
- slug/asset identities throughout the public contract.

The API's collection list is derived from the umbrella root's first-level
Catalogs, not from leaf objects whose STAC type is `Collection`. This preserves
the existing meaning of `/api/collections/hifld` despite the terminology overlap.

Slug-based browse/detail/page routes and non-identity metadata remain stable
through the cutover. Numeric identity fields/routes are intentionally replaced
as described above; full response-schema parity is not required for those fields.
Select and compare continue in the frontend with slug/asset references. Download
routes resolve version, asset key, and optional storage slug through SQLite and
redirect only to a trusted catalog asset. Non-spatial datasets remain browsable
and downloadable and do not offer spatial feature actions.

The legacy `layer_name` and `source_file_path` response fields remain nullable
during the compatibility window. Phase 1 audits PostgreSQL for non-null values.
If none exist, the webapp returns `null` without adding the fields to SQLite. If
values do exist, they are copied into a narrow temporary compatibility table,
not the canonical `files` table, and retained until removing the public fields
is handled as a separate breaking API change. New records always return `null`.

The server-side `DATASET_API_URL` remains available only during dual-read and
rollback. The final runtime replaces it with catalog SQLite/storage settings.

## Dataset MCP integration

The dataset MCP remains an independently deployed service. Its typed
`CatalogClient` is adapted to the webapp's slug-based API and response envelopes;
this is not only a base-URL change. Remove numeric lookups and `/by-slug` calls.
File detail/version expansion and schema requests use the collection/dataset/file
slug hierarchy. Its base URL moves to the webapp's internal Service URL, keeping
one public response-shaping implementation.

The MCP source resolver remains fail-closed. It verifies collection, dataset,
file, asset, format, version, and storage ownership by slug/asset identity before
returning exact GeoParquet object URIs. The webapp catalog endpoint must expose the
same storage-location and object-list information currently supplied by
`dataset-api`.

The MCP does not query Portolan JSON or SQLite directly in the first migration.
That can be reconsidered only if removing the HTTP dependency provides a measured
benefit. Query source models, tokens, WebMCP schemas, and map descriptors migrate
to the same identities. Bounded SQL execution, result paging, and MVT capability
remain; their source-reference fields change together with the client.

## Freshness and failure behavior

A new or replaced version becomes visible in the runtime catalog when its data,
STAC metadata, and finally the SQLite object have been published in order. No
webapp rebuild or restart is required. The freshness objective is the configured
poll interval plus one database download and validation.

Failure rules are:

- Never replace the SQLite object for a failed catalog build.
- Never swap a consumer to a database with a bad checksum, unsupported schema,
  failed integrity check, or mismatched generation.
- Continue serving the last-known-good local database after a refresh error.
- Fail readiness at cold start if no valid database exists.
- Report catalog staleness without taking a healthy instance out of service
  merely because one refresh attempt failed.
- Treat a missing asset target, invalid Portolan link, or conflicting latest
  version as a publishing failure.

Because both data and the stable SQLite object may be overwritten, rebuilding
restores the current catalog; it cannot reconstruct prior bytes that are no
longer retained. Historical rollback requires explicitly retained data and
metadata backups or upstream re-acquisition. Optional provider versioning may
offer a short recovery window but is not an application guarantee. A previous
local catalog snapshot preserves metadata availability, not historical asset
availability. A changed asset must be refreshed or fail with a bounded stale
source error rather than being served under a mismatched schema/revision.

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
5. Validation of each typed metadata asset against its own pinned schema.
6. SQLite schema, integrity, foreign-key, FTS, latest-version, and response-shape
   validation.
7. HTTP probes for CORS and byte-range support on canonical cloud-native assets.
8. When a TypeScript STAC reader exists, validation of its generated declarations
   and adapter against representative Catalog and Collection fixtures carrying
   every pinned extension.

The existing conversion and quality checks remain authoritative. Portolan's data
validator adds conformance checks; it does not replace HIFLD's domain-specific
quality policy.

## Migration and cutover

### Phase 1: contract capture

Capture representative `dataset-api` responses for all public routes, including
multiple files, multiple versions, every supported format, partitioned
GeoParquet, missing optional metadata, failed quality, and multiple storage
locations. Inventory numeric-ID consumers for the coordinated slug migration;
do not export IDs as a permanent catalog dependency. Audit whether any
`layer_name` or `source_file_path` value is non-null before deciding whether the
temporary legacy-field table is required.

### Phase 2: dual publication

Add typed Portolan and SQLite projections to `hifld-next-datasets` while keeping
the current discovery jobs. Seed the normalized records from existing source
manifests and data dictionaries, and verify title, description, keyword,
provider, source-link, license-file, and date mappings before publication. Copy
every
existing data object and retained metadata object from
`{dataset_slug}/{file_slug}/{version}/...` to
`{collection_slug}/{dataset_slug}/{file_slug}/{version}/...` using server-side
object copies where available, and verify size and checksum before publishing
any Portolan link to the new key. Do not copy `source_manifest.json` into the
canonical prefixed path. During this phase, newly published versions continue to
write source manifests only to the old unprefixed path while also writing the new
canonical Portolan metadata, so the old discovery job remains a valid rollback
source.

The canonical Portolan tree and shadow SQLite database reference only the new
prefixed keys. Old keys are temporary rollback copies, not Portolan alternate
assets. Validate the generated catalog against the captured database for
completeness and slug/asset identity parity, including at least two collection
namespaces
with intentionally repeated dataset and file slugs.

Before running this against the full production inventory, pass the shared local
SeaweedFS acceptance workflow. The selected production GeoPackages must travel
from legacy unprefixed keys through Dagster conversion, quality checks, canonical
promotion, Portolan generation, SQLite projection, and live consumer refresh.
This is the executable small-scale proof of the same namespace migration; it is
not a separate mock publishing path.

### Phase 3: webapp dual read

Add the SQLite repository behind a runtime switch. In shadow mode, serve existing
responses from `dataset-api`, query SQLite in parallel for sampled requests, and
record semantic differences without logging sensitive values. Compare via
canonical slug/asset identities, excluding deliberately removed numeric fields.
Resolve unexplained differences or document intentional ordering changes.

### Phase 4: consumer cutover

Make SQLite the webapp source of truth, deploy the adapted slug-based MCP client
against the webapp catalog API, and verify downloads, schema pages, compare,
maps, MCP search, MCP source resolution, and sitemap generation. Retain the
dataset API as a rollback target
for a bounded observation window. Rollback must restore a compatible consumer
release/adapter as well as its backend; the old numeric API is not a drop-in
endpoint for the new slug-based client.

### Phase 5: retirement

Remove the `dataset-api` and `dataset-discovery` Helm releases, PostgreSQL catalog
resources, discovery/config CronJobs, database migrations, and deployment
workflow steps. Remove `DATASET_API_URL` after rollback is formally closed. Also
remove source-manifest generation, resolution, seeding, and maintenance support
after the canonical Portolan projection has passed parity checks.

Continue dual writes throughout the bounded rollback window so `dataset-api`
remains a complete rollback target. After rollback formally closes, stop writing
unprefixed keys and remove the old unprefixed objects using an explicit, reviewed
inventory produced during Phase 2. The prefixed objects are the only durable
copies, so the temporary migration overlap does not become an ongoing storage
cost.

The `dataset-api/` source can be deleted in the same retirement change or kept
for one release as non-deployed reference code. It must not remain an active
second writer.

## Verification and acceptance criteria

- Every published root, Catalog, and Collection validates against the pinned
  Portolan and STAC versions.
- Every existing logical dataset/file/version appears exactly once in Portolan
  and SQLite.
- Every Portolan Collection ID begins with its immutable collection slug, and
  identical dataset/file/version slugs in different collections remain distinct.
- Shapefile, GeoPackage, File Geodatabase, GeoJSON, GeoParquet, and PMTiles
  downloads remain available with correct media types and roles.
- Every Shapefile and File Geodatabase representation exposes exactly one ZIP
  asset and no exploded component assets.
- Schema, quality, feature count, bounds, CRS, geometry type, tags, provenance,
  and all storage replicas survive migration.
- Existing source-manifest titles and descriptions appear at the appropriate
  Catalog and Collection levels; category tags appear as Catalog/Collection
  keywords and retain their existing compatibility API behavior.
- Canonical collection paths contain no `source_manifest.json`, and no Portolan
  object advertises either a source-manifest or GeoParquet-layout asset.
- Portolan objects contain no custom HIFLD fields or HIFLD extension declaration;
  identity comes from the hierarchy, descriptive and provenance metadata use
  standard fields and links, and detailed quality/schema information comes from
  typed metadata assets.
- Search and tag-filter result sets match the current API for the captured
  fixtures; pagination order is deterministic.
- Slug-based catalog/page routes preserve non-identity metadata and navigation;
  numeric fields/routes and `/by-slug` usage are removed in all consumers.
- Rebuilding SQLite from current catalog assets preserves slug/asset identities
  and latest selection without PostgreSQL or a numeric-ID mapping.
- Non-spatial and all-null-geometry datasets retain catalog/download coverage
  and are not advertised as spatial OGC collections.
- STAC extents are CRS84 while storage CRS and native bounds remain accurate;
  no API feature-ID column is added to converted Parquet.
- Applicable dataset/catalog license files resolve through explicit Collection
  links; missing legacy license fields do not block publication.
- Dataset MCP can search, inspect schema, resolve trusted GeoParquet sources, run
  a bounded query, page results, and render a tile after cutover.
- Publishing a new or replaced version updates a running webapp within the
  configured refresh interval without rebuilding or restarting it.
- A corrupt or partially published database never replaces the active
  last-known-good database.
- A publisher interruption before SQLite replacement leaves cold-start consumers
  able to load the prior complete index. After replacement they load the new one
  without a separate marker. Conditional metadata/download races retry safely.
- GCS production and SeaweedFS local-development catalog refreshes both pass.
- The SeaweedFS acceptance bootstrap verifies pinned production object
  generations, sizes, and checksums and requires no production write access.
- The four default GeoPackage fixtures cover point, line, and polygon data;
  multiple datasets; and sibling files within one dataset while keeping the
  downloaded source set below approximately 75 MiB.
- Local Dagster reads fixture bytes from SeaweedFS and writes canonical
  GeoPackage, GeoParquet, PMTiles, Shapefile ZIP, metadata, Portolan, and SQLite
  objects back through SeaweedFS storage APIs.
- After the initial promotion, the webapp can browse, search, compare, inspect
  schema/quality metadata, download the canonical GeoPackage, and resolve map
  assets using only the SeaweedFS-backed catalog.
- Promoting the held-back dataset while the webapp and feature server remain
  running advances the catalog generation and makes it available within the TTL
  without a restart; initial unchanged versions remain available.
- A separate overwrite wave replaces an existing fixture under the same version
  label, updates object revisions and metadata, and refreshes running consumers
  without assuming historical bytes remain accessible.
- Additional small tabular and multi-partition cases verify non-spatial catalog
  coverage and object-set identities beyond the four spatial baseline fixtures.
- Repeating bootstrap and promotion is idempotent, and failed acceptance runs
  retain their dedicated bucket for inspection rather than deleting broad
  prefixes.
- No runtime component performs a recursive object-storage discovery scan during
  normal startup or refresh.
- The webapp contains no handwritten duplicate of the STAC or Portolan JSON
  Schemas; any TypeScript STAC reader validates with the pinned official schemas
  before adapting a document into application models.
- Object storage contains one named SQLite index, not an accumulating generation
  directory.
- No Portolan link or SQLite asset row refers to an unprefixed rollback key after
  migration, and every legacy object selected for cleanup has a checksum-matched
  canonical copy.

## Risks and mitigations

### Portolan stability

Portolan is evolving before 1.0. Pin the schema URI and validator version, keep
the projection isolated in the pipeline, and treat upgrades like data-contract
migrations.

### Static-catalog update consistency

Multiple parent Catalog JSON files cannot change in one object-store transaction.
New links target already-uploaded objects. Replacements can temporarily expose
stale metadata or mixed revisions across the static tree; the publisher validates
and reconciles the final tree and does not claim multi-object atomicity. Internal
services switch catalog snapshots only after validating the replaced SQLite
object. Asset readers independently detect revision changes and invalidate caches
or fail stale requests instead of assuming a metadata snapshot freezes the bytes.

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

### Identity-contract migration

Public identities become slug paths plus version/asset keys and optional storage
slugs. Coordinate all consumers, token schemas, map links, and download routes.
Old numeric references may stop working; do not silently reinterpret them or
retain numeric generation/mapping as a permanent requirement.

### Collection-prefix migration

Adding the collection namespace changes every existing object key, and object
storage implements that change as copy plus later deletion. Use a generated,
reviewable migration inventory, server-side copies, checksum verification, dual
publication only during the rollback window, and explicit cleanup approval.
Never infer deletion targets from a broad bucket prefix. Monitor temporary
duplicate bytes so the rollback window cannot silently become permanent.

## Result

HIFLD keeps the useful parts of its existing system—its frontend, slug-based API,
dataset MCP, format coverage, quality metadata, schemas, versions, and storage
selection—while removing the duplicate database-backed cataloging authority.
Portolan becomes the interoperable catalog on object storage, SQLite provides
fast local indexing, and Dagster is the only normal writer of catalog truth.

## References

- [Portolan core specification](https://github.com/portolan-sdi/portolan-spec/blob/main/specs/portolan/core.md)
- [Portolan format requirements](https://github.com/portolan-sdi/portolan-spec/blob/main/specs/portolan/formats.md)
- [Portolan STAC profile](https://github.com/portolan-sdi/portolan-spec/blob/main/stac/README.md)
- [STAC specification](https://github.com/radiantearth/stac-spec)
- [STAC Node Validator](https://www.npmjs.com/package/stac-node-validator)
- [`stac-ts`](https://github.com/blacha/stac-ts)
- [`json-schema-to-typescript`](https://github.com/bcherny/json-schema-to-typescript)
