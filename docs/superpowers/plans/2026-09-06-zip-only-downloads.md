# ZIP-only downloads implementation plan

**Goal:** Store, discover, and serve File Geodatabases and shapefiles as complete ZIP archives, without public legacy component-file support.

**Approved design:** Keep dataset/file/version format prefixes and logical format identifiers. Catalog sources reference one ZIP; processing extracts archives only into job-local temporary storage. GeoParquet and PMTiles remain unchanged. The user approved implementing this design and removing redundant staging GDB components; production components remain until later promotion.

## Independent implementation scopes

- [ ] Pipeline: test ZIP-only source reads and archive-only persistent writes, then update ingestion, catalog readers, and publishing. Run targeted tests followed by `uv run python -m unittest discover tests` in the datasets repository.
- [ ] API/discovery: regression-test ZIP selection, ignored component objects, ambiguous archives, idempotent source updates, and ZIP-only redirects for both archive formats. Remove request-time ZIP assembly. Preserve routes and unrelated format discovery.
- [ ] Webapp: regression-test direct ZIP download links and compressed sizes for both formats. Remove component assembly and restrict archive links to supported archive sources.
- [ ] Run API gates: Ruff lint and format check, Pyright, BasedPyright, and pytest. Run webapp check, typecheck, tests, and build.
- [ ] Review integrated diffs and record any remaining failures before claiming completion.

## Operational checkpoints

- [ ] Inventory exact registered staging GDB prefixes, ZIP generations, and redundant component generations.
- [ ] Verify staging deletion recovery policy; validate ZIP CRCs and readable GDB layers before deleting components.
- [ ] Delete only validated component objects with generation preconditions; retain ZIPs, metadata, all other formats, and a deletion audit.
- [ ] Build/deploy pipeline changes after tests; retry only failed jobs addressed by the cleanup/fix, excluding successful and running versions.
- [ ] Confirm retry progress and report backfill errors separately from ZIP migration results. Do not promote unverified GeoParquet geometry changes.

## Known exceptions

Two cataloged WBD versions have no GDB objects in either bucket; do not invent archives or delete other formats to reconcile them. Historical tsunami locations has a separate Arrow column-order failure, outside ZIP handling. NHD Waterbody geometry hashes differ from production and require investigation before promotion.
