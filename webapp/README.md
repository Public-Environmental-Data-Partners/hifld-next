# HIFLD Next Webapp

Public TanStack Start application and public JSON API facade for HIFLD Next.

## Running

```bash
npm install
CATALOG_SQLITE_URL=http://127.0.0.1:8333/published/_catalog/catalog.sqlite npm run dev
```

The webapp reads a published SQLite catalog and serves its STAC metadata through same-origin `/api/*` routes. ZIP downloads redirect directly to published storage assets.

## Production Configuration

Production runs on GKE behind the external Application Load Balancer. Configure a published catalog release pointer:

```bash
CATALOG_RELEASE_POINTER_URL=https://storage.googleapis.com/your-bucket/releases/current.json
```

`CATALOG_SQLITE_URL` also supports a direct published index URL. `CATALOG_SQLITE_PATH` supports an existing local SQLite file; set a published URL alongside it when serving STAC documents. The in-process catalog starts on first use and refreshes on a timer, retaining the last valid generation on refresh failures. Readiness and catalog routes fail closed when no valid catalog can be opened. Configure `CATALOG_STORAGE_LOCATIONS_JSON` to resolve published asset storage locations (including SeaweedFS for local storage). Numeric database row IDs are retired; use collection slugs and published dataset/file paths.

Runtime browser settings are supplied by the running webapp server and served from `/runtime-config.js`:

```bash
PUBLIC_POSTHOG_KEY=your-posthog-key
PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

Leave `PUBLIC_POSTHOG_KEY` unset to disable analytics. Do not use `VITE_PUBLIC_*` values for deployment-specific browser config; these values are intentionally not baked into public images.

### WebMCP and query-service configuration

WebMCP is a native browser feature. Registration is enabled by default only in
browsers that support it; the current standard `document.modelContext`
surface is preferred, while native Chrome preview/scanner builds may expose
`navigator.modelContext` as a fallback. Unsupported browsers keep the ordinary
webapp behavior without an error or polyfill.

- `WEBMCP_ENABLED` defaults to enabled; set it to `false` to disable registration.
- `WEBMCP_ORIGIN_TRIAL_TOKEN` is optional, server-only webapp configuration
  used to emit the native browser Origin-Trial header. Do not expose it through
  runtime client config or commit a production token.
- `DATASET_MCP_QUERY_API_URL` is the server-only internal base URL for the
  dataset-mcp query service. It is never sent to the browser; the webapp's
  same-origin query routes proxy only the needed bounded requests.
- `DATASET_MCP_PUBLIC_ENDPOINT` is an optional server-only public endpoint
  override for the MCP Server Card. When empty, discovery advertises the
  same-origin `/mcp` proxy. The proxy still uses the internal
  `DATASET_MCP_QUERY_API_URL`; internal service origins never leak.
- `WEBAPP_PUBLIC_ORIGIN` is the canonical public webapp origin used to validate
  the `Origin` header on browser MCP requests. Set it explicitly in production;
  it defaults to `http://localhost:3000` for local development.
- `DATASET_MCP_WEBAPP_ORIGINS` belongs on dataset-mcp. It is the comma-separated
  allowlist of deployed webapp origins allowed to load public query MVT with
  `X-HIFLD-Query-Token` CORS. Use HTTPS origins in production; localhost is for
  local development only.

For local native-browser testing, run the webapp on a localhost origin and use
the supported Chrome WebMCP developer flag or a localhost origin trial. Do not
add a WebMCP polyfill. The query service remains stateless: there is no Valkey,
result persistence, cursor registry, or saved query history.

## Public JSON API

- `GET /api` returns bootstrap links for OpenAPI, collections, `llms.txt`, and agent discovery.
- `GET /api/openapi` returns the public machine-readable API contract.
- `GET /api/collections` returns the root STAC catalog.
- `GET /api/collections/{slug}` returns a collection STAC catalog.
- `GET /api/collections/{slug}/datasets` lists datasets for a collection.
- `GET /api/collections/{collectionSlug}/datasets/{datasetSlug}` returns dataset detail.
- `GET /api/collections/{collectionSlug}/datasets/{datasetSlug}/files/{fileSlug}` returns file/source detail.
- `GET /api/datasets` provides a capped global list. Prefer collection-scoped endpoints for complete catalog traversal.
- `GET /api/datasets/stats` returns aggregate catalog stats.
- `POST /api/queries` starts a bounded query through the server-only
  dataset-mcp integration.
- `POST /api/queries/{query_id}/pages` fetches a bounded page and requires the
  signed token in `X-HIFLD-Query-Token`; the path ID is bound to that token.

The JSON catalog API is read-only. Supported browsers may offer contextual
WebMCP tools that read catalog/query data and change only the current browser
workspace. Query pages have a non-negative `offset` and `page_size` from 1 to
1,000. Stable problem responses do not reveal SQL, query tokens, credentials,
or storage paths. MapLibre loads query MVT directly from the public dataset-mcp
URL returned with a query; the webapp does not proxy tiles.

Errors use `application/problem+json` where supported. Pagination links are returned in response JSON and `Link` headers for paged routes.

## Discovery Documents

- `/llms.txt`
- `/.well-known/api-catalog`
- `/.well-known/agent-skills`
- `/.well-known/mcp/server-card.json` — JSON MCP Server Card for scanners.
- `/.well-known/ai-catalog.json` — JSON Agent Resource Discovery catalog (ARD).
- `/mcp` — same-origin Streamable HTTP MCP proxy.
- `/sitemap.xml`
- `/robots.txt`

Scanner acceptance should fetch the MCP Server Card and ARD as JSON, confirm
the default same-origin `/mcp` endpoint, and then probe the `/mcp` proxy. ARD
supports cross-origin JSON discovery with CORS; MCP calls remain same-origin.

## Tests And Build

```bash
npm test
npm run build
```
