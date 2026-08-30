# Dataset MCP App Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public, stateless FastMCP Apps server that exposes catalog metadata, bounded server-side DuckDB queries over trusted GeoParquet sources, interactive result tables, and bbox-constrained maps.

**Architecture:** A new `dataset-mcp/` service wraps the existing read-only catalog HTTP API and resolves catalog source identities into server-managed storage profiles. FastMCP tools call a bounded DuckDB worker process; signed self-contained tokens carry query state between stateless page and tile requests. A single-file React MCP App renders the initial query page directly, calls model-and-app-visible paging tools through the host bridge, and uses MapLibre for server-generated MVT.

**Tech Stack:** Python 3.12, FastMCP, FastAPI/Starlette, Pydantic v2, HTTPX, DuckDB with bundled `httpfs` and `spatial` extensions, SQLGlot, pytest, React 19, TypeScript, Zod, TanStack Table/Virtual, MapLibre GL JS, Vite, Vitest, Biome, Docker, and Helm.

---

## Source documents and fixed decisions

- Design spec: `docs/superpowers/specs/2026-08-29-dataset-mcp-app-server-design.md`.
- Webapp metadata-parity contracts:
  - `GET /api/collections`
  - `GET /api/collections/{collectionSlug}`
  - `GET /api/collections/{collectionSlug}/datasets/{datasetSlug}`
  - `GET /api/collections/{collectionSlug}/datasets/{datasetSlug}/files/{fileSlug}`
  - `GET /api/collections/{collectionSlug}/datasets/{datasetSlug}/files/{fileSlug}/schema`
- Internal `dataset-api` contracts the MCP service actually calls:
  - `GET /api/collections` and `GET /api/collections/{collection_id}`
  - `GET /api/collections/{collection_id}/datasets`
  - `GET /api/collections/{collection_id}/datasets/{dataset_id}/files`
  - `GET /api/collections/{collection_id}/datasets/by-slug/{dataset_slug}/files`
  - `GET /api/collections/{collection_id}/datasets/{dataset_id}/files/{file_id}`
  - `GET /api/collections/{collection_id}/datasets/by-slug/{dataset_slug}/files/{file_slug}`
  - `GET /api/collections/{collection_id}/datasets/{dataset_id}/files/{file_id}/versions`
- Existing response schemas: `webapp/src/lib/openapi/spec.ts`.
- Existing source models: `dataset-api/models/dataset.py`.
- Tile spike code to copy and harden:
  `../geoparquet-duckdb-partitioning/server.py`,
  `../geoparquet-duckdb-partitioning/duckdb_parquet_provider.py`, and
  `../geoparquet-duckdb-partitioning/metrics.py`.
- FastMCP custom app API: https://gofastmcp.com/apps/low-level
- FastMCP stateless HTTP deployment: https://gofastmcp.com/v2/deployment/http
- MCP Apps React lifecycle: https://github.com/modelcontextprotocol/ext-apps/blob/main/src/react/useApp.tsx

The implementation must not add Valkey, query-result storage, DuckDB-Wasm, direct iframe access to cloud GeoParquet, user-supplied storage URLs, authentication, or GeoServer coupling.

### Spike reuse matrix

Copy the working spike code first, then adapt it behind the production
contracts. Do not rewrite these algorithms from memory.

| Spike source | Copy into | Preserve | Replace or add |
| --- | --- | --- | --- |
| `duckdb_parquet_provider.py:get_connection` | `query_worker/runtime.py` | one long-lived connection per execution owner; warm extension/footer state | one connection per worker process; preinstalled `LOAD` only; locked config; no module-global server connection |
| `duckdb_parquet_provider.py:_bbox_predicate` | `query_worker/tiles.py` | GeoParquet 1.1 bbox overlap ordering and bound parameters | validated quoted bbox identifier; typed four-number bbox; exact geometry intersection after pruning |
| `server.py:_TILE_SQL_TEMPLATE` | `query_worker/tiles.py` | `ST_TileEnvelope`, bounds CTE, transform, `ST_AsMVTGeom`, `ST_AsMVT` | request query as inner relation; validated CRS; clipping; feature/byte caps; no fixed `counties` view |
| `server.py:tile` | `app/http/tiles.py` | z/x/y validation, MVT MIME, 204 empty response | signed token, source revalidation, worker timeout, CORS, stable errors |
| `metrics.py:init_connection` and `measure` | `query_worker/metrics.py` | profiling setting order, warm-up query, `fetchall` flush, bytes/latency/wall metrics | typed metrics dataclass, worker-owned temp path, safe error code, cleanup, no `Any` or raw error text |

Do not copy `pygeoapi` integration, catalog mutation/admin routes, direct source
strings, runtime `INSTALL`, global views, direct f-string identifiers, exact
counts, or broad typing. Keep a short provenance comment above each adapted
block naming the spike file/function so later performance work can compare the
implementations.

## Parallel execution contract

Use one git worktree and branch per agent. Never run two writing agents in the same worktree. Each agent starts from the integration branch commit named in its prompt and returns:

1. commit SHA;
2. exact changed-file list;
3. targeted test commands and results;
4. known limitations or follow-up risks.

The coordinator reviews each diff before cherry-picking it. A worker may edit only the files assigned to its task. If a required shared contract is wrong, the worker stops and reports the mismatch rather than editing another lane's files.

Create the integration branch and Wave 1 worktrees with:

```bash
git switch -c feat/dataset-mcp-integration
git worktree add ../hifld-next-worktrees/dataset-mcp-catalog -b feat/dataset-mcp-catalog feat/dataset-mcp-integration
git worktree add ../hifld-next-worktrees/dataset-mcp-security -b feat/dataset-mcp-security feat/dataset-mcp-integration
git worktree add ../hifld-next-worktrees/dataset-mcp-storage -b feat/dataset-mcp-storage feat/dataset-mcp-integration
git worktree add ../hifld-next-worktrees/dataset-mcp-ui-bridge -b feat/dataset-mcp-ui-bridge feat/dataset-mcp-integration
```

After a wave is reviewed and integrated, create the next wave's branches from
the updated `feat/dataset-mcp-integration` head. Do not reuse a prior wave's
branch as the base.

Each task section below is the focused subagent prompt. Prepend only the base
commit SHA and this instruction: “Use TDD, edit only the listed files, run the
listed gates, make the listed commit, and return the four-item execution
report.” Do not give a subagent the full conversation history.

### Dependency waves

