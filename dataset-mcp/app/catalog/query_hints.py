"""Conservative query hints derived from catalog storage paths, never dataset names."""

import re
from urllib.parse import unquote

from app.catalog.models import StacVersionCollection

type JSONValue = None | bool | int | float | str | list[JSONValue] | dict[str, JSONValue]


def catalog_query_hints(response: StacVersionCollection) -> list[dict[str, JSONValue]]:
    """Derive non-authoritative partition hints from published GeoParquet asset paths."""
    grouped: dict[str, dict[str, set[str]]] = {}
    for asset_key, asset in response.assets.items():
        if not (asset_key == "geoparquet" or asset_key.startswith("geoparquet-")):
            continue
        fields = grouped.setdefault(asset_key, {})
        for segment in asset.href.split("/")[:-1]:
            name, separator, value = segment.partition("=")
            name, value = unquote(name), unquote(value)
            if (
                separator
                and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name)
                and value
                and not any(char in value for char in "*?[]")
                and value != "__HIVE_DEFAULT_PARTITION__"
            ):
                fields.setdefault(name, set()).add(value)
    hints: list[dict[str, JSONValue]] = []
    for asset_key, fields in grouped.items():
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
        hints.append(
            {
                "asset_key": asset_key,
                "partition_fields": partitions,
                "partition_provenance": "catalog_paths; observed values may not be exhaustive",
                "declared_crs": response.native_crs,
                "inspection_required": True,
                "inspection_tool": "inspect_query_source",
            }
        )
    return hints
