# Dataset MCP Multi-Query Map Design

## Summary

Extend the Dataset MCP map app to render up to eight independently styled
GeoParquet query layers. Agents provide meaningful map and layer names plus
the semantic query inputs (`sources` and `sql`) instead of copying opaque query
tokens between tool calls. The server remains stateless and stores neither
query definitions nor query results.

The server issues signed query tokens internally and returns each token with
its layer configuration. This avoids an agent copying the opaque token between
tool calls and avoids depending on hosts forwarding custom tool-result
metadata. Query tools already expose these signed, scoped tokens, so this does
not introduce a new credential class into model-visible results.

## Goals

- Render one through eight spatial query layers in a single MCP map app.
- Support complex read-only joins independently within every layer query.
- Require an agent-authored map title and agent-authored name for every layer.
- Keep query execution, paging, and tile generation stateless.
- Eliminate the unreliable agent handoff of long opaque query tokens for maps.
- Preserve server-side SQL policy, source resolution, execution limits, and
  token validation on every request.
- Match the first-party webapp's OpenFreeMap Bright and Esri satellite
  basemaps, query styling defaults, map title, and grouped legend behavior.

## Non-goals

- Catalog PMTiles layers.
- Persisted map workspaces, query history, or result caching.
- Valkey or another query registry.
- UI-driven layer editing, reordering, or visibility controls.
- Arbitrary MapLibre styles or expressions.
- Changing the existing `query_geoparquet` and `get_query_page` paging
  contract. Their tokens remain available for agents that explicitly page a
  query result.

## Root Cause Addressed

The existing map workflow requires an agent to copy a signed query token from
`query_geoparquet` into `view_query_map`. Even a simple token is several
hundred opaque characters, and joins can produce larger tokens because the
signed payload contains canonical SQL and source identities. Exact tokens work
through the complete local query, map, CORS, and tile flow, while any changed
character fails authentication.

The map UI is attached to `view_query_map`, so hosts may render the app even
when the tool returns an error. This makes an input-token failure appear to be
a map rendering failure. Moving query construction into the map tool removes
the opaque agent handoff without adding state.

## Agent-Facing Tool Contract

Replace the token-based `view_query_map` input with this semantic contract:

```text
view_query_map(
  title: string,
  layers: [
    {
      layer_name: string,
      sources: [QuerySourceRef, ...],
      sql: string,
      geometry_column?: string,
      result_crs?: string,
      style?: {
        color?: "#RRGGBB",
        opacity?: 0..1,
        point_radius?: >0..50,
        line_width?: >0..20
      },
      visible?: boolean
    },
    ...
  ],
  basemap?: "street" | "satellite",
  camera?: MapCameraInput
)
```

Requirements:

- `title` is trimmed, contains 1 through 200 characters, and is always
  supplied by the agent.
- `layers` contains 1 through 8 entries.
- Every `layer_name` is trimmed, contains 1 through 200 characters, and is
  always supplied by the agent.
- Layer names are unique under case-insensitive comparison.
- Each layer accepts 1 through 8 catalog query sources and the same safe SQL,
  geometry, and CRS inputs as `query_geoparquet`.
- `visible` defaults to `true`.
- Layers retain input order. The first layer is lowest and the last layer is
  highest in the query overlay stack.
- No fallback names are generated from query IDs.

This is an intentional breaking change to `view_query_map`. It avoids keeping
two competing map contracts and prevents agents from selecting the fragile
token-based path.

## Server Data Flow

For each layer, in input order, the map tool:

1. Applies the existing SQL policy to the layer's source aliases and SQL.
2. Resolves every catalog source and its trusted storage configuration.
3. Executes a bounded one-row query through the existing worker path to
   validate the result schema and resolve the geometry column and CRS.
4. Issues the existing signed, two-hour query token.
5. Builds a map layer configuration with a unique query-ID tile URL.

Layer preparation is sequential. This keeps one map invocation from consuming
all worker capacity while still allowing the resulting MapLibre map to request
tiles normally under the process-wide concurrency limit.

If any layer fails, the entire tool call returns the existing stable error
envelope. The server does not return or render a partial map.

## Result Contract and Token Privacy

