"""Helper functions for constructing URLs from storage locations and dataset paths."""

import logging
import re
from typing import Optional, Union

from .dataset import (
    FileSource,
    StorageLocation,
    FileLocation,
    ApiLocation,
    GeoServerLocation,
)
from storage.storage_client import create_storage_client_from_location

logger = logging.getLogger(__name__)


def get_file_url(
    source_type: str,
    location: Union[FileLocation, ApiLocation, GeoServerLocation, dict],
    storage_location: Optional[StorageLocation],
) -> Optional[str]:
    """
    Construct the full URL from source type, location, and storage location.

    Args:
        source_type: Type of source - "file", "database", "api", or "service"
        location: Location model or dict with appropriate fields for the source type
        storage_location: StorageLocation with config.base_url

    Returns:
        Full URL to resource, or None if location or storage location is missing
    """
    if not location or not storage_location:
        return None

    # Convert dict to Pydantic model if needed
    if isinstance(location, dict):
        if source_type == "file":
            location = FileLocation(**location)
        elif source_type == "api":
            location = ApiLocation(**location)
        elif source_type == "service":
            location = GeoServerLocation(**location)

    # For API locations, return the URL directly
    if source_type == "api":
        if isinstance(location, ApiLocation):
            return location.url
        return None

    # For database locations, return None (no URL for databases)
    if source_type == "database":
        return None

    # For service locations (GeoServer), return None
    # GeoServer URLs are constructed differently in the frontend
    if source_type == "service":
        return None

    # For file locations, use storage client to construct URL
    if source_type == "file":
        if not isinstance(location, FileLocation):
            return None
        file_path = location.path
        if not file_path:
            return None

        if not storage_location:
            return None

        # Use storage client to get public URL (handles bucket stripping, URL format, etc.)
        storage_client = create_storage_client_from_location(storage_location)
        if not storage_client:
            return None

        return storage_client.get_public_url(file_path)

    return None


