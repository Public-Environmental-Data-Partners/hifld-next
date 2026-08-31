# WebMCP webapp design

## Goal

Add WebMCP to the first-party `webapp` so browser agents can discover HIFLD
datasets, inspect dataset and file metadata, control the existing map workspace,
compare catalog sources, execute bounded server-side DuckDB queries, and control
the visible result table and query-derived map layers.

WebMCP exposes the live browser application. It does not replace the public
FastMCP server. FastMCP remains the persistent backend tool surface for coding
agents and MCP hosts; WebMCP exposes contextual commands and state from the
currently open HIFLD webapp.

## Product decisions

- Register imperative tools with `document.modelContext.registerTool` in the
  top-level `webapp`. Do not add WebMCP to the sandboxed MCP App iframe.
- Use a small repository-owned React adapter and the official `webmcp-types`
  package. Do not depend on the experimental `usewebmcp` React package.
- Feature-detect `document.modelContext`. Unsupported browsers retain the
  complete normal webapp without errors, warnings, or a polyfill.
- Reuse application commands shared with the visible React controls. WebMCP
  callbacks must not simulate clicks or implement a second map, catalog, or
  query state machine.
- Keep catalog identities and tool vocabulary aligned with the FastMCP surface
  where the domain operation is the same.
- Keep DuckDB, SQL validation, cloud credentials, source resolution, paging,
  and MVT generation on the server. The webapp never runs DuckDB-Wasm and never
  accepts an arbitrary object-store URL as a query source.
- Add an ordinary HTTP query surface to `dataset-mcp` and proxy it through
  same-origin webapp routes. The browser does not speak MCP JSON-RPC.
- Continue using signed, self-contained query tokens. Do not add Valkey,
  persisted query results, live cursors, or server-side workspace sessions.
- Treat comparison as composition: add two or more layers, order them, style
  them, and control visibility. Do not add an overlapping generic
  `compare_datasets` tool in the first release.
- Keep tool output small and structured. Full result pages are rendered in the
  UI, not returned through WebMCP.
- Do not expose cross-origin tools with `exposedTo` in the first release.

## Scope

The first release includes:

- Collection listing and detail.
- Collection-scoped dataset search with text, tag filters, and offset paging.
- Discovery of valid collection tag keys and values.
- Dataset, file, source, version, spatial, and bounded schema metadata.
- Navigation to catalog, file, schema, comparison, viewer, and map routes.
- Metadata and schema comparison between two file versions.
- Map state inspection and control for catalog PMTiles sources.
- Adding, removing, ordering, styling, and showing or hiding map layers.
- Camera, basemap, fit-to-layer, and bounded feature-selection controls.
- Arbitrary policy-approved read-only DuckDB queries over as many as eight
  catalog-resolved GeoParquet sources.
- Bounded query result tables and stateless page re-execution.
- Query-derived MVT layers in the same multi-layer map workspace as PMTiles.
- Cancellation propagation from the WebMCP execution signal to browser fetches.
- Unit, integration, and supported-Chrome acceptance tests.
- Updated agent documentation describing the WebMCP surface.

The first release does not include:

- Authentication, private datasets, user-specific authorization, or
  user-provided cloud credentials.
- Global cross-collection dataset search. Agents list collections and then
  search a selected collection, matching the FastMCP discovery flow.
- Persisted queries, saved workspaces, query history, result materialization,
  exports, or downloadable query results.
- Query execution scoped automatically to the current map viewport or feature
  selection. This can be added later as a typed spatial scope.
- Swipe, split-screen, or semantic row-difference map modes. Overlay comparison
  is supported through multiple independently styled layers.
- Raw MapLibre style expressions, arbitrary source URLs, arbitrary browser
  JavaScript, or rendered-feature dumps.
- Agent-triggered downloads or data-quality feedback submissions.
- Cross-origin iframe exposure, declarative WebMCP forms, or a WebMCP polyfill.
- A compatibility path through `navigator.modelContext`.

## Approaches considered

### Native adapter over shared application commands — selected

Create a narrow `useWebMcpTool` lifecycle adapter, define input and result
contracts with Zod, and register route-aware callbacks that call shared catalog,
map, and query commands. This adds little dependency risk, keeps WebMCP at the
application boundary, and lets normal controls and tools exercise identical
behavior.

