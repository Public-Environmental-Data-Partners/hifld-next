# Portolan Production Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing production Dagster publish Portolan releases, and move webapp/OGC readers to the verified GCS catalog while preserving legacy download URLs and a tested rollback.

**Architecture:** Merge the already-tested publisher and reader branches into their respective `main` branches. IaC first gains a non-disruptive feature-server deployment and the existing additive Portolan storage routes; the production writer then switches its existing Cloud SQL-backed Dagster release to the Portolan staging/published buckets using a pinned public GHCR image. The webapp and OGC service read the same verified release pointer. No shadow release, Neon provider, or new database is introduced.

**Tech Stack:** Dagster, GCS, Terraform, Helm/GKE, GHCR, SQLite STAC catalog, webapp, OGC feature server.

---

### Task 1: Integrate and pin source

**Files:** `../hifld-next-datasets/src/dagster_hifld/portolan/workflow.py`, `../hifld-next-iac/environments/prod/main.tf`, `webapp/src/lib/catalog-runtime.ts`.

- [ ] Run the publisher's declared pytest suite on `codex/portolan-publisher-release` with `PYTHONPATH=.`; record its result. The repository does not declare Ruff/Pyright gates and a fresh installation reports substantial baseline findings, so do not silently treat those as passing. Confirm `main` is an ancestor and merge the reviewed PR. Record the resulting GHCR `dagster-user:<main SHA>` manifest.
- [ ] Run `npm run check`, `npm run typecheck`, `npm test`, `npm run build`, and the feature-server Ruff, Pyright, BasedPyright, and pytest gates on `codex/portolan-migration-feature-server-specs`. Merge the reviewed PR and record the five GHCR image manifests for its main SHA.
- [ ] Merge `codex/portolan-production-routing` into IaC `main` only after the full Terraform plan shows no unrelated deletion or replacement. Keep `/storage/*` on the legacy bucket and the four specific Portolan paths on the candidate bucket.

### Task 2: Add production reader deployment wiring

**Files:** `charts/webapp/values.yaml`, `charts/webapp/templates/deployment.yaml`, `../hifld-next-iac/charts/webapp-gcp/values.yaml`, `../hifld-next-iac/.github/workflows/deploy-containers.yml`, `../hifld-next-iac/environments/prod/main.tf`.

- [ ] Add the webapp chart's server-only release-pointer value and `CATALOG_RELEASE_POINTER_URL` environment variable. Test the rendered Deployment contains the pointer URL and the storage-location registry.
- [ ] Add a feature-server Helm deployment to the container workflow with `FEATURE_SERVER_CATALOG_POINTER_URL=https://hifld.publicenvirodata.org/storage/_catalog/current.json`, a storage registry containing both the historical `gcp-portolan-published` and current `gcs-portolan-published` slugs (each pointing to the candidate GCS bucket with prefix `hifld`), `FEATURE_SERVER_PUBLIC_URL=https://hifld.publicenvirodata.org/features/`, and a named GKE NEG. Keep its public route disabled until the internal service passes readiness and sample collection/item requests.
- [ ] Add the `/features/*` URL-map path rule and backend service only after the internal check. Rewrite the public prefix to `/` and leave `/api/*`, MCP, webapp, and legacy storage paths unchanged. Verify the Terraform plan is limited to feature-server exposure.

### Task 3: Deploy existing production Dagster against Portolan buckets

**Files:** `../hifld-next-iac/environments/prod/dagster.tf`, `../hifld-next-iac/.github/workflows/deploy-dagster.yml`, `../hifld-next-iac/scripts/dagster-gcp-values.yaml`, `../hifld-next-datasets/helm/values.yaml`.

- [ ] Grant the existing `dagster-runtime` service account object-admin on the two candidate buckets. Preserve the existing Cloud SQL host, user, database, and secret.
- [ ] Change `dagster-env` to `HIFLD_STAGING_BUCKET=hifld-next-portolan-staging`, `HIFLD_DATASETS_BUCKET=hifld-next-portolan-published`, both prefixes `hifld`, and `HIFLD_PORTOLAN_ENABLED=1`. Keep the previous ConfigMap values and Helm revision in the rollback record.
- [ ] Add a manually dispatched deploy workflow that resolves a datasets `main` SHA, checks the public GHCR manifest, obtains Terraform outputs, and upgrades the production Dagster Helm release with all four image references pinned to that SHA. Do not build or push an image from the IaC runner.
- [ ] Apply the reviewed Terraform plan, run the Dagster workflow, confirm all production Dagster pods are ready and the loaded asset definitions include `publish/portolan_catalog`, then run one bounded publication. Do not bulk-run while a sample fails.

### Task 4: Verify one coherent release and switch readers

**Files:** `docs/reviews/2026-09-20-portolan-production-cutover.md` (evidence only).

- [ ] Confirm the selected pointer generation, SQLite SHA-256/size, STAC root and collection links, and sample data-asset HTTP range reads. Compare names, descriptions, tags, dictionary schemas, versions, and downloads with the legacy site. Thumbnails are optional and not a cutover gate.
- [ ] Exercise Hospitals version comparison, one non-spatial dataset, partitioned NFHL features, PMTiles map display, MCP query, feature ID round-trip, and full dataset pagination/search. Check the existing legacy download URL still returns the same bytes.
- [ ] Deploy the main app images through the container workflow with the pointer and storage registry configured; verify public HTTP and browser behavior. Publish the feature-server route only after internal acceptance.
- [ ] Rehearse rollback: restore the previous Dagster Helm image/config, previous webapp images/config, and previous catalog pointer generation without changing source object bytes. Record exact SHAs and HTTP outcomes.

### Stop conditions

- A Terraform plan would delete or replace an unrelated production resource.
- A candidate pointer is invalid or readers disagree on generation.
- Legacy download URLs change bytes or fail.
- A production job targets the wrong bucket or loses access.
- Core map, dataset, feature, MCP, or Hospitals comparison paths fail after rollout.
