# HIFLD Next

HIFLD Next is a catalog and delivery app for public geospatial datasets.

## Architecture

- `webapp/` is the public TanStack Start application and public JSON API.
- `dataset-api/` is the FastAPI catalog service for collections, datasets, files, formats, and source URLs.
- Google Cloud Storage is the production artifact store for GeoParquet, PMTiles, GeoJSON, shapefile ZIPs, file geodatabases, and metadata manifests.
- SeaweedFS is the supported local object-storage backend for testing storage discovery and URL generation.
- Dagster/GKE own ingestion and data operations.
- Dataset quality, schema, feature counts, file sizes, and related comparison data come from Dagster-published `quality_manifest.json` and `data_dictionary.json` files ingested by discovery.
- The dataset API intentionally runs Alembic migrations and SQLModel table initialization on startup.

GeoServer has been removed from the active architecture.

## Local Services

Start local Postgres and SeaweedFS:

```bash
docker compose up -d dataset-api-postgres seaweedfs-master seaweedfs-volume seaweedfs-filer
```

Useful local endpoints:

- SeaweedFS filer UI/API: `http://localhost:8888`
- SeaweedFS S3 API: `http://localhost:8333`
- Dataset API Postgres: `localhost:5433`

## Development

Run the dataset API:

```bash
cd dataset-api
uv sync
DATABASE_URL=postgresql://hifld:hifld_dev@localhost:5433/hifld_datasets uv run uvicorn main:app --reload --port 8000
```

Run the webapp:

```bash
cd webapp
npm install
DATASET_API_URL=http://127.0.0.1:8000 npm run dev
```

Run tests:

```bash
cd dataset-api && uv run pytest
cd webapp && npm test
```

Run the local SeaweedFS integration test:

```bash
cd dataset-api
HIFLD_RUN_SEAWEEDFS_INTEGRATION=1 uv run pytest tests/test_storage_client.py -v
```

## Deployment

Production infrastructure lives in `../hifld-next-iac`. The webapp, dataset API, discovery, and config reconciliation run on GKE with Helm-managed releases. The public webapp is served through the external Application Load Balancer; the dataset API is internal-only at `http://dataset-api.hifld-next.svc.cluster.local`.

This repo publishes application images to GHCR:

- `ghcr.io/public-environmental-data-partners/hifld-next/dataset-api`
- `ghcr.io/public-environmental-data-partners/hifld-next/webapp`

The `Publish app images` workflow tags both images with the full commit SHA and also publishes `latest` from `main`. Images are portable and do not bake deployment-specific runtime configuration.

The production deployment path is the `Deploy containers` GitHub Actions workflow in the IaC repo. It fetches GKE credentials and deploys a selected GHCR image tag with Helm upgrades for:

- `dataset-api`
- `dataset-discovery`
- `webapp`

The webapp receives runtime configuration from the deployer. `DATASET_API_URL` points the server at the internal dataset API, while browser-visible settings such as `PUBLIC_DATASET_API_URL` and optional analytics values are served from `/runtime-config.js`. Public GHCR images do not contain deployment-specific origins or PostHog keys. Use explicit SHA image tags for production rollouts and rollbacks; `latest` is only a convenience default.
