# HIFLD Dataset Import

Import datasets from inventory.csv into the HIFLD catalog.

## Architecture

```
inventory.csv
     │
     ▼
import_inventory.py
     │
     ├── POST /process → upload-processor
     │         │
     │         ├── Download parquet (public GCS bucket)
     │         ├── Create GeoParquet
     │         ├── Create PMTiles
     │         ├── Upload to SeaweedFS
     │         └── Return URLs + metadata
     │
     └── POST /api/datasets → webapp
               │
               ├── Create database entry
               └── Register with GeoServer
```

## Prerequisites

1. **Docker services running:**
   ```bash
   docker compose up -d
   ```

2. **Upload processor running:**
   ```bash
   cd ../upload-processor
   uv run uvicorn main:app --reload --port 8000
   ```

3. **Webapp running:**
   ```bash
   cd ../webapp
   npm run dev
   ```

## Usage

```bash
# Install dependencies
pip install -r requirements.txt

# Preview what would be processed (dry run)
python import_inventory.py --dry-run

# Process first 5 datasets
python import_inventory.py --limit 5

# Process all datasets
python import_inventory.py

# Skip GeoServer registration
python import_inventory.py --skip-geoserver
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PROCESSOR_URL` | Upload processor API URL | `http://localhost:8000` |
| `CATALOG_URL` | Webapp catalog API URL | `http://localhost:3000` |
