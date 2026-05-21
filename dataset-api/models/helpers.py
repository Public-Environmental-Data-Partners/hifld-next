"""Helper functions for constructing URLs from storage locations and dataset paths."""

import logging
import re
from typing import Protocol

from schemas.types import APIDict, JSONDict, json_value, model_json_dict
from storage.storage_client import create_storage_client_from_location

from .dataset import (
    ApiLocation,
    FileLocation,
    FileSource,
    GeoServerLocation,
    StorageLocation,
)


logger = logging.getLogger(__name__)
STORAGE_URI_PATTERN = re.compile(r"^(gs://|s3://)([^/]+)/(.+)$")
GCS_PUBLIC_URL_PATTERN = re.compile(r"^https?://storage\.googleapis\.com/[^/]+/(.*)$")


class SupportsFileSize(Protocol):
    """Protocol for storage clients that can return file sizes."""

    async def get_file_size(self, remote_path: str) -> int:
        """Return the remote object's size in bytes."""
        ...


def get_file_url(
    source_type: str,
    location: FileLocation | ApiLocation | GeoServerLocation | JSONDict,
    storage_location: StorageLocation | None,
) -> str | None:
    """Construct the full URL from source type, location, and storage location.

    Args:
        source_type: Type of source - "file", "database", "api", or "service"
        location: Location model or dict with appropriate fields for the source type
        storage_location: StorageLocation with config.base_url

    Returns:
        Full URL to resource, or None if location or storage location is missing
    """
    if not location:
        return None

    normalized = normalize_location(source_type, location)
    if source_type == "api" and isinstance(normalized, ApiLocation):
        return normalized.url
    if source_type != "file" or not isinstance(normalized, FileLocation):
        return None
    return file_location_public_url(normalized, storage_location)


def normalize_location(
    source_type: str,
    location: FileLocation | ApiLocation | GeoServerLocation | JSONDict,
) -> FileLocation | ApiLocation | GeoServerLocation | None:
    """Convert a raw location dict into its typed location model."""
    if not isinstance(location, dict):
        return location
    if source_type == "file":
        return FileLocation.model_validate(location)
    if source_type == "api":
        return ApiLocation.model_validate(location)
    if source_type == "service":
        return GeoServerLocation.model_validate(location)
    return None


def file_location_public_url(location: FileLocation, storage_location: StorageLocation | None) -> str | None:
    """Return a public URL for a concrete file location."""
    if not location.path or "*" in location.path or not storage_location:
        return None
    storage_client = create_storage_client_from_location(storage_location)
    return storage_client.get_public_url(location.path) if storage_client else None


def get_file_source_url(
    file_source: FileSource,
    storage_location: StorageLocation | None,
) -> str | None:
    """Construct the full URL for a FileSource.

    Args:
        file_source: FileSource with source_type and location dict
        storage_location: StorageLocation with config.base_url

    Returns:
        Full URL to resource, or None if location or storage location is missing
    """
    if not storage_location or not file_source.location:
        return None
    return get_file_url(file_source.source_type, file_source.location, storage_location)


def get_file_source_storage_uri(
    file_source: FileSource,
    storage_location: StorageLocation | None,
) -> str | None:
    """Construct the storage URI (gs:// or s3://) for a FileSource.

    Args:
        file_source: FileSource with source_type and location dict
        storage_location: StorageLocation with config

    Returns:
        Storage URI (e.g., gs://bucket/path or s3://bucket/path), or None if not applicable
    """
    file_path = file_source_path(file_source)
    if not storage_location or not file_path:
        return None

    # Only bucket-based storage locations have storage URIs
    if storage_location.backend_type != "s3":
        return None

    # Create storage client and use it to construct the URI
    storage_client = create_storage_client_from_location(storage_location)
    if not storage_client:
        return None

    clean_path = file_path.lstrip("/")
    uri = storage_client.path_to_storage_uri(clean_path)
    return uri


def file_source_path(file_source: FileSource) -> str | None:
    """Return the path from a file source if it is a concrete file source."""
    if file_source.source_type != "file" or not file_source.location:
        return None
    if isinstance(file_source.location, dict):
        return str(file_source.location.get("path", ""))
    if isinstance(file_source.location, FileLocation):
        return file_source.location.path
    return None


def construct_glob_pattern_from_sources(
    file_sources: list[FileSource],
    storage_location: StorageLocation,
) -> str | None:
    """Construct a glob pattern from multiple file sources in the same storage location.

    Args:
        file_sources: List of FileSource objects with source_type="file"
        storage_location: StorageLocation with config

    Returns:
        Glob pattern (e.g., gs://bucket/path/*.parquet) or None if not applicable
    """
    storage_uris = storage_uris_for_sources(file_sources, storage_location)
    if not storage_uris:
        return None

    first_uri = storage_uris[0]
    match = STORAGE_URI_PATTERN.match(first_uri.split("?")[0])
    if not match:
        return None

    paths = storage_uri_directories(storage_uris)
    if not paths:
        return None

    common_path = longest_common_path(paths)
    glob_pattern = (
        f"{match.group(1)}{match.group(2)}/{common_path}/*.parquet"
        if common_path
        else f"{match.group(1)}{match.group(2)}/*.parquet"
    )
    endpoint_param = endpoint_url_param(first_uri)
    return f"{glob_pattern}?endpoint_url={endpoint_param}" if endpoint_param else glob_pattern


