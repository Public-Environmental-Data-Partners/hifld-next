# Categorical Map Colors Implementation Plan

> **For agentic workers:** Use subagent-driven-development for the isolated core helpers; integrate viewer changes in this session. Follow test-driven-development and review spec compliance before quality review.

**Goal:** Implement the approved categorical styling and unused-palette behavior without remote distinct-value queries.

**Architecture:** Pure map-core helpers own normalization, append-only category registries, expressions, legends, and palette selection. Viewer state owns registries by layer/field and samples loaded tiles on idle. Editor and agent commands share the same typed style vocabulary.

**Tech Stack:** TypeScript, React, MapLibre, Vitest, existing Portolan metadata.

## 1. Pure helpers

- [x] Add failing tests in `packages/map-core/tests/category.test.ts` for normalization, bounded registries, stable assignments, boolean/numeric/string expressions, palette allocation and legends.
- [x] Implement `packages/map-core/src/category.ts`, export through `src/index.ts`, extend `src/style.ts` with qualitative palettes while retaining all existing numeric outputs.
- [x] Run `npm test --workspace @hifld/map-core` and `npm run typecheck --workspace @hifld/map-core`.

Contract: `CategoryValue = string | number | boolean`; `CategoryFieldType = "string" | "number" | "boolean"`; `CategoryRegistry = { values: CategoryValue[]; overflow: boolean }`. `extendCategoryRegistry(previous, values, type)` normalizes, sorts unseen values, caps at 32, and returns the previous object when unchanged. `categoricalStyle(property, registry, type, scheme)` returns `{ color: PaintValue, items: LegendItem[], notes: string[] }`. `chooseLayerPalette(used: string[])` deterministically chooses unused then least-used. `solidPaletteColor(scheme)` returns a representative color.

## 2. Viewer metadata and lifecycle

- [x] Add failing tests for typed field extraction from source column `possible_values`, scalar tile fields, and query fields.
- [x] Add `categoricalFields.ts` for metadata normalization and `layerColorStyle.ts` for shared map/legend resolution and batch defaults. Extend viewer types with optional `colorMode` and scalar field summaries.
- [x] Add `useCategoryRegistries.ts` to seed dictionary values and discover bounded loaded-feature values on idle. Persist field registries across property changes and clean removed layers. Test lifecycle behavior.
- [x] Wire registry discovery and atomic palette initialization into `useLayerStyling.ts`; return registry state for legend rendering. Keep radius/width numeric-only.

## 3. Controls, legends and commands

- [x] Add editor and command regression tests before enabling text/boolean color fields and numeric categorical mode.
- [x] Update `LayerStylingEditor.tsx`, workspace legend construction, and map command validation/application. Use shared resolved category entries for expressions and legends. Skip numeric auto-break updates for categorical fields.
- [x] Update WebMCP style schema and agent documentation for categorical mode/palettes. Keep existing route, storage and service contracts.
- [x] Test missing data, 32-category overflow, palette reuse notices, manual overrides, and retained numeric behavior.

## 4. Verification and handoff

- [x] Run targeted tests, then map-core typecheck/tests and webapp check/typecheck/full tests/build.
- [ ] Complete categorical-color and multi-layer browser verification; basic GCS map loading and file selection are verified below.
- [x] Review diff for spec coverage, type safety, bounded discovery and event cleanup; fix concrete findings.
- [x] Hand off implementation and verification status. Production deployment is not part of this request.

## Verification results

- Webapp: check and typecheck passed; 479 tests passed; production build passed. Biome reports 45 pre-existing informational findings, no errors.
- Map-core: typecheck and 22 tests passed, including real MapLibre expression parsing/evaluation. Map-ui: typecheck and 18 tests passed.
- Independent review identified two issues, both fixed with red/green regression tests: late-discovered categories after many repeated features, and palette-only agent updates resetting implicit-numeric manual breakpoints.
- Visual verification remains incomplete: the temporary GCS-backed app loaded metadata and the basemap, but PMTiles requests failed in the browser with `Failed to fetch`. Both real GCS PMTiles archives were independently readable through the terminal. No claim of successful visual coloring verification is made. Temporary diagnostic UI changes were reverted and the test server stopped; persistent SeaweedFS configuration and production were not changed.

### Follow-up NFHL fixes

The GCS failure was traced to the viewer rebuilding a catalog asset URL without its bucket name. Catalog assets now retain their already-resolved URL. The long file selector uses a bounded popper layout instead of an expanding item-aligned menu. Regression tests reproduced both issues before fixing them. Browser verification confirmed NFHL West automatically loads and renders, and wheel scrolling reaches and selects Water Lines near the bottom of the NFHL file list. Webapp checks, typecheck, 481 tests, and build passed. Local runtime remains temporarily GCS-backed at the user's request; saved SeaweedFS configuration is unchanged.