| Wave | Run mode | Tasks |
| --- | --- | --- |
| 0 | Serial | Task 1 foundation, then Task 2 shared contracts |
| 1 | Parallel | Task 3 catalog; Task 4 SQL/token; Task 5 storage; Task 6 UI bridge |
| 2 | Parallel after Wave 1 integration | Task 7 worker/query service; Task 8 discovery tools; Task 9 table UI; Task 10 deployment skeleton |
| 3 | Parallel after Task 7 integration | Task 11 query tools; Task 12 tile HTTP; Task 13 map UI |
| 4 | Serial integration | Task 14 application assembly; Task 15 security/integration/performance verification |

Tasks 3–6 own disjoint files. Tasks 7–10 own disjoint files. Tasks 11–13 own disjoint files. Only Tasks 1, 2, 14, and 15 may change shared package entry points.

## Planned file structure

```text
dataset-mcp/
  app/
    __init__.py
    config.py
    errors.py
    http_app.py
    mcp_server.py
    observability.py
    catalog/
      client.py
      models.py
      shaping.py
      source_resolver.py
    query/
      models.py
      serialization.py
      service.py
      sql_policy.py
      token_codec.py
    storage/
      models.py
      resolver.py
    tools/
      discovery.py
      query.py
    http/
      tiles.py
  query_worker/
    metrics.py
    pool.py
    protocol.py
    runtime.py
    tiles.py
  tests/
    contract_fixtures/
    integration/
    security/
    test_catalog_client.py
    test_config.py
    test_discovery_tools.py
    test_http_app.py
    test_query_service.py
    test_query_tools.py
    test_serialization.py
    test_source_resolver.py
    test_sql_policy.py
    test_storage_resolver.py
    test_tiles.py
    test_token_codec.py
    test_worker_pool.py
    test_worker_runtime.py
  ui/
    src/
      components/
        DatasetExplorer.tsx
        ErrorPanel.tsx
        MapView.tsx
        ResultTable.tsx
      mcp/
        contracts.ts
        useMcpApp.ts
      App.tsx
      main.tsx
      styles.css
    tests/
      App.test.tsx
      MapView.test.tsx
      ResultTable.test.tsx
      contracts.test.ts
      setup.ts
    biome.json
    index.html
    package.json
    package-lock.json
    tsconfig.json
    vite.config.ts
  Dockerfile
  README.md
  pyproject.toml
  uv.lock
charts/dataset-mcp/
  Chart.yaml
  values.yaml
  templates/_helpers.tpl
  templates/deployment.yaml
  templates/ingress.yaml
  templates/networkpolicy.yaml
  templates/service.yaml
  templates/serviceaccount.yaml
.github/workflows/dataset-mcp-quality.yml
```

## Task 1: Scaffold the service and quality gates

**Owner:** Foundation agent, serial.

**Files:**
- Create: `dataset-mcp/pyproject.toml`
- Create: `dataset-mcp/uv.lock`
- Create: `dataset-mcp/app/__init__.py`
- Create: `dataset-mcp/app/config.py`
- Create: `dataset-mcp/app/errors.py`
- Create: `dataset-mcp/tests/test_config.py`
- Create: `dataset-mcp/ui/package.json`
- Create: `dataset-mcp/ui/package-lock.json`
- Create: `dataset-mcp/ui/tsconfig.json`
- Create: `dataset-mcp/ui/biome.json`
- Create: `dataset-mcp/ui/vite.config.ts`
- Create: `dataset-mcp/ui/index.html`
- Create: `dataset-mcp/ui/tests/setup.ts`

- [ ] **Step 1: Create the Python package and install locked dependencies**

Run:

```bash
mkdir -p dataset-mcp/app dataset-mcp/tests dataset-mcp/ui
cd dataset-mcp
uv init --bare --python 3.12
uv add fastmcp fastapi "uvicorn[standard]" httpx pydantic-settings duckdb "sqlglot[rs]"
uv add --dev pytest pytest-asyncio respx ruff pyright basedpyright
```

Add Ruff and both type-checker configurations to `pyproject.toml`. Include `app` and `query_worker`, exclude tests from static typing, set Python 3.12, and make unknown parameter types, missing type arguments, and untyped decorators errors. Do not add `Any` or broad ignores.

- [ ] **Step 2: Write the failing settings test**

```python
from app.config import Settings


def test_settings_require_catalog_and_token_secret() -> None:
    settings = Settings(
        catalog_base_url="http://dataset-api:8000",
        query_token_secret="x" * 32,
    )

    assert str(settings.catalog_base_url) == "http://dataset-api:8000/"
    assert settings.query_default_limit == 100
    assert settings.query_max_limit == 1_000
    assert settings.worker_count == 1
```

Run: `cd dataset-mcp && uv run pytest tests/test_config.py -q`  
Expected: FAIL because `app.config` does not exist.

- [ ] **Step 3: Implement typed settings and stable errors**

Create `app/config.py` with this public shape:

```python
from pydantic import AnyHttpUrl, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="DATASET_MCP_", extra="forbid")

    catalog_base_url: AnyHttpUrl
    query_token_secret: SecretStr = Field(min_length=32)
    query_token_ttl_seconds: int = Field(default=7_200, ge=60, le=86_400)
    query_default_limit: int = Field(default=100, ge=1, le=1_000)
    query_max_limit: int = Field(default=1_000, ge=1, le=10_000)
    query_max_offset: int = Field(default=50_000, ge=0)
    query_timeout_seconds: float = Field(default=30.0, gt=0)
    tile_timeout_seconds: float = Field(default=10.0, gt=0)
    worker_count: int = Field(default=1, ge=1, le=8)
    duckdb_threads: int = Field(default=2, ge=1, le=8)
    duckdb_memory_limit: str = "1GiB"
    duckdb_temp_directory: str = "/tmp/dataset-mcp"
    max_sources: int = Field(default=8, ge=1, le=32)
    max_result_bytes: int = Field(default=4 * 1024 * 1024, ge=1024)
    public_origin: AnyHttpUrl | None = None
```

Create `app/errors.py` with a string enum `ErrorCode` containing every code in the design spec and a frozen `AppError` dataclass with `code`, `message`, and typed `details`.

- [ ] **Step 4: Install and configure the React package**

Run:

```bash
cd dataset-mcp/ui
npm init -y
npm install react react-dom zod @modelcontextprotocol/ext-apps @tanstack/react-table @tanstack/react-virtual maplibre-gl
npm install --save-dev typescript vite @vitejs/plugin-react vite-plugin-singlefile vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom @types/react @types/react-dom @biomejs/biome
```

Set scripts to `check`, `typecheck`, `test`, and `build`. Configure strict TypeScript with `noUncheckedIndexedAccess` and no `any`/`unknown` escape hatches in application code. Configure Vite to emit one HTML entry and a separately copied, versioned MapLibre worker asset.

