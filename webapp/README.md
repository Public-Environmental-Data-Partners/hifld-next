# HIFLD Next Webapp

Public TanStack Start application and public JSON API facade for HIFLD Next.

## Running

```bash
npm install
DATASET_API_URL=http://127.0.0.1:8000 npm run dev
```

The webapp proxies the FastAPI dataset service through same-origin `/api/*` routes.

## Production Configuration

Production runs on GKE behind the external Application Load Balancer. The server runtime should use the internal dataset API service:

```bash
DATASET_API_URL=http://dataset-api.hifld-next.svc.cluster.local
```

The build-time public API origin should be the load balancer origin, usually:

```bash
VITE_PUBLIC_DATASET_API_URL=https://hifld.publicenvirodata.org
```

Runtime browser settings are supplied by the running webapp server and served from `/runtime-config.js`:

```bash
PUBLIC_POSTHOG_KEY=your-posthog-key
PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

Leave `PUBLIC_POSTHOG_KEY` unset to disable analytics. Do not use `VITE_PUBLIC_POSTHOG_*` values; PostHog config is intentionally not baked into public images.

## Public JSON API

- `GET /api` returns bootstrap links for OpenAPI, collections, `llms.txt`, and agent discovery.
- `GET /api/openapi` returns the public machine-readable API contract.
- `GET /api/collections` lists collections.
- `GET /api/collections/{slug}` lists datasets for a collection.
- `GET /api/collections/{collectionSlug}/datasets/{datasetSlug}` returns dataset detail.
- `GET /api/collections/{collectionSlug}/datasets/{datasetSlug}/files/{fileSlug}` returns file/source detail.
- `GET /api/datasets` provides a capped global list. Prefer collection-scoped endpoints for complete catalog traversal.
- `GET /api/datasets/stats` returns aggregate catalog stats.

Errors use `application/problem+json` where supported. Pagination links are returned in response JSON and `Link` headers for paged routes.

## Discovery Documents

- `/llms.txt`
- `/.well-known/api-catalog`
- `/.well-known/agent-skills`
- `/sitemap.xml`
- `/robots.txt`

## Tests And Build

```bash
npm test
npm run build
```
