"""Storage discovery service for scanning versioned datasets from object storage."""

import json
import logging
import re
import tempfile
from collections import defaultdict
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from models.dataset import SpatialDatasetFileMetadata
from schemas.types import DatasetTags, JSONDict, json_dict, json_value


logger = logging.getLogger(__name__)
SEMVER_VERSION_RE = re.compile(r"^v\d+\.\d+\.\d+$")

KNOWN_FORMATS = {
    "geoparquet",
    "pmtiles",
    "geopackage",
    "shapefile",
    "geojson",
    "file_geodatabase",
}
ZIP_ONLY_FORMATS = {"shapefile", "file_geodatabase"}
MIN_DISCOVERY_PATH_PARTS = 5
DATASET_MANIFEST_PARTS = 3
LAYER_MANIFEST_PARTS = 4


@dataclass(slots=True)
class DiscoveredVersion:
    """A discovered dataset version and its storage paths."""

    dataset_slug: str
    file_slug: str
    version: str
    format_type: str
    location_path: str
    object_paths: list[str]
    metadata: SpatialDatasetFileMetadata | None
    metadata_object_paths: list[str] = field(default_factory=list)
    catalog_metadata_object_paths: list[str] = field(default_factory=list)
    dataset_name: str | None = None
    dataset_description: str | None = None
    dataset_tags: DatasetTags | None = None
    file_name: str | None = None
    file_description: str | None = None


class StorageClient(Protocol):
    """Storage client operations required by discovery."""

    async def list_files(self, prefix: str = "") -> list[str]:
        """List file paths under a prefix."""
        ...

    async def download_file(self, remote_path: str, local_path: Path) -> None:
        """Download a remote path to a local path."""
        ...

    async def get_file_size(self, remote_path: str) -> int:
        """Return the size of a remote path in bytes."""
        ...