### Experimental React package

The `usewebmcp` package would reduce initial hook code and provides schema-driven
helpers. It is not selected because both WebMCP and the wrapper are experimental;
owning a small adapter gives the project one unstable boundary instead of two.
The decision can be revisited after the package and browser API stabilize.

### Mirror or call FastMCP from the browser

Automatically converting FastMCP tools or sending MCP JSON-RPC from browser
callbacks would appear to avoid duplicated tool descriptions. It is not
selected because MCP transport and WebMCP lifecycle are different, it would
couple the webapp to MCP session behavior, and it would not solve live map or UI
state. Domain names and response semantics remain aligned, but registration and
transport are intentionally separate.

## Current code constraints

The existing collection map is capable but highly centralized:

- `webapp/src/routes/collections.$collectionSlug.map.tsx` owns layer search,
  layer state, styling, selection, comparison tables, basemap state, and map UI.
- `webapp/src/components/viewer/useMapInitialization.ts` owns the MapLibre
  instance and synchronizes PMTiles sources from `LoadedMapLayer[]`.
- `webapp/src/components/viewer/useLayerStyling.ts` converts the constrained
  `LayerStyle` model into MapLibre paint expressions.
- `webapp/src/components/map/multiLayerSources.ts` models only catalog PMTiles
  layers even though query results must use server-generated MVT.
- `webapp/src/components/dataset/ParquetViewerPanel.tsx` reads Parquet in the
  browser with Hyparquet. It is a preview component and is not a query engine.
- The webapp already exposes same-origin JSON routes for collections, datasets,
  files, schemas, and tag values.
- The current global `/api/datasets` implementation scans collections and is
  not suitable as an agent-facing unbounded search surface.
- The schema JSON route returns every column and needs bounded schema paging for
  WebMCP output.
- `dataset-mcp` already owns the trusted source resolver, SQL policy, DuckDB
  workers, query tokens, result serialization, paging, and MVT routes.

The implementation should improve only the boundaries needed by WebMCP. It
must not rewrite unrelated catalog pages or replace the existing MapLibre and
PMTiles implementation.

## Architecture

```text
Browser agent
    |
    | document.modelContext.executeTool
    v
WebMCP registration adapter
    |
    +--> Catalog commands --> same-origin webapp JSON API --> dataset-api
    |
    +--> Navigation commands --> TanStack Router
    |
    +--> Map commands --> React workspace state --> MapLibre/PMTiles
    |
    `--> Query commands --> same-origin webapp query proxy
                              |
                              v
                         dataset-mcp HTTP query API
                              |
                              +--> source resolver / SQL policy
                              +--> bounded DuckDB worker
                              +--> signed query token
                              `--> bbox-constrained MVT tiles
```

The webapp is the tool owner. Tool callbacks finish only after the associated
visible interface state has been updated. Read tools may fetch and return data
without navigation; action tools update the route or workspace through the
same commands used by human controls.

## WebMCP adapter

Add a focused WebMCP module under `webapp/src/lib/webmcp/`:

```text
webapp/src/lib/webmcp/
  model-context.ts       feature detection and narrow browser types
  schemas.ts             shared input/result schemas and JSON Schema conversion
  result.ts              bounded success and error envelopes
  useWebMcpTool.ts       registration and cleanup lifecycle
  catalog-tools.ts       global catalog tool definitions
```

Map and query registrations live next to their application command hooks under
`webapp/src/components/map/`, rather than importing map state into the global
WebMCP module.

`useWebMcpTool` must:

- Do nothing during SSR or when `document.modelContext` is absent.
- Register through the imperative API after hydration.
- Unregister through an `AbortController` when the owning route/component
  unmounts or the tool becomes inapplicable.
- Avoid re-registering on every render. Callback refs may update while the tool
  identity and schema remain stable.
- Parse callback input with the same Zod schema used to generate JSON Schema.
- Pass the execution `AbortSignal` through to fetch-based commands.
- Convert expected validation, not-found, rate-limit, timeout, and query-policy
  failures into a stable result envelope.
- Allow unexpected programming failures to be logged safely and returned as a
  generic internal error without stack traces.

