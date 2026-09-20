# ClickHouse Storage-Agnostic Feature Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve catalog-approved OGC Features through ClickHouse using a typed, storage-neutral catalog source registry.

**Architecture:** The feature server continues to project its read-only SQLite catalog to pygeoapi resources. A dedicated source resolver turns a catalog storage location plus exact object keys into an immutable ClickHouse source spec; a ClickHouse provider emits only fixed catalog-derived count/page/item SQL and converts result rows to OGC features. The MCP HTTP service remains out of this path.

**Tech Stack:** Python 3.12, Starlette, pygeoapi, ClickHouse HTTP, SQLGlot, Pydantic, pytest.

---

### Task 1: Add a typed feature-server storage registry

**Files:**
- Create: `feature-server/app/storage/registry.py`
- Modify: `feature-server/app/catalog/snapshot.py`
- Test: `feature-server/tests/test_storage_registry.py`

- [ ] **Step 1: Write failing GCS and SeaweedFS resolver tests**

```python
def test_resolver_returns_only_configured_gcs_object_urls() -> None:
    resolver = StorageRegistry.from_json('{"gcp":{"type":"gcs","bucket":"data"}}')
    assert resolver.resolve("gcp", ("hifld/a.parquet",)).object_uris == ("gs://data/hifld/a.parquet",)

def test_resolver_rejects_unregistered_storage_location() -> None:
    resolver = StorageRegistry.from_json("{}")
    with pytest.raises(StorageResolutionError):
        resolver.resolve("missing", ("hifld/a.parquet",))
```

- [ ] **Step 2: Run the resolver tests and confirm they fail**

Run: `UV_CACHE_DIR=/private/tmp/hifld-portolan-uv-cache uv run pytest tests/test_storage_registry.py -q`

Expected: FAIL because `StorageRegistry` does not exist.

- [ ] **Step 3: Implement immutable registry models and strict resolution**

```python
@dataclass(frozen=True, slots=True)
class ClickHouseSource:
    object_uris: tuple[str, ...]
    seaweed_endpoint: str | None = None

class StorageRegistry:
    def resolve(self, slug: str, object_keys: tuple[str, ...]) -> ClickHouseSource: ...
```

Require exact configured bucket and prefix, reject URI components/traversal, map public GCS to `gs://`, and map SeaweedFS to `s3://` plus a server-owned endpoint.

- [ ] **Step 4: Project records as storage-neutral source fields**

Add `storage_location_slug` and `object_keys` to the provider definition; do not put resolved URLs or credentials in the SQLite catalog or public OGC response.

- [ ] **Step 5: Run resolver and projection tests**

Run: `UV_CACHE_DIR=/private/tmp/hifld-portolan-uv-cache uv run pytest tests/test_storage_registry.py tests/test_catalog_projection.py -q`

Expected: PASS.

### Task 2: Implement the bounded ClickHouse OGC provider

**Files:**
- Create: `feature-server/app/provider/clickhouse_provider.py`
- Modify: `feature-server/app/asgi.py`
- Modify: `feature-server/pyproject.toml`
- Test: `feature-server/tests/test_clickhouse_provider.py`

- [ ] **Step 1: Write failing provider tests with a fake bounded executor**

```python
def test_provider_uses_catalog_native_identifier() -> None:
    provider = provider_for("objectid")
    assert provider.query(limit=1)["features"][0]["id"] == "7"

def test_provider_generated_id_is_stable_for_multipart_source() -> None:
    provider = provider_for(None, objects=("hifld/a.parquet", "hifld/b.parquet"))
    page = provider.query(limit=2)
    assert provider.get(str(page["features"][1]["id"])) == page["features"][1]
```

- [ ] **Step 2: Run provider tests and confirm they fail**

Run: `UV_CACHE_DIR=/private/tmp/hifld-portolan-uv-cache uv run pytest tests/test_clickhouse_provider.py -q`

Expected: FAIL because the ClickHouse provider does not exist.

- [ ] **Step 3: Implement catalog-only SQL construction and row conversion**

