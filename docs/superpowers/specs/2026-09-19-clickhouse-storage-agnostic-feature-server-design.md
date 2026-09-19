# ClickHouse-backed, storage-agnostic feature server

## Goal

Serve catalog-approved spatial assets through OGC API Features without making
the OGC API depend on a particular object store.

## Decision

Keep the feature server's existing responsibilities:

- It downloads and validates the published `_catalog/catalog.sqlite` snapshot.
- It projects only `spatial` catalog versions to OGC collections.
- It owns OGC API Features request parsing, response shaping, conformance, and
  generated IDs where no source identifier exists.

Keep the DuckDB provider for OGC Features. It is the current reader that
exposes a stable physical row ordinal for a GeoParquet file, which is required
to implement retrieval-safe generated OGC IDs when a source has no identifier.
The MCP HTTP API and ClickHouse engine remain separate user-authored query and
tile interfaces; neither is in the OGC request path.

The production catalog has 515 spatial versions and all need generated IDs.
ClickHouse exposes a source path but no durable Parquet row ordinal; window and
block row counters change with execution order, pagination, or parallelism.
Using it as the OGC provider would make `/items/{id}` unreliable.

## Storage boundary

The catalog records a storage-location slug and exact object keys. A new
storage resolver will map that pair to a typed, server-configured source:

- `gcs` maps an approved public bucket/object key to the ClickHouse GCS source
  syntax.
- `seaweedfs` maps an approved S3-compatible bucket/object key plus
  server-owned endpoint/credentials to the ClickHouse S3 source syntax.
- An unknown storage type, foreign bucket, traversal, credentials, query
  string, or an object outside the configured prefix fails before SQL is built.

The OGC provider receives this typed source object; it does not interpret
environment variables or concatenate client input into storage URLs. This is
the same separation used by `dataset-mcp/app/storage/resolver.py`, adapted to
DuckDB source declarations.

## OGC operations and identity

`/collections`, collection detail, and queryables continue to come from the
catalog snapshot. `items` accepts `limit`, `offset`, `bbox`, and catalog schema
property equality filters. The provider emits CRS84 geometries and runs the
count and page under existing ClickHouse limits and cancellation.

When a catalog version declares `feature_id_column` (`id` or `objectid`), that
column is selected and used for the OGC item ID. Otherwise, page SQL must
return the physical input filename and per-file row number and encode the
existing revision-bound `(asset fingerprint, logical object key, row number)`
identifier. Item lookup validates and decodes that identifier, then applies an
exact filename/row predicate. Consequently, filtering, pagination, and
multipart files cannot change an identifier.

## Reuse and limits

The feature server uses the same catalog location-registry pattern as MCP but
keeps DuckDB-specific feature identity logic. ClickHouse continues to provide
the hardened MCP query and tile path. Do not forward OGC requests to MCP or
duplicate its HTTP API.

Feature-server deployment gains a typed storage-location configuration matching
the MCP registry. Local SeaweedFS and the temporary public GCS catalog are both
configured through that registry. Docker and Helm pass the registry; no
backend-specific GCS/S3 variables should be required by the provider.

## Verification

Tests must cover catalog projection and storage resolution for GCS and
SeaweedFS, reject unconfigured or unsafe locations, verify native and generated
item IDs across multipart sources, and assert bounded OGC SQL is compiled only
from catalog values. Existing feature-server tests must still cover OGC
responses. A local smoke test uses the public GCS Portolan catalog plus the
local ClickHouse service and checks readiness, collection listing, a native-ID
item page, a generated-ID item page, and a multipart collection.

## Non-goals

- No new dynamic SQL endpoint or MCP token requirement for OGC clients.
- No modification of GeoParquet files to add IDs.
- No storage credentials in catalog files or OGC responses.
- Tiles are deferred to a follow-up after core OGC Features parity is verified.
