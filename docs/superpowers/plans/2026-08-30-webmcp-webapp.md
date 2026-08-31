# WebMCP Webapp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add contextual WebMCP tools to the existing HIFLD webapp for catalog discovery, metadata inspection, map control, server-side GeoParquet queries, pageable result tables, and query-derived MVT layers.

**Architecture:** Register native `document.modelContext` tools in the first-party React app and route every UI-changing tool through the same typed commands used by human controls. Catalog tools call the existing same-origin JSON API; query tools call small same-origin REST proxies backed by the same Python `QueryApplicationService` as FastMCP. Query execution remains stateless: a signed token contains an opaque `query_id`, while React privately maps that ID to the token for page and tile requests.

**Tech Stack:** React 19, TanStack Start/Router, TypeScript 5.7, Zod 4, `webmcp-types`, MapLibre GL 5, Hightable, Vitest/Testing Library, Playwright, FastAPI, FastMCP 3, Pydantic 2, DuckDB, Pytest.

---

## Research decisions locked for implementation

- Use the unscoped `webmcp-types` package from the Web Machine Learning Community Group as a development-only type dependency.
- Use Zod 4's existing `z.toJSONSchema()` support. Do not add a schema-conversion package.
- Keep a small repository-owned `useWebMcpTool` adapter. `usewebmcp`, `use-webmcp-tool`, MCP-B packages, and browser MCP bridges either add deprecated fallbacks/polyfills, normalize results into a different contract, or provide transport features this app does not need.
- Do not make the browser an MCP client. A direct Streamable HTTP client would add MCP negotiation, JSON-RPC/SSE handling, CORS, and bundle weight while still requiring separate React state synchronization.
- Compose FastMCP and REST at `QueryApplicationService`, below both transports. There is one source resolver, SQL policy, worker pool, page serializer, token codec, and tile implementation.
- Keep the existing MCP `/mcp` transport and `/tiles/{z}/{x}/{y}.mvt` route compatible. Add resource-oriented webapp routes under `/api/queries`.
- Never place a signed query token in a URL. Use the non-secret query ID in the path and `X-HIFLD-Query-Token` in the request header.
- Do not add Valkey, query result storage, cursors, a WebMCP polyfill, or DuckDB-Wasm.

Primary references checked on 2026-08-30:

- [WebMCP Community Group draft](https://webmachinelearning.github.io/webmcp/)
- [Chrome imperative WebMCP API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
- [Chrome WebMCP security guidance](https://developer.chrome.com/docs/ai/webmcp/secure-tools)
- [Chrome comparison of WebMCP and MCP](https://developer.chrome.com/docs/ai/webmcp/compare-mcp)
- [Zod JSON Schema conversion](https://zod.dev/json-schema)
- [FastMCP HTTP deployment](https://gofastmcp.com/v2/deployment/http)
- [MCP TypeScript client transport](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md)

## Execution and parallel-agent rules

The repository currently contains unrelated uncommitted `dataset-mcp` work. Before execution, finish or commit that work, then create an isolated worktree from the resulting `mcp-app` head. Do not have agents infer ownership from a dirty shared tree.

Use four parallel tracks only where file ownership is disjoint:

| Wave | Agent | Tasks | Exclusive ownership during wave |
|---|---|---|---|
| 1 | Foundation | 1 | `webapp/src/lib/webmcp/**`, runtime config, root provider, package files |
| 1 | Query HTTP | 2 | `dataset-mcp/app/http/**`, query token/application models, Python tests/config |
| 1 | Catalog | 3 | catalog/schema API shaping and OpenAPI; no WebMCP adapter files |
| 1 | Map model | 4 | map source model, selection union, pure workspace command types/tests |
| 2 | Catalog tools | 5-6 | global catalog provider and comparison route |
| 2 | Query proxy | 7 | webapp `/api/queries` routes and typed query client |
| 2 | Map engine | 8 | MapLibre source synchronization and camera adapter |
| 3 | Map/query integration | 9-11 | one agent exclusively owns the collection map route and query UI |
| 4 | Delivery | 12-14 | deployment, docs, analytics, browser acceptance, final gates |

Agents must not edit `webapp/src/routes/collections.$collectionSlug.map.tsx` before Task 9. Tasks 4 and 8 prepare focused modules so the integration agent can make one controlled route edit.

## Intended file structure

New focused files:

```text
dataset-mcp/app/http/queries.py
dataset-mcp/tests/test_http_queries.py
webapp/src/components/WebMcpProvider.tsx
webapp/src/components/map/MapLayerListItem.tsx
webapp/src/components/map/QueryResultPanel.tsx
webapp/src/components/map/mapWorkspaceCommands.ts
webapp/src/components/map/queryResults.ts
webapp/src/components/map/useMapWorkspaceCommands.ts
webapp/src/components/map/webmcpMapTools.ts
webapp/src/components/map/webmcpQueryTools.ts
webapp/src/lib/query-api.ts
webapp/src/lib/webmcp/catalogTools.ts
webapp/src/lib/webmcp/modelContextFake.ts
webapp/src/lib/webmcp/result.ts
webapp/src/lib/webmcp/schemas.ts
webapp/src/lib/webmcp/useWebMcpTool.ts
webapp/src/lib/webmcp/versionComparisonTool.ts
webapp/src/routes/api/queries.ts
webapp/src/routes/api/queries.$queryId.pages.ts
webapp/plugins/webmcp-origin-trial.ts
webapp/e2e/webmcp.spec.ts
webapp/playwright.config.ts
```

Responsibility boundaries:

- `useWebMcpTool.ts` owns browser feature detection and registration lifecycle only.
- `schemas.ts` owns stable Zod input contracts and their JSON Schema conversion.
- `result.ts` owns bounded success/failure envelopes and redaction.
- `catalogTools.ts` owns same-origin catalog fetches, shaping, and six global tools.
- `mapWorkspaceCommands.ts` owns public map command types and pure validation/reducer helpers.
- `useMapWorkspaceCommands.ts` binds those commands to React state and MapLibre readiness.
- `queryResults.ts` owns parsed HTTP query/page contracts and private query workspace types.
- `QueryResultPanel.tsx` renders server rows and paging; it never invokes Hyparquet.
- `queries.py` adapts HTTP requests to `QueryApplicationService`; it contains no SQL or storage logic.

### Task 1: Native WebMCP foundation and feature flags

**Files:**
- Modify: `webapp/package.json`
- Modify: `webapp/package-lock.json`
- Modify: `webapp/tsconfig.json`
- Modify: `webapp/src/lib/runtime-client-config.ts`
- Modify: `webapp/src/lib/server-runtime-client-config.ts`
- Modify: `webapp/src/routes/runtime-config[.]js.ts`
- Modify: `webapp/src/routes/__root.tsx`
- Create: `webapp/src/components/WebMcpProvider.tsx`
- Create: `webapp/src/lib/webmcp/schemas.ts`
- Create: `webapp/src/lib/webmcp/result.ts`
- Create: `webapp/src/lib/webmcp/useWebMcpTool.ts`
- Create: `webapp/src/lib/webmcp/modelContextFake.ts`
- Test: `webapp/src/lib/webmcp/__tests__/schemas.test.ts`
- Test: `webapp/src/lib/webmcp/__tests__/result.test.ts`
- Test: `webapp/src/lib/webmcp/__tests__/useWebMcpTool.test.tsx`
- Test: `webapp/src/lib/__tests__/runtime-client-config.test.ts`

- [ ] **Step 1: Add the declarations-only dependency**

Run:

```bash
cd webapp
npm install --save-dev webmcp-types@0.1.5
```

Add `webmcp-types` to `compilerOptions.types` beside `vite/client`. Expected: package lock changes, production bundle does not gain a runtime module.

- [ ] **Step 2: Write failing runtime flag tests**

Cover these exact outcomes:

```ts
expect(runtimeClientConfigFromEnv({ WEBMCP_ENABLED: undefined })).toMatchObject({
  webMcpEnabled: false,
  queryToolsEnabled: false,
});
expect(
  runtimeClientConfigFromEnv({ WEBMCP_ENABLED: "true", DATASET_MCP_QUERY_API_URL: "http://dataset-mcp:8000" }),
).toMatchObject({ webMcpEnabled: true, queryToolsEnabled: true });
expect(JSON.stringify(runtimeClientConfigFromEnv({ WEBMCP_ORIGIN_TRIAL_TOKEN: "secret" }))).not.toContain("secret");
```

Run `npm test -- src/lib/__tests__/runtime-client-config.test.ts`; expected: FAIL because the booleans do not exist.

- [ ] **Step 3: Implement server-derived client flags**

Extend `RuntimeClientConfig` with required booleans. Parse `WEBMCP_ENABLED` strictly as `"true"`; derive `queryToolsEnabled` from both the flag and a non-empty `DATASET_MCP_QUERY_API_URL`. Keep the internal URL and origin-trial token out of the returned object.

- [ ] **Step 4: Write failing adapter tests with a typed fake**

The fake records registered tools and abort-driven removal. Verify SSR/unsupported no-op, post-hydration registration, cleanup, stable registration across callback rerenders, disabled state, Zod rejection before callback, annotation forwarding, latest callback use, and execution-signal propagation.

```ts
const fake = createModelContextFake();
installModelContextFake(fake);
const { rerender, unmount } = render(<Harness execute={firstExecute} />);
await waitFor(() => expect(fake.toolNames()).toEqual(["get_dataset"]));
rerender(<Harness execute={secondExecute} />);
expect(fake.registrationCount("get_dataset")).toBe(1);
await fake.execute("get_dataset", { collection: "hifld", dataset: "roads" });
expect(secondExecute).toHaveBeenCalledOnce();
unmount();
expect(fake.toolNames()).toEqual([]);
```

Run `npm test -- src/lib/webmcp/__tests__/useWebMcpTool.test.tsx`; expected: FAIL because the adapter does not exist.

- [ ] **Step 5: Implement the narrow adapter and result envelope**

Use module-scope Zod schemas and `z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" })`. The hook owns a registration `AbortController`, keeps the latest executor in a ref, and passes the execution signal from the callback's second argument.

```ts
export type WebMcpErrorCode =
  | "invalid_request"
  | "not_found"
  | "unsupported_state"
  | "query_rejected"
  | "query_timeout"
  | "query_capacity"
  | "rate_limited"
  | "upstream_unavailable"
  | "internal_error";

export type WebMcpFailure = {
  ok: false;
  error: { code: WebMcpErrorCode; message: string; retryable: boolean };
};
```

Truncate only complete fields, cap serialized output at 1,500 characters, and return `internal_error` without stack text for unexpected exceptions. Do not register through `navigator.modelContext` and do not pass `exposedTo`.

- [ ] **Step 6: Mount the provider and prove unsupported browsers are unchanged**

Mount `<WebMcpProvider />` inside `RootLayout`, adjacent to the existing providers. Initially it only reads flags and provides the registration boundary; global tools arrive in Task 5. Run:

```bash
cd webapp
npm test -- src/lib/webmcp src/lib/__tests__/runtime-client-config.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the foundation**

```bash
git add webapp/package.json webapp/package-lock.json webapp/tsconfig.json webapp/src/lib/runtime-client-config.ts webapp/src/lib/server-runtime-client-config.ts 'webapp/src/routes/runtime-config[.]js.ts' webapp/src/routes/__root.tsx webapp/src/components/WebMcpProvider.tsx webapp/src/lib/webmcp
git commit -m "feat(webapp): add native WebMCP registration foundation"
```

### Task 2: Stateless REST query resources in dataset-mcp

**Files:**
- Modify: `dataset-mcp/app/query/models.py`
- Modify: `dataset-mcp/app/query/token_codec.py`
- Modify: `dataset-mcp/app/query/application.py`
- Modify: `dataset-mcp/app/config.py`
- Modify: `dataset-mcp/app/production.py`
- Modify: `dataset-mcp/app/http_app.py`
- Modify: `dataset-mcp/app/http/tiles.py`
- Create: `dataset-mcp/app/http/queries.py`
- Test: `dataset-mcp/tests/test_token_codec.py`
- Test: `dataset-mcp/tests/test_query_application.py`
- Test: `dataset-mcp/tests/test_http_queries.py`
- Test: `dataset-mcp/tests/test_tiles.py`
- Test: `dataset-mcp/tests/test_http_app.py`

- [ ] **Step 1: Write failing query identity tests**

Add token tests for a URL-safe query ID round trip, a missing/invalid claim, token tampering, and expiry. Add application assertions:

```py
initial = await service.query((_source(),), "SELECT id FROM roads", 1, None, None)
assert isinstance(initial["query_id"], str)
assert initial["map_configuration"]["tile_url"].endswith(
    f'/api/queries/{initial["query_id"]}/tiles/{{z}}/{{x}}/{{y}}.mvt'
)
service.validate_query_identity(initial["query_token"], initial["query_id"])
```

Run `uv run pytest tests/test_token_codec.py tests/test_query_application.py -q`; expected: FAIL because the claim and validation method do not exist.

- [ ] **Step 2: Add a signed opaque query ID**

Add `query_id` to `QueryTokenPayload` and `_EncodedPayload` with `^[A-Za-z0-9_-]{20,64}$`. Generate it with `secrets.token_urlsafe(18)` before token encoding. Return it beside `query_token`, include it in page responses, and bind it into the MVT URL. `validate_query_identity(token, query_id)` decodes and compares with `hmac.compare_digest`; mismatch raises `QUERY_TOKEN_INVALID`.

- [ ] **Step 3: Write failing REST contract tests**

Test these exact routes and boundaries using a dependency-injected fake service:

```text
POST /api/queries
POST /api/queries/query_123/pages
GET  /api/queries/query_123/tiles/4/3/6.mvt
OPTIONS /api/queries/query_123/tiles/4/3/6.mvt
```

Assert body validation, required token header for page/tile, path/token mismatch rejection before execution, stable error codes, MVT MIME, empty-tile 204, cancellation-safe request handling, and preservation of `/tiles/{z}/{x}/{y}.mvt`.

- [ ] **Step 4: Implement `app/http/queries.py` as a transport adapter**

Define narrow models and protocol methods; handlers call `query`, `validate_query_identity`, `page`, and `render_tile` only.

```py
class QueryPageHttpRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    offset: int = Field(ge=0)
    page_size: int = Field(default=100, ge=1, le=1_000)

@router.post("/api/queries/{query_id}/pages")
async def query_page(
    query_id: str,
    request: QueryPageHttpRequest,
    query_token: Annotated[str | None, Header(alias=QUERY_TOKEN_HEADER)] = None,
) -> Response:
    token = required_query_token(query_token)
    service.validate_query_identity(token, query_id)
    return JSONResponse(await service.page(token, request.offset, request.page_size))
```

Use the existing error mapping rather than returning exception or DuckDB text. Wire the router through `HttpDependencies`; pass the same `QueryApplicationService` instance used by FastMCP and legacy tiles.

- [ ] **Step 5: Add exact-origin CORS for nested tiles**

Parse `DATASET_MCP_WEBAPP_ORIGINS` as a comma-separated tuple of absolute HTTPS origins, permitting `http://localhost` and `http://127.0.0.1` only for local development. Reflect `Access-Control-Allow-Origin` only for a configured request origin. Allow `GET, OPTIONS` and `X-HIFLD-Query-Token`; use `Vary: Origin, X-HIFLD-Query-Token`. Keep legacy tile CORS behavior stable for MCP App callers.

- [ ] **Step 6: Run targeted and full dataset-mcp gates**

```bash
cd dataset-mcp
uv run pytest tests/test_http_queries.py tests/test_token_codec.py tests/test_query_application.py tests/test_tiles.py tests/test_http_app.py -q
uv run ruff check .
uv run ruff format --check .
uv run pyright
uv run basedpyright
uv run pytest
```

Expected: every command exits 0.

- [ ] **Step 7: Commit the REST surface**

```bash
git add dataset-mcp/app dataset-mcp/tests
git commit -m "feat(dataset-mcp): expose stateless query resources"
```

### Task 3: Bounded catalog/schema HTTP contracts and shaping

**Files:**
- Modify: `webapp/src/routes/api/collections.$collectionSlug.datasets.$datasetSlug.files.$fileSlug.schema.ts`
- Modify: `webapp/src/lib/api-links.ts`
- Modify: `webapp/src/lib/openapi/spec.ts`
- Create: `webapp/src/lib/webmcp/catalogShapes.ts`
- Test: `webapp/src/lib/openapi/__tests__/spec.test.ts`
- Test: `webapp/src/lib/webmcp/__tests__/catalogShapes.test.ts`
- Test: `webapp/src/routes/__tests__/api-schema-paging.test.ts`

- [ ] **Step 1: Write failing schema paging tests**

Verify omitted paging parameters preserve the existing full `schema.columns` response. With `column_offset=25&column_limit=25`, assert `schema.columns` contains that slice and the top-level response includes:

```ts
{
  total_columns: 73,
  column_offset: 25,
  column_limit: 25,
  has_more: true,
}
```

Reject negative offsets, zero limits, and limits above 50 with RFC 7807 responses.

- [ ] **Step 2: Implement compatible paging and canonical links**

Parse paging only when either paging parameter is present. Default tool paging to 25, cap at 50, and retain the legacy unpaged response when neither is present. Extend `schemaSelf` to encode `version`, `column_offset`, and `column_limit` through typed options.

- [ ] **Step 3: Define bounded WebMCP catalog shapes**

Create explicit Zod response schemas and shaping functions. `get_dataset_file` may return catalog IDs, slugs, versions, format names, bounded spatial/schema summaries, query source references, and canonical same-origin links. It must omit `url`, `storage_uri`, `glob_pattern`, storage config, physical paths, and complete descriptions.

```ts
export const QuerySourceRefSchema = z.object({
  alias: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/),
  collection_id: z.number().int().positive(),
  dataset_id: z.number().int().positive(),
  file_id: z.number().int().positive(),
  file_source_id: z.number().int().positive(),
});
```

Test that serialized shaped results stay under 1,500 characters or set `truncated: true` at complete list/field boundaries.

- [ ] **Step 4: Update OpenAPI and verify**

Document `column_offset`, `column_limit`, and paging fields in `openapi/spec.ts`. Run:

```bash
cd webapp
npm test -- src/lib/openapi src/lib/webmcp/__tests__/catalogShapes.test.ts src/routes/__tests__/api-schema-paging.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit bounded catalog contracts**

```bash
git add webapp/src/routes/api webapp/src/lib/api-links.ts webapp/src/lib/openapi webapp/src/lib/webmcp/catalogShapes.ts webapp/src/lib/webmcp/__tests__/catalogShapes.test.ts webapp/src/routes/__tests__/api-schema-paging.test.ts
git commit -m "feat(webapp): add bounded schema and catalog contracts"
```

### Task 4: Map layer union and pure command contracts

**Files:**
- Modify: `webapp/src/components/map/multiLayerSources.ts`
- Modify: `webapp/src/components/map/featureSelection.ts`
- Modify: `webapp/src/components/viewer/types.ts`
- Create: `webapp/src/components/map/mapWorkspaceCommands.ts`
- Test: `webapp/src/components/map/__tests__/multiLayerMap.test.ts`
- Test: `webapp/src/components/map/__tests__/featureSelection.test.ts`
- Create: `webapp/src/components/map/__tests__/mapWorkspaceCommands.test.ts`

- [ ] **Step 1: Write failing discriminated-union tests**

Define expected source kinds and stable IDs:

```ts
type LoadedMapLayer = CatalogPmtilesLayer | QueryMvtLayer;

expect(buildQueryMvtLayer(queryResult).kind).toBe("query_mvt");
expect(buildLoadedMapLayer(catalogInput).kind).toBe("catalog_pmtiles");
expect(buildQueryMvtLayer(queryResult).id).toBe(`query:${queryResult.queryId}`);
```

Query layers carry `queryId`, label, source aliases, geometry column, tile template, scalar field metadata, bounds, and `status`. Tokens remain in query workspace state, not the public layer model.
Keep `buildLoadedMapLayer` as the catalog constructor so existing route/tests and
callers remain compatible; only its returned discriminant is additive.

- [ ] **Step 2: Implement source-kind-aware feature normalization**

Preserve existing catalog selection output. Add a query selection identity that uses `queryId`, source-layer ID, and feature ID without inventing dataset slugs. Update diff eligibility so only compatible catalog selections enter version-diff mode.

- [ ] **Step 3: Write failing command validation tests**

Cover add/remove, visibility, complete-order validation, constrained style updates, one-of camera targets, basemap, selection clearing, and atomic rejection. Public contracts:

```ts
export interface MapWorkspaceCommands {
  addDatasetLayer(input: DatasetLayerInput): Promise<MapLayerSummary>;
  removeLayer(layerId: string): void;
  setLayerVisibility(layerId: string, visible: boolean): void;
  setLayerStyle(styleLayerId: string, update: LayerStyleUpdate): void;
  reorderLayers(layerIds: string[]): void;
  setCamera(camera: MapCameraInput): Promise<MapCameraState>;
  setBasemap(mode: BasemapMode): void;
  clearSelection(): void;
}
```

Reject raw MapLibre expressions, unknown fields/palettes, incomplete orders, invalid breaks/ranges/scales, and camera inputs containing more than one target form.

- [ ] **Step 4: Implement pure helpers and run focused tests**

```bash
cd webapp
npm test -- src/components/map/__tests__/multiLayerMap.test.ts src/components/map/__tests__/featureSelection.test.ts src/components/map/__tests__/mapWorkspaceCommands.test.ts
npm run typecheck
```

Expected: PASS without editing the collection map route.

- [ ] **Step 5: Commit the map model**

```bash
git add webapp/src/components/map webapp/src/components/viewer/types.ts
git commit -m "refactor(webapp): define typed map workspace commands"
```

### Task 5: Six global catalog WebMCP tools and visible search synchronization

**Files:**
- Modify: `webapp/src/components/WebMcpProvider.tsx`
- Modify: `webapp/src/routes/collections.$slug.tsx`
- Create: `webapp/src/lib/webmcp/catalogTools.ts`
- Create: `webapp/src/lib/webmcp/__tests__/catalogTools.test.tsx`
- Test: `webapp/src/routes/__tests__/collections.$slug.test.tsx`

- [ ] **Step 1: Write failing tool tests**

Register and execute exactly:

```text
list_collections
get_collection
search_datasets
get_dataset
get_dataset_file
get_dataset_file_schema
```

Verify collection-first discovery, filter-key/value paging, search cap 20, schema cap 50, canonical links, annotations, cancellation, stable failures, output budget, and absence of source URLs/tokens/physical paths.

- [ ] **Step 2: Implement abortable same-origin catalog fetches**

Parse every response with explicit Zod schemas at the browser boundary. `get_collection` combines `/api/collections/{slug}` metadata with `/datasets/tags`, slicing `filter_offset`/`filter_limit`. The tool never asks an agent to construct encoded tag-filter JSON.

- [ ] **Step 3: Make collection search state URL-backed**

Extend the route's validated search with an optional `tag_filters` JSON string matching the existing public API convention. Parse that boundary into `DatasetTags`; the shared `applyDatasetSearch` command accepts the typed record and serializes it canonically into the URL. Human controls and `search_datasets` both use that command, which updates URL parameters, visible filters, and cards before resolving. Add a `source: "human" | "webmcp"` option so a WebMCP search does not emit the existing raw-query analytics event.

- [ ] **Step 4: Mount global tools and verify registration stability**

Define schemas and descriptors at module scope. The provider passes current route/navigation commands through refs so normal rerenders do not unregister tools.

Run:

```bash
cd webapp
npm test -- src/lib/webmcp/__tests__/catalogTools.test.tsx 'src/routes/__tests__/collections.$slug.test.tsx'
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit catalog tools**

```bash
git add webapp/src/components/WebMcpProvider.tsx webapp/src/lib/webmcp/catalogTools.ts webapp/src/lib/webmcp/__tests__/catalogTools.test.tsx 'webapp/src/routes/collections.$slug.tsx' 'webapp/src/routes/__tests__/collections.$slug.test.tsx'
git commit -m "feat(webapp): expose catalog WebMCP tools"
```

### Task 6: Route-scoped file version comparison tool

**Files:**
- Modify: `webapp/src/components/dataset/VersionCompare.tsx`
- Modify: `webapp/src/routes/collections.$collectionSlug.datasets.$datasetSlug.files.$fileSlug.compare.tsx`
- Create: `webapp/src/lib/webmcp/versionComparisonTool.ts`
- Test: `webapp/src/components/dataset/__tests__/VersionCompare.test.tsx`
- Test: `webapp/src/routes/__tests__/collections.$collectionSlug.datasets.$datasetSlug.files.$fileSlug.compare.test.ts`

- [ ] **Step 1: Extract and test a pure bounded comparison**

Return changed file metadata plus bounded `added_columns`, `removed_columns`, and `changed_columns`; do not compare data rows. Test identical, changed, missing-version, and truncated-column cases.

- [ ] **Step 2: Register `compare_file_versions` only on the comparison route**

Validate both versions against the route's actual source options, call the same comparison helper as the UI, update both visible selectors, and resolve after the comparison is rendered. Return canonical map links when both versions have PMTiles.

- [ ] **Step 3: Run focused tests and commit**

```bash
cd webapp
npm test -- src/components/dataset/__tests__/VersionCompare.test.tsx 'src/routes/__tests__/collections.$collectionSlug.datasets.$datasetSlug.files.$fileSlug.compare.test.ts'
git add webapp/src/components/dataset/VersionCompare.tsx 'webapp/src/routes/collections.$collectionSlug.datasets.$datasetSlug.files.$fileSlug.compare.tsx' webapp/src/lib/webmcp/versionComparisonTool.ts webapp/src/components/dataset/__tests__/VersionCompare.test.tsx 'webapp/src/routes/__tests__/collections.$collectionSlug.datasets.$datasetSlug.files.$fileSlug.compare.test.ts'
git commit -m "feat(webapp): expose file comparison tool"
```

### Task 7: Same-origin webapp query proxy and typed client

**Files:**
- Modify: `webapp/src/env/server.ts`
- Create: `webapp/src/lib/query-api.ts`
- Create: `webapp/src/routes/api/queries.ts`
- Create: `webapp/src/routes/api/queries.$queryId.pages.ts`
- Test: `webapp/src/lib/__tests__/query-api.test.ts`
- Test: `webapp/src/routes/__tests__/api-queries.test.ts`

- [ ] **Step 1: Write failing proxy tests**

Assert the create route forwards only `Content-Type` and a generated request ID. Assert the page route also forwards `X-HIFLD-Query-Token`. Both forward `request.signal`, preserve structured status/error bodies, never forward cookies, and never expose the internal service URL.

- [ ] **Step 2: Define and parse query contracts**

Use strict Zod schemas for source references, columns, JSON scalar row values, paging state, `query_id`, private `query_token`, and map configuration. Reject binary, raw geometry, unexpected URLs, and malformed error envelopes at the proxy/client boundary.

- [ ] **Step 3: Implement the two proxy routes**

`POST /api/queries` forwards to `${DATASET_MCP_QUERY_API_URL}/api/queries`. `POST /api/queries/{queryId}/pages` forwards to the matching resource path. Do not add a tile proxy: MapLibre loads the absolute public dataset-mcp tile URL directly with exact-origin CORS.

- [ ] **Step 4: Verify and commit**

```bash
cd webapp
npm test -- src/lib/__tests__/query-api.test.ts src/routes/__tests__/api-queries.test.ts
npm run typecheck
npm run build
git add webapp/src/env/server.ts webapp/src/lib/query-api.ts webapp/src/routes/api/queries.ts 'webapp/src/routes/api/queries.$queryId.pages.ts' webapp/src/lib/__tests__/query-api.test.ts webapp/src/routes/__tests__/api-queries.test.ts
git commit -m "feat(webapp): proxy stateless query resources"
```

### Task 8: MapLibre query MVT sources, token routing, ordering, and camera readiness

**Files:**
- Modify: `webapp/src/components/viewer/useMapInitialization.ts`
- Modify: `webapp/src/components/viewer/useLayerStyling.ts`
- Create: `webapp/src/components/map/useMapWorkspaceCommands.ts`
- Test: `webapp/src/components/viewer/__tests__/useMapInitialization.test.tsx`
- Test: `webapp/src/components/map/__tests__/useMapWorkspaceCommands.test.tsx`

- [ ] **Step 1: Write failing source and token-routing tests**

Verify catalog PMTiles and query MVT sources coexist, clean up independently, and yield vector metadata. `transformRequest` extracts only `/api/queries/{query_id}/tiles/`, looks up the token in a private ref, and returns the header. Unknown local IDs return a blocked request result and produce a bounded layer error; tokens never appear in URLs or public layer summaries.

- [ ] **Step 2: Implement the source-kind branch**

Keep PMTiles metadata loading unchanged. For `query_mvt`, create a vector source using the server tile template and server-returned source layer/scalar field metadata. Reuse `addRenderedLayersForVectorLayer` and `useLayerStyling`; exclude geometry and non-scalar columns from style fields.

- [ ] **Step 3: Write failing camera/order/readiness tests**

Test initial route layers fit their known union once, the first layer added to an empty workspace fits once, later additions preserve camera, explicit layer/feature/bounds/center targets work, invalid mixed targets make no state change, and commands resolve on `moveend` or a stable map error.

- [ ] **Step 4: Bind commands to map and React state**

Implement `useMapWorkspaceCommands` with current-state refs, map-ready/movement promises, atomic validation, catalog-only import analytics, and complete layer ordering that preserves basemap placement. Human and WebMCP callers receive the same command object.

- [ ] **Step 5: Verify and commit**

```bash
cd webapp
npm test -- src/components/viewer/__tests__/useMapInitialization.test.tsx src/components/map/__tests__/useMapWorkspaceCommands.test.tsx
npm run typecheck
git add webapp/src/components/viewer webapp/src/components/map/useMapWorkspaceCommands.ts webapp/src/components/map/__tests__/useMapWorkspaceCommands.test.tsx
git commit -m "feat(webapp): support query MVT map sources"
```

### Task 9: Query result workspace and visible query layers

**Files:**
- Create: `webapp/src/components/map/queryResults.ts`
- Create: `webapp/src/components/map/QueryResultPanel.tsx`
- Create: `webapp/src/components/map/MapLayerListItem.tsx`
- Modify: `webapp/src/routes/collections.$collectionSlug.map.tsx`
- Test: `webapp/src/components/map/__tests__/QueryResultPanel.test.tsx`
- Test: `webapp/src/components/map/__tests__/MapLayerListItem.test.tsx`
- Test: `webapp/src/routes/__tests__/collections.$collectionSlug.map.test.tsx`
- Test: `webapp/src/routes/__tests__/MapWorkspace.analytics.test.tsx`

- [ ] **Step 1: Write failing query workspace reducer tests**

Model private state explicitly:

```ts
export interface QueryWorkspaceResult {
  queryId: string;
  queryToken: string;
  label: string;
  sources: QuerySourceRef[];
  columns: QueryColumn[];
  rows: QueryRow[];
  offset: number;
  limit: number;
  hasMore: boolean;
  mapLayerId: string | null;
  warnings: string[];
}
```

Test sequential default labels, focused result, page replacement, private token lookup, map attachment/detachment, and removal preserving result/page/token state.

- [ ] **Step 2: Write and implement the query result table**

Render the current bounded server page with the existing Hightable dependency and `arrayDataFrame(rows)`. Limit its descriptors to the server column list and let Hightable manage column visibility without enabling its client sorting wrapper. Add Previous/Next paging, warnings, elapsed/read metrics, `On map`, `Focus layer`, and human `Show on map`. Do not use `ParquetViewerPanel`, Hyparquet, client sorting, or GeoJSON.

- [ ] **Step 3: Refactor the loaded layer row into a discriminated component**

Catalog rows retain `Open file`. Query rows show `Query result`, label, source aliases/geometry, `loading | ready | error`, visibility/remove, and `View results`. Both feed the existing Style layers list and layer ordering.

- [ ] **Step 4: Integrate one shared command path into `MapWorkspace`**

Replace direct add/remove/visibility/basemap/camera state mutations with `useMapWorkspaceCommands`. Guard every catalog-only descriptor access with `kind === "catalog_pmtiles"`. Query layers must be excluded from catalog-import analytics and catalog back links. Render the query panel in the existing lower resizable workspace without removing selected-feature functionality.

- [ ] **Step 5: Test partial map failure and bidirectional linking**

When query rows succeed but source setup fails, keep the table, display a bounded warning, set the visible layer status to `error`, and never report it as ready. Removing a query layer retains paging and exposes `Show on map`; `View results` focuses the corresponding table.

- [ ] **Step 6: Verify and commit**

```bash
cd webapp
npm test -- src/components/map/__tests__/QueryResultPanel.test.tsx src/components/map/__tests__/MapLayerListItem.test.tsx 'src/routes/__tests__/collections.$collectionSlug.map.test.tsx' src/routes/__tests__/MapWorkspace.analytics.test.tsx
npm run typecheck
git add webapp/src/components/map 'webapp/src/routes/collections.$collectionSlug.map.tsx' 'webapp/src/routes/__tests__/collections.$collectionSlug.map.test.tsx' webapp/src/routes/__tests__/MapWorkspace.analytics.test.tsx
git commit -m "feat(webapp): add pageable query map workspace"
```

### Task 10: Ten contextual map WebMCP tools

**Files:**
- Create: `webapp/src/components/map/webmcpMapTools.ts`
- Create: `webapp/src/components/map/__tests__/webmcpMapTools.test.tsx`
- Modify: `webapp/src/routes/collections.$collectionSlug.map.tsx`

- [ ] **Step 1: Write failing registration-state tests**

Register exactly:

```text
get_map_state
add_dataset_layer
remove_map_layer
set_layer_visibility
set_layer_style
reorder_map_layers
set_map_camera
set_basemap
get_map_selection
clear_map_selection
```

An empty map exposes `get_map_state`, `add_dataset_layer`, `set_map_camera`, and `set_basemap`; layer/selection tools appear only while usable. Registration changes by capability state, never once per layer.

- [ ] **Step 2: Test command delegation and bounded summaries**

Use a fake `MapWorkspaceCommands`. Assert tools call shared commands, wait for completion, shape stable IDs and scalar style fields, page selection properties, reject invalid targets atomically, and return no token, URL, SQL, geometry, feature dump, or stack trace. `get_map_state` includes query ID, status, order, visibility, styles, current result page summary, and associated map layer.

- [ ] **Step 3: Implement route-scoped registrations**

Schemas live at module scope and stay under documented name/parameter/description budgets. Read tools use `readOnlyHint: true`; visible mutations use `false`; catalog and feature-derived outputs set `untrustedContentHint: true`.

- [ ] **Step 4: Verify and commit**

```bash
cd webapp
npm test -- src/components/map/__tests__/webmcpMapTools.test.tsx
npm run typecheck
git add webapp/src/components/map/webmcpMapTools.ts webapp/src/components/map/__tests__/webmcpMapTools.test.tsx 'webapp/src/routes/collections.$collectionSlug.map.tsx'
git commit -m "feat(webapp): expose map workspace tools"
```

### Task 11: Server query execution and paging WebMCP tools

**Files:**
- Create: `webapp/src/components/map/webmcpQueryTools.ts`
- Create: `webapp/src/components/map/__tests__/webmcpQueryTools.test.tsx`
- Modify: `webapp/src/routes/collections.$collectionSlug.map.tsx`

- [ ] **Step 1: Write failing query tool tests**

Register `run_dataset_query` while the query-enabled map workspace is mounted and `set_result_page` only while a current query can page. Cover one source, eight-source maximum, complex join SQL, limit default 100/server maximum, `show_on_map` default true, optional 80-character `layer_label`, ambiguous/no geometry warning, cancellation, page changes, and multiple simultaneous token mappings.

- [ ] **Step 2: Implement `run_dataset_query` through the typed client**

Send catalog `QuerySourceRef` identities only. Store the token privately, create/focus the result panel, then append a query layer when spatial and requested. Resolve after the table and visible layer row are rendered and the layer status is stable; do not wait for every tile. Return at most five preview rows within 1,500 characters.

- [ ] **Step 3: Implement `set_result_page`**

Look up the private token by `query_id`, call `/api/queries/{query_id}/pages`, update the visible table before resolving, and return only offset, page size, row count, `has_more`, and at most two preview rows.

- [ ] **Step 4: Verify cancellation and secrecy, then commit**

```bash
cd webapp
npm test -- src/components/map/__tests__/webmcpQueryTools.test.tsx
npm run typecheck
git add webapp/src/components/map/webmcpQueryTools.ts webapp/src/components/map/__tests__/webmcpQueryTools.test.tsx 'webapp/src/routes/collections.$collectionSlug.map.tsx'
git commit -m "feat(webapp): expose server query tools"
```

### Task 12: Privacy-bounded observability and origin-trial deployment

**Files:**
- Modify: `webapp/src/lib/analytics.ts`
- Test: `webapp/src/lib/__tests__/analytics.test.ts`
- Create: `webapp/plugins/webmcp-origin-trial.ts`
- Create: `webapp/plugins/__tests__/webmcp-origin-trial.test.ts`
- Modify: `webapp/nitro.config.ts`
- Modify: `dataset-mcp/app/observability.py`
- Modify: `dataset-mcp/app/http/queries.py`
- Test: `dataset-mcp/tests/test_http_queries.py`

- [ ] **Step 1: Write failing analytics privacy tests**

Assert events contain only `tool_name`, `route_kind`, `duration_bucket`, optional stable `error_code`, and optional coarse `result_count_bucket`. Pass sentinel SQL, token, URL, source ID, row value, geometry, and stack text into the helper and assert none appear in serialized capture properties.

- [ ] **Step 2: Implement started/completed/failed events**

Instrument the shared adapter around execution. Ensure WebMCP-initiated catalog search does not also call existing raw-query analytics. Add dataset-mcp transport labels with only `mcp` and `webapp_http`; do not use query IDs, origins, paths, SQL, or source IDs as metric labels.

- [ ] **Step 3: Write and implement the origin-trial header plugin**

Register a Nitro response hook that adds `Origin-Trial` only when `WEBMCP_ORIGIN_TRIAL_TOKEN` is non-empty. Assert it never appears in `/runtime-config.js`, client config, HTML source text, or logs.

- [ ] **Step 4: Verify and commit**

```bash
cd webapp
npm test -- src/lib/__tests__/analytics.test.ts plugins/__tests__/webmcp-origin-trial.test.ts
cd ../dataset-mcp
uv run pytest tests/test_http_queries.py -q
git add webapp/src/lib/analytics.ts webapp/src/lib/__tests__/analytics.test.ts webapp/plugins webapp/nitro.config.ts dataset-mcp/app/observability.py dataset-mcp/app/http/queries.py dataset-mcp/tests/test_http_queries.py
git commit -m "feat: add private WebMCP telemetry and trial headers"
```

### Task 13: Agent, API, and deployment documentation

**Files:**
- Modify: `webapp/public/llms.txt`
- Modify: `webapp/src/lib/agent-skills.ts`
- Modify: `webapp/src/lib/__tests__/llms-txt.test.ts`
- Modify: `webapp/src/lib/__tests__/agent-skills.test.ts`
- Modify: `webapp/src/routes/api/index.ts`
- Modify: `webapp/src/lib/openapi/spec.ts`
- Modify: `webapp/src/lib/openapi/__tests__/spec.test.ts`
- Modify: `webapp/README.md`
- Modify: `dataset-mcp/README.md`
- Modify: `charts/webapp/values.yaml`

- [ ] **Step 1: Update machine-readable API discovery**

Document the two same-origin POST routes, token-header requirement, query ID path semantics, paging bounds, stable problems, and direct public MVT URL. Do not document the internal service URL or imply the JSON catalog API is writable.

- [ ] **Step 2: Correct agent-facing wording**

Replace “no MCP/action tools” with: the JSON API remains read-only; supported browsers may expose contextual WebMCP tools that read catalog/query data and modify only the current browser workspace. List the 19 tool names and collection-first workflow without embedding full schemas in `llms.txt`.

- [ ] **Step 3: Document operations**

Document `WEBMCP_ENABLED`, `WEBMCP_ORIGIN_TRIAL_TOKEN`, server-only `DATASET_MCP_QUERY_API_URL`, and dataset-mcp `DATASET_MCP_WEBAPP_ORIGINS`. Include local SeaweedFS/GCS query setup already supported by dataset-mcp, native Chrome flag/origin-trial testing, unsupported-browser behavior, and the absence of Valkey/result persistence.

- [ ] **Step 4: Test generated docs and commit**

```bash
cd webapp
npm test -- src/lib/__tests__/llms-txt.test.ts src/lib/__tests__/agent-skills.test.ts src/lib/openapi/__tests__/spec.test.ts
git add webapp/public/llms.txt webapp/src/lib/agent-skills.ts webapp/src/lib/__tests__/llms-txt.test.ts webapp/src/lib/__tests__/agent-skills.test.ts webapp/src/routes/api/index.ts webapp/src/lib/openapi webapp/README.md dataset-mcp/README.md charts/webapp/values.yaml
git commit -m "docs: describe WebMCP and query HTTP surfaces"
```

### Task 14: Browser acceptance and final repository gates

**Files:**
- Modify: `webapp/package.json`
- Modify: `webapp/package-lock.json`
- Create: `webapp/playwright.config.ts`
- Create: `webapp/e2e/webmcp.spec.ts`
- Create: `webapp/e2e/modelContextHarness.ts`
- Modify: `.github/workflows/dataset-mcp-quality.yml`

- [ ] **Step 1: Add Playwright and a deterministic real-browser harness**

Install `@playwright/test` as a development dependency and add `test:e2e`. The harness injects the standards-shaped `document.modelContext` fake before hydration, but all tool callbacks, UI rendering, HTTP requests, MapLibre adapters, and route transitions execute in a real browser page.

```bash
cd webapp
npm install --save-dev @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Script the seven acceptance flows**

Cover collection/filter/search/file/schema discovery; version comparison; two catalog layers with style/order/camera/visibility; one-source query paging; two-source spatial join with visible/styleable MVT layer; cancellation and recovery; and unsupported-browser ordinary workflows. Assert query tokens never appear in page URLs, tool outputs, analytics requests, or console logs.

- [ ] **Step 3: Add an opt-in native Chrome smoke lane**

Run a real localhost origin in headed supported Chrome with the current WebMCP flag or an origin-trial token. Discover tools through `document.modelContext.getTools()` and execute one read and one UI mutation through `executeTool()`. Keep this separate from the deterministic headless release gate because current headless Chrome exposure has varied across preview versions.

- [ ] **Step 4: Run focused end-to-end and performance checks**

Use local SeaweedFS and one public GCS-backed large GeoParquet fixture. Measure first page, next page, and bbox-constrained tile requests for a large scan and complex join. Record timings and bytes read in test output without hard-coding brittle internet latency thresholds; assert server timeout, memory, row, page, tile-density, and output caps remain enforced.

- [ ] **Step 5: Run every required quality gate**

```bash
cd dataset-mcp
uv run ruff check .
uv run ruff format --check .
uv run pyright
uv run basedpyright
uv run pytest

cd ../webapp
npm run check
npm run typecheck
npm test
npm run build
npm run test:e2e
```

If implementation touches `dataset-api`, also run from `dataset-api/`:

```bash
uv run ruff check .
uv run ruff format --check .
uv run pyright
uv run basedpyright
uv run pytest
```

Expected: every required command exits 0. Report exact remaining failures rather than weakening or skipping a gate.

- [ ] **Step 6: Commit browser acceptance**

```bash
git add webapp/package.json webapp/package-lock.json webapp/playwright.config.ts webapp/e2e .github/workflows/dataset-mcp-quality.yml
git commit -m "test: add WebMCP browser acceptance"
```

## Final acceptance checklist

- [ ] Unsupported browsers render and behave exactly as before.
- [ ] Only route/state-valid tools are registered, with 19 total tool names across all contexts.
- [ ] Tool schemas and runtime validation come from the same Zod definitions.
- [ ] Tool outputs stay within 1,500 characters and carry correct trust/read-only annotations.
- [ ] Catalog discovery reaches collections, filters, datasets, files, versions, sources, and paged schema metadata.
- [ ] Search, comparison, map, and query actions visibly update the UI before resolving.
- [ ] Query layers appear in the same Loaded and Style panels as catalog layers and link back to their result table.
- [ ] PMTiles and query MVT layers can coexist, reorder, style, hide, select, fit, and clean up independently.
- [ ] DuckDB executes only in bounded server workers; paging re-executes against cloud GeoParquet.
- [ ] Every tile query is bbox-constrained and every path query ID is verified against its signed token.
- [ ] No credentials, query token, internal origin, physical path, raw SQL, geometry, row dump, or stack trace leaks through URLs, tool results, analytics, or logs.
- [ ] FastMCP, legacy MCP App tiles, SeaweedFS, startup initialization, and existing public JSON routes remain compatible.
- [ ] Required Python, TypeScript, unit, build, and browser gates pass.