def get_file_source_url(
    file_source: FileSource,
    storage_location: Optional[StorageLocation],
) -> Optional[str]:
    """
    Construct the full URL for a FileSource.

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
    storage_location: Optional[StorageLocation],
) -> Optional[str]:
    """
    Construct the storage URI (gs:// or s3://) for a FileSource.

    Args:
        file_source: FileSource with source_type and location dict
        storage_location: StorageLocation with config

    Returns:
        Storage URI (e.g., gs://bucket/path or s3://bucket/path), or None if not applicable
    """
    if not storage_location or not file_source.location:
        return None

    # Only file sources with bucket storage have storage URIs
    if file_source.source_type != "file":
        return None

    # Handle both dict and FileLocation objects
    if isinstance(file_source.location, dict):
        file_path = file_source.location.get("path", "")
    elif isinstance(file_source.location, FileLocation):
        file_path = file_source.location.path
    else:
        return None

    if not file_path:
        return None

    # Only bucket-based storage locations have storage URIs
    if storage_location.backend_type != "s3":
        return None

    # Create storage client and use it to construct the URI
    from storage.storage_client import create_storage_client_from_location

    storage_client = create_storage_client_from_location(storage_location)
    if not storage_client:
        return None

    clean_path = file_path.lstrip("/")
    uri = storage_client.path_to_storage_uri(clean_path)
    return uri


def construct_glob_pattern_from_sources(
    file_sources: list[FileSource],
    storage_location: StorageLocation,
) -> Optional[str]:
    """
    Construct a glob pattern from multiple file sources in the same storage location.

    Args:
        file_sources: List of FileSource objects with source_type="file"
        storage_location: StorageLocation with config

    Returns:
        Glob pattern (e.g., gs://bucket/path/*.parquet) or None if not applicable
    """
    if not file_sources or not storage_location:
        return None

    # Filter to only file sources
    file_sources = [s for s in file_sources if s.source_type == "file"]
    if not file_sources:
        return None

    # Get storage URIs for all sources
    storage_uris = []
    for source in file_sources:
        uri = get_file_source_storage_uri(source, storage_location)
        if uri and (uri.startswith("gs://") or uri.startswith("s3://")):
            storage_uris.append(uri)

    if not storage_uris:
        return None

    # Parse first URI to get scheme and bucket
    first_uri = storage_uris[0]
    # Handle URIs with query parameters (e.g., s3://bucket/path?endpoint_url=...)
    uri_without_params = first_uri.split("?")[0]
    match = re.match(r"^(gs://|s3://)([^/]+)/(.+)$", uri_without_params)
    if not match:
        return None

    scheme = match.group(1)  # gs:// or s3://
    bucket = match.group(2)  # bucket name

    # Extract endpoint URL from first URI if present (for SeaweedFS)
    endpoint_param = None
    if "?endpoint_url=" in first_uri:
        endpoint_param = first_uri.split("?endpoint_url=")[1]

    # Extract directory paths from all URIs
    paths = []
    for uri in storage_uris:
        # Handle URIs with query parameters
        uri_without_params = uri.split("?")[0]
        match = re.match(r"^(gs://|s3://)([^/]+)/(.+)$", uri_without_params)
        if match:
            full_path = match.group(3)
            # Remove filename, keep directory
            path_parts = full_path.split("/")
            if len(path_parts) > 1:
                directory = "/".join(path_parts[:-1])
                paths.append(directory)
            else:
                paths.append("")

    if not paths:
        return None

    # Find common directory prefix
    if len(paths) == 1:
        common_path = paths[0]
    else:
        # Find longest common prefix
        common_parts = paths[0].split("/")
        for path in paths[1:]:
            parts = path.split("/")
            # Find common prefix length
            common_length = 0
            for i in range(min(len(common_parts), len(parts))):
                if common_parts[i] == parts[i]:
                    common_length += 1
                else:
                    break
            common_parts = common_parts[:common_length]
        common_path = "/".join(common_parts)

        # Construct glob pattern
        if common_path:
            glob_pattern = f"{scheme}{bucket}/{common_path}/*.parquet"
        else:
            glob_pattern = f"{scheme}{bucket}/*.parquet"

        # Add endpoint parameter if present (for SeaweedFS)
        if endpoint_param:
            glob_pattern = f"{glob_pattern}?endpoint_url={endpoint_param}"

        return glob_pattern


async def expand_glob_pattern_in_source(
    file_source: FileSource,
    storage_location: StorageLocation,
) -> list[dict]:
    """
    Expand a file source with a glob pattern in its path to individual file sources.

    Args:
        file_source: FileSource with a path containing wildcards (e.g., "path/*.parquet")
        storage_location: StorageLocation with config

    Returns:
        List of dicts (not actual FileSource objects) with individual file paths
    """
    # Handle both dict and FileLocation objects
    if not file_source.location:
        return []

    if isinstance(file_source.location, dict):
        file_path = file_source.location.get("path", "")
        location_version = file_source.location.get("version", "1")
    elif isinstance(file_source.location, FileLocation):
        file_path = file_source.location.path
        location_version = file_source.location.version
    else:
        return []

    if not file_path or "*" not in file_path:
        # Not a glob pattern, return as-is
        if isinstance(file_source, dict):
            return [file_source]
        else:
            return [file_source.model_dump()]

    # Normalize paths that include a scheme or full URL
    match = re.match(r"^(gs://|s3://)([^/]+)/(.*)$", file_path)
    if match:
        file_path = match.group(3)
    match = re.match(r"^https?://storage\.googleapis\.com/[^/]+/(.*)$", file_path)
    if match:
        file_path = match.group(1)
    file_path = file_path.lstrip("/")

    # Create storage client and use it to expand the glob pattern
    storage_client = create_storage_client_from_location(storage_location)
    if not storage_client:
        logger.warning(
            f"Cannot create storage client for location {storage_location.name}, cannot expand glob pattern"
        )
        return [file_source.model_dump()]

    # Use storage client's expand_glob_pattern method
    matching_files = await storage_client.expand_glob_pattern(file_path)

    logger.info(
        "Storage client found %s files matching glob pattern %s",
        len(matching_files),
        file_path,
    )

    if not matching_files:
        logger.warning(f"No files found matching glob pattern: {file_path}")
        return [file_source.model_dump()]

    # Create individual file source dicts
    expanded_sources = []
    for matching_file in matching_files:
        # Create a new FileLocation with the actual file path
        new_location = FileLocation(
            version=location_version,
            path=matching_file,
        )
        # Create a dict representation (not a FileSource object)
        source_dict = {
            "id": file_source.id,  # Keep original ID for reference
            "file_format_id": file_source.file_format_id,
            "storage_location_id": file_source.storage_location_id,
            "version": file_source.version,
            "source_type": file_source.source_type,
            "location": new_location.model_dump(),
            "source_metadata": (
                file_source.source_metadata.model_dump()
                if file_source.source_metadata
                else None
            ),
        }
        expanded_sources.append(source_dict)

    return expanded_sources
