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

## Execution outcome — 2026-09-06

- Implemented and deployed pipeline commit `3f02375` as `gcr.io/hifld-next/dagster-user:zip-only-20260906`, Dagster Helm revision 52. Full pipeline suite: 308 tests, one skipped.
- API/discovery and webapp implementation commits: `5358207`, `3f2c583`. API/discovery image `gcr.io/hifld-next/dataset-api:zip-only-v2-20260906` (Helm revisions 31/35); webapp image `gcr.io/hifld-next/webapp:zip-only-20260906` (revision 25).
- API quality gates passed; 58 pytest tests passed, one skipped. Webapp check/typecheck/build passed; 390 tests passed. Live API archive redirects and the webapp redirect route returned 302; public archive range requests returned 206 with ZIP signatures.
- All 117 staging GDB archives passed complete ZIP CRC validation and layer-read checks in a temporary cluster job. Removed 6,989 generation-pinned loose objects (35,714,013,188 bytes); retained all 117 ZIPs. Rescan confirmed zero mixed/unpacked GDB versions in staging. Production component copies were untouched. Staging soft-delete recovery is seven days.
- Durable audits: `gs://hifld-next-staging-prod/_maintenance/zip-only-20260906/gdb-validation.json` and `gdb-component-deletions.json` under the same prefix. Temporary validation job, config map, scratch volume, and leftover local downloads were cleaned up.
- Production discovery completed without failures or pruning: 117 GDB archives and 376 shapefile archives discovered. All 119 catalog GDB records now reference ZIPs; two preexisting WBD ZIP references remain unavailable in storage.
- Launched GeoParquet-only retry backfill `uvrvcrcr` for 115 original GDB ambiguity failures. First checkpoint: 42 succeeded; one earthquake dataset exposed the same separate Arrow column-order issue as tsunami data. Remaining runs continue; no promotion launched.
- New partition-pruned GCS benchmarks (three fresh connections, full geometries): NHD Flowline Miami 41.920→3.080 seconds; NFHL Line Miami 8.183→9.239; NFHL East Miami 61.761→10.277; NFHL West San Francisco 17.376→11.525. All four returned matching geometry hashes. NFHL Line regression remains; production NFHL West contains overlapping legacy/canonical partition families and needs a clean replacement on eventual promotion.