def storage_uris_for_sources(file_sources: list[FileSource], storage_location: StorageLocation) -> list[str]:
    """Return valid native storage URIs for file sources."""
    storage_uris = []
    for source in file_sources:
        uri = get_file_source_storage_uri(source, storage_location)
        if uri and (uri.startswith("gs://") or uri.startswith("s3://")):
            storage_uris.append(uri)
    return storage_uris


def storage_uri_directories(storage_uris: list[str]) -> list[str]:
    """Extract directory paths from storage URIs."""
    paths = []
    for uri in storage_uris:
        match = STORAGE_URI_PATTERN.match(uri.split("?")[0])
        if not match:
            continue
        path_parts = match.group(3).split("/")
        paths.append("/".join(path_parts[:-1]) if len(path_parts) > 1 else "")
    return paths


def longest_common_path(paths: list[str]) -> str:
    """Return the longest slash-delimited common path."""
    common_parts = paths[0].split("/")
    for path in paths[1:]:
        parts = path.split("/")
        common_length = 0
        for common_part, part in zip(common_parts, parts, strict=False):
            if common_part != part:
                break
            common_length += 1
        common_parts = common_parts[:common_length]
    return "/".join(common_parts)


def endpoint_url_param(uri: str) -> str | None:
    """Extract an endpoint_url query parameter from a storage URI."""
    if "?endpoint_url=" not in uri:
        return None
    return uri.split("?endpoint_url=", maxsplit=1)[1]


async def expand_glob_pattern_in_source(
    file_source: FileSource,
    storage_location: StorageLocation,
) -> list[APIDict]:
    """Expand a file source with a glob pattern in its path to individual file sources.

    Args:
        file_source: FileSource with a path containing wildcards (e.g., "path/*.parquet")
        storage_location: StorageLocation with config

    Returns:
        List of dicts (not actual FileSource objects) with individual file paths
    """
    source_location = glob_source_location(file_source)
    if not source_location:
        return []
    file_path, location_version = source_location
    if "*" not in file_path:
        # Not a glob pattern, return as-is
        return [model_json_dict(file_source)]

    file_path = normalize_glob_path(file_path)

    # Create storage client and use it to expand the glob pattern
    storage_client = create_storage_client_from_location(storage_location)
    if not storage_client:
        logger.warning(
            "Cannot create storage client for location %s, cannot expand glob pattern", storage_location.name
        )
        return [model_json_dict(file_source)]

    # Use storage client's expand_glob_pattern method
    matching_files = await storage_client.expand_glob_pattern(file_path)

    logger.info(
        "Storage client found %s files matching glob pattern %s",
        len(matching_files),
        file_path,
    )

    if not matching_files:
        logger.warning("No files found matching glob pattern: %s", file_path)
        return [model_json_dict(file_source)]

    return [
        await expanded_source_dict(file_source, matching_file, location_version, storage_client)
        for matching_file in matching_files
    ]


def glob_source_location(file_source: FileSource) -> tuple[str, str] | None:
    """Return source path and location version for a glob-capable source."""
    if not file_source.location:
        return None
    if isinstance(file_source.location, dict):
        file_path = str(file_source.location.get("path", ""))
        location_version = str(file_source.location.get("version", "1"))
    elif isinstance(file_source.location, FileLocation):
        file_path = file_source.location.path
        location_version = file_source.location.version
    else:
        return None
    return (file_path, location_version) if file_path else None


def normalize_glob_path(file_path: str) -> str:
    """Normalize storage URIs and GCS public URLs into object paths."""
    match = STORAGE_URI_PATTERN.match(file_path)
    if match:
        return match.group(3).lstrip("/")
    match = GCS_PUBLIC_URL_PATTERN.match(file_path)
    if match:
        return match.group(1).lstrip("/")
    return file_path.lstrip("/")


async def expanded_source_dict(
    file_source: FileSource,
    matching_file: str,
    location_version: str,
    storage_client: SupportsFileSize,
) -> APIDict:
    """Build a source dictionary for one expanded glob match."""
    file_size = await file_size_or_none(storage_client, matching_file)
    base_metadata = source_metadata_dict(file_source)
    if file_size is not None:
        base_metadata["size_bytes"] = file_size
    base_metadata.setdefault("version", "v1")
    return {
        "id": file_source.id,
        "file_format_id": file_source.file_format_id,
        "storage_location_id": file_source.storage_location_id,
        "version": file_source.version,
        "source_type": file_source.source_type,
        "location": model_json_dict(FileLocation(version=location_version, path=matching_file)),
        "source_metadata": base_metadata if base_metadata else None,
    }


async def file_size_or_none(storage_client: SupportsFileSize, matching_file: str) -> int | None:
    """Return file size for an expanded source, logging and ignoring lookup errors."""
    try:
        return await storage_client.get_file_size(matching_file)
    except Exception as exc:
        logger.warning("Failed to get file size for %s: %s", matching_file, exc)
        return None


def source_metadata_dict(file_source: FileSource) -> APIDict:
    """Return a mutable source metadata dictionary."""
    source_metadata = file_source.source_metadata
    if isinstance(source_metadata, dict):
        return {str(key): json_value(value) for key, value in source_metadata.items()}
    if source_metadata:
        return model_json_dict(source_metadata)
    return {}
