# MCP spatial reliability: approved scope and verification

## Contract

- Rename the general MCP query tool to `query_parquet`; keep its paginated
  arguments/results and existing catalog-source restrictions.
- Add `generate_mvt_tile_url`, accepting catalog sources, SQL, and optional
  geometry-column/CRS selection. Return the tile template, header capability,
  expiry, source layer, and geometry/CRS. Require a spatial result; no GeoJSON,
  feature collection, full-result materialization, or map UI creation.
- Reuse existing SQL policy, source resolution/revalidation, signed tokens,
  bounded validation probe, worker execution, and tile safety limits.
- Tolerate once-stringified map layers/camera at the input boundary without
  relaxing their Pydantic schemas or changing diagnostic records.
- Keep all work local; no deployment.

## Reproduced map failure

The same built map renders selectable MVT points in a regular iframe but not an
opaque-origin `sandbox="allow-scripts"` iframe. The failing case makes no tile
requests. Isolated browser tests confirm a module Blob worker fails in that
sandbox, whereas a classic Blob worker starts. Immediate Blob URL revocation
was ruled out by repeating without revocation.

Build a self-contained classic worker from the installed MapLibre worker using
the existing Vite build tool. Advertise its `.cjs` URL so MapLibre uses its
classic-worker path. Retain existing module assets. Serve the classic asset as
JavaScript and permit its fetch origin in MCP resource connect domains.

## Verification

Regression tests use the real built React app, real MCP app bridge handshake,
real MapLibre worker, and encoded MVT fixture, with only remote assets/data
intercepted locally. They verify token headers and click a rendered hospital
point to prove feature selection. Both regular and opaque-origin iframe cases
must pass. CI builds the assets and runs these tests in Chromium.

Python tests cover HTTP tool discovery/calls, string compatibility plus invalid
shapes, tile-only response fields, missing/non-spatial geometry, missing CRS,
preservation of full SQL despite the one-row probe, and worker asset headers.
Run full Python lint/format/type/tests, UI lint/type/unit/build/browser tests,
and frontend workspace contract tests before handoff.

The desktop host itself was not instrumented; the local sandbox failure matches
the observed symptom and is fixed by this change. Validate in that client after
the eventual reviewed deployment.
