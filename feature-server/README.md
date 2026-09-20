# HIFLD Next feature server

This service exposes catalog-approved spatial GeoParquet through OGC API - Features.
It reads `_catalog/catalog.sqlite` as a publisher-owned, immutable snapshot and never
accepts client-supplied storage paths or SQL.

Feature queryables come from the catalog's source dictionary. Reads support
offset/limit pagination, CRS84 bounding boxes, scalar property equality filters,
and native or revision-bound generated feature IDs. CQL expressions are not
implemented and must be rejected, not silently treated as unfiltered requests.
The service is read-only; only implemented capabilities are advertised.

`FEATURE_SERVER_STORAGE_LOCATIONS` is a JSON registry keyed by the catalog's
storage-location slug. Each entry is either a public GCS location
(`{"type":"gcs","bucket":"...","prefix":"hifld"}`) or a SeaweedFS
location (`{"type":"seaweedfs","bucket":"...","prefix":"hifld",
"endpoint_url":"https://..."}`). The process resolves only catalog object keys
through this registry; no client supplies a URI, endpoint, or credential. This
is the same storage boundary used by Dataset MCP.

`pygeoapi==0.24.0` and `duckdb==1.5.5` are intentionally exact pins. Build the image
to preinstall DuckDB `httpfs` and `spatial`; requests only `LOAD` those extensions.

Run checks:

```sh
uv sync --all-groups
uv run ruff check .
uv run ruff format --check .
uv run pyright
uv run basedpyright
uv run pytest
```

Required environment includes `FEATURE_SERVER_STORAGE_LOCATIONS` and either
`FEATURE_SERVER_CATALOG_URL` (direct compatibility mode) or
`FEATURE_SERVER_CATALOG_POINTER_URL` (the preferred immutable-release mode).
When a pointer is configured, the server validates its generation-scoped SQLite
key, size, SHA-256, and embedded catalog generation before activation. A failed
refresh keeps the last known-good snapshot active. The process is ready only
after it validates and activates a catalog.
