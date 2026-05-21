# HIFLD Next

HIFLD Next is a catalog and delivery app for public geospatial datasets.

## Architecture

- `webapp/` is the public TanStack Start application and public JSON API.
- `dataset-api/` is the FastAPI catalog service for collections, datasets, files, formats, and source URLs.
- Google Cloud Storage is the production artifact store for GeoParquet, PMTiles, GeoJSON, shapefile ZIPs, file geodatabases, and metadata manifests.
- SeaweedFS is the supported local object-storage backend for testing storage discovery and URL generation.
- Dagster/GKE own ingestion and data operations.
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

Production infrastructure lives in `../hifld-next-iac`. Cloud Run services and jobs use dedicated service accounts, Secret Manager-backed database URLs, and pinned image tags. The webapp is public; dataset API public access is explicit and defaults off in Terraform CI.
