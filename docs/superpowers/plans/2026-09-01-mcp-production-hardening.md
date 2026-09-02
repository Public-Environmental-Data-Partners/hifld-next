# MCP Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for each repair. Independent tasks may run in parallel, but each worker owns only the files listed for its task.

**Goal:** Repair the confirmed MCP build, runtime, map, discovery, and deployment defects and push verified application and IaC branches.

**Architecture:** A root npm workspace owns shared frontend dependencies; stateless query execution remains server-side and gains bounded, cancellation-safe lifecycle controls. Public transport and deployment configuration are made explicit and testable at their HTTP, Helm, and Terraform boundaries.

**Tech Stack:** npm workspaces, React, MapLibre, FastAPI, FastMCP, DuckDB, Pytest, Vitest, Helm, Terraform, GitHub Actions.

---

### Task 1: Clean frontend dependency and asset builds

**Files:** root `package.json`/lockfile, package manifests, consumer Dockerfiles, `.github/workflows/dataset-mcp-quality.yml`, HTTP-app tests.

- [ ] Add a failing clean-install regression that resolves `@hifld/map-ui` from each consumer and a Docker build smoke check.
- [ ] Introduce the smallest root workspace/install topology that makes shared dependencies resolvable from source packages.
- [ ] Make Python tests inject temporary assets and CI explicitly build production UI assets before production-composition coverage.
- [ ] Run clean consumer typechecks/builds and the affected Python tests.

### Task 2: Catalog and storage boundary safety

**Files:** `dataset-mcp/app/catalog/client.py`, `source_resolver.py`, `storage/resolver.py`, and their tests/integration tests.

- [ ] Add failing tests showing concrete GCS object URIs win over HTTP-incompatible wildcard patterns.
- [ ] Add failing tests showing malicious dataset/file identities cannot normalize outside their catalog routes.
- [ ] Validate identity grammar, encode path segments, and restrict wildcard use to enumerable backends.
- [ ] Run catalog/storage tests including multipart public-GCS coverage when network access is available.

### Task 3: Worker lifecycle and bounded result execution

**Files:** `dataset-mcp/query_worker/pool.py`, `runtime.py`, `protocol.py`, query serialization/configuration, and worker tests.

- [ ] Add failing cancellation, non-fatal failure reuse, alias case/CTE scope, oversized-row progress, and bounded-materialization tests.
- [ ] Return or replace an owned slot in cancellation-safe cleanup and shield retirement/replacement.
- [ ] Recycle only fatal worker/protocol states.
- [ ] Make alias rewriting case-folded and scope-aware, or reject ambiguous source/CTE collisions.
- [ ] Fetch/encode rows incrementally within the response budget and return `row_too_large` when one row cannot fit.
- [ ] Configure DuckDB `max_temp_directory_size` below the chart ephemeral-storage budget.
- [ ] Run targeted worker tests and Python type/lint checks.

### Task 4: HTTP transport safety and availability

**Files:** `dataset-mcp/app/http_app.py`, `production.py`, `config.py`, `webapp/src/routes/mcp.ts`, chart values/templates, and HTTP tests.

- [ ] Add failing tests for hostile Origin, invalid Host, canonical `/mcp` behavior, and health/static availability while expensive traffic is saturated.
- [ ] Configure FastMCP host/origin protection from validated settings and mirror Origin enforcement in the proxy.
- [ ] Limit only MCP/query/tile execution rather than every HTTP request.
- [ ] Serve the advertised MCP path without an unsafe redirect or advertise `/mcp/` consistently.
- [ ] Run the HTTP, proxy, chart, and configuration tests.

### Task 5: Map lifecycle and command correctness

**Files:** webapp map initialization/workspace files, MCP `MapView.tsx`, query-result panel/state, and associated tests.

- [ ] Add failing tests for transient `isStyleLoaded() === false`, camera target plus orientation, box-selection click suppression, page accumulation, and concurrent layer IDs.
- [ ] Track initial style readiness independently and route load errors to query-layer error state.
- [ ] Issue one camera transition containing target and orientation.
- [ ] Suppress only an actual synthetic click after selection.
- [ ] Append “Load more” rows and revalidate layer uniqueness inside the atomic state update.
- [ ] Run targeted and full webapp/MCP UI tests.

### Task 6: Discovery and query API contracts

**Files:** webapp agent discovery, well-known routes, OpenAPI spec, query proxy routes/schemas, and tests.

- [ ] Add failing schema/header tests for current Server Card and AI Catalog formats.
- [ ] Add failing OpenAPI tests for query creation/page endpoints and token header documentation.
- [ ] Add failing oversized-body/SQL tests before JSON buffering.
- [ ] Emit the current card shape, correct media/link metadata, register query contracts, and reject oversized requests early.
- [ ] Run discovery, OpenAPI, query-route, webapp full tests, and build.

### Task 7: GCP routing and deployment safety

**Files:** `../hifld-next-iac/charts/dataset-mcp-gcp`, `environments/prod`, deployment workflow, and IaC tests.

- [ ] Add rendered-policy tests for values-driven Google health-check/proxy CIDRs on the MCP port.
- [ ] Route both exact MapLibre worker modules and set backend timeout above the application deadline.
- [ ] Derive MCP origin settings from the configured LB domain.
- [ ] Preflight all application charts and exact-SHA images before the first Helm upgrade, then use atomic upgrades where supported.
- [ ] Ensure chart-only deployable application commits publish or select valid image SHAs.
- [ ] Run Helm render tests, Terraform format/validate, and deployment workflow static checks.

### Task 8: Integration, verification, and push

**Files:** all changed files in both repositories.

- [ ] Review each domain diff for scope and cross-domain compatibility.
- [ ] Run every AGENTS.md quality gate plus production frontend builds and IaC validation.
- [ ] Commit application and IaC changes on their existing feature branches.
- [ ] Rebase safely if required, push both branches, and inspect remote CI status.