- [ ] **Step 5: Run foundation gates and commit**

Run:

```bash
cd dataset-mcp
uv run ruff check .
uv run ruff format --check .
uv run pyright
uv run basedpyright
uv run pytest tests/test_config.py -q
cd ui
npm run check
npm run typecheck
npm test
npm run build
```

Expected: all commands exit 0.

Commit:

```bash
git add dataset-mcp
git commit -m "chore: scaffold dataset MCP service"
```

## Task 2: Define shared catalog, query, and UI contracts

**Owner:** Contract agent, serial after Task 1.

**Files:**
- Create: `dataset-mcp/app/catalog/models.py`
- Create: `dataset-mcp/app/query/models.py`
- Create: `dataset-mcp/query_worker/protocol.py`
- Create: `dataset-mcp/ui/src/mcp/contracts.ts`
- Create: `dataset-mcp/tests/test_serialization.py`
- Create: `dataset-mcp/ui/tests/contracts.test.ts`

- [ ] **Step 1: Write boundary tests from saved catalog fixtures**

Copy redacted, minimal responses for collection, dataset, file, and schema endpoints into `dataset-mcp/tests/contract_fixtures/`. Preserve IDs, slugs, format types, storage-location fields, file-source versions, `source_metadata`, and schema columns; replace live URLs with `https://storage.example.test/sample.parquet`.

Write tests that call `TypeAdapter(list[Collection]).validate_json`,
`DatasetPage.model_validate_json`, `Dataset.model_validate_json`,
`DatasetFileResponse.model_validate_json`, and the derived
`DatasetFileSchemaResult.model_validate_json`.

Run: `cd dataset-mcp && uv run pytest tests/test_serialization.py -q`  
Expected: FAIL because the contract models do not exist.

- [ ] **Step 2: Implement narrow Pydantic catalog models**

Define explicit models for:

```python
from pydantic import BaseModel, ConfigDict, Field


class CatalogModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class QuerySourceRef(CatalogModel):
    alias: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")
    collection_id: int = Field(gt=0)
    dataset_id: int = Field(gt=0)
    file_id: int = Field(gt=0)
    file_source_id: int = Field(gt=0)


class ColumnSchema(CatalogModel):
    name: str
    type: str
    description: str | None = None
    nullable: bool = True
    num_null_values: int | None = None
    num_unique_values: int | None = None
    example_values: list[str] | None = None
    min: float | None = None
    max: float | None = None
    length: int | None = None
    possible_values: list[str] | None = None


class DatasetSearchRequest(CatalogModel):
    collection: int | str
    search: str | None = None
    tag_filters: str | None = None
    limit: int = Field(default=50, ge=1, le=1_000)
    offset: int = Field(default=0, ge=0)

    def to_query_params(self) -> dict[str, str | int]:
        params: dict[str, str | int] = {
            "limit": self.limit,
            "offset": self.offset,
        }
        if self.search is not None:
            params["search"] = self.search
        if self.tag_filters is not None:
            params["tag_filters"] = self.tag_filters
        return params
```

Add explicit `Collection`, `Dataset`, `DatasetFile`, `FileFormat`, `FileSource`, `StorageLocation`, `FileLocation`, `SpatialDatasetFileMetadata`, and endpoint response models matching `webapp/src/lib/openapi/spec.ts`. Use narrow unions for storage config and location variants. Unknown catalog fields may be ignored only at this external HTTP boundary.

Use this field matrix so later tasks share one vocabulary:

| Model | Required fields |
| --- | --- |
| `Collection` | `id`, `slug`, `name`, nullable `description`, `created_at`, `updated_at` |
| `Dataset` | `id`, `collection_id`, `slug`, `name`, nullable `description`, typed `tags`, timestamps, optional `files` |
| `DatasetFile` | `id`, `dataset_id`, `slug`, `name`, nullable `description`/`layer_name`/`file_metadata`, timestamps, optional `formats` |
| `FileFormat` | `id`, `format_type`, `name` and the enclosing format entry's `sources` |
| `FileSource` | `id`, `file_format_id`, `storage_location_id`, `version`, `source_type`, typed `location`, nullable `source_metadata`, storage location, URLs, timestamps |
| `StorageLocation` | `id`, `slug`, `name`, storage type, and typed public connection metadata with credential fields excluded |
| `SpatialDatasetFileMetadata` | version, description, size/MIME, feature count, bounds, geometry type, invalid count, quality result, columns hash, and optional `columns` |
| `DatasetPage` | `items`, `total`, `limit`, `offset` |
| `DatasetFileResponse` | `dataset`, `file` |
| `DatasetFileVersionsResponse` | `dataset_id`, `file_id`, `formats` |
| `DatasetFileSchemaResult` | collection/dataset/file summaries, versions, selected version, nullable schema provenance/summary/columns |

- [ ] **Step 3: Define query and worker protocol models**

`app/query/models.py` must define `ReadRowsRequest`, `QueryRequest`, `QueryPageRequest`, `MapFeaturesRequest`, `ResolvedSource`, `ColumnResult`, `PageResult`, `QueryResult`, and `QueryTokenPayload`. Use:

```python
type JsonScalar = None | bool | int | float | str
type JsonValue = JsonScalar | list["JsonValue"] | dict[str, "JsonValue"]
type EncodedRow = dict[str, JsonValue]
```

Use these exact request/result fields:

| Type | Fields |
| --- | --- |
| `ReadRowsRequest` | `source`, optional `columns`, `limit=100`, `offset=0` |
| `QueryRequest` | `sources`, `sql`, `limit=100`, nullable `geometry_column` and `result_crs` |
| `QueryPageRequest` | `query_token`, `offset`, `page_size=100` |
| `MapFeaturesRequest` | `query_token`, four-number `bbox`, `zoom`, `feature_cap` |
| `ResolvedSource` | source ref, resolved version, format type, storage-location slug, exact object URIs, nullable bbox/CRS metadata |
| `ColumnResult` | `name`, DuckDB logical type, nullability |
| `PageResult` | columns, rows, offset, returned count, `has_more`, nullable `next_offset`, truncation/order warnings, elapsed/bytes/files metrics |
| `QueryResult` | `page`, `query_token`, resolved source summaries, nullable map configuration |
| `QueryTokenPayload` | token version, canonical SQL, source refs, geometry settings, issued-at, expiry |

