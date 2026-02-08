# Dataset Import JSONL Schema

Each line in the JSONL file represents a complete dataset configuration for import.

## Schema

```json
{
  "slug": "security-zones-securityzones",
  "name": "Security Zones - SecurityZones",
  "description": "Dataset description...",
  "parquet_url": "https://storage.googleapis.com/bucket/datasets/security-zones-securityzones/security-zones-securityzones.parquet",
  "parquet_urls": null,
  "pmtiles_url": "https://storage.googleapis.com/bucket/tiles/security-zones-securityzones.pmtiles",
  "source_file_path": null,
  "tags": {
    "inventory_name": "security-zones-securityzones",
    "geometry_type": "Polygon",
    "categories": ["Boundaries", "Transportation Water", "Law Enforcement"],
    "category_confidence": "0.85",
    "category_reasoning": "Brief explanation..."
  },
  "import": {
    "add_to_geoserver": true,
    "geoserver_workspace": null,
    "geoserver_store_name": null,
    "geoserver_layer_name": null
  },
  "files": [
    {
      "name": "security-zones-securityzones",
      "slug": "security-zones-securityzones",
      "layer_name": null,
      "source_file_path": null,
      "formats": {
        "geoparquet": {
          "urls": ["https://storage.googleapis.com/bucket/datasets/security-zones-securityzones/security-zones-securityzones.parquet"],
          "is_chunked": false
        },
        "pmtiles": {
          "url": "https://storage.googleapis.com/bucket/tiles/security-zones-securityzones.pmtiles"
        }
      }
    }
  ]
}
```

## Fields

### Top-level fields

- `slug` (string, required): Unique identifier for the dataset (used as database slug)
- `name` (string, required): Human-readable name
- `description` (string, optional): Dataset description
- `parquet_url` (string, optional): Primary URL to source parquet file (first URL if chunked)
- `parquet_urls` (array of strings, optional): All parquet URLs if dataset is chunked (null if single file)
- `pmtiles_url` (string, optional): URL to PMTiles file for visualization
- `source_file_path` (string, optional): Original source file path (for tracking)
- `tags` (object, optional): Metadata tags
  - `inventory_name` (string): Original inventory name
  - `geometry_type` (string, optional): Geometry type (Point, Polygon, etc.)
  - `categories` (array of strings, optional): HIFLD categories
  - `category_confidence` (string, optional): LLM confidence score
  - `category_reasoning` (string, optional): LLM reasoning
- `import` (object, optional): Import settings
  - `add_to_geoserver` (boolean, default: true): Whether to register with GeoServer
  - `geoserver_workspace` (string, optional): GeoServer workspace (uses default if null)
  - `geoserver_store_name` (string, optional): GeoServer store name (auto-generated if null)
  - `geoserver_layer_name` (string, optional): GeoServer layer name (auto-generated if null)
- `files` (array, required): List of files/layers in this dataset
  - Each file object:
    - `name` (string, required): File name
    - `slug` (string, required): Unique identifier for the file within the dataset
    - `layer_name` (string, optional): Layer name if from multi-layer source (null for single-layer)
    - `source_file_path` (string, optional): Original source file path
    - `formats` (object, optional): Processed file formats and their locations
      - `geoparquet` (object, optional): GeoParquet format information
        - `urls` (array of strings): URLs to GeoParquet files (single or chunked)
        - `is_chunked` (boolean): Whether the dataset is split into multiple files
      - `pmtiles` (object, optional): PMTiles format information
        - `url` (string): URL to PMTiles file

## Multi-layer Example

For datasets with multiple layers (e.g., GeoPackage with multiple layers):

```json
{
  "slug": "census-tracts",
  "name": "Census Tracts",
  "description": "...",
  "parquet_url": "https://storage.googleapis.com/bucket/datasets/census-tracts/census-tracts-boundaries.parquet",
  "files": [
    {
      "name": "census-tracts-boundaries",
      "slug": "census-tracts-boundaries",
      "layer_name": "boundaries",
      "source_file_path": "gs://bucket/census.gpkg",
      "formats": {
        "geoparquet": {
          "urls": ["https://storage.googleapis.com/bucket/datasets/census-tracts/census-tracts-boundaries.parquet"],
          "is_chunked": false
        }
      }
    },
    {
      "name": "census-tracts-water",
      "slug": "census-tracts-water",
      "layer_name": "water",
      "source_file_path": "gs://bucket/census.gpkg",
      "formats": {
        "geoparquet": {
          "urls": ["https://storage.googleapis.com/bucket/datasets/census-tracts/census-tracts-water.parquet"],
          "is_chunked": false
        }
      }
    }
  ]
}
```

## Chunked Dataset Example

For large datasets split into multiple files:

```json
{
  "slug": "large-dataset",
  "name": "Large Dataset",
  "description": "...",
  "parquet_url": "https://storage.googleapis.com/bucket/datasets/large-dataset/large-dataset-0.parquet",
  "parquet_urls": [
    "https://storage.googleapis.com/bucket/datasets/large-dataset/large-dataset-0.parquet",
    "https://storage.googleapis.com/bucket/datasets/large-dataset/large-dataset-1.parquet",
    "https://storage.googleapis.com/bucket/datasets/large-dataset/large-dataset-2.parquet"
  ],
  "files": [
    {
      "name": "large-dataset",
      "slug": "large-dataset",
      "layer_name": null,
      "formats": {
        "geoparquet": {
          "urls": [
            "https://storage.googleapis.com/bucket/datasets/large-dataset/large-dataset-0.parquet",
            "https://storage.googleapis.com/bucket/datasets/large-dataset/large-dataset-1.parquet",
            "https://storage.googleapis.com/bucket/datasets/large-dataset/large-dataset-2.parquet"
          ],
          "is_chunked": true
        }
      }
    }
  ]
}
```

