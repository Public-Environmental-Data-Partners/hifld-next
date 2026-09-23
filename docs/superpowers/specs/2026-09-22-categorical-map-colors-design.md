# Categorical map colors and distinct layer palettes

## Goal

Allow map users to color features by categories such as flood zone, and give
new layers a palette not already used in the workspace. This is a webapp map
styling change; it does not require dataset rewriting, catalog publication,
Dagster changes, or new feature-server queries.

## Approved behavior

- The color-field selector includes scalar categorical fields, not only numbers.
- Text and boolean fields default to categorical coloring. Numeric fields default
  to graduated coloring, with a categorical mode for numeric codes.
- Categorical legends show value labels and swatches instead of numeric breaks.
- Colors already assigned to categories remain stable when panning, zooming,
  changing selection, or discovering more values.
- New layers choose an unused palette, counting hidden layers. Once every
  palette is used, choose the least-used palette with deterministic tie-breaking.
- Existing styles and manual palette choices are never changed by adding,
  hiding, removing, or reordering another layer.

## Category discovery and stability

Use available dictionary `possible_values` first, preserving their actual scalar
values rather than confusing descriptions with values. Also discover values
from loaded source features, including values omitted from dictionary metadata.
Do not query all distinct values remotely or scan complete datasets.

Keep a bounded, append-only category registry per rendered layer and field for
the lifetime of that layer in the workspace. Sort each newly discovered batch
deterministically before assigning unused slots. Deduplicate tile copies.
Switching fields and returning to a field retains its registry. Removing the
layer releases its registry. A new workspace may discover categories in a
different order when the dictionary does not enumerate them; do not promise
cross-session identity for sampled categories.

Normalize numeric codes according to known field type so dictionary `1` and
tile value `1` match. Preserve text identifiers such as `01`, case, and exact
text. Missing, null, and empty-string values use a neutral “No data” swatch;
zero and false are valid categories. Unsupported structured values are not
categorical options.

Bound explicit category entries to 32 per field. Additional values use an
“Other values” swatch distinct from “No data”. Explain the cap in the legend.
For sampled discovery, label the legend as based on loaded features rather than
claiming a complete dataset inventory. No available values is an informative
empty state, not a reason to fail loading the layer.

## Palettes and rendering

Use fixed-size discrete swatch sequences for categorical coloring. Assign a
category's color by its persistent slot, never by resampling a ramp using the
current category count: otherwise discovering a category recolors existing
ones. Palettes can repeat swatches beyond their discrete capacity; communicate
that colors are reused rather than implying unlimited distinguishable colors.

Retain existing palette IDs and numeric ramp outputs. Add qualitative palette
choices for categories without changing existing numeric styling. A palette
change intentionally recolors categories while preserving their registry slots.
Use the same resolved category entries for map expressions and legends.

Palette allocation runs in one state update across all newly added rendered
layers, so simultaneous additions cannot choose the same unused palette. Count
only currently loaded layers, including hidden ones, not stale removed-layer
styles. Use a fixed preference order starting with the existing Viridis default;
choose least-used after exhaustion. Manual overrides may intentionally duplicate
palettes. For unclassified solid layers, use a representative palette color
instead of near-white ramp endpoints so different defaults are visibly useful.

## Implementation boundaries

- `packages/map-core`: pure category color/expression/legend helpers and palette
  definitions; preserve existing numeric helpers and tests.
- Viewer types and source initialization: typed scalar field/category summaries,
  derived from existing source metadata and tile fields.
- Viewer styling: bounded category discovery on relevant source-load/idle events,
  stable registries, no state updates when values have not changed, cleanup on
  layer removal, and automatic palette allocation.
- Styling editor and legend: categorical mode, scalar field choices, discrete
  labels, palette overrides, sampled/capped notices. Numeric size/width controls
  remain numeric-only.
- Map command validation and agent guidance: expose the same categorical mode and
  supported palettes through existing style commands. Keep UI and agent behavior
  consistent; do not introduce arbitrary expression execution.

Apply shared behavior to webapp PMTiles and query-result layers and the single
file viewer where it uses these controls. Reuse existing metadata paths. The
separate MCP embedded app is not being redesigned by this change.

## Verification

Add focused regression coverage for categorical text, booleans, numeric codes,
missing values, dictionary labels, duplicate features, cap behavior, unchanged
colors after discovery/panning, field switching, and map/legend agreement.
Cover unused and least-used palette allocation, batch additions, hidden/removed
layers, and preservation of manual styles. Retain numeric styling coverage and
test command validation for new modes and palettes.

Run map-core tests and all required webapp gates (`npm run check`,
`npm run typecheck`, `npm test`, and production build). Visually verify a real
categorical layer such as flood zones, numeric-code categories, and multiple
added layers. Temporarily use the published Portolan catalog if local fixtures
lack representative categories, leaving SeaweedFS configuration intact afterward.

## Out of scope

Per-category manual color editing, saved/shareable styles, full-dataset distinct
queries, automatic semantic flood-zone colors, and guaranteed unique colors
across every category in every layer are not part of this change.