The model-visible text result is concise and contains the title, layer count,
and layer names. It does not contain query tokens, raw SQL, object locations,
or storage credentials.

The structured result contains:

```text
{
  title,
  basemap,
  camera?,
  worker_url,
  layers: [
    {
      query_id,
      query_token,
      layer_name,
      tile_url,
      source_layer,
      geometry_column,
      result_crs,
      initial_bounds?,
      style,
      visible
    }
  ]
}
```

The React app validates the single self-contained structure with a strict Zod
schema. It rejects missing tokens, duplicate query IDs, and invalid URLs. There
is no secondary token path or server-side token registry.

## Stateless Tile Routing

Add the sandbox-compatible route:

```text
GET /tiles/{query_id}/{z}/{x}/{y}.mvt
```

The component extracts `query_id` from each configured tile URL and adds the
matching token as `X-HIFLD-Query-Token`. The route validates tile coordinates,
decodes the token, compares its signed query ID with the path using the
existing constant-time identity check, re-resolves sources, and runs the
bounded DuckDB MVT query.

The existing `/tiles/{z}/{x}/{y}.mvt` route may remain temporarily for already
open single-layer app instances, but new map results never use it. It is not a
fallback and is not used by the new component contract.

Both routes retain the current sandbox CORS policy. Tokens never appear in
URLs, logs, model-visible content, or MapLibre layer summaries.

## React Map Model

The component creates one MapLibre vector source per query layer and three
geometry render layers per source (fill, line, and circle). Internal IDs use
the validated array index rather than raw names or query IDs:

```text
hifld-query-0
hifld-query-0-polygons
hifld-query-0-lines
hifld-query-0-points
```

All query render layers are inserted below the first basemap symbol layer.
Layer groups follow input order. `visible: false` sets the initial layout
visibility to `none` for all three render layers while keeping the layer in the
legend.

The explicit agent camera takes precedence. Otherwise the component fits the
smallest ordinary longitude/latitude bounds containing every layer that has
`initial_bounds`. If none are available, it uses the current world view. This
first version does not add antimeridian-specific bounds inference.

## Title, Legend, and Feature Selection

- The map title displays the required top-level `title`.
- The collapsible legend displays one solid-color group per layer in render
  order, using the required `layer_name` and resolved layer color.
- Hidden layers remain listed so the initial map state is explicit.
- Feature hit testing includes every visible query render layer.
- The selected-feature panel displays the originating `layer_name` before the
  sorted feature properties.
- The Bright street and Esri satellite implementations remain identical to
  the first-party webapp.

## Errors

The existing stable errors remain authoritative. The map tool additionally
returns `invalid_request` for duplicate layer names, too many layers, missing
required names, or malformed presentation inputs.

The app shows one bounded error state when:

- tool-result structured content is invalid;
- a layer token is absent or invalid;
- the worker or tile URL is invalid;
- a tile returns a stable server error; or
- MapLibre cannot initialize.

It does not retry with another URL, convert data to GeoJSON, substitute a
different basemap, or render a partial configuration.

## Testing

Server tests cover:

- the new FastMCP input schema and required human-readable names;
- one-layer and eight-layer preparation;
- per-layer SQL validation and map configuration;
- failure of the complete call when any layer is invalid or non-spatial;
- concise results with the exact internally issued token on each layer;
- the query-ID tile route, CORS preflight, missing tokens, and identity
  mismatches;
- absence of result or query registries.

UI tests cover:

- strict self-contained structured-result parsing;
- rejection of missing layer tokens;
- one source and three render layers per query layer;
- deterministic render order and initial visibility;
- query-ID-to-token request transformation;
- combined initial bounds and explicit camera precedence;
- required map title, grouped legend, and selected-feature layer attribution;
- Bright street and Esri satellite behavior with several overlays.

Acceptance includes all existing Python and UI quality gates, a production UI
build, and a live local MCP smoke test that executes two distinct queries,
opens one map, and fetches a tile for each layer with the corresponding
layer token.

## Documentation Basis

The [MCP Apps specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx)
defines `ontoolresult` as the view's tool-result delivery mechanism. The map
uses standard `structuredContent` because it is the interoperable result field
forwarded by the deployed hosts under test.