Use Zod 4 JSON Schema conversion so the registered schema and runtime parser
come from one source. Do not add parallel hand-written TypeScript and JSON
schemas. Application code must not use `any`, `unknown`, `object`, non-null
assertions, or TypeScript suppression comments as escape hatches.

## Registration lifecycle

Global catalog tools are registered once from a provider mounted inside the
root client layout. Contextual route components register only the additional
tools they can execute.

Contextual tools are registered only while usable:

- File-version comparison exists only on the file comparison route.
- Core map tools exist while `MapWorkspace` is mounted.
- Layer mutation tools exist when at least one compatible layer is loaded.
- Selection tools exist only when the selection state makes them meaningful.
- Query paging exists only when an active query has a valid paging token.

Dynamic registration must be state-based, not per selected dataset or per
individual layer. A tool accepts a validated layer or source identifier rather
than registering one tool per entity.

The first release defines 19 tool names: six global catalog tools, one
comparison-route tool, ten map tools, and two query tools. They are never all
registered together. An empty map exposes 11 tools; layer, selection, and paging
tools appear only as those capabilities become usable.

Tools are same-origin only. Do not pass `exposedTo`. Tool descriptions stay
under 500 characters, parameter descriptions under 150 characters, names and
parameter names under 30 characters, and serialized tool results under 1,500
characters.

## Tool result contract

Every tool returns one of two serializable envelopes:

```ts
type WebMcpSuccess<TData extends JsonValue> = {
  ok: true;
  summary: string;
  data: TData;
  truncated?: true;
};

type WebMcpFailure = {
  ok: false;
  error: {
    code: WebMcpErrorCode;
    message: string;
    retryable: boolean;
  };
};
```

Expected domain failures return `WebMcpFailure` rather than rejecting the
execution promise because the current draft does not reliably carry rejection
details to the caller. `summary` is short, factual, and reflects the visible
state after the command completes.

Allowed stable error codes are:

- `invalid_request`
- `not_found`
- `unsupported_state`
- `query_rejected`
- `query_timeout`
- `query_capacity`
- `rate_limited`
- `upstream_unavailable`
- `internal_error`

Tool output must never include credentials, internal service origins, physical
object-store URLs, query tokens, raw geometry payloads, binary values, stack
traces, or complete result pages. Dataset descriptions and row values are
truncated by Unicode code point with an explicit `truncated` marker.

## Catalog tools

The following tools are available throughout the hydrated webapp:

| Tool | Inputs | Behavior | Annotations |
|---|---|---|---|
| `list_collections` | none | Return compact collection identities, names, and canonical links | read-only; untrusted |
| `get_collection` | `collection`, optional `tag_key`, `filter_offset`, `filter_limit` | Return compact collection metadata and bounded valid dataset filter keys/values | read-only; untrusted |
| `search_datasets` | `collection`, optional `search`, `tags`, `limit`, `offset` | Navigate to the collection search state, render the result page, and return compact matches | changes UI state; untrusted |
| `get_dataset` | `collection`, `dataset` | Return complete bounded dataset metadata, its tags, and compact file summaries | read-only; untrusted |
| `get_dataset_file` | `collection`, `dataset`, `file` | Return complete bounded file metadata, formats, all version/source choices, spatial/schema summaries, query-source identities, and canonical links | read-only; untrusted |
| `get_dataset_file_schema` | catalog identities, optional `version`, `column_offset`, `column_limit` | Return one bounded schema page and provenance | read-only; untrusted |

Catalog identity inputs use slugs as displayed by the webapp. Numeric IDs may
be returned as metadata but are not accepted as ambiguous path substitutes.

`get_collection` folds filter discovery into collection metadata. It includes
valid tag keys and bounded value lists from the existing tags endpoint, with
per-list truncation markers when the output budget is reached. Supplying
`tag_key` returns a bounded value page for that key, so the merged tool does not
make uncommon filter values unreachable. A separate filter-discovery tool is
unnecessary. `get_dataset` includes that dataset's actual tags; it does not
repeat every value available across the collection.

`search_datasets` requires `collection`. `limit` defaults to 10 and is capped at
20; `offset` is non-negative. Tags are a typed record of string keys to a
string or string list. The callback serializes them for the existing API rather
than requiring the agent to construct JSON in a query string. Search results
omit long descriptions and source URLs.

