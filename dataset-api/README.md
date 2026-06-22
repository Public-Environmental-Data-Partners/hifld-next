# HIFLD Dataset API

FastAPI catalog service for HIFLD Next datasets.

## Responsibilities

- Serve collection, dataset, file, format, and source metadata.
- Shape storage URLs for GCS and local SeaweedFS-backed sources.
- Run startup database initialization: Alembic `upgrade head`, revision logging, then SQLModel `create_all`.
- Support discovery/config jobs that write catalog records outside the request path.
- Read dataset quality, schema, file size, and feature-count metadata from stored `FileSource.source_metadata`.

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
- `jobs.config_sync` syncs configured formats and storage locations into the catalog database.
- `scripts.seed_formats` seeds supported format definitions.
- `scripts.seed_storage` seeds GCS and SeaweedFS storage locations.

In production, the `dataset-discovery` Helm release schedules these jobs as Kubernetes CronJobs:

- `dataset-discovery-config-sync-prod`
- `dataset-discovery-hifld-prod`

Dataset quality is not computed by API requests. Dagster publishes `quality_manifest.json` and `data_dictionary.json` alongside dataset versions; discovery ingests those files into `FileSource.source_metadata`; compare and detail API responses read only that stored metadata.

## Tests

Run targeted tests for touched code first, then the full suite before handing off:

```bash
uv run pytest
HIFLD_RUN_SEAWEEDFS_INTEGRATION=1 uv run pytest tests/test_storage_client.py -v
```

## Quality Gates

Ruff uses the NASA JPL autoRIFT baseline rules adapted for this API. Pyright provides the standard type check, and BasedPyright enforces stricter dynamic-typing rules that upstream Pyright does not expose.

Run all of these before claiming a `dataset-api` change is complete:

```bash
uv run ruff check .
uv run ruff format --check .
uv run pyright
uv run basedpyright
uv run pytest
```

## Type Safety

- Do not use `Any`, `dict[str, Any]`, `list[Any]`, or `cast(Any, ...)` in application code.
- Do not use `object` as a convenience escape hatch. Keep it only at true external boundaries such as JSON validation, Pydantic validators, SQLAlchemy hooks, pandas dtype inspection, or similar APIs that genuinely accept unknown input.
- Prefer explicit dataclasses, Pydantic models, `TypedDict`, type aliases, or narrow unions over broad dynamic typing.
- Use native Ruff, Pyright, and BasedPyright checks. Do not add custom type-check scripts to compensate for weak typing.

## Dataset Service Layout

Dataset-specific service logic lives under `services/dataset/`:

| Module | Purpose |
| --- | --- |
| `service.py` | Main `DatasetService` and catalog mutation helpers |
| `queries.py` | Dataset search, count, and tag query construction |
| `shaping.py` | API response shaping for datasets, files, formats, and sources |
| `downloads.py` | Download and shapefile ZIP response helpers |

Import the public service from `services.dataset`:

```python
from services.dataset import DatasetService
```
