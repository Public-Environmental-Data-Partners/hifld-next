"""Conservative query hints derived from catalog storage paths, never dataset names."""

import re
from urllib.parse import unquote

from app.catalog.models import DatasetFileResponse, FileLocation

type JSONValue = None | bool | int | float | str | list[JSONValue] | dict[str, JSONValue]


def catalog_query_hints(response: DatasetFileResponse) -> list[dict[str, JSONValue]]:
    grouped: dict[int, dict[str, set[str]]] = {}
    crs_values: dict[int, set[str]] = {}
    for entry in response.file.formats:
        if entry.format.format_type != "geoparquet":
            continue
        for source in entry.sources:
            if source.source_type != "file" or source.storage_location is None:
                continue
            fields = grouped.setdefault(source.id, {})
            declared = crs_values.setdefault(source.id, set())
            if source.source_metadata and source.source_metadata.crs:
                declared.add(source.source_metadata.crs)
            paths = [source.location.path] if isinstance(source.location, FileLocation) else []
            if source.source_metadata and source.source_metadata.object_paths:
                paths.extend(source.source_metadata.object_paths)
            for path in paths:
                for segment in path.split("/")[:-1]:
                    name, separator, value = segment.partition("=")
                    name, value = unquote(name), unquote(value)
                    if (
                        separator
                        and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name)
                        and value
                        and not any(char in value for char in "*?[]")
                    ):
                        if value != "__HIVE_DEFAULT_PARTITION__":
                            fields.setdefault(name, set()).add(value)
    hints: list[dict[str, JSONValue]] = []
    for source_id, fields in grouped.items():
        partitions: list[JSONValue] = []
        for name, values in sorted(fields.items()):
            observed: list[JSONValue] = list(sorted(values)[:100])
            partitions.append(
                {
                    "name": name,
                    "observed_values": observed,
                    "values_truncated": len(values) > 100,
                }
            )
        crs = crs_values[source_id]
        hints.append(
            {
                "file_source_id": source_id,
                "partition_fields": partitions,
                "partition_provenance": "catalog_paths; observed values may not be exhaustive",
                "declared_crs": next(iter(crs)) if len(crs) == 1 else None,
                "inspection_required": True,
                "inspection_tool": "inspect_query_source",
            }
        )
    return hints
