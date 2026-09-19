# Portolan shadow pipeline deployment plan

**Goal:** Exercise current publisher through local Dagster and SeaweedFS, then run isolated Dagster pipelines against the Portolan staging and published GCS buckets without changing the current production publisher.

**Architecture:** The existing Portolan publisher worktree contains the Dagster conversion/promotion job and metadata-only inventory job. The local fixture proves the write path. A separate shadow deployment receives only the Portolan bucket configuration and explicit run targets; the current production Dagster release stays on its existing buckets until cutover.

## Tasks

- [x] Re-run the fixture Dagster job with SeaweedFS, verify source, GeoParquet, PMTiles, STAC, SQLite, source timestamps, and absolute links; record run IDs.
- [x] Replace the synthetic-only terminal asset with a production-safe Portolan publication path driven by authored source metadata and the actual promoted partition. Test one partition and an incremental update.
- [x] Build the publisher image from the isolated worktree and verify imports and Dagster definitions.
- [x] Add a separate GKE Dagster release and narrowly scoped bucket IAM for Portolan staging/published buckets. Preserve the current production release and its bucket configuration.
- [x] Deploy the shadow release, run an explicitly selected partition, and inspect Dagster events plus object checksums and catalog identity in both buckets.
- [x] Run bounded webapp/feature-server reads against the resulting catalog, record failures and rollback path, and leave production cutover for a later plan.

The two existing GCS Portolan buckets contain migration data. Reuse their exact names and verify object generations before any replacement. Do not run a broad automatic backfill as a deployment smoke test.

## Validation record

- Local SeaweedFS Dagster fixture runs: `ac62bb02-1e16-4fd4-b428-d78602528c10` and `562b41be-d6da-49b5-b674-d2b4dd98b0f9`, both `SUCCESS`. A separate real-asset graph run, `6b0c28a6-5623-4bfd-9ba0-0a93ef7bf77f`, also succeeded.
- Publisher tests: 390 passed, 1 skipped after GCS SHA-streaming regression coverage. Final shadow image `gcr.io/hifld-next/dagster-user:portolan-gcs-sha-20260919` (`sha256:908f4b0e719bc1eb3ae403d21a361cdc30aef1a3dab479044d7e44a0ac59fd09`).
- Shadow GKE namespace/release: `hifld-portolan-shadow` / `dagster-portolan-shadow`. Current production release `dagster` in `hifld-next-datasets` remains at revision 57.
- GCS selected partition: `above-ground-lng-storage-facilities/above-ground-lng-storage-facilities/v1.0.0`. Initial run `e3825bf9-dd38-4325-880c-b53e8dafda33` failed before asset code because the Helm overlay emptied the compute-log bucket. Full retry `393a8ac3-ad75-4c67-8b77-71addb8ebc49` passed catalog, both checks, four formats, and promotion, then revealed that the terminal asset rejected legacy documentation and GCS objects without SHA-256 metadata. Both issues were fixed. Terminal-only retry `37315e9c-f34d-4a31-9e4d-d4e435b7b3e7` succeeded.
- Published SQLite generation changed from `1789829886237216` to `1789843367073645`; schema v2, `PRAGMA integrity_check = ok`, 1 collection, 330 datasets, 525 files, 526 versions, 2,718 assets, 9,590 columns. The selected version has 13 point features and four assets with SHA-256 checksums. Root STAC generation changed from `1789829841971397` to `1789843363977485`, while its title remains `HIFLD Next`.
- Webapp `localhost:3000` collection and selected metadata endpoints returned STAC; selected metadata bytes exactly matched the published GCS `collection.json`. Feature server `localhost:8003` returned 13 matching point features. Public PMTiles and GeoParquet HTTP range reads returned `PMTiles` and `PAR1` headers.
- Production Dagster release remained revision 57. The shadow release is isolated in namespace `hifld-portolan-shadow`; rollback is to suspend or remove that release and, if necessary, restore versioned Portolan bucket objects from their prior GCS generations. No production cutover was attempted.

## Limits before cutover

- This cloud run covered one small partition, not every one of the 526 versions. Local fixtures covered the other source formats, but broad backfill and exceptional datasets need a staged validation plan.
- The existing K8s step executor requests 7.385 CPUs, 48 GiB memory, and an ephemeral scratch volume even for 13 features. Right-size resource profiles before bulk runs to control GKE provisioning time and cost.
- GCS migration objects do not carry custom SHA-256 metadata, so the terminal asset streams each selected data object to compute a Portolan checksum. This is bounded-memory and verified for the selected partition, but large versions will incur a full read; persist hashes at upload or precompute them before bulk publication.
- Publisher and shadow IaC changes live in isolated worktrees and have not been pushed to the new `hifld-next-datasets` GitHub repository. GHCR/Helm publication is the requested later task, not part of this validation.
