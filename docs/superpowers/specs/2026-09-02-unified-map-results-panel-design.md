# Unified Map Results Panel Design

## Goal

Replace the separate query-results and selected-features panels with one collapsible, resizable bottom panel that renders both modes through `@hifld/map-ui`'s `SelectedFeaturesTable`.

## Interaction

- A query layer's **View results** button is a toggle. It opens the bottom panel in query-results mode, switches back to that mode from selected features, and collapses the panel when query results are already visible.
- Selecting map features opens the same panel and switches it to selected-features mode.
- The panel header provides **Query results** and **Selected features** mode buttons only when both datasets exist.
- Clearing selected features switches to query results when available; otherwise it collapses the panel.
- The resizable panel keeps its user-selected height when switching modes or collapsing and reopening.

## Rendering

- Both modes use `SelectedFeaturesTable`; `QueryResultPanel` must not maintain a second table implementation.
- Query rows are adapted to `{ id, properties }`, with stable IDs based on query ID and absolute row offset. Columns follow the query response order and geometry cells use the existing scalar display conversion.
- Query mode retains status/error text and pagination. Selected-features mode retains layer/version controls, searching, sorting, actions, and click-to-zoom.
- The unified panel owns the outer border and height. Child table views fill it without creating another vertical panel.

## Testing

- Component tests prove query rows use the shared table data slots and preserve ordered columns, sorting, and pagination controls.
- State tests prove toggle, auto-switch, clear-selection fallback, collapse, and reopen behavior.
- Route tests prove only one bottom panel is mounted when query results and selected features coexist.

