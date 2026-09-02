# MCP Map Presentation Design

## Goal

Render query results over the same OpenFreeMap basemap used by the HIFLD webapp and let an agent choose a bounded initial layer style and camera when calling `view_query_map`.

## Design

`view_query_map` remains the only MCP tool that opens the map app. It accepts three presentation inputs that do not alter the signed query or create server state:

- `basemap`: one of `bright`, `positron`, `dark`, or `none`; defaults to `bright`.
- `style`: optional query-layer color, opacity, point radius, and line width.
- `camera`: optional bounds or center/zoom plus bearing, pitch, and padding.

The Python tool boundary validates these inputs and returns them inside `map_configuration`. The React app validates the complete result again with Zod. It loads the selected trusted OpenFreeMap style, adds the signed query MVT source after the base style loads, and inserts query layers before the first symbol layer so place labels remain legible. With `none`, it uses an intentionally blank local style; there is no network-error fallback.

The MCP resource CSP permits the configured query-tile origin and the fixed `https://tiles.openfreemap.org` basemap origin. Arbitrary style URLs and raw MapLibre expressions are not accepted.

## Verification

Python tests cover tool schemas, validation, structured output, and CSP. React tests cover the default basemap, overlay insertion, style application, explicit and default camera behavior, and the no-basemap mode. The built app is then exercised through the live FastMCP tool flow.
