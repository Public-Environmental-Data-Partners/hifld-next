# HIFLD Next Webapp

Public TanStack Start application and public JSON API facade for HIFLD Next.

## Running

```bash
npm install
CATALOG_SQLITE_URL=http://127.0.0.1:8333/published/_catalog/catalog.sqlite npm run dev
```

The webapp reads a published SQLite catalog and serves its STAC metadata through same-origin `/api/*` routes. ZIP downloads redirect directly to published storage assets.

For a local preview of the published catalog, set both of these values (for example in a local, ignored `.env.local`):

```dotenv
CATALOG_RELEASE_POINTER_URL=https://hifld.publicenvirodata.org/storage/_catalog/current.json
CATALOG_STORAGE_LOCATIONS_JSON={"gcs-hifld-next-datasets-prod":{"type":"gcs","base_url":"https://storage.googleapis.com","bucket":"hifld-next-datasets-prod"}}
```

The pointer must use the same public origin as the STAC metadata links. The storage registry must match the catalog’s storage slugs; leaving it out hides file sources even when catalog health is ready. For a built preview, run `node --env-file=.env.local .output/server/index.mjs`; set `NITRO_HOST=127.0.0.1`, `NITRO_PORT=3099`, `WEBAPP_PUBLIC_ORIGIN=http://127.0.0.1:3099`, and an empty `PUBLIC_POSTHOG_KEY` in that file to use the local preview without production analytics.


## Production Configuration

Production runs on GKE behind the external Application Load Balancer. Configure a published catalog release pointer:

```bash
CATALOG_RELEASE_POINTER_URL=https://storage.googleapis.com/your-bucket/_catalog/current.json
```

`CATALOG_SQLITE_URL` also supports a direct published index URL. `CATALOG_SQLITE_PATH` supports an existing local SQLite file; set a published URL alongside it when serving STAC documents. The in-process catalog starts on first use and refreshes on a timer, retaining the last valid generation on refresh failures. Readiness and catalog routes fail closed when no valid catalog can be opened. Configure `CATALOG_STORAGE_LOCATIONS_JSON` to resolve published asset storage locations (including SeaweedFS for local storage). Numeric database row IDs are retired; use collection slugs and published dataset/file paths.

Single-object file links use the published STAC asset `href`, or its indexed
catalog `href` for SQLite-only reads. These links and ZIP redirects do not
reconstruct URLs from the storage registry's `base_url` and `bucket`. The registry
still supplies backend identity and storage configuration; it does not override
the publisher's public URL. Multi-object assets are not offered as single-file
downloads.

The All files browser uses that same published URL for single-object assets.
For multi-object assets it retains indexed backend resolution for each physical
file, because the STAC asset does not supply individual object URLs.

The publisher sets public URLs with `HIFLD_PORTOLAN_PUBLIC_ROOT`. Changing that
setting requires a new catalog publication. If switching the catalog itself to
a custom domain, configure its pointer on the matching public root: STAC document
loading remains restricted to the active catalog's origin and release path.
MCP/feature-server storage configuration must also match before switching hosts.

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


### Privacy and analytics

