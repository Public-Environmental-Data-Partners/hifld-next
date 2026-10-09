# Legacy catalog retirement

## Scope and status

The operator approved a separate retirement change after the Portolan cutover.
This application change removes the dataset-api service, discovery/config-sync
jobs and charts, GeoServer models, legacy webapp HTTP/numeric-ID fallbacks, and
one-off migration scripts. It does not perform a production teardown.

Preserve production databases, users, credentials, bucket data, local volumes,
and ignored cutover/rollback evidence. Deleted tracked source is recoverable
from Git history. Historical specifications/reports describe earlier states;
they are retained for audit and are not active deployment instructions.

## Current contracts

Keep the public webapp routes and STAC responses, path-based dataset/file IDs,
version/schema/quality metadata, original-format ZIP downloads, MCP/WebMCP tools,
OGC features, and SeaweedFS. Obsolete database row IDs and API environment
settings no longer select a hidden backend. Missing catalog configuration or
unavailable startup snapshots fail closed rather than reporting a ready service.
Direct SQLite file/URL sources remain supported alongside release pointers.

The source manifests, data dictionaries and quality manifests still feed the
publisher; they are not deleted with discovery. Existing stored-data layout
handling is distinct from operating an obsolete service.
MCP's local catalog default now targets webapp port 3000. Its DuckDB regression
reference workers and shared query protocol remain: production uses ClickHouse,
not those workers, and they are not a legacy catalog/GeoServer fallback.

Retained script: `scripts/portolan_acceptance.py` tests real catalog/feature
consumers and additive refreshes. Removed scripts are the old API baseline,
initial migration copy/spike, static catalog uploader, and old-export parity
tools. None is a production publication entrypoint; use the publisher's recorded
Dagster promotion/catalog-only commands instead.

## Coordinated rollout (not executed by this PR)

1. Merge and verify the focused map/publisher cleanup changes.
2. Review the application, publisher and infrastructure retirement PRs together.
   Build pinned application and publisher images. Keep existing data releases.
3. Deploy the API-free publisher and catalog-only webapp/MCP/feature readers.
   Remove API fallback env wiring. The infrastructure container workflow must
   use a retirement application revision, not an older API-containing checkout.
4. Verify STAC/search, version/schema/quality views, original ZIPs and HTTP ranges,
   WebMCP catalog and spatial map tools, MCP count/query tiles, and OGC collections,
   items/queryables/pagination/bbox. Verify SeaweedFS locally and hot catalog
   adoption without restarts. Check for unexpected former API callers.
5. With explicit rollout approval, uninstall the legacy API/discovery Helm
   releases; confirm deployments, services and suspended cronjobs are gone.
   Do not delete the shared Cloud SQL instance: Dagster also uses it.
6. Only then apply the separately reviewed legacy workload-identity/IAM cleanup.
   Database/bucket destruction and temporary-copy retention are separate decisions.

No `terraform apply`, Helm uninstall, database deletion, bucket deletion, local
volume pruning, or production dataset publication is part of this code change.

Companion changes: [publisher retirement #14](https://github.com/fulton-ring/hifld-next-datasets/pull/14)
and [infrastructure retirement #28](https://github.com/fulton-ring/hifld-next-iac/pull/28).

## Verification

- The pre-deletion dataset-api baseline passed Ruff, formatting, Pyright,
  BasedPyright and pytest (61 passed, one skipped) with its test extra installed.
- Root retirement regression first failed while old services/scripts existed;
  it now prevents their accidental reintroduction and keeps SeaweedFS/acceptance.
- GeoServer model regressions first demonstrated accepted retired formats and
  storage configs; they now reject both at the MCP parsing boundary.
- Run all surviving service quality gates, chart renders, Compose config checks,
  and the frontend workspace gate before merging. CI validates buildable images.
- Local verification: webapp check/typecheck, 517 tests and build; MCP native
  Ruff/format/Pyright/BasedPyright, 500 tests (12 skipped) and UI build; feature
  server native Python gates and 44 tests; shared map-core/map-ui/MCP UI suites
  (22/18/114 tests); nine workspace and three acceptance-contract tests; three
  Helm chart lints and Compose config validation. Existing informational lint
  messages and external-fixture skips are not new retirement failures.
- Production acceptance remains a rollout gate, not something local tests prove.
