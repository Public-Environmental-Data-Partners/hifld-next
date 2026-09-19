"""Context-safe catalog response shaping."""

from typing import TypedDict

from pydantic import TypeAdapter

from app.catalog.models import QuerySourceRef, StacVersionCollection
from app.catalog.query_hints import catalog_query_hints

type JSONValue = None | bool | int | float | str | list[JSONValue] | dict[str, JSONValue]


class FileMetadataShape(TypedDict):
    metadata: dict[str, JSONValue] | None
    query_sources: list[QuerySourceRef]
    query_hints: list[dict[str, JSONValue]]


_metadata_adapter: TypeAdapter[dict[str, JSONValue]] = TypeAdapter(dict[str, JSONValue])


def shape_file_metadata(
    response: StacVersionCollection, alias_prefix: str = "source"
) -> FileMetadataShape:
    """Remove expensive inline columns while preserving schema provenance."""
    parts = response.id.split("/")
    if len(parts) != 4:
        return {"metadata": None, "query_sources": [], "query_hints": []}
    metadata = _metadata_adapter.validate_python(
        {
            "feature_count": response.feature_count,
            "bounds": response.extent.spatial.bbox[0] if response.extent.spatial.bbox else None,
            "geometry_type": response.geometry_type,
            "crs": response.native_crs,
            "column_count": len(response.table_columns),
            "columns_available": bool(response.table_columns),
        }
    )
    refs: list[QuerySourceRef] = []
    index = 0
    for asset_key, asset in response.assets.items():
        if not (asset_key == "geoparquet" or asset_key.startswith("geoparquet-")):
            continue
        if asset.type != "application/vnd.apache.parquet" or "data" not in asset.roles:
            continue
        refs.append(
            QuerySourceRef(
                alias=f"{alias_prefix}_{index}",
                collection_slug=parts[0],
                dataset_slug=parts[1],
                file_slug=parts[2],
                version=parts[3],
                asset_key=asset_key,
            )
        )
        index += 1
    return {
        "metadata": metadata,
        "query_sources": refs,
        "query_hints": catalog_query_hints(response),
    }
