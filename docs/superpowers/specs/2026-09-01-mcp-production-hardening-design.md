# MCP Production Hardening Design

## Goal

Make the dataset MCP application, web map integration, discovery documents, and GCP deployment safe to build, test, deploy, and operate from clean checkouts.

## Scope

This repair includes every confirmed P1 finding and the directly actionable P2 findings from the 2026-09-01 audit. It does not add immutable source fingerprints because paging consistency was explicitly accepted as weak, and it does not add production SeaweedFS credentials because production currently uses public GCS while local development already supplies SeaweedFS credentials.

## Architecture

- Use a root npm workspace so shared TypeScript packages and both consumers resolve one dependency graph. Shared packages continue to export source TypeScript for workspace builds.
- Keep the production UI-asset startup assertion, but make Python tests provide explicit temporary assets and make CI build the UI before production-composition tests.
- Keep query execution stateless. Resolve concrete GCS objects, validate catalog path identities, make worker-slot ownership cancellation-safe, recycle workers only for fatal failures, and enforce response/spill budgets before unbounded materialization.
- Apply concurrency limits only to expensive MCP/query/tile traffic. Health and immutable assets remain available under query saturation.
- Configure FastMCP host/origin protection and apply the same allowed-origin policy at the webapp proxy.
- Treat initial MapLibre style readiness separately from transient source/tile loading and surface query-layer synchronization failures.
- Publish discovery documents using the current experimental MCP Server Card and AI Catalog contracts, and document query endpoints in OpenAPI.
- Route all exact MCP-owned MapLibre modules through the existing load balancer, allow values-driven load-balancer ingress through NetworkPolicy, configure an adequate backend timeout, and preflight every chart/image before any Helm mutation.

## Error Handling and Compatibility

Public routes and response fields remain stable. `/mcp` becomes directly usable or discovery advertises the canonical non-redirecting `/mcp/` endpoint. Oversized rows return a stable error rather than a non-advancing cursor. Expected query/storage failures do not restart healthy workers. Existing canonical production-domain behavior remains unchanged while custom domains become configurable.

## Verification

- Clean installs and production Docker builds for both JavaScript consumers.
- Dataset MCP targeted regression tests followed by Ruff, formatting, Pyright, BasedPyright, and full Pytest.
- Webapp targeted tests followed by check, typecheck, full tests, and build.
- Helm rendering tests plus Terraform format, validate, and plan where credentials permit.
- Direct ASGI tests for Origin rejection, `/mcp` routing, health availability under saturation, cancellation recovery, multipart GCS resolution, pagination progress, alias rewriting, and non-fatal worker reuse.