`query_worker/protocol.py` must define frozen dataclasses for `WorkerQuery`, `WorkerTileQuery`, `WorkerPage`, `WorkerTile`, and a discriminated `WorkerFailure`. `WorkerQuery` carries canonical SQL, trusted DuckDB source specs, limit, offset, and deadline; `WorkerPage` carries typed columns/rows and execution metrics; `WorkerTileQuery` adds z/x/y and geometry/CRS settings; `WorkerTile` carries bytes plus metrics; `WorkerFailure` carries only stable code and safe message. No multiprocessing message may contain a live DuckDB connection, exception object, credential, or Pydantic model.

- [ ] **Step 4: Define matching Zod schemas**

In `ui/src/mcp/contracts.ts` define and export Zod schemas for discovery results, query results, page results, encoded tagged values, stable error results, and map configuration. Derive TypeScript types with `z.infer`. Do not use `z.any()`, `z.unknown()`, TypeScript `any`, or TypeScript `unknown`; use recursive `z.json()` only for the validated encoded cell boundary.

- [ ] **Step 5: Verify round-trip fixtures and commit**

Run:

```bash
cd dataset-mcp
uv run pytest tests/test_serialization.py -q
uv run pyright
uv run basedpyright
cd ui
npm run typecheck
npm test -- contracts.test.ts
```

Expected: all commands exit 0.

Commit:

```bash
git add dataset-mcp/app/catalog/models.py dataset-mcp/app/query/models.py dataset-mcp/query_worker/protocol.py dataset-mcp/tests dataset-mcp/ui/src/mcp/contracts.ts dataset-mcp/ui/tests/contracts.test.ts
git commit -m "feat: define dataset MCP contracts"
```

## Task 3: Implement catalog discovery and exact source resolution

**Owner:** Catalog agent, Wave 1.

**Files:**
- Create: `dataset-mcp/app/catalog/client.py`
- Create: `dataset-mcp/app/catalog/shaping.py`
- Create: `dataset-mcp/app/catalog/source_resolver.py`
- Create: `dataset-mcp/tests/test_catalog_client.py`
- Create: `dataset-mcp/tests/test_source_resolver.py`

- [ ] **Step 1: Write HTTP contract tests**

Use `respx` to assert the internal numeric/slug paths listed under “Source
documents,” encoded query parameters, timeout propagation, 404 mapping, and
response validation. Include identity resolution for numeric IDs and slugs,
plus derived schema tests for omitted version, valid explicit version, invalid
explicit version, and column slicing.

Run: `cd dataset-mcp && uv run pytest tests/test_catalog_client.py -q`  
Expected: FAIL because `CatalogClient` does not exist.

- [ ] **Step 2: Implement the async catalog client**

Centralize request execution in one private method that maps HTTP 404 to
`catalog_not_found`, transport/non-404 failures to `catalog_unavailable`, and
invalid JSON/models to `catalog_contract_invalid`.

Implement this exact resolution behavior:

| Client operation | Internal request |
| --- | --- |
| `list_collections()` | list collections |
| `resolve_collection(int)` | get numeric collection |
| `resolve_collection(str)` | list collections and require one exact slug |
| `search_datasets(request)` | resolve collection, then call its numeric dataset-list route |
| `get_dataset(collection, int)` | numeric dataset `/files` route |
| `get_dataset(collection, str)` | dataset `by-slug/{dataset_slug}/files` route |
| `get_dataset_file(collection, dataset, int)` | resolve collection/dataset, then numeric file route |
| `get_dataset_file(collection, str, str)` | resolve collection, then slug file route |
| `get_file_versions(collection, dataset, file)` | numeric versions route after resolving all identities |
| `get_dataset_file_schema(collection, dataset, file, version)` | derive locally from the versions response using the same preference order as `webapp/src/components/dataset/schemaSources.ts` |

The MCP service must not call the webapp's public API or duplicate its
collection/dataset wrappers. It reproduces metadata parity by shaping the
internal catalog responses into MCP results.

- [ ] **Step 3: Write source-membership security tests**

Cover matching IDs, wrong collection, wrong dataset, wrong file, wrong source ID, non-GeoParquet format, non-file source, missing storage location, changed version, and catalog glob expansion. Assert that arbitrary caller URLs cannot enter `ResolvedSource`.

- [ ] **Step 4: Implement source resolution and response shaping**

`SourceResolver.resolve` must refetch file detail, verify the full identity chain, select exactly one `file_source_id` under a `geoparquet` format, and return catalog-produced object paths plus storage location identity. `shape_file_metadata` must omit inline `columns` arrays, retain column count/hash/availability, and add one ready-to-copy `QuerySourceRef` per eligible source.

- [ ] **Step 5: Run catalog tests and commit**

Run:

```bash
cd dataset-mcp
uv run pytest tests/test_catalog_client.py tests/test_source_resolver.py -q
uv run ruff check app/catalog tests/test_catalog_client.py tests/test_source_resolver.py
uv run pyright
uv run basedpyright
```

Expected: all commands exit 0.

Commit: `git commit -m "feat: add catalog discovery client"` after adding only this task's files.

## Task 4: Implement SQL policy and signed query tokens

**Owner:** Security agent, Wave 1.

**Files:**
- Create: `dataset-mcp/app/query/sql_policy.py`
- Create: `dataset-mcp/app/query/token_codec.py`
- Create: `dataset-mcp/tests/security/sql_policy_cases.py`
- Create: `dataset-mcp/tests/test_sql_policy.py`
- Create: `dataset-mcp/tests/test_token_codec.py`

- [ ] **Step 1: Write SQL allow/deny tests**

Allow joins, CTEs, subqueries, unions, windows, grouping, ordering, quoted approved aliases, and approved spatial scalar functions. Deny DDL, DML, `PRAGMA`, `SET`, `ATTACH`, `COPY`, `CALL`, `INSTALL`, `LOAD`, secrets, multiple statements, qualified catalogs, direct paths, `read_*`, `parquet_scan`, `glob`, table functions, unknown aliases, and SQL over 8 KiB.

Run: `cd dataset-mcp && uv run pytest tests/test_sql_policy.py -q`  
Expected: FAIL because `SqlPolicy` does not exist.

- [ ] **Step 2: Implement AST validation**

`SqlPolicy.validate(sql: str, aliases: frozenset[str]) -> ValidatedSql` must parse exactly one DuckDB-dialect statement with SQLGlot, require a query root, walk every table and function node, and return canonical SQL plus `deterministic_order`. Function checks use an explicit immutable allowlist. Reject a function unless it is known-safe; never use a denylist as the acceptance rule.

- [ ] **Step 3: Write token tamper and expiry tests**

