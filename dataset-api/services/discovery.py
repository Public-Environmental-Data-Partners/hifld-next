"""Storage discovery service for scanning versioned datasets from object storage."""

import json
import logging
import tempfile
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncIterator, Optional

from models.dataset import SpatialDatasetFileMetadata

logger = logging.getLogger(__name__)

KNOWN_FORMATS = {
    "geoparquet",
    "pmtiles",
    "geoserver",
    "geopackage",
    "shapefile",
    "geojson",
    "file_geodatabase",
}


@dataclass(slots=True)
class DiscoveredVersion:
    dataset_slug: str
    file_slug: str
    version: str
    format_type: str
    location_path: str
    metadata: Optional[SpatialDatasetFileMetadata]


class DiscoveryService:
    """Scan bucket-style storage and yield discovered version records."""

    def __init__(self, storage_client: Any):
        self.storage_client = storage_client

    async def scan(self, prefix: str = "", limit: Optional[int] = None) -> AsyncIterator[DiscoveredVersion]:
        files = await self.storage_client.list_files(prefix)
        grouped: dict[tuple[str, str, str], dict[str, list[str]]] = defaultdict(
            lambda: defaultdict(list)
        )

        for path in files:
            parts = [part for part in path.split("/") if part]
            if len(parts) < 4:
                continue

            dataset_slug, file_slug, version = parts[0], parts[1], parts[2]
            group_name = parts[3]
            if group_name == "metadata" or group_name in KNOWN_FORMATS:
                grouped[(dataset_slug, file_slug, version)][group_name].append(path)

        yielded = 0
        for dataset_slug, file_slug, version in sorted(grouped):
            if limit is not None and yielded >= limit:
                break

            group = grouped[(dataset_slug, file_slug, version)]
            metadata = await self._load_metadata(group.get("metadata", []))
            formats = sorted(fmt for fmt in group.keys() if fmt in KNOWN_FORMATS)

            for format_type in formats:
                if limit is not None and yielded >= limit:
                    return

                format_files = sorted(group.get(format_type, []))
                if not format_files:
                    continue

                yielded += 1
                yield DiscoveredVersion(
                    dataset_slug=dataset_slug,
                    file_slug=file_slug,
                    version=version,
                    format_type=format_type,
                    location_path=self._build_location_path(format_type, format_files),
                    metadata=metadata,
                )

    async def _load_metadata(
        self, metadata_paths: list[str]
    ) -> Optional[SpatialDatasetFileMetadata]:
        quality_manifest = await self._read_json_from_candidates(
            metadata_paths, "quality_manifest.json"
        )
        data_dictionary = await self._read_json_from_candidates(
            metadata_paths, "data_dictionary.json"
        )

        if not quality_manifest and not data_dictionary:
            return None

        metadata_payload: dict[str, Any] = {}
        if quality_manifest:
            metadata_payload.update(
                {
                    key: value
                    for key, value in quality_manifest.items()
                    if key
                    in {
                        "version",
                        "size_bytes",
                        "mime_type",
                        "feature_count",
                        "bounds",
                        "geometry_type",
                        "invalid_geometry_count",
                        "quality_check_passed",
                        "columns_hash",
                    }
                }
            )

        columns = self._extract_columns(data_dictionary)
        if columns:
            metadata_payload["columns"] = columns

        if "version" not in metadata_payload:
            metadata_payload["version"] = "v1"

        return SpatialDatasetFileMetadata(**metadata_payload)

    async def _read_json_from_candidates(
        self, metadata_paths: list[str], filename: str
    ) -> Optional[dict[str, Any]]:
        for path in metadata_paths:
            if path.endswith(filename):
                return await self._read_json(path)
        return None

    async def _read_json(self, remote_path: str) -> dict[str, Any]:
        with tempfile.TemporaryDirectory(prefix="discovery_metadata_") as tmpdir:
            local_path = Path(tmpdir) / Path(remote_path).name
            await self.storage_client.download_file(remote_path, local_path)
            return json.loads(local_path.read_text(encoding="utf-8"))

    def _extract_columns(self, data_dictionary: Optional[dict[str, Any]]) -> list[dict[str, Any]]:
        if not data_dictionary:
            return []
        columns = data_dictionary.get("columns", data_dictionary)
        if isinstance(columns, list):
            return [column for column in columns if isinstance(column, dict)]
        return []

    def _build_location_path(self, format_type: str, format_files: list[str]) -> str:
        first_path = format_files[0]
        if len(format_files) == 1:
            return first_path

        parent = str(Path(first_path).parent)
        if format_type == "geoparquet":
            return f"{parent}/*.parquet"
        if format_type == "shapefile":
            return f"{parent}/{Path(first_path).stem}.*"
        return first_path