`get_dataset_file` includes every published file version and storage choice,
plus the stable logical source reference required by `run_dataset_query`:

```ts
type QuerySourceRef = {
  alias: string;
  collection_id: number;
  dataset_id: number;
  file_id: number;
  file_source_id: number;
};
```

The returned alias is a suggestion derived from catalog metadata. The query
tool revalidates aliases and all catalog identities server-side.

Returning richer dataset and file objects removes separate tools for file lists,
formats, sources, and versions. `get_dataset_file_schema` remains separate
because schemas can contain hundreds of columns, require independent paging,
and may be requested for a version other than the default. Folding schema pages
into every file response would make the common response larger and repeat file
metadata on every schema page.

`get_dataset_file_schema` defaults to 25 columns and caps `column_limit` at 50.
The response includes `total_columns`, `column_offset`, `column_limit`, and
`has_more`. The existing webapp schema API gains compatible optional paging
parameters while preserving its current response fields for callers that omit
them.

## Version comparison tools

The following tool is registered on the file comparison route:

| Tool | Inputs | Behavior | Annotations |
|---|---|---|---|
| `compare_file_versions` | `left_version`, `right_version` | Compare versions of the current file, update the visible comparison, and return bounded metadata/schema changes | changes UI state; untrusted |

Version and source discovery comes from `get_dataset_file`; it is not repeated
as a contextual tool. `compare_file_versions` remains separate because it
computes a diff and synchronizes the visible comparison rather than reading one
catalog object.

The comparison result includes changed file-level metadata and bounded lists of
added, removed, or changed columns. It does not compare data rows. When both
versions have PMTiles, the result identifies that they can be opened together
on the map through their returned canonical map link and the map layer tools.

## Map workspace boundary

Refactor `MapWorkspace` into state plus a typed command interface without
changing the visible behavior:

```ts
interface MapWorkspaceCommands {
  addDatasetLayer(input: DatasetLayerInput): Promise<MapLayerSummary>;
  removeLayer(layerId: string): void;
  setLayerVisibility(layerId: string, visible: boolean): void;
  setLayerStyle(layerId: string, style: LayerStyleUpdate): void;
  reorderLayers(layerIds: string[]): void;
  setCamera(camera: MapCameraInput): Promise<MapCameraState>;
  setBasemap(mode: BasemapMode): void;
  clearSelection(): void;
}
```

Human controls and WebMCP callbacks call this interface. The command layer owns
catalog resolution, state updates, analytics, and map readiness errors. The
MapLibre hook remains responsible for translating declarative workspace state
into sources, layers, paint, layout, and camera changes.

Broaden the map source model into a discriminated union:

```ts
type LoadedMapLayer = CatalogPmtilesLayer | QueryMvtLayer;
```

Both variants expose a stable layer ID, label, visibility, opacity, bounds when
known, and vector-layer metadata. Only the catalog variant contains a source
descriptor and PMTiles URL. Only the query variant contains the in-memory query
token and server MVT configuration. The token remains private React state and
is omitted from WebMCP results, URLs, analytics, and logs.

Multiple query layers may have different tokens even though the server returns
the same tile path template. Each `QueryMvtLayer` therefore receives a random,
non-secret client layer key. The webapp appends that key to its tile template as
an allowlisted query parameter and maintains an in-memory key-to-token map.
MapLibre's `transformRequest` uses the key to attach the correct token header to
each tile request. The dataset-mcp tile handler accepts but does not interpret
the client key. This also gives MapLibre distinct cache keys without placing a
query token in the URL. Unknown keys fail closed and no tile request is sent.

Map source IDs and style layer IDs are generated by the application and cannot
be provided by an agent. Style tools target the stable IDs returned by
`get_map_state`.

The public tool contract distinguishes two levels of identity:

- `map_layer_id` identifies one loaded catalog or query source and is used for
  removal, visibility, ordering, and fitting.
- `style_layer_id` identifies one vector sublayer within a loaded source and is
  used for field-aware styling.

`get_map_state` nests style-layer summaries under their owning map layer so an
agent never has to infer the relationship from generated MapLibre IDs.

