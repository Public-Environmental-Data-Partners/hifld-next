# HIFLD Dataset API

FastAPI catalog service for HIFLD Next datasets.

## Responsibilities

- Serve collection, dataset, file, format, and source metadata.
- Shape storage URLs for GCS and local SeaweedFS-backed sources.
- Run startup database initialization: Alembic `upgrade head`, revision logging, then SQLModel `create_all`.
- Support discovery/config jobs that write catalog records outside the request path.

GeoServer is not part of the active runtime.

## Running Locally

Start local dependencies from the repo root:

```bash
docker compose up -d dataset-api-postgres seaweedfs-master seaweedfs-volume seaweedfs-filer
```

Run the API:

```bash
uv sync
DATABASE_URL=postgresql://hifld:hifld_dev@localhost:5433/hifld_datasets uv run uvicorn main:app --reload --port 8000
```

The app will run migrations on startup. To create a new migration:

```bash
uv run alembic revision --autogenerate -m "describe_change"
```

## Storage

Production artifact storage is GCS. Local storage tests use SeaweedFS:

| Variable | Description | Default |
| --- | --- | --- |
| `STORAGE_TYPE` | `seaweedfs` or `gcs` | `seaweedfs` |
| `SEAWEEDFS_FILER_URL` | SeaweedFS filer API | `http://localhost:8888` |
| `SEAWEEDFS_S3_URL` | SeaweedFS S3-compatible API | `http://localhost:8333` |
| `SEAWEEDFS_BUCKET` | Local bucket name | `hifld` |
| `GCS_BUCKET` | Production bucket name | unset |
| `GCS_PROJECT` | GCP project for GCS | unset |

## Jobs

Catalog/data operations should run as named jobs, not request-time work:

- `jobs.discover` scans object storage and upserts discovered datasets.
- `scripts.seed_formats` seeds supported format definitions.
- `scripts.seed_storage` seeds GCS and SeaweedFS storage locations.

## Tests

```bash
uv run pytest
HIFLD_RUN_SEAWEEDFS_INTEGRATION=1 uv run pytest tests/test_storage_client.py -v
```
