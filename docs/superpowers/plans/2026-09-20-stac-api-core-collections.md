# STAC API Core and Collections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the active Portolan version Collections through a standards-shaped, read-only STAC API at `/stac`, while preserving existing `/api` routes and updating agent guidance.

**Architecture:** The generated catalog database supplies version IDs and STAC hrefs through a database-neutral repository method. A small STAC adapter fetches the canonical JSON from the same active release, adapts API navigation links, and builds bounded listing pages. TanStack server routes expose Core and Collections only.

**Tech Stack:** TanStack Start, TypeScript, Zod, Node SQLite, Vitest, PySTAC Client.

---

### Task 1: Database-neutral version enumeration

**Files:**
- Modify: `webapp/src/lib/catalog-repository.ts`
- Test: `webapp/src/lib/__tests__/catalog-repository.test.ts`

- [ ] **Step 1: Write a failing repository test** that inserts a second version row into the existing fixture, asserts `listStacVersions({ after: null, limit: 1 })` returns the first ID and a second call after that ID returns the next, and asserts `getStacVersion("hifld/stations/stations/v1.0.0")` returns its `collection_href`. The first call must not return an unbounded set.
- [ ] **Step 2: Run** `npm test -- src/lib/__tests__/catalog-repository.test.ts`; confirm TypeScript/test failure is caused by the missing methods.
- [ ] **Step 3: Add** `CatalogStacVersion = { version_path: string; collection_href: string }`, `listStacVersions(query: { after: string | null; limit: number }): Awaitable<CatalogStacVersion[]>`, and `getStacVersion(id: string): Awaitable<CatalogStacVersion | null>` to `CatalogRepository`. Implement in `SQLiteCatalogRepository` with `WHERE version_path > ? ORDER BY version_path LIMIT ?` and a direct `WHERE version_path = ?` lookup, parsing rows through Zod. Do not expose SQLite types through the interface.
- [ ] **Step 4: Run** the targeted test, then `npm run typecheck`.
- [ ] **Step 5: Commit** the repository method and test.

### Task 2: Generation-consistent STAC adapter

**Files:**
- Modify: `webapp/src/lib/catalog-repository.ts` (`CatalogLifecycle` read snapshot)
- Create: `webapp/src/lib/stac-api.ts`
- Test: `webapp/src/lib/__tests__/stac-api.test.ts`

- [ ] **Step 1: Write failing tests** for a landing Catalog with exactly Core and Collections conformance, required `self`/`root`/`data`/`service-desc` links; Collection `self`/`root`/`parent` links with unchanged assets and ID; a two-page listing with a `next` link; malformed and stale cursor rejection. Use a mock fetcher for canonical JSON and the existing in-memory SQLite fixture style.
- [ ] **Step 2: Run** `npm test -- src/lib/__tests__/stac-api.test.ts`; confirm the module/API is absent.
- [ ] **Step 3: Add** one `CatalogLifecycle.withSnapshot` callback that leases a repository together with its matching active URL and generation. Keep the old `withRepository` behavior. The snapshot shape is `{ repository: CatalogRepository; catalogUrl: string | null; generation: string }` and must be captured before awaiting the callback. This prevents a refresh from mixing a new SQLite index with an old object-storage release.
- [ ] **Step 4: Implement** pure builders in `stac-api.ts`: `stacLanding(publishedRoot, origin)`, `stacCollection(publishedCollection, origin)`, `encodeCollectionId(id)` using `encodeURIComponent`, and cursor encode/decode that contains `{ generation, after }` and rejects invalid inputs. The listing helper fetches at most 50 Collections concurrently in batches of 8, asks the repository for 51 IDs to detect a next page, checks every fetched document is a Collection with matching ID, and produces `collections` plus `self`/`root`/`next` links. Retain all published fields and asset URLs; replace only API navigation links.
- [ ] **Step 5: Run** the targeted tests and `npm run typecheck`.
- [ ] **Step 6: Commit** the adapter, lifecycle snapshot, and tests.

