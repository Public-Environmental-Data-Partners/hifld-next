"""Helper functions for constructing URLs from storage locations and dataset paths."""

from typing import Optional, Any
from .dataset import DatasetSource, StorageLocation


def get_file_url(
    source_type: str,
    location: dict[str, Any],
    storage_location: Optional[StorageLocation],
) -> Optional[str]:
    """
    Construct the full URL from source type, location, and storage location.

    Args:
        source_type: Type of source - "file", "database", or "api"
        location: Location dict with appropriate fields for the source type
        storage_location: StorageLocation with config.base_url

    Returns:
        Full URL to resource, or None if location or storage location is missing
    """
    if not location or not storage_location:
        return None

    # For API locations, return the URL directly
    if source_type == "api":
        return location.get("url")

    # For database locations, return None (no URL for databases)
    if source_type == "database":
        return None

    # For file locations, construct URL from path
    if source_type == "file":
        file_path = location.get("path")
        if not file_path:
            return None

        # Get base_url and bucket from config
        base_url = None
        bucket = None
        if storage_location.config:
            if isinstance(storage_location.config, dict):
                base_url = storage_location.config.get("base_url")
                bucket = storage_location.config.get("bucket")
            else:
                # Pydantic model
                base_url = storage_location.config.base_url
                bucket = storage_location.config.bucket

        if not base_url:
            return None

        base_url = base_url.rstrip("/")
        path = file_path.lstrip("/")

        # For SeaweedFS and similar storage, include /buckets/{bucket}/ in the URL
        if bucket:
            return f"{base_url}/buckets/{bucket}/{path}"
        else:
            return f"{base_url}/{path}"

    return None


def get_dataset_source_url(
    dataset_source: DatasetSource,
    storage_location: Optional[StorageLocation],
) -> Optional[str]:
    """
    Construct the full URL for a DatasetSource.

    Args:
        dataset_source: DatasetSource with source_type and location dict
        storage_location: StorageLocation with config.base_url

    Returns:
        Full URL to resource, or None if location or storage location is missing
    """
    if not storage_location or not dataset_source.location:
        return None
    return get_file_url(
        dataset_source.source_type, dataset_source.location, storage_location
    )
