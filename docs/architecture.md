# HIFLD Next architecture

## Catalog publication

Dagster in the publisher repository ingests original datasets, converts supported
formats, computes quality/schema metadata, and promotes immutable version assets.
It renders Portolan STAC documents and a derived SQLite catalog, then atomically
selects the complete catalog generation with `_catalog/current.json`.

Production published storage is `hifld-next-datasets-prod`; staging is
`hifld-next-staging-prod`. The canonical published storage slug is
`gcs-hifld-next-datasets-prod`. Source formats and quality/schema/provenance
metadata remain available; retiring the old discovery service does not remove
the manifests used by the publisher.

## Serving

- The TanStack Start webapp reads the selected SQLite catalog and STAC documents
  for browsing, search, schemas, version comparison, downloads and STAC APIs.
- Dataset MCP calls the webapp's slug-based catalog API. ClickHouse executes
  supported spatial queries; the MCP service serves authenticated query tiles
  and its map application.
- The feature server reads the same release pointer independently. Its pygeoapi
  resources use a custom DuckDB provider over the catalog's approved GeoParquet
  assets.
- Webapp and feature server initialize their catalog snapshot on startup and
  refresh in-process. A complete new catalog becomes visible without restarting;
  refresh failures retain the last usable snapshot.
- The public HTTPS load balancer routes browser/API, MCP, feature-server and
  published-storage requests. Storage registries constrain trusted locations.

## Local and operational boundaries

SeaweedFS remains the local object-storage backend. ClickHouse and the optional
feature-server Compose profile use local storage; the host webapp/MCP can use
the same published catalog.

Terraform and Helm in the infrastructure repository manage GKE, load-balancer
routing, storage and identities. Dagster retains its own durable run/partition
state and PostgreSQL database. The former catalog database and credentials are
preserved pending a separately approved data-retention decision; they are not
serving dependencies of this architecture.

The application repository publishes webapp, MCP, ClickHouse and feature-server
images. Runtime browser configuration is served dynamically; catalog URLs,
storage policy and credentials remain server-only.

The retired API/discovery runtime, GeoServer schemas and one-off migration
writers are absent from active application code. Historical specs and cutover
reports remain an audit trail, not current deployment instructions. See
[the retirement guide](legacy-retirement.md) for rollout order and verification.