Cover deterministic encoding, version field, signature mutation, payload mutation, expiry boundary, future-issued tokens, decompression bombs, invalid base64, decoded payload over 64 KiB, more than eight sources, and encoded tokens over 8 KiB.

- [ ] **Step 4: Implement the standard-library token codec**

Use JSON with sorted keys and compact separators, zlib compression, URL-safe base64 without padding, `hmac.digest(secret, compressed_payload, "sha256")`, and `hmac.compare_digest`. The token payload contains canonical SQL, source identities/aliases, optional geometry column/CRS, issued-at, expiry, and token version. It never contains URLs, credentials, or rows.

- [ ] **Step 5: Run security tests and commit**

Run:

```bash
cd dataset-mcp
uv run pytest tests/test_sql_policy.py tests/test_token_codec.py -q
uv run ruff check app/query tests/security tests/test_sql_policy.py tests/test_token_codec.py
uv run pyright
uv run basedpyright
```

Expected: all commands exit 0.

Commit: `git commit -m "feat: enforce SQL and query token policy"`.

## Task 5: Implement server-managed storage profiles

**Owner:** Storage agent, Wave 1.

**Files:**
- Create: `dataset-mcp/app/storage/models.py`
- Create: `dataset-mcp/app/storage/resolver.py`
- Create: `dataset-mcp/tests/test_storage_resolver.py`

- [ ] **Step 1: Write resolver tests**

Cover public GCS HTTPS conversion, AWS `s3://` paths, SeaweedFS endpoint/path-style/TLS settings, unknown storage slug, bucket-prefix scope violations, encoded path traversal, agent-supplied endpoint rejection, and redacted model serialization.

- [ ] **Step 2: Implement typed profiles**

Define discriminated `PublicGcsProfile`, `S3Profile`, and `SeaweedProfile` models. Settings map catalog storage-location slug to one profile. `StorageResolver.resolve` accepts only a catalog `ResolvedSource` and returns a `DuckDbSourceSpec` containing exact object URIs and a short-lived secret specification. Its `repr` and structured logging fields expose no secret values.

- [ ] **Step 3: Implement trusted DuckDB setup statements**

Return parameterized setup operations rather than concatenated agent input. Public GCS becomes HTTPS object URLs. S3 and SeaweedFS create request-scoped DuckDB secrets with fixed provider, endpoint, URL style, TLS, region, and bucket/prefix scope selected from server configuration.

- [ ] **Step 4: Run tests and commit**

Run: `cd dataset-mcp && uv run pytest tests/test_storage_resolver.py -q && uv run pyright && uv run basedpyright`  
Expected: all commands exit 0.

Commit: `git commit -m "feat: resolve catalog storage profiles"`.

## Task 6: Implement the MCP App React bridge and shell

**Owner:** UI bridge agent, Wave 1.

**Files:**
- Create: `dataset-mcp/ui/src/mcp/useMcpApp.ts`
- Create: `dataset-mcp/ui/src/components/ErrorPanel.tsx`
- Create: `dataset-mcp/ui/src/App.tsx`
- Create: `dataset-mcp/ui/src/main.tsx`
- Create: `dataset-mcp/ui/src/styles.css`
- Create: `dataset-mcp/ui/tests/App.test.tsx`

- [ ] **Step 1: Write lifecycle tests**

Mock `useApp` and assert handlers are registered in `onAppCreated` before connection, initial tool results are Zod-validated, host theme/font/safe-area variables apply, hidden views pause rendering, and hosts without `serverTools` show static mode.

- [ ] **Step 2: Implement the bridge**

`useMcpApp` returns a discriminated state:

```typescript
type McpViewState =
  | { status: "connecting" }
  | { status: "error"; code: string; message: string }
  | { status: "ready"; result: ToolResult; canCallTools: boolean };
```

Register `ontoolresult`, `onhostcontextchanged`, `onteardown`, and visibility handlers inside `onAppCreated`. Validate every server result before state updates. `callServerTool` accepts a Zod input schema and output schema so no unparsed boundary value enters components.

- [ ] **Step 3: Implement the accessible shell**

Render compact discovery summaries, query/table/map tabs, loading state, typed errors, static-host status, and a text alternative for maps. Use host CSS variables, safe-area insets, responsive dimensions, and no external CDN assets.

- [ ] **Step 4: Verify and commit**

Run: `cd dataset-mcp/ui && npm run check && npm run typecheck && npm test -- App.test.tsx && npm run build`  
Expected: all commands exit 0.

Commit: `git commit -m "feat: add MCP app React bridge"`.

## Task 7: Implement bounded DuckDB workers and query serialization

**Owner:** Query worker agent, Wave 2 after Tasks 4 and 5.

**Files:**
- Create: `dataset-mcp/app/query/serialization.py`
- Create: `dataset-mcp/app/query/service.py`
- Create: `dataset-mcp/query_worker/runtime.py`
- Create: `dataset-mcp/query_worker/metrics.py`
- Create: `dataset-mcp/query_worker/pool.py`
- Create: `dataset-mcp/tests/test_query_service.py`
- Create: `dataset-mcp/tests/test_serialization.py`
- Create: `dataset-mcp/tests/test_worker_runtime.py`
- Create: `dataset-mcp/tests/test_worker_pool.py`

- [ ] **Step 1: Write local-Parquet worker tests**

Generate small Parquet fixtures through DuckDB in pytest temporary directories. Test one source, complex join, outer `LIMIT + 1`, offset, inner limit preservation, schema extraction, deterministic-order warning, no exact count, request-unique view cleanup, and sequential request isolation.

- [ ] **Step 2: Implement worker bootstrap**

Start by copying `get_connection` from
`../geoparquet-duckdb-partitioning/duckdb_parquet_provider.py` into the worker
runtime. Adapt it to create one in-memory connection per spawned worker
process. Load preinstalled `httpfs` and `spatial`, disable extension
auto-install/autoload/community repositories, set threads/memory/temp
directory, and lock configuration before requests. Create source views from
trusted object lists only; use generated internal view names and bind file
lists as parameters.

- [ ] **Step 3: Port typed DuckDB profiling**

Copy `init_connection` and `measure` from
`../geoparquet-duckdb-partitioning/metrics.py` into
`query_worker/metrics.py`. Preserve its profiling-setting order, warm-up query,
`fetchall` flush, per-query profile file, and cleanup. Replace dynamic
dictionaries with frozen `QueryMetrics` and `MutableQueryMetrics` dataclasses;
map profile-read failures to a stable code instead of recording exception text.

- [ ] **Step 4: Implement page execution and encoding**

Wrap canonical SQL as:

