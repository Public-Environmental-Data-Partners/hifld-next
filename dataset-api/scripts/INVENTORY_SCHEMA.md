# Inventory JSONL Schema

The inventory JSONL file contains dataset metadata with AI-generated categorization tags.
This is separate from the storage-specific file locations.

## Schema

```json
{
  "slug": "12nm-territorial-sea",
  "name": "12NM Territorial Sea",
  "description": "NOAA is responsible for depicting on its nautical charts...",
  "source_file_path": null,
  "tags": {
    "inventory_name": "12nm-territorial-sea",
    "geometry_type": "Polygon",
    "categories": ["Borders", "Boundaries", "Transportation Water"],
    "category_confidence": "0.9",
    "category_reasoning": "The dataset describes maritime limits..."
  },
  "import": {
    "add_to_geoserver": true,
    "geoserver_workspace": null,
    "geoserver_store_name": null,
    "geoserver_layer_name": null
  },
  "files": [
    {
      "name": "12nm-territorial-sea",
      "slug": "12nm-territorial-sea",
      "layer_name": null,
      "source_file_path": null
    }
  ]
}
```

## Fields

### Top-level fields

- `slug` (string, required): Unique identifier for the dataset
- `name` (string, required): Human-readable name
- `description` (string, optional): Dataset description
- `source_file_path` (string, optional): Original source file path (for tracking)
- `tags` (object, optional): Metadata tags
  - `inventory_name` (string): Original inventory name
  - `geometry_type` (string, optional): Geometry type (Point, Polygon, etc.)
  - `categories` (array of strings, optional): HIFLD categories from AI
  - `category_confidence` (string, optional): AI confidence score (0-1)
  - `category_reasoning` (string, optional): AI reasoning for categorization
- `import` (object, optional): Import settings
  - `add_to_geoserver` (boolean, default: true): Whether to register with GeoServer
  - `geoserver_workspace` (string, optional): GeoServer workspace
  - `geoserver_store_name` (string, optional): GeoServer store name
  - `geoserver_layer_name` (string, optional): GeoServer layer name
- `files` (array, required): List of files/layers in this dataset (structure only, no storage URLs)
  - Each file object:
    - `name` (string, required): File name
    - `slug` (string, required): Unique identifier for the file within the dataset
    - `layer_name` (string, optional): Layer name if from multi-layer source
    - `source_file_path` (string, optional): Original source file path

## Notes

- This file contains **metadata only**, no storage URLs
- Storage URLs are added later when generating the final datasets.jsonl
- The `files` array describes the structure but doesn't include format information
- Format information (GeoParquet, PMTiles URLs) is added when combining with storage locations


