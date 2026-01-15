"""Helper functions for constructing URLs from storage locations and dataset paths."""

from typing import Optional, Union
from .dataset import (
    DatasetSource,
    StorageLocation,
    FileLocation,
    ApiLocation,
    GeoServerLocation,
)


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

    # For file locations, construct URL from path
    if source_type == "file":
        if not isinstance(location, FileLocation):
            return None
        file_path = location.path
        if not file_path:
            return None

        # Get base_url and bucket from config
        # Only bucket-based storage (S3-compatible: AWS S3, GCS, SeaweedFS, etc.) have bucket field
        base_url = None
        bucket = None
        if storage_location.config:
            if isinstance(storage_location.config, dict):
                base_url = storage_location.config.get("base_url")
                # Only get bucket if backend_type is not geoserver
                if storage_location.backend_type != "geoserver":
                    bucket = storage_location.config.get("bucket")
            else:
                # Pydantic model - check backend_type before accessing bucket
                base_url = storage_location.config.base_url
                # Only access bucket if it's a BucketStorageLocationConfig
                if storage_location.backend_type != "geoserver":
                    from .dataset import BucketStorageLocationConfig

                    if isinstance(storage_location.config, BucketStorageLocationConfig):
                        bucket = storage_location.config.bucket

        if not base_url:
            return None

        base_url = base_url.rstrip("/")
        path = file_path.lstrip("/")

        # For GCS, URL format is: https://storage.googleapis.com/{bucket}/{path}
        # For SeaweedFS, URL format is: {base_url}/buckets/{bucket}/{path}
        if bucket:
            # Check if this is GCS (base_url contains storage.googleapis.com)
            if "storage.googleapis.com" in base_url:
                return f"{base_url}/{bucket}/{path}"
            else:
                # SeaweedFS or similar
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