```sql
SELECT *
FROM (
  /* validated canonical query */
) AS _mcp_result
LIMIT ? OFFSET ?
```

Bind `limit + 1` and offset. Encode decimals, temporal values, UUIDs, and unsafe integers as typed strings; recursively encode lists/structs; summarize binary/geometry; truncate cells at 64 KiB; stop before 4 MiB; calculate `has_more` and `next_offset` without skipping the first row that did not fit.

- [ ] **Step 5: Implement the process pool**

Use `multiprocessing.get_context("spawn")`. One worker accepts one request at a time. The async pool queues requests, enforces the soft timeout, terminates at the hard timeout, replaces dead/poisoned workers, and returns only `WorkerPage` or `WorkerFailure`. Shutdown joins or terminates every child.

- [ ] **Step 6: Run worker tests and commit**

Run:

```bash
cd dataset-mcp
uv run pytest tests/test_serialization.py tests/test_worker_runtime.py tests/test_worker_pool.py tests/test_query_service.py -q
uv run ruff check app/query query_worker tests
uv run pyright
uv run basedpyright
```

Expected: all commands exit 0.

Commit: `git commit -m "feat: execute bounded DuckDB query pages"`.

## Task 8: Implement discovery MCP tools

**Owner:** Discovery tool agent, Wave 2 after Task 3.

**Files:**
- Create: `dataset-mcp/app/tools/discovery.py`
- Create: `dataset-mcp/tests/test_discovery_tools.py`

- [ ] **Step 1: Write tool-shape tests**

Test `list_collections`, `get_collection`, `search_datasets`, `get_dataset`, `get_dataset_file`, and `get_dataset_file_schema`. Assert model-and-app visibility, UI resource linkage, concise text fallback, structured content, slug/ID hierarchy checks, default/max schema column pagination, strict requested schema version, and omission of inline file column arrays.

- [ ] **Step 2: Implement discovery functions**

Each function accepts a typed request and injected `CatalogClient`, returns `ToolResult` with concise text and structured content, and contains no FastMCP global. `get_dataset_file` adds query-source references. `get_dataset_file_schema` slices columns after resolving the canonical schema response and returns `total`, `offset`, `limit`, and `has_more`.

- [ ] **Step 3: Add metadata-parity regression coverage**

Define one immutable mapping in the test:

```python
METADATA_TOOL_PARITY = {
    "collections": "list_collections",
    "collection": "get_collection",
    "dataset": "get_dataset",
    "dataset_file": "get_dataset_file",
    "dataset_file_schema": "get_dataset_file_schema",
}
```

Assert all six discovery tools, including `search_datasets`, are registered model-visible; assert the five mapped tools preserve access to the webapp metadata responses.

- [ ] **Step 4: Run tests and commit**

Run: `cd dataset-mcp && uv run pytest tests/test_discovery_tools.py -q && uv run pyright && uv run basedpyright`  
Expected: all commands exit 0.

Commit: `git commit -m "feat: expose catalog discovery tools"`.

## Task 9: Implement the interactive result table

**Owner:** Table UI agent, Wave 2 after Task 6.

**Files:**
- Create: `dataset-mcp/ui/src/components/ResultTable.tsx`
- Create: `dataset-mcp/ui/tests/ResultTable.test.tsx`

- [ ] **Step 1: Write component tests**

Assert the initial `query_geoparquet` rows render without calling `get_query_page`, next uses `next_offset`, previous uses cached rows, revisiting a page does not refetch, local sort is labeled page-only, geometry is summarized, large/empty/error/loading states render, and keyboard focus returns to the table after paging.

- [ ] **Step 2: Implement table state**

Use TanStack Table and Virtual. Cache pages by `offset:limit` in component memory. Initialize the cache from the first tool result. Call:

```typescript
await callServerTool({
  name: "get_query_page",
  arguments: { query_token: token, offset: nextOffset, page_size: pageSize },
});
```

Validate the returned structured content before caching. Display elapsed time, bytes read, truncation, ordering warning, and whether another page exists. Never infer a total.

- [ ] **Step 3: Verify and commit**

Run: `cd dataset-mcp/ui && npm run check && npm run typecheck && npm test -- ResultTable.test.tsx`  
Expected: all commands exit 0.

Commit: `git commit -m "feat: render paginated query tables"`.

## Task 10: Create deployment skeleton and image workflow

**Owner:** Deployment agent, Wave 2.

**Files:**
- Create: `dataset-mcp/Dockerfile`
- Create: `dataset-mcp/README.md`
- Create: `charts/dataset-mcp/Chart.yaml`
- Create: `charts/dataset-mcp/values.yaml`
- Create: `charts/dataset-mcp/templates/_helpers.tpl`
- Create: `charts/dataset-mcp/templates/deployment.yaml`
- Create: `charts/dataset-mcp/templates/ingress.yaml`
- Create: `charts/dataset-mcp/templates/networkpolicy.yaml`
- Create: `charts/dataset-mcp/templates/service.yaml`
- Create: `charts/dataset-mcp/templates/serviceaccount.yaml`
- Create: `.github/workflows/dataset-mcp-quality.yml`
- Modify: `.github/workflows/publish-images.yml`

- [ ] **Step 1: Write Helm render assertions**

Use `helm template dataset-mcp charts/dataset-mcp` and assert the rendered deployment includes a non-root security context, read-only root filesystem, 2 GiB memory default, 4 GiB size-limited temp volume, one replica/worker, `/healthz` probes, catalog URL, token-secret reference, ingress rate/concurrency annotations, restricted egress, and no Valkey variables.

- [ ] **Step 2: Implement multi-stage Docker build**

The Node stage runs `npm ci && npm run build`. The Python stage runs `uv sync --frozen --no-dev`, copies the built UI, copies preinstalled DuckDB extension binaries into an immutable directory, creates the non-root user and writable spill directory, and starts `uvicorn app.http_app:app`. The runtime image performs no package or DuckDB extension downloads.

- [ ] **Step 3: Implement the chart**

Follow `charts/dataset-api` naming/service-account patterns. Expose port 8000. Mount an `emptyDir` with `sizeLimit: 4Gi` at the configured spill directory. Default resources to requests `500m/1Gi` and limits `2 CPU/2Gi`. Accept public origin, catalog base URL, storage-profile settings, and token-secret `secretEnv`. Add optional ingress with request-rate, connection, body-size, and header-size controls. Add a default-deny egress `NetworkPolicy` that permits DNS, the catalog service, and explicitly configured storage HTTPS/S3 endpoints.

- [ ] **Step 4: Extend image publication**