## Map tools

The following tools are registered by `MapWorkspace`:

| Tool | Inputs | Behavior | Registration |
|---|---|---|---|
| `get_map_state` | none | Return camera, basemap, layer order, visibility, style summaries, valid style fields, and selection count | map mounted |
| `add_dataset_layer` | catalog/source identities, optional initial visibility/style | Resolve and add one PMTiles source, leaving existing layers intact | map mounted |
| `remove_map_layer` | `map_layer_id` | Remove one catalog or query layer | at least one layer |
| `set_layer_visibility` | `map_layer_id`, `visible` | Show or hide the selected layer | at least one layer |
| `set_layer_style` | `style_layer_id`, constrained partial style | Update field, palette, breaks, opacity, radius, or line width | compatible vector layer loaded |
| `reorder_map_layers` | complete ordered `map_layer_ids` | Set dataset layer stacking while preserving basemap placement | at least two layers |
| `set_map_camera` | explicit bounds, center/zoom, `map_layer_ids`, or selected `feature_id`; optional bearing/pitch/padding | Resolve the target, move the map, and return the settled camera state | map ready |
| `set_basemap` | `street` or `satellite` | Change the visible basemap | map ready |
| `get_map_selection` | optional `offset`, `limit` | Return a bounded page of normalized selected feature properties | selection exists |
| `clear_map_selection` | none | Clear selected features and the selection box | selection exists |

All map mutation tools set `readOnlyHint: false` because they change visible
application state. Map state containing dataset labels, field names, or feature
properties sets `untrustedContentHint: true`. `get_map_state` and
`get_map_selection` set `readOnlyHint: true`; all other map tools set it to
`false`.

`set_layer_style` accepts the existing constrained style vocabulary. It rejects
unknown fields, palettes, invalid manual breaks, out-of-range opacity, radius,
or width, and scale modes incompatible with the field. It never accepts raw
MapLibre expressions or arbitrary JSON style fragments.

`reorder_map_layers` requires every currently loaded map layer exactly once.
This avoids accidental deletion, duplication, or partial ordering ambiguity.

`set_map_camera` accepts exactly one target form. Layer IDs resolve to the union
of their known bounds; a feature ID resolves only from the current bounded
selection. This single camera tool replaces separate fit-to-layer and
zoom-to-feature tools without forcing the agent to copy coordinates from a
previous response.

The current webapp does not fit a source when it is loaded. This feature changes
that behavior deliberately: the initial route layers fit to their union once
the map is ready, and the first layer added to an empty workspace fits when its
bounds are known. Adding later layers does not move the camera, preserving the
user's comparison context. An explicit `set_map_camera` call can fit any later
layer or selected feature.

Overlay comparison is achieved by adding multiple sources, ordering them, and
using style and visibility tools. The tool descriptions explicitly call out
this workflow so a separate overlapping comparison tool is unnecessary.

## Query HTTP API

Add ordinary HTTP handlers to `dataset-mcp` next to the existing MCP and tile
routes. They call the same application service used by FastMCP:

- `POST /api/queries` accepts `sources`, `sql`, `limit`, optional
  `geometry_column`, and optional `result_crs`.
- `POST /api/query-pages` accepts `query_token`, `offset`, and `page_size`.

These endpoints return the existing structured query/page contracts and stable
error codes. They do not add alternate source resolution, SQL policy, worker,
serialization, token, or tile implementations.

The webapp exposes same-origin proxy routes with the same request semantics.
The proxy calls a new server-only `DATASET_MCP_QUERY_API_URL`. It forwards the
browser cancellation signal, a generated request ID, and only required
headers. It does not forward cookies or arbitrary client headers.

The query service remains the security and capacity boundary. The webapp proxy
does not claim to make a query safe. Existing query size, source count,
function, timeout, memory, concurrency, page, result, and token limits remain
authoritative.

Query responses contain an absolute public tile URL generated from
`DATASET_MCP_PUBLIC_ORIGIN`. The dataset-mcp deployment allows the configured
webapp origins to request MVT tiles and send the query-token header. CORS allows
only `GET`, the required token/request headers, and configured HTTPS origins;
it does not use wildcard origin with credentials.