HIFLD Next follows the existing [PEDP Privacy Policy](https://www.publicenvirodata.org/privacy-policy) (last updated March 17, 2025) and does not edit it. `/privacy` links to that policy for PEDP commitments and contact information, gives a brief HIFLD-specific disclosure of analytics, search terms, failure categories and consented feedback, and holds the analytics preferences. The search notice and feedback consent link to `/privacy`. The feedback consent notice version is `2026-11-04`.

Browser analytics use `cookieless_mode: "always"`, memory-only persistence and no person profiles. Replay, heatmaps, automatic clicks and unsolicited performance/error capture are disabled. Visitor estimates, device/referral summaries, explicit usage events, and the download lifecycle remain available. Dataset search terms are retained to identify unmet dataset demand, including zero-result searches. Terms are normalized for case/spacing and omitted when over 200 characters or matching obvious email, URL, phone, precise-coordinate or common street-address patterns. This is best-effort filtering, not anonymization: names and unusual formats may pass and legitimate queries may be omitted. Omitted text is marked by `query_suppressed: true`; result counts remain available. Query text is only allowed on `dataset_search`, not copied into other events or URLs. URL queries/fragments are removed. DNT, GPC and the privacy-page opt-out are honored. The only new preference cookie is `hifld_analytics=off`, written on an explicit opt-out, with a one-year lifetime.

Cookieless visitor IDs are derived by PostHog from the request IP, user agent, host and calendar day. They are estimates: monthly counts are not comparable to persistent-ID monthly visitors. Do not sum daily uniques and describe them as unique people across a month. Stateless cookieless ingestion must be enabled in **Project settings → Web analytics** before deploying the SDK change, or events are discarded. This project was configured on 2026-11-03 with `cookieless_server_hash_mode: 1`, IP anonymization enabled, and replay/heatmaps disabled. Retain these settings after future project changes.

`api_route_requested` keeps one shared anonymous identity. It records sanitized request URLs and optional self-declared agent provider/client/purpose labels, not raw user agents or client IPs. It cannot measure distinct agents. Client categories and provider labels are heuristics, not verified identities.

Feedback is independent of analytics. `/api/feedback` accepts bounded same-origin JSON, validates affirmative consent and notice version, and stamps consent time on the server. It sends a report with a new random ID and no browsing identity, IP, or geometry to PostHog. The form only closes after an ingestion acknowledgement; failures preserve the report for retry. The existing `PUBLIC_POSTHOG_KEY` and `PUBLIC_POSTHOG_HOST` configure delivery, and missing configuration yields a visible delivery error. Browser tracking opt-outs do not block deliberately submitted feedback.

Interaction and failure reporting: map imports emit `map_viewer_opened` (an attempt to view, not proof of a successful render). Parquet previews, selected-feature tables and query-result panels emit `data_table_opened`. Successful clipboard writes emit `url_copied` with the type and available catalog context, never copied URLs/configuration. A map import can also emit `dataset_imported_into_map`; these are different measures, not additive open counts.

`ui_operation_failed` covers handled map/tile/basemap/WebGL, table metadata/render, search, query, clipboard and feedback delivery failures, router-caught errors, browser runtime errors and unhandled rejections. Its explicit payload allows only feature/failure categories, page kind, public catalog context and a valid HTTP status where available. No raw exceptions, messages/stacks, SQL, tokens, request bodies or feature contents. Intentional request aborts are excluded. Identical failures are deduplicated and distinct reports capped at 20 per pathname visit; use them to identify affected views, not total failing tiles or exact failure rates. Telemetry respects all existing analytics privacy controls. Generic runtime categories identify where to investigate, but require reproduction or internal server logs to diagnose the underlying exception. Browser blocking, offline operation and failures before the app initializes can prevent delivery. No production dashboard/alert configuration is installed by this code change.

The shared router error and not-found pages show human-readable recovery actions and stable `page_unavailable` / `page_not_found` categories without displaying exception properties. A Start serialization adapter also replaces exception messages with a generic error before hydration or server-function transport, so hiding the visible message does not leave the original in the HTML script. Existing API JSON error contracts and HTTP status handling remain in place.

Download reporting distinguishes `dataset_download_clicked`, `dataset_download_handed_off`, `dataset_download_succeeded`, and `dataset_download_failed`. Sum `received_bytes` for measured transfers; `expected_size_bytes` on a handoff is only planned volume. Native links, external clients, map tiles, and interrupted downloads prevent a complete bandwidth total; use storage/CDN access metrics for authoritative bytes served. Existing download reports and visitor insights should mark the cookieless deployment date as a measurement change.

Operational requirements under [PEDP’s policy](https://www.publicenvirodata.org/privacy-policy):

- Retention follows PEDP’s two-year policy. Verified: a live PostHog audit found the earliest event on 2026-02-16 and no events older than two years. Not verified: an account setting that enforces deletion at two years. Operators must configure or confirm that setting and apply the same limit to exports, backups and retained infrastructure logs; this application cannot enforce it.
- Restrict access to feedback and analytics, and verify the PostHog processor agreement and hosting arrangement with the responsible PEDP organization.
- Handle deletion/withdrawal requests through `hello@publicenvirodata.org`; locate feedback by `reporter_email`, remove matching events and any exports, and document completion. Do not rely on person-profile deletion, since these reports have no person profile.
- Review the `/privacy` notice and the no-popup configuration against applicable privacy law before deployment. Cookieless is a technical mode, not an automatic legal exemption.
- These changes do not remove historical cookies from prior releases or erase historical PostHog events. Historical data and retention require a separately scoped review.
