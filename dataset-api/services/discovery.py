"""Storage discovery service for scanning versioned datasets from object storage."""

import json
import logging
import re
import tempfile
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator, Optional

from models.dataset import SpatialDatasetFileMetadata

logger = logging.getLogger(__name__)
SEMVER_VERSION_RE = re.compile(r"^v\d+\.\d+\.\d+$")

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
    object_paths: list[str]
    metadata: Optional[SpatialDatasetFileMetadata]
    metadata_object_paths: list[str] = field(default_factory=list)
    dataset_description: Optional[str] = None


class DiscoveryService:
    """Scan bucket-style storage and yield discovered version records."""

    def __init__(self, storage_client: Any):
        self.storage_client = storage_client

    async def scan(
        self, prefix: str = "", limit: Optional[int] = None
    ) -> AsyncIterator[DiscoveredVersion]:
        files = await self.storage_client.list_files(prefix)
        grouped: dict[tuple[str, str, str], dict[str, list[str]]] = defaultdict(
            lambda: defaultdict(list)
        )

        for path in files:
            parsed = self._parse_discovery_path(path)
            if not parsed:
                continue

            dataset_slug, file_slug, version, group_name = parsed
            grouped[(dataset_slug, file_slug, version)][group_name].append(path)

        yielded = 0
        for dataset_slug, file_slug, version in sorted(grouped):
            if limit is not None and yielded >= limit:
                break

            group = grouped[(dataset_slug, file_slug, version)]
            metadata_paths = sorted(group.get("metadata", []))
            metadata_result = await self._load_metadata(metadata_paths)
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
                    object_paths=format_files,
                    metadata=metadata_result.metadata,
                    metadata_object_paths=metadata_paths,
                    dataset_description=metadata_result.dataset_description,
                )

    def _parse_discovery_path(
        self, path: str
    ) -> Optional[tuple[str, str, str, str]]:
        parts = [part for part in path.split("/") if part]
        if len(parts) < 5:
            return None

        dataset_slug, file_slug, version, group_name = parts[:4]
        if not SEMVER_VERSION_RE.match(version):
            return None
        if group_name != "metadata" and group_name not in KNOWN_FORMATS:
            return None
        return dataset_slug, file_slug, version, group_name

    @dataclass(slots=True)
    class MetadataResult:
        metadata: Optional[SpatialDatasetFileMetadata]
        dataset_description: Optional[str]

    async def _load_metadata(self, metadata_paths: list[str]) -> MetadataResult:
        quality_manifest = await self._read_json_from_candidates(
            metadata_paths, "quality_manifest.json"
        )
        data_dictionary = await self._read_json_from_candidates(
            metadata_paths, "data_dictionary.json"
        )

        if not quality_manifest and not data_dictionary:
            return self.MetadataResult(metadata=None, dataset_description=None)

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

        return self.MetadataResult(
            metadata=SpatialDatasetFileMetadata(**metadata_payload),
            dataset_description=self._extract_dataset_description(
                quality_manifest, data_dictionary
            ),
        )

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

    def _extract_columns(
        self, data_dictionary: Optional[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        if not data_dictionary:
            return []
        columns = data_dictionary.get("columns", data_dictionary)
        if isinstance(columns, list):
            return [
                self._normalize_column(column)
                for column in columns
                if isinstance(column, dict)
            ]
        return []

    def _normalize_column(self, column: dict[str, Any]) -> dict[str, Any]:
        aliases = {
            "numNullValues": "num_null_values",
            "numUniqueValues": "num_unique_values",
            "exampleValues": "example_values",
            "possibleValues": "possible_values",
        }
        normalized = dict(column)
        for source_key, target_key in aliases.items():
            if source_key in normalized and target_key not in normalized:
                normalized[target_key] = normalized[source_key]
            normalized.pop(source_key, None)
        return normalized

    def _extract_dataset_description(
        self,
        quality_manifest: Optional[dict[str, Any]],
        data_dictionary: Optional[dict[str, Any]],
    ) -> Optional[str]:
        for metadata in (quality_manifest, data_dictionary):
            if not metadata:
                continue
            description = metadata.get("description")
            if isinstance(description, str) and description.strip():
                return description.strip()
        return None

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