Add `dataset-mcp/**` to workflow paths, define `DATASET_MCP_IMAGE`, emit SHA/latest tags, and add one `docker/build-push-action` step with context `dataset-mcp`.

- [ ] **Step 5: Add the package quality workflow**

Create `dataset-mcp-quality.yml` with separate Python and UI jobs. The Python
job runs Ruff check/format, Pyright, BasedPyright, and pytest. The UI job runs
`npm ci`, Biome check, TypeScript, Vitest, and production build. Trigger on
changes under `dataset-mcp/**`, the workflow itself, and the design/plan files.

- [ ] **Step 6: Verify and commit**

Run:

```bash
docker build -t hifld-dataset-mcp:test dataset-mcp
helm lint charts/dataset-mcp
helm template dataset-mcp charts/dataset-mcp
```

Expected: all commands exit 0 and the render assertions pass.

Commit: `git commit -m "build: package dataset MCP service"`.

## Task 11: Implement query MCP tools and first-page reuse

**Owner:** Query tool agent, Wave 3 after Task 7.

**Files:**
- Create: `dataset-mcp/app/tools/query.py`
- Create: `dataset-mcp/tests/test_query_tools.py`

- [ ] **Step 1: Write tool tests**

Cover `read_geoparquet_rows`, `query_geoparquet`, and `get_query_page`. Assert model-and-app visibility, default limit 100, max 1,000, source cap eight, SQL policy before worker dispatch, first execution returns the initial page and token, no page-zero duplicate, later paging revalidates token and source membership, changed sources fail closed, and inner SQL limits remain intact.

- [ ] **Step 2: Implement row and query entry points**

`read_geoparquet_rows` builds a trusted projection query. `query_geoparquet` validates aliases and SQL. Both resolve sources, execute offset zero with `limit + 1`, sign a token, and return the complete first page. They must not write rows to memory outside the bounded response, disk, database, cache, or Valkey.

- [ ] **Step 3: Implement stateless page retrieval**

`get_query_page` validates signature/expiry/version/size, re-runs SQL policy, refetches every source, executes the requested bounded offset, and returns new timing/bytes metrics. It is registered for `["model", "app"]`. Default page size is 100 and maximum is 1,000.

- [ ] **Step 4: Run tests and commit**

Run: `cd dataset-mcp && uv run pytest tests/test_query_tools.py -q && uv run pyright && uv run basedpyright`  
Expected: all commands exit 0.

Commit: `git commit -m "feat: expose stateless GeoParquet query tools"`.

## Task 12: Implement bbox-constrained MVT and GeoJSON endpoints

**Owner:** Tile agent, Wave 3 after Task 7.

**Files:**
- Create: `dataset-mcp/query_worker/tiles.py`
- Create: `dataset-mcp/app/http/tiles.py`
- Create: `dataset-mcp/tests/test_tiles.py`

- [ ] **Step 1: Write spatial fixtures and failing tests**

Create points/polygons inside and outside a known tile. Test z/x/y validation, token validation, CRS requirements, bbox prefilter, exact intersection, clipping, EPSG:3857 transformation, omitted geometry/bbox properties, feature cap, 1 MiB cap, dense-tile error, 10-second timeout, and wildcard CORS limited to the query-token header.

- [ ] **Step 2: Implement trusted tile SQL**

Copy `_bbox_predicate` from
`../geoparquet-duckdb-partitioning/duckdb_parquet_provider.py` and
`_TILE_SQL_TEMPLATE` from `../geoparquet-duckdb-partitioning/server.py` into
`query_worker/tiles.py`. Preserve the bbox comparison order and
`ST_TileEnvelope`/bounds/`ST_AsMVTGeom`/`ST_AsMVT` CTE shape. Replace the fixed
`counties` relation with the validated query result, quote only validated
identifiers, transform tile bounds into validated result CRS, apply exact
intersection after bbox pruning, clip geometry, and enforce feature/byte caps.
Agent SQL remains an inner subquery and never supplies an object path or SQL
fragment to the tile wrapper.

- [ ] **Step 3: Implement the HTTP route and GeoJSON fallback**

Copy the z/x/y validation, MVT response MIME, and empty-tile 204 behavior from
`../geoparquet-duckdb-partitioning/server.py:tile`.
`GET /tiles/{z}/{x}/{y}.mvt` then adds signed-token input from
`X-HIFLD-Query-Token`, source revalidation, worker dispatch, safe metrics, and
CORS. The app-only `get_map_features` path uses the same viewport predicate,
returns at most 2,000 GeoJSON features/4 MiB, and never serves features outside
the requested bbox.

- [ ] **Step 4: Run tests and commit**

Run: `cd dataset-mcp && uv run pytest tests/test_tiles.py -q && uv run pyright && uv run basedpyright`  
Expected: all commands exit 0.

Commit: `git commit -m "feat: render bbox-constrained map data"`.

## Task 13: Implement MapLibre rendering and fallback

**Owner:** Map UI agent, Wave 3 after Task 6 and in parallel with Task 12.

**Files:**
- Create: `dataset-mcp/ui/src/components/MapView.tsx`
- Create: `dataset-mcp/ui/tests/MapView.test.tsx`

- [ ] **Step 1: Write map behavior tests**

Mock MapLibre. Assert tile URLs use z/x/y, the query token is sent only in the allowed header, viewport updates do not call unbounded tools, ambiguous geometry/CRS errors are rendered, dense tiles suggest filter/aggregate/zoom, hidden views pause rendering, and failed worker startup calls app-only `get_map_features`.

- [ ] **Step 2: Implement the map**

Configure a self-hosted MapLibre worker URL. Add one vector source for `/tiles/{z}/{x}/{y}.mvt` and geometry-appropriate layers. Fit initial bounds when provided, expose keyboard-accessible feature details, and render a tabular/text alternative. Request fullscreen only when host capabilities advertise it.

- [ ] **Step 3: Implement bounded fallback**

When worker/WebGL/tile requests are unavailable, call `get_map_features` with current bbox, zoom, and cap. Validate GeoJSON before adding it as a source. Do not fetch cloud objects or the internal catalog from the iframe.

- [ ] **Step 4: Verify and commit**

Run: `cd dataset-mcp/ui && npm run check && npm run typecheck && npm test -- MapView.test.tsx && npm run build`  
Expected: all commands exit 0.

Commit: `git commit -m "feat: render geospatial query maps"`.

## Task 14: Assemble FastMCP, ASGI lifespan, resource CSP, and UI

**Owner:** Integration agent, serial after Tasks 8–13.