### Task 3: HTTP routes and API description

**Files:**
- Create: `webapp/src/routes/stac/index.ts`
- Create: `webapp/src/routes/stac/api.ts`
- Create: `webapp/src/routes/stac/collections.ts`
- Create: `webapp/src/routes/stac/collections.$collectionId.ts`
- Test: `webapp/src/routes/__tests__/stac-api.test.ts`

- [ ] **Step 1: Write failing route tests** for `GET /stac`, `GET /stac/api`, `GET /stac/collections`, `GET /stac/collections/{percent-encoded full version ID}`, unknown ID, invalid cursor, and stale cursor. Assert JSON media types, generation header, exact advertised conformance classes, and no `/search` or `/items` links. Test an actual local HTTP request with `%2F` inside the Collection ID; do not rely solely on direct handler calls.
- [ ] **Step 2: Run** `npm test -- src/routes/__tests__/stac-api.test.ts`; confirm the routes are absent.
- [ ] **Step 3: Implement** the four TanStack server routes using the adapter and one `CatalogLifecycle.withSnapshot` call per request. Serve a small OpenAPI 3.1 document at `/stac/api` listing only the four GET paths. Return 503 when the active catalog is unavailable, 404 for absent IDs, 400 for malformed cursors, and 409 for a cursor from an older generation. Set `Content-Type: application/json` and `X-Catalog-Generation`. Do not modify `/api/collections`.
- [ ] **Step 4: Run** targeted tests, `npm run typecheck`, and a local HTTP smoke test of the encoded Collection ID. If ingress/router decodes the slash before route matching, use a splat route beneath `/stac/collections` while retaining the same public percent-encoded URL and ID.
- [ ] **Step 5: Commit** the routes and tests.

### Task 4: Agent guidance and final verification

**Files:**
- Modify: `webapp/public/llms.txt`
- Modify: `webapp/src/routes/api/index.ts`
- Modify: `webapp/src/lib/agent-skills.ts`
- Modify: `webapp/src/lib/agent-resource-discovery.ts`
- Modify: `webapp/src/lib/openapi/spec.ts` (clarify the `/api` contract and link to `/stac`)
- Test: `webapp/src/lib/__tests__/llms-txt.test.ts`, `webapp/src/lib/__tests__/agent-skills.test.ts`, `webapp/src/lib/__tests__/agent-resource-discovery.test.ts`, and `webapp/src/lib/openapi/__tests__/spec.test.ts`

- [ ] **Step 1: Write failing guidance tests** that check `/llms.txt` identifies `/stac` as STAC API Core + Collections, labels `/api/collections` as static STAC, and says `/features` contains OGC data features rather than STAC Items. Check `/api` bootstrap, agent skill, ARD entries, and OpenAPI description link to `/stac` without claiming Item Search.
- [ ] **Step 2: Run** the targeted test and confirm it fails for missing guidance/link.
- [ ] **Step 3: Update** the named guidance, `/api` bootstrap link/hint, agent skill, ARD, and custom OpenAPI description. Preserve existing custom dataset-search guidance and all existing public response fields. Correct the agent skill's misleading `GET /api/collections` “list collections” description to “root static STAC Catalog.” Do not claim STAC Item Search, Collection Search, or STAC API Features.
- [ ] **Step 4: Run** `npm run check`, `npm run typecheck`, `npm test`, and `npm run build` from `webapp/`. Start the local server and verify `pystac-client.Client.open("http://localhost:3000/stac")` advertises Core + Collections, `get_collections()` returns version Collections, `get_collection(full_version_id)` loads one, and pagination follows `next`. Run the official STAC API validator for Core + Collections against the local server.
- [ ] **Step 5: Commit** guidance, tests, and any final corrections.

## Review

Confirm that the root, listing, and Collection responses match the STAC API Core and Collections 1.0.0 contracts; the static `/api/collections` body and asset hrefs remain unchanged; every listing page is bounded; and the guidance names only advertised capabilities.
