# HIFLD Upload Processor

A simple FastAPI service for processing geospatial datasets.

## What it does

1. Loads parquet files directly from URLs (gs://, s3://, http://)
2. Validates and normalizes geospatial data  
3. Creates optimized GeoParquet
4. Creates PMTiles for visualization (if tippecanoe is available)
5. Uploads processed files to SeaweedFS
6. Returns URLs and metadata

## API

### `POST /process`

Process a parquet dataset.

**Request:**
```json
{
  "name": "power-plants",
  "parquet_url": "gs://seerai-hifld-archive/power-plants/v1/data.parquet"
}
```

**Response:**
```json
{
  "success": true,
  "name": "power-plants",
  "pmtiles_url": "http://localhost:8888/hifld/tiles/power-plants.pmtiles",
  "geoparquet_url": "http://localhost:8888/hifld/datasets/power-plants/power-plants.parquet",
  "feature_count": 10234,
  "bounds": "[-179.1, 18.9, 179.8, 71.4]",
  "geometry_type": "Point"
}
```

### `GET /health`

Health check endpoint.

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

| Variable | Description | Default |
|----------|-------------|---------|
| `STORAGE_TYPE` | `seaweedfs` or `gcs` | `seaweedfs` |
| `SEAWEEDFS_FILER_URL` | SeaweedFS filer URL | `http://localhost:8888` |
| `SEAWEEDFS_BUCKET` | Bucket name | `hifld` |

## Notes

- GeoPandas/PyArrow can read directly from cloud storage URLs without additional credentials for public buckets
- tippecanoe is optional - if not installed, PMTiles creation is skipped
- Files are uploaded to SeaweedFS by default (configure with environment variables)
