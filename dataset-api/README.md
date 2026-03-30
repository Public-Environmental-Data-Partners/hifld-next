# HIFLD Dataset API

A read-only FastAPI service for serving geospatial dataset metadata.

## What it does

- Read-only API for collections and datasets
- Serves dataset metadata (formats, sources, URLs)
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

## DRP -> Dataset API Import Process

The API is read-only. Dataset ingestion happens through scripts.

Current source inventory CSV:
- `dataset-api/scripts/HIFLD_Open_Inventory_12112025.csv`

Current DRP source bucket:
- `gs://drp-hifld-copy-49775666365`

Current formatted destination bucket:
- `seaweedfs://drp-hifld-copy-formatted`

### End-to-end workflow

1) Map inventory rows to source zips in DRP bucket.

```bash
python -m scripts.generate_gcs_inventory \
  --input scripts/HIFLD_Open_Inventory_12112025.csv \
  --output scripts/inventory_gcs.csv \
  --bucket drp-hifld-copy-49775666365 \
  --skip-verify
```

2) Process source files into publishable formats in destination storage.

```bash
python -m scripts.process_gcs_datasets \
  --inventory scripts/inventory_gcs.csv \
  --source gs://drp-hifld-copy-49775666365 \
  --dest seaweedfs://drp-hifld-copy-formatted
```

3) Build metadata inventory JSONL from the HIFLD inventory CSV.

```bash
python -m scripts.generate_jsonl_inventory \
  --input scripts/HIFLD_Open_Inventory_12112025.csv \
  --output scripts/inventory.jsonl
```

4) Join metadata with storage-discovered files to produce import payload.

```bash
python -m scripts.generate_datasets \
  --inventory scripts/inventory.jsonl \
  --bucket seaweedfs://drp-hifld-copy-formatted \
  --output scripts/datasets.jsonl
```

5) Seed DB lookup tables (idempotent).

```bash
python -m scripts.seed_formats
python -m scripts.seed_storage
```

6) Import datasets into the Dataset API database.

```bash
python -m scripts.import_datasets --input scripts/datasets.jsonl
```

### GeoServer note

GeoServer is no longer used as a storage target for this pipeline.
Do not pass GeoServer storage options during import.

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
