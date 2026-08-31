# Shared Map Core and MCP Highlight Context Design

## Goal

Add webapp-parity feature highlighting to the dataset MCP map and make the
shared map behavior reusable without changing the existing webapp's public
behavior.

## Decisions

- Highlighting enriches the next user turn through MCP Apps
  `ui/update-model-context`. It never sends a chat message.
- Click selection and region selection match the current webapp interaction:
  clicking replaces the selection; the toolbar button or held Shift key enables
  drag selection; the translucent blue region remains until cleared.
- The UI reports the number of highlighted features and whether the selection
  was capped. It does not add a result table.
- The model-context snapshot contains layer identity, feature identity,
  normalized scalar properties, and centroids. It never contains query tokens,
  tile URLs, SQL, or complete geometries.
- The snapshot is capped at 100 features per rendered query layer, matching the
  webapp. Capping is explicit in both the UI and context payload.
- Context updates use text and structured content when the host advertises those
  modalities. Unsupported or rejected updates do not break selection and are
  reported as a small status message.
- Clearing or replacing the selection sends a complete new snapshot because MCP
  Apps context updates overwrite the prior snapshot.

## Shared Package Boundary

Create `packages/map-core` as a React-free TypeScript package. It owns only
stable, browser-neutral map semantics:

- the eight color-ramp definitions and pure color/break/scale expression helpers;
- basemap URL/source constants shared by both applications;
- selection-box geometry, normalized screen bounds, selection limits, and
  shared control labels.

The package does not own MapLibre instances, React state, MCP contracts, query
tokens, PMTiles loading, catalog resolution, or application-specific controls.
The webapp keeps its shadcn/Tailwind wrappers and the MCP app keeps its
host-themed native wrappers. This keeps visuals application-appropriate while
eliminating drift in behavior and vocabulary.

Both applications consume the package through local `file:` dependencies and
retain their existing working-directory commands and lockfiles. A root npm
workspace is intentionally deferred; it is unnecessary for a single shared
package and would broaden this change considerably.

## MCP Highlight Data Flow

1. The map records click or drag selection using the same MapLibre event order
   as the webapp.
2. Rendered features are mapped back to `MapLayerConfiguration` through their
   `hifld-query-{index}` source and render-layer ID.
3. Features are deduplicated, normalized, and capped per query layer.
4. React updates the visible selection summary and feature details.
5. A dedicated context adapter inspects `app.getHostCapabilities()` and calls
   `app.updateModelContext()` with the latest full snapshot.
6. The next user prompt receives that snapshot. No FastMCP endpoint or server
   state is involved.

The structured payload is shaped as follows:

```json
{
  "map_highlight": {
    "map_title": "Transportation comparison",
    "selected_feature_count": 2,
    "was_capped": false,
    "selection_bounds": [-77.2, 38.7, -76.8, 39.1],
    "selected_features": [
      {
        "id": "query:<query-id>:hifld:<feature-id>",
        "query_id": "<query-id>",
        "layer_name": "Amtrak stations",
        "source_layer_id": "hifld",
        "feature_id": "<feature-id>",
        "centroid": [-77.01, 38.91],
        "properties": { "StationName": "Washington Union Station" }
      }
    ]
  }
}
```

## Webapp Compatibility

The webapp is treated as the behavioral source of truth. Its route contracts,
MapLibre lifecycle, source ordering, basemap fallback, selection event sequence,
100-per-layer cap, controls, style defaults, hover behavior, and WebMCP output
must remain unchanged. Shared helpers are introduced behind existing webapp
exports where possible, so current imports and tests continue to work.

Characterization tests cover shared color ramps, break calculations,
selection-box geometry, control labels, and the existing webapp selection
normalization before integration.

## Build and Deployment

Local commands remain:

```bash
cd webapp && npm install
cd dataset-mcp/ui && npm install
```

Docker builds must use the repository root as context so both applications can
copy `packages/map-core`. The Dockerfiles still build from their respective app
directories internally. CI path filters include `packages/map-core/**`, and a
root `.dockerignore` prevents the larger context from sending Git metadata,
virtual environments, dependency trees, and build output.

## Verification

- Shared package: typecheck and pure-function tests.
- MCP UI: interaction tests for click, Shift/button drag, reverse drag, clear,
  cap/dedupe, unsupported host, rejected context update, and exact context
  payload; then Biome, TypeScript, all tests, and production build.
- Webapp: targeted characterization tests followed by `npm run check`,
  `npm run typecheck`, `npm test`, and `npm run build`.
- Container boundary: build both images from repository root when Docker is
  available.