class DiscoveryService:
    """Scan bucket-style storage and yield discovered version records."""

    def __init__(self, storage_client: StorageClient) -> None:
        """Create a discovery service."""
        self.storage_client = storage_client
        self.protected_source_keys: set[tuple[str, str, str, str]] = set()

    async def scan(self, prefix: str = "", limit: int | None = None) -> AsyncIterator[DiscoveredVersion]:
        """Scan storage and yield discovered version records."""
        self.protected_source_keys.clear()
        files = await self.storage_client.list_files(prefix)
        grouped: dict[tuple[str, str, str], dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
        catalog_manifest_paths: dict[tuple[str, str | None], str] = {}

        for path in files:
            manifest_key = self._parse_source_manifest_path(path)
            if manifest_key:
                catalog_manifest_paths[manifest_key] = path
                continue

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
            catalog_metadata = await self._load_catalog_metadata(
                dataset_slug=dataset_slug,
                file_slug=file_slug,
                manifest_paths=catalog_manifest_paths,
            )
            formats = sorted(fmt for fmt in group if fmt in KNOWN_FORMATS)

            for format_type in formats:
                if limit is not None and yielded >= limit:
                    return

                format_files = sorted(group.get(format_type, []))
                if not format_files:
                    continue
                selected_files = self._select_format_files(dataset_slug, file_slug, version, format_type, format_files)
                if not selected_files:
                    continue
                format_files = selected_files

                yielded += 1
                source_metadata = await self._metadata_with_computed_size(
                    metadata=metadata_result.metadata,
                    version=version,
                    format_type=format_type,
                    object_paths=format_files,
                )

                yield DiscoveredVersion(
                    dataset_slug=dataset_slug,
                    file_slug=file_slug,
                    version=version,
                    format_type=format_type,
                    location_path=self._build_location_path(format_type, format_files),
                    object_paths=format_files,
                    metadata=source_metadata,
                    metadata_object_paths=metadata_paths,
                    catalog_metadata_object_paths=catalog_metadata.object_paths,
                    dataset_name=catalog_metadata.dataset_name,
                    dataset_description=catalog_metadata.dataset_description,
                    dataset_tags=catalog_metadata.dataset_tags,
                    file_name=catalog_metadata.file_name,
                    file_description=catalog_metadata.file_description,
                )

    def _select_format_files(
        self,
        dataset_slug: str,
        file_slug: str,
        version: str,
        format_type: str,
        format_files: list[str],
    ) -> list[str] | None:
        """Select the storage objects that represent one format source."""
        if format_type not in ZIP_ONLY_FORMATS:
            return format_files

        zip_files = [path for path in format_files if path.lower().endswith(".zip")]
        if len(zip_files) == 1:
            return zip_files
        if len(zip_files) > 1:
            self.protected_source_keys.add((dataset_slug, file_slug, format_type, version))
            logger.warning(
                "Skipping ambiguous %s source %s/%s %s: found %d ZIP archives",
                format_type,
                dataset_slug,
                file_slug,
                version,
                len(zip_files),
            )
        return None

    def _parse_discovery_path(self, path: str) -> tuple[str, str, str, str] | None:
        parts = [part for part in path.split("/") if part]
        if len(parts) < MIN_DISCOVERY_PATH_PARTS:
            return None

        dataset_slug, file_slug, version, group_name = parts[:4]
        if not SEMVER_VERSION_RE.match(version):
            return None
        if group_name != "metadata" and group_name not in KNOWN_FORMATS:
            return None
        return dataset_slug, file_slug, version, group_name

    def _parse_source_manifest_path(self, path: str) -> tuple[str, str | None] | None:
        parts = [part for part in path.split("/") if part]
        if len(parts) == DATASET_MANIFEST_PARTS and parts[1:] == ["metadata", "source_manifest.json"]:
            return (parts[0], None)
        if len(parts) == LAYER_MANIFEST_PARTS and parts[2:] == ["metadata", "source_manifest.json"]:
            return (parts[0], parts[1])
        return None

    @dataclass(slots=True)
    class MetadataResult:
        """Loaded quality metadata."""

        metadata: SpatialDatasetFileMetadata | None

    @dataclass(slots=True)
    class CatalogMetadataResult:
        """Loaded catalog metadata."""

        object_paths: list[str]
        dataset_name: str
        dataset_description: str | None
        dataset_tags: DatasetTags | None
        file_name: str
        file_description: str | None

    async def _load_metadata(self, metadata_paths: list[str]) -> MetadataResult:
        quality_manifest = await self._read_json_from_candidates(metadata_paths, "quality_manifest.json")
        data_dictionary = await self._read_json_from_candidates(metadata_paths, "data_dictionary.json")

        if not quality_manifest and not data_dictionary:
            return self.MetadataResult(metadata=None)

        metadata_payload: JSONDict = {}
        if quality_manifest:
            metadata_payload.update(
                {
                    key: value
                    for key, value in quality_manifest.items()
                    if key
                    in {
                        "version",
                        "description",
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
            metadata_payload["columns"] = [json_value(column) for column in columns]

        if "version" not in metadata_payload:
            metadata_payload["version"] = "v1"

        return self.MetadataResult(metadata=SpatialDatasetFileMetadata.model_validate(metadata_payload))

    async def _metadata_with_computed_size(
        self,
        metadata: SpatialDatasetFileMetadata | None,
        version: str,
        format_type: str,
        object_paths: list[str],
    ) -> SpatialDatasetFileMetadata | None:
        is_zip_only = format_type in ZIP_ONLY_FORMATS
        if metadata is not None and is_zip_only:
            metadata = metadata.model_copy(update={"mime_type": "application/zip"})
        if metadata is not None and metadata.size_bytes is not None and not is_zip_only:
            return metadata

        size_bytes = await self._calculate_object_paths_size(object_paths)
        if size_bytes is None:
            if metadata is not None and is_zip_only:
                return metadata.model_copy(update={"size_bytes": None})
            return metadata

        if metadata is None:
            return SpatialDatasetFileMetadata(
                version=version,
                size_bytes=size_bytes,
                mime_type="application/zip" if is_zip_only else None,
            )
        return metadata.model_copy(update={"size_bytes": size_bytes})

    async def _calculate_object_paths_size(self, object_paths: list[str]) -> int | None:
        total_size = 0
        for object_path in object_paths:
            try:
                total_size += await self.storage_client.get_file_size(object_path)
            except Exception:
                logger.warning("Could not calculate source size for %s", object_path, exc_info=True)
                return None
        return total_size if total_size > 0 else None

    async def _load_catalog_metadata(
        self,
        dataset_slug: str,
        file_slug: str,
        manifest_paths: dict[tuple[str, str | None], str],
    ) -> CatalogMetadataResult:
        dataset_manifest_path = manifest_paths.get((dataset_slug, None))
        layer_manifest_path = manifest_paths.get((dataset_slug, file_slug))
        dataset_manifest = await self._read_json(dataset_manifest_path) if dataset_manifest_path else None
        layer_manifest = await self._read_json(layer_manifest_path) if layer_manifest_path else None
        catalog_paths = [path for path in [dataset_manifest_path, layer_manifest_path] if path]
        dataset_title = self._extract_manifest_string(dataset_manifest, "title")
        dataset_description = self._extract_manifest_string(dataset_manifest, "description")
        dataset_tags = self._extract_manifest_tags(dataset_manifest)

        file_title = self._extract_manifest_string(layer_manifest, "title") or dataset_title or file_slug
        file_description = self._extract_manifest_string(layer_manifest, "description") or dataset_description

        return self.CatalogMetadataResult(
            object_paths=catalog_paths,
            dataset_name=dataset_title or dataset_slug,
            dataset_description=dataset_description,
            dataset_tags=dataset_tags,
            file_name=file_title,
            file_description=file_description,
        )

    async def _read_json_from_candidates(self, metadata_paths: list[str], filename: str) -> JSONDict | None:
        for path in metadata_paths:
            if path.endswith(filename):
                return await self._read_json(path)
        return None

    async def _read_json(self, remote_path: str) -> JSONDict:
        with tempfile.TemporaryDirectory(prefix="discovery_metadata_") as tmpdir:
            local_path = Path(tmpdir) / Path(remote_path).name
            await self.storage_client.download_file(remote_path, local_path)
            return json_dict(json.loads(local_path.read_text(encoding="utf-8")))

    def _extract_columns(self, data_dictionary: JSONDict | None) -> list[JSONDict]:
        if not data_dictionary:
            return []
        columns = data_dictionary.get("columns", data_dictionary)
        if isinstance(columns, list):
            return [self._normalize_column(column) for column in columns if isinstance(column, dict)]
        return []

    def _normalize_column(self, column: JSONDict) -> JSONDict:
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

    def _extract_manifest_string(self, manifest: JSONDict | None, key: str) -> str | None:
        if not manifest:
            return None
        value = manifest.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        return None

    def _extract_manifest_tags(self, manifest: JSONDict | None) -> DatasetTags | None:
        if not manifest:
            return None
        tags = manifest.get("tags")
        if isinstance(tags, dict):
            parsed_tags: DatasetTags = {}
            for key, value in tags.items():
                if isinstance(value, str):
                    parsed_tags[str(key)] = value
                elif isinstance(value, list) and all(isinstance(item, str) for item in value):
                    parsed_tags[str(key)] = [item for item in value if isinstance(item, str)]
            return parsed_tags or None
        return None

    def _build_location_path(self, format_type: str, format_files: list[str]) -> str:
        first_path = format_files[0]
        if format_type == "geoparquet":
            return self._build_geoparquet_location_path(format_files)

        if len(format_files) == 1:
            return first_path

        parent = str(Path(first_path).parent)
        if format_type == "shapefile":
            return f"{parent}/{Path(first_path).stem}.*"
        return first_path

    def _build_geoparquet_location_path(self, format_files: list[str]) -> str:
        first_path = format_files[0]
        format_root = self._format_root_from_path(first_path)
        if not format_root:
            return first_path

        has_nested_parquet = any(self._parent_path(path) != format_root for path in format_files)
        if has_nested_parquet:
            return f"{format_root}/**/*.parquet"

        if len(format_files) == 1:
            return first_path

        return f"{format_root}/*.parquet"

    def _format_root_from_path(self, path: str) -> str | None:
        parts = [part for part in path.split("/") if part]
        if len(parts) < MIN_DISCOVERY_PATH_PARTS:
            return None
        return "/".join(parts[:4])

    def _parent_path(self, path: str) -> str:
        parts = [part for part in path.split("/") if part]
        return "/".join(parts[:-1])