The browser stores the signed query token only in transient workspace state.
The WebMCP result contains a short opaque `query_id` generated by the webapp for
selecting among current in-tab results; that ID is not accepted by the server
and does not survive reload.

## Query workspace and tools

The collection map route gains a query-results workspace integrated with its
existing bottom/table panel. It can show the first bounded result page, switch
pages, let the human choose visible columns, and show a spatial result as a
query MVT layer. It does not use `ParquetViewerPanel` or Hyparquet for query
results.

`run_dataset_query` is registered while the collection map workspace is
mounted. Agents arriving elsewhere follow the canonical map link returned by
the catalog tools before executing a query. Sources may belong to other
collections even though the current collection controls the map's catalog
picker.

| Tool | Inputs | Behavior | Registration |
|---|---|---|---|
| `run_dataset_query` | source refs, SQL, result limit, optional geometry settings and `show_on_map` | Execute server-side, render the first page, optionally add its spatial MVT layer, focus the result panel, and return a compact preview | map workspace mounted |
| `set_result_page` | `query_id`, `offset`, optional `page_size` | Re-execute the signed query page and render it | pageable query exists |

`run_dataset_query` defaults to 100 returned rows and uses the existing server
maximum. It returns column summaries, warnings, paging state, and a preview of
at most five rows after applying the 1,500-character output limit. The complete
first page remains visible in the table. `show_on_map` defaults to `true`; it is
ignored with an explicit warning when the result has no usable geometry. A
spatial query layer is added without removing existing catalog or query layers.

`set_result_page` changes the displayed UI but returns only the new offset,
page size, `has_more`, row count on the page, and at most a two-row preview.

Both query tools set `readOnlyHint: false` because they change visible
application state and `untrustedContentHint: true` because their success or
error output may contain catalog-controlled names or query-derived values.

`get_map_state` includes compact active-query summaries: query ID, aliases,
columns, current page, paging availability, geometry status, and associated map
layer. This removes a separate query-state tool. Human-only column visibility
controls remain in the table; an agent that needs a different projection writes
that projection in SQL rather than invoking a display-only column tool.

Sorting arbitrary query results is expressed in SQL with `ORDER BY`; the first
release does not expose client-only page sorting as a tool because that would
misrepresent ordering across pages.

WebMCP cancellation aborts the browser request. The query service retains its
existing worker timeout and replacement behavior; cancellation is best-effort
and does not introduce cross-request cancel IDs.

## Navigation and UI synchronization

Catalog read tools return canonical same-origin links for relevant detail,
schema, comparison, viewer, and map routes. Browser agents already observe and
navigate links, so WebMCP does not duplicate generic navigation as a tool.
`search_datasets` remains an action because applying filters and rendering the
result set are one domain operation, not generic navigation.

Action tools update the interface before resolving:

- Search updates URL search parameters and visible cards.
- Version comparison updates both selectors and the visible comparison.
- Map commands update React state and wait for MapLibre readiness or movement
  completion when relevant.
- Query execution displays the result panel before returning.
- Query paging displays the requested page before returning.

If navigation destroys the tool-owning route, returning `null` is acceptable
under the WebMCP navigation lifecycle. Any state needed after navigation must
come from the destination route or URL, not an unresolved callback in the
unmounted route.

## Security and privacy

WebMCP schemas are descriptions, not enforcement. Every callback parses input
with Zod and every server boundary validates again.

The implementation must:

- Set `untrustedContentHint: true` on tools returning catalog metadata, schema,
  dataset descriptions, query values, or feature properties.
- Set `readOnlyHint: true` only for tools that do not change application state.
- Never interpolate agent input into URLs except through encoded, typed catalog
  path segments and allowlisted query parameters.
- Never accept an object-store URL, endpoint, bucket, credential, MapLibre
  source, HTML fragment, JavaScript, or raw style expression from a tool.
- Keep SQL within the existing server policy and resource isolation.
- Exclude query text, query tokens, row values, feature properties, URLs, and
  dataset descriptions from analytics and application logs.
- Truncate all tool outputs at a structured field boundary rather than slicing
  serialized JSON into invalid output.
- Preserve normal browser confirmation behavior for navigation. Downloads and
  submissions remain outside the tool surface.