**Files:**
- Create: `dataset-mcp/app/mcp_server.py`
- Create: `dataset-mcp/app/http_app.py`
- Create: `dataset-mcp/app/observability.py`
- Create: `dataset-mcp/tests/test_http_app.py`
- Modify: `dataset-mcp/ui/src/App.tsx`
- Modify: `dataset-mcp/ui/tests/App.test.tsx`
- Modify: `dataset-mcp/README.md`

- [ ] **Step 1: Write protocol and HTTP assembly tests**

Use FastMCP's in-memory client to list tools/resources and call one discovery tool plus one local-Parquet query. Assert:

- all discovery/query/page tools have `visibility=["model", "app"]`;
- `get_map_features` has `visibility=["app"]`;
- all app tools link `ui://hifld/dataset-explorer.html`;
- the resource MIME is `text/html;profile=mcp-app`;
- structured content and concise text are both present;
- `/mcp/` is stateless;
- `/healthz`, `/tiles/`, and `/assets/` share the FastMCP lifespan.

- [ ] **Step 2: Register tools and resource**

Create `FastMCP("HIFLD Dataset Explorer", stateless_http=True)`. Register each function from `app/tools` with `AppConfig(resource_uri="ui://hifld/dataset-explorer.html", visibility=["model", "app"])`. Register `get_map_features` with app-only visibility. Register the built HTML resource with `ResourceCSP` containing only the configured tile origin, basemap origins, and self-hosted worker asset origin.

- [ ] **Step 3: Assemble the ASGI application**

Create dependencies once in lifespan: HTTPX client, catalog client, storage resolver, SQL policy, token codec, and worker pool. Pass the MCP app lifespan when mounting it into FastAPI/Starlette. Close HTTPX and the process pool on shutdown. Add structured request/error middleware and global concurrency limits.

- [ ] **Step 4: Implement safe query observability**

Emit metrics for queue, catalog, policy, storage, DuckDB, serialization, and
tile durations plus rows, files, bytes, peak memory, and spill. Structured logs
contain query hash, source IDs/versions, token version, limit/offset, latency,
and stable error code. Add tests that assert logs never contain full SQL,
literals, tokens, credentials, row values, or geometry.

- [ ] **Step 5: Connect final UI views**

Dispatch validated tool-result kinds to `DatasetExplorer`, `ResultTable`, and `MapView`. Preserve initial query rows as page zero. Configure the map tab only when geometry/CRS resolution succeeds.

- [ ] **Step 6: Run package gates and commit**

Run:

```bash
cd dataset-mcp
uv run ruff check .
uv run ruff format --check .
uv run pyright
uv run basedpyright
uv run pytest
cd ui
npm run check
npm run typecheck
npm test
npm run build
```

Expected: every command exits 0.

Commit: `git commit -m "feat: assemble dataset MCP app server"`.

## Task 15: Complete security, integration, deployment, and performance gates

**Owner:** Verification coordinator, serial.

**Files:**
- Create: `dataset-mcp/tests/integration/test_mcp_flow.py`
- Create: `dataset-mcp/tests/integration/test_seaweedfs.py`
- Create: `dataset-mcp/tests/integration/test_public_gcs.py`
- Create: `dataset-mcp/tests/security/test_sql_bypass_corpus.py`
- Create: `dataset-mcp/tests/security/test_token_fuzz.py`
- Create: `dataset-mcp/tests/benchmark_queries.py`
- Modify: `dataset-mcp/README.md`

- [ ] **Step 1: Run one end-to-end local flow**

Start the catalog fixture server and MCP server. Through an MCP client: list collections, inspect collection/dataset/file/schema, select a GeoParquet source, query with limit 100, render initial rows without a second query, fetch the next page, run a two-source join, request an intersecting tile, and reject a non-intersecting feature.

- [ ] **Step 2: Run storage integration tests**

Run SeaweedFS against the repository-supported local endpoint and a representative public GCS GeoParquet source. Record HTTP requests, bytes read, files read, cold latency, and warm latency. Skip public-network tests only when an explicit `NO_NETWORK_TESTS=1` is set; CI intended for release must run them.

- [ ] **Step 3: Run the security corpus**

Execute every SQL bypass case, token mutation/fuzz case, source-identity mismatch, output-size boundary, timeout, worker replacement, path scope, and credential-redaction assertion. Confirm rejected SQL never reaches `DuckDbWorkerPool.submit`.

- [ ] **Step 4: Run page and tile benchmarks**

Measure pages 1, 2, 20, and 200 for scan, selective filter, ordered query,
aggregation, and complex join. Measure low/medium/high zoom tiles, including a
blocking global query. Run the same representative tile against the earlier
spike and record whether bytes read, feature count, and geometry bounds match
within the expected production changes. Write the results and launch thresholds
into `dataset-mcp/README.md`; do not add caching or materialization in response
to a slow benchmark without a new design decision.

- [ ] **Step 5: Test MCP hosts**

Run FastMCP's app development host, the MCP Apps basic reference host, and a manual Claude web connector. Verify tool visibility, initial-page reuse, app-to-server paging, CSP, CORS, theme, safe areas, fullscreen, MapLibre worker startup, MVT, and GeoJSON fallback.

- [ ] **Step 6: Run final repository gates**

Run:

```bash
cd dataset-mcp
uv run ruff check .
uv run ruff format --check .
uv run pyright
uv run basedpyright
uv run pytest
cd ui
npm run check
npm run typecheck
npm test
npm run build
cd ../..
docker build -t hifld-dataset-mcp:test dataset-mcp
helm lint charts/dataset-mcp
helm template dataset-mcp charts/dataset-mcp
git diff --check
git status --short
```

Expected: all gates exit 0; `git status --short` contains only the intentional verification-document update, if any.

- [ ] **Step 7: Commit verification artifacts**

```bash
git add dataset-mcp/tests dataset-mcp/README.md
git commit -m "test: verify dataset MCP app end to end"
```

## Coordinator review checklist

Before integrating each parallel wave:

- [ ] Confirm every returned commit starts from the requested integration base.
- [ ] Inspect `git diff --stat` and reject edits outside the assigned ownership.
- [ ] Run each task's targeted tests after cherry-pick.
- [ ] Run `uv run pyright` and `uv run basedpyright` after every Python wave.
- [ ] Run `npm run typecheck` after every UI wave.
- [ ] Resolve contract changes in Task 2 models first; never let downstream agents independently rename shared fields.
- [ ] Preserve SeaweedFS, startup lifespan initialization, public HTTP API fields, and the no-GeoServer rule.
- [ ] Do not claim completion until Task 15's fresh full-gate output is available.
