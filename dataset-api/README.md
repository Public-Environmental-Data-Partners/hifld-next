# HIFLD Dataset API

A read-only FastAPI service for serving geospatial dataset metadata.

## What it does

- Read-only API for collections and datasets
- Serves dataset metadata (formats, sources, URLs)
- GeoServer integration endpoints
- Dataset processing is handled by CLI scripts

## API Endpoints

### Collections

- `GET /api/collections` - List all collections
- `GET /api/collections/{id}` - Get collection details
- `GET /api/collections/{id}/datasets` - List datasets in collection

### Datasets

- `GET /api/datasets` - List all datasets (across collections)
- `GET /api/datasets/{id}` - Get dataset details with formats and sources

### Health

- `GET /health` - Health check endpoint

## Dataset Processing

Dataset processing is done via CLI scripts, not through the API:

```bash
# Process datasets from inventory
python -m scripts.import_inventory [--dry-run] [--limit N]
```

## Running

```bash
# Install dependencies
uv sync

# Run the server
uv run fastapi dev

# Or with uvicorn directly
uv run uvicorn main:app --reload --port 8000
```

## Environment Variables

Configuration is loaded from `.env.local` (local development) or `.env` files.

### API Configuration

The FastAPI app only requires database configuration:

| Variable        | Description                | Default                |
| --------------- | -------------------------- | ---------------------- |
| `DATABASE_URL`  | Database connection string | `sqlite:///./local.db` |
| `DATABASE_ECHO` | Enable SQL query logging   | `false`                |

### Scripts Configuration

Dataset processing scripts additionally require storage configuration:

| Variable              | Description          | Default                 |
| --------------------- | -------------------- | ----------------------- |
| `STORAGE_TYPE`        | `seaweedfs` or `gcs` | `seaweedfs`             |
| `SEAWEEDFS_FILER_URL` | SeaweedFS filer URL  | `http://localhost:8888` |
| `SEAWEEDFS_BUCKET`    | Bucket name          | `hifld`                 |
| `GCS_BUCKET`          | GCS bucket (if GCS)  | -                       |
| `GCS_PROJECT`         | GCS project (if GCS) | -                       |

### Database Setup

To generate migrations:

```bash
uv run alembic revision --autogenerate -m "revision_name"
```

#### SQLite (Default)

No setup required. Just run the migrations:

```bash
uv run alembic upgrade head
```

#### PostgreSQL (Recommended for Production)

1. **Start PostgreSQL via Docker Compose:**

   ```bash
   # From project root
   docker-compose up -d dataset-api-postgres
   ```

2. **Create `.env.local` file:**

   ```bash
   cp .env.example .env.local
   ```

   The default configuration connects to the Docker Compose PostgreSQL instance:

   ```
   DATABASE_URL=postgresql://hifld:hifld_dev@localhost:5433/hifld_datasets
   ```

3. **Run migrations:**
   ```bash
   uv run alembic upgrade head
   ```

## Notes

- GeoPandas/PyArrow can read directly from cloud storage URLs without additional credentials for public buckets
- tippecanoe is optional - if not installed, PMTiles creation is skipped
- Files are uploaded to SeaweedFS by default (configure with environment variables)