- Treat tool availability as a convenience, not an authorization boundary.

The first release registers same-document tools only. It does not request or
grant the `tools` Permissions Policy to third-party frames and does not expose
tools to other origins.

## Experimental API and deployment

WebMCP is a Community Group draft and an experimental browser feature. The
webapp must not require it for startup, rendering, routing, or user interaction.

Deployment configuration is explicit:

- `WEBMCP_ENABLED` is a webapp boolean feature flag and defaults to `false`.
- `WEBMCP_ORIGIN_TRIAL_TOKEN` is an optional webapp server configuration value
  used only to emit the origin-trial response header.
- `DATASET_MCP_QUERY_API_URL` is the server-only internal dataset-mcp base URL.
- `DATASET_MCP_WEBAPP_ORIGINS` is the dataset-mcp allowlist for public tile
  requests from deployed webapp origins.

The runtime client configuration exposes only `webMcpEnabled` and
`queryToolsEnabled` booleans. It does not expose internal service URLs or the
origin-trial token. Catalog and map tools may remain enabled when query service
configuration is absent; query tools are registered only when
`queryToolsEnabled` is true.

Production acceptance uses an origin-trial token supplied at deployment time,
not committed to source or bundled as a permanent constant. The webapp server
emits the configured token as an `Origin-Trial` response header. Local testing
may use the current supported-browser developer flag or a localhost trial
configuration.

Use `document.modelContext`; do not implement a deprecated
`navigator.modelContext` fallback. Browser type augmentation is isolated in the
WebMCP adapter so the rest of the application remains independent of draft API
changes.

## Error handling

Catalog and workspace action tools return:

- `invalid_request` for malformed identities, filters, or pagination.
- `not_found` for a missing collection, dataset, file, source, version, layer,
  feature, or query result.
- `unsupported_state` when a route or map state cannot perform the command.
- `upstream_unavailable` when the catalog service cannot be reached.

Query tools additionally preserve stable query-policy, timeout, capacity, and
rate-limit errors. They do not return DuckDB exception text, SQL fragments
rewritten with internal views, physical paths, or storage error details.

An unsupported browser produces no tool registration and no user-facing error.
Development diagnostics may log one debug-level message when registration is
unavailable.

## Observability

Add client analytics for:

- `webmcp_tool_started`
- `webmcp_tool_completed`
- `webmcp_tool_failed`

Allowed properties are tool name, route kind, duration bucket, stable error
code, and coarse result-count bucket. Do not send tool arguments, SQL, catalog
descriptions, source references, query tokens, selected feature data, or result
values.

The query HTTP handlers use the existing dataset-mcp request and query metrics.
Add a transport label distinguishing `mcp` from `webapp_http` without placing
high-cardinality origins, paths, queries, or source IDs in metric labels.

## Documentation

Update:

- `webapp/public/llms.txt`
- `webapp/src/lib/agent-skills.ts`
- The webapp API index and OpenAPI description for bounded schema paging and
  same-origin query routes.
- `webapp/README.md` with feature detection, origin-trial setup, query-service
  configuration, and local testing.
- `dataset-mcp/README.md` with the HTTP query routes and allowed webapp origins.

The current statement that the webapp exposes no MCP/action tools must be
replaced with an accurate explanation: the JSON API remains read-only, and
supported browsers may expose contextual WebMCP tools that read data or modify
only the current browser workspace.

## Testing

### WebMCP adapter tests

Use a typed in-memory `ModelContext` fake to verify:

- Unsupported-browser no-op behavior.
- Registration after hydration and cleanup on unmount/state change.
- Stable registration across normal rerenders.
- Zod validation before callbacks execute.
- JSON Schema generation from the same Zod schemas.
- Annotation correctness.
- Cancellation propagation.
- Structured error envelopes and output budgets.
- No token, URL, SQL, geometry, or stack-trace leakage.

### Catalog integration tests

Mock the same-origin API boundary and verify:

- Collection-first search, tag filters, and offset paging.
- Search URL/UI synchronization.
- Metadata shaping and truncation.
- Schema paging and version selection.
- Canonical route navigation.
- File-version comparison output.

### Map integration tests

Use the existing MapLibre test boundary to verify:

