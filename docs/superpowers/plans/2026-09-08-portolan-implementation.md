# Portolan Implementation Plan

> **For agentic workers:** Use subagent-driven-development with independent subsystem ownership. The user explicitly requested parallel implementation and focused verification rather than repeated review loops.

**Goal:** Publish the approved Portolan/SQLite catalog, consume it in the webapp and MCP, and serve spatial assets with DuckDB/pygeoapi against local SeaweedFS.

**Architecture:** The publisher owns the shared normalized SQLite schema and publishes the index last. The webapp and feature server independently validate and swap read-only snapshots; MCP consumes the webapp's slug-based API. Physical-row feature identifiers are computed at read time without changing Parquet.

**Tech Stack:** Dagster/Python, STAC, SQLite, Node/React, DuckDB, pygeoapi, SeaweedFS S3, Docker Compose, Helm.

## Parallel ownership and integration order

- [ ] Publisher: isolated datasets worktree `.worktrees/portolan-publisher`; typed records, SQL contract, STAC/document projections, publication/recovery, S3 support, tests. Share the SQL contract before consumer implementation.
- [ ] Webapp: `webapp/`, frontend packages and npm dependency lock; SQLite lifecycle/repository, slug API and frontend/WebMCP identities, readiness and tests.
- [ ] MCP: `dataset-mcp/`; slug client/resolver, versioned source tokens, analytics/MVT and UI compatibility, tests. Coordinate response shapes directly with webapp owner.
- [ ] Feature server: `feature-server/`; pygeoapi snapshot wrapper, provider, physical IDs, filters, CRS handling, bounds and security tests, image.
- [ ] Deployment: Compose, Helm, workflows and environment documentation; preserve existing SeaweedFS and rollback services, never deploy production.
- [ ] Integration (main agent): local fixture preparation, shared acceptance execution, cross-subsystem contract review, verification report and remaining rollout gates.

## Verification

Write and run focused failing tests before implementation of new behavior. Each subsystem runs targeted checks during development and its full quality gate at handoff. Integration uses the existing SeaweedFS instance and a dedicated acceptance bucket, does not delete existing data, and exercises initial publication, live additive refresh and same-version overwrite. Verify spatial IDs across filters and partitions and catalog preservation of nonspatial tables. Production cutover, deletion of the legacy database/API, broad performance/OGC certification, and public routing require their documented later release gates; local implementation does not authorize production mutation.

Record commands and actual results in the implementation verification report. Do not infer completion from an agent's summary or a partial test run.