Generate quoted identifier/literal SQL only from provider metadata plus parsed OGC controls. Apply native ID predicates when available; otherwise select a physical filename and row number, then encode/decode `FeatureId`. Execute count and bounded page calls with the existing ClickHouse timeout, concurrency, memory, and cancellation policy. Convert WKB/geometry results to GeoJSON in CRS84.

- [ ] **Step 4: Replace the pygeoapi provider name at snapshot activation**

Use `app.provider.clickhouse_provider.ClickHouseGeoParquetProvider`; inject the registry and executor through server-owned application configuration. Keep collection identity and route structure unchanged.

- [ ] **Step 5: Run focused provider and integration tests**

Run: `UV_CACHE_DIR=/private/tmp/hifld-portolan-uv-cache uv run pytest tests/test_clickhouse_provider.py tests/test_asgi_catalog_integration.py -q`

Expected: PASS.

### Task 3: Configure deployment and verify both storage types

**Files:**
- Modify: `feature-server/Dockerfile`
- Modify: `feature-server/README.md`
- Modify: `docker-compose.yaml`
- Modify: `charts/feature-server/values.yaml`
- Modify: `charts/feature-server/templates/deployment.yaml`
- Modify: `ops/gcp-portolan.env.example`
- Modify: `ops/local-portolan.env.example`
- Test: `feature-server/tests/test_asgi_catalog_integration.py`

- [ ] **Step 1: Add failing settings/configuration tests**

```python
def test_gcp_environment_uses_the_same_storage_registry_shape_as_mcp() -> None:
    settings = parse_environment(GCP_ENVIRONMENT)
    assert settings.storage_locations["gcp-portolan-published"].type == "gcs"
```

- [ ] **Step 2: Run the settings test and confirm it fails**

Run: `UV_CACHE_DIR=/private/tmp/hifld-portolan-uv-cache uv run pytest tests/test_asgi_catalog_integration.py -q`

Expected: FAIL until the feature server accepts the registry configuration.

- [ ] **Step 3: Pass one JSON registry and ClickHouse credentials/configuration through local and Helm deployment**

Use `FEATURE_SERVER_STORAGE_LOCATIONS`, `FEATURE_SERVER_CLICKHOUSE_URL`, bounded limit/timeout/memory settings, and separately secret-backed ClickHouse credentials. Remove provider-specific GCS/S3 environment switches.

- [ ] **Step 4: Update the service README**

Document that the catalog selects a location slug, deployments resolve it through the registry, and ClickHouse is the only GeoParquet query engine.

- [ ] **Step 5: Run all feature-server quality gates**

Run:

```sh
UV_CACHE_DIR=/private/tmp/hifld-portolan-uv-cache uv run ruff check .
UV_CACHE_DIR=/private/tmp/hifld-portolan-uv-cache uv run ruff format --check .
UV_CACHE_DIR=/private/tmp/hifld-portolan-uv-cache uv run pyright
UV_CACHE_DIR=/private/tmp/hifld-portolan-uv-cache uv run basedpyright
UV_CACHE_DIR=/private/tmp/hifld-portolan-uv-cache uv run pytest
```

Expected: all commands exit 0.

### Task 4: Run local end-to-end checks

**Files:**
- No source changes required.

- [ ] **Step 1: Build the feature-server image and start ClickHouse**

Run: `docker compose --profile feature-server up -d --build clickhouse feature-server`

Expected: `/healthz` returns 204 and `/readyz` returns a catalog generation.

- [ ] **Step 2: Check the public GCS Portolan catalog through OGC**

Run:

```sh
curl -fsS http://127.0.0.1:8003/readyz
curl -fsS 'http://127.0.0.1:8003/collections?f=json'
curl -fsS 'http://127.0.0.1:8003/collections/<native-id-collection>/items?limit=2&f=json'
curl -fsS 'http://127.0.0.1:8003/collections/<generated-id-collection>/items?limit=2&f=json'
```

Expected: ready service, catalog-derived collections, native IDs when declared, and stable generated IDs otherwise.

- [ ] **Step 3: Check local SeaweedFS catalog selection**

Run: `source ops/local-portolan.env.example && docker compose --profile feature-server up -d feature-server`

Expected: an activated local catalog and no storage-specific code changes.