- Human controls and WebMCP tools call the same workspace commands.
- Multiple catalog layers remain loaded for overlay comparison.
- Visibility, style, ordering, camera, fit, and basemap commands.
- Invalid layer IDs, style fields, palettes, and breaks fail without partial
  state changes.
- Selection paging, clearing, and zooming.
- PMTiles and query MVT sources coexist and clean up independently.
- Query tokens never appear in tool results or route search state.

### Query service tests

Add HTTP contract tests proving that the new handlers:

- Call the same query service as FastMCP.
- Enforce the same SQL, source, worker, timeout, and output policies.
- Return compatible initial and page contracts.
- Reject arbitrary paths, URLs, storage settings, and unsafe SQL.
- Preserve bbox-constrained MVT generation.
- Handle SeaweedFS and public GCS through the existing integration fixtures.

### Browser acceptance

In a supported Chrome origin-trial environment, use
`document.modelContext.getTools()` and `executeTool()` to script these flows:

1. List collections, inspect filter options, search one collection, inspect a
   dataset, file, and bounded schema page, and navigate to the file.
2. Compare two file versions and open both PMTiles sources on the map.
3. Add two datasets, style and reorder them, fit the camera, hide one, and
   inspect map state.
4. Execute a one-source query, render the first page, and fetch another page.
5. Execute a two-source spatial join, automatically add its MVT layer, and
   retain the existing catalog layers.
6. Cancel a query request and verify that the UI returns to a usable state.
7. Load the site in an unsupported browser and verify that all ordinary user
   workflows still work.

Do not require an unconstrained semantic-agent evaluation as a release gate.
The scripted browser acceptance flow is the first-release end-to-end gate.

### Repository quality gates

Run the repository-required webapp gates:

```bash
cd webapp
npm run check
npm run typecheck
npm test
npm run build
```

Run the dataset-mcp lint, formatting, type, and test gates defined by that
package. If implementation changes `dataset-api`, run all dataset-api gates
from `AGENTS.md`; the design intentionally avoids requiring dataset-api changes.

## Delivery sequence

Implementation should proceed in dependency order:

1. WebMCP feature detection, typed registration adapter, result envelopes, and
   test fake.
2. Global catalog tools and bounded schema API behavior.
3. File-version comparison and search-state synchronization.
4. Map workspace command extraction and map tools for existing PMTiles layers.
5. Dataset-mcp HTTP query handlers and same-origin webapp proxy.
6. Query result workspace, query tools, and MVT layer union.
7. Browser acceptance, observability, origin-trial deployment configuration,
   and documentation.

Each step leaves the ordinary webapp functional without WebMCP support.

## Acceptance criteria

The feature is accepted when:

- A supported browser discovers only tools valid for the current route/state.
- An unsupported browser experiences no functional or visible regression.
- Tool schemas and runtime validation come from the same typed source.
- Agents can follow the collection-first discovery flow through file/schema
  metadata without unbounded output.
- Search and action tools update visible UI state before completing.
- Agents can load, style, order, hide, remove, and fit multiple dataset layers.
- Overlay comparison works without a separate overlapping comparison tool.
- Agents can compare file metadata/schema versions.
- DuckDB runs only in the existing bounded server workers.
- Query sources are catalog identities and arbitrary source URLs are rejected.
- Query result pages are visible in the webapp while WebMCP output stays under
  the output budget.
- Spatial query results render through bbox-constrained MVT tiles alongside
  catalog PMTiles layers.
- No tool result, URL, analytics event, or log leaks credentials, physical
  object paths, internal origins, query tokens, raw geometry, or stack traces.
- Cancellation and expected failures leave the workspace usable.
- Required webapp and dataset-mcp quality gates pass.

## References

- [WebMCP Community Group draft](https://webmachinelearning.github.io/webmcp/)
- [Chrome WebMCP imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
- [Chrome WebMCP best practices](https://developer.chrome.com/docs/ai/webmcp/best-practices)
- [Chrome WebMCP tool security](https://developer.chrome.com/docs/ai/webmcp/secure-tools)
- [When to use WebMCP and MCP](https://developer.chrome.com/docs/ai/webmcp/compare-mcp)
- `docs/superpowers/specs/2026-08-29-dataset-mcp-app-server-design.md`
