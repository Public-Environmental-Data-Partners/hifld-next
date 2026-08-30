"""Context-safe catalog response shaping."""

from typing import TypedDict

from pydantic import TypeAdapter

from app.catalog.models import DatasetFileResponse, QuerySourceRef

type JSONValue = None | bool | int | float | str | list[JSONValue] | dict[str, JSONValue]


class FileMetadataShape(TypedDict):
    metadata: dict[str, JSONValue] | None
    query_sources: list[QuerySourceRef]


_metadata_adapter: TypeAdapter[dict[str, JSONValue]] = TypeAdapter(dict[str, JSONValue])


def shape_file_metadata(
    response: DatasetFileResponse, alias_prefix: str = "source"
) -> FileMetadataShape:
    """Remove expensive inline columns while preserving schema provenance."""
    metadata = (
        _metadata_adapter.validate_python(
            response.file.file_metadata.model_dump(mode="json", exclude={"columns"})
        )
        if response.file.file_metadata
        else None
    )
    if metadata is not None:
        columns = response.file.file_metadata.columns if response.file.file_metadata else None
        metadata["column_count"] = len(columns) if columns is not None else 0
        metadata["columns_available"] = columns is not None
    refs: list[QuerySourceRef] = []
    index = 0
    for format_entry in response.file.formats:
        if format_entry.format.format_type != "geoparquet":
            continue
        for source in format_entry.sources:
            if source.source_type != "file" or source.storage_location is None:
                continue
            refs.append(
                QuerySourceRef(
                    alias=f"{alias_prefix}_{index}",
                    collection_id=response.collection.id,
                    dataset_id=response.dataset.id,
                    file_id=response.file.id,
                    file_source_id=source.id,
                )
            )
            index += 1
    return {"metadata": metadata, "query_sources": refs}
