"""
Configurable storage client for SeaweedFS and S3-compatible storage.

This module provides an abstraction layer for object storage operations,
allowing the upload processor to work with different storage backends.
"""

import logging
import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Dict, List, Optional

import httpx
import gcsfs
import s3fs

try:
    from google.cloud import storage

    GCS_AVAILABLE = True
except ImportError:
    GCS_AVAILABLE = False

from models.dataset import BucketStorageLocationConfig

logger = logging.getLogger("storage-client")


class StorageClient(ABC):
    """Abstract base class for storage clients."""

    @abstractmethod
    async def upload_file(
        self,
        local_path: Path,
        remote_path: str,
        content_type: Optional[str] = None,
    ) -> str:
        """Upload a file to storage and return the public URL."""
        pass

    @abstractmethod
    async def download_file(self, remote_path: str, local_path: Path) -> None:
        """Download a file from storage."""
        pass

    @abstractmethod
    async def delete_file(self, remote_path: str) -> bool:
        """Delete a file from storage."""
        pass

    @abstractmethod
    async def file_exists(self, remote_path: str) -> bool:
        """Check if a file exists in storage."""
        pass

    @abstractmethod
    def get_public_url(self, remote_path: str) -> str:
        """Get the public URL for a file."""
        pass

    @abstractmethod
    async def list_files(self, prefix: str) -> List[str]:
        """List all files with the given prefix.

        Args:
            prefix: Path prefix to search within (e.g., "dataset-name/")

        Returns:
            List of relative paths (not full URLs), excluding directories.
        """
        pass

    async def find_files_by_extensions(
        self, prefix: str, extensions: List[str]
    ) -> Dict[str, List[str]]:
        """Find files by extension within a prefix.

        Args:
            prefix: Path prefix to search within
            extensions: List of extensions (e.g., ['.parquet', '.pmtiles'])

        Returns:
            Dict mapping extension (without dot) to list of public URLs.
            Keys are normalized (e.g., 'parquet', 'pmtiles').
        """
        all_files = await self.list_files(prefix)
        result: Dict[str, List[str]] = {}

        for file_path in all_files:
            # Check each extension
            for ext in extensions:
                # Normalize extension (remove leading dot, handle .zstd.parquet)
                normalized_ext = ext.lstrip(".")
                if file_path.endswith(ext) or (
                    ext == ".parquet" and file_path.endswith(".zstd.parquet")
                ):
                    # Use normalized extension as key
                    if normalized_ext not in result:
                        result[normalized_ext] = []
                    result[normalized_ext].append(self.get_public_url(file_path))
                    break  # File matched one extension, move to next file

        return result

    def parse_url_to_path(self, url: str) -> Optional[str]:
        """Parse a storage URL to extract the relative path.

        Args:
            url: Full storage URL

        Returns:
            Relative path if URL belongs to this storage backend, None otherwise.
        """
        pass

    def path_to_s3_uri(self, path: str) -> str:
        """Convert a storage path to S3-compatible URI (e.g., s3://bucket/path).

        Args:
            path: Relative path within the storage location

        Returns:
            S3-compatible URI (e.g., s3://bucket/path/to/file.parquet)
        """
        pass

    def path_to_storage_uri(self, path: str) -> str:
        """Convert a storage path to storage-specific URI (e.g., gs://bucket/path or s3://bucket/path).

        This method returns the native protocol for each storage backend:
        - GCS: gs://bucket/path
        - SeaweedFS/S3: s3://bucket/path

        Args:
            path: Relative path within the storage location

        Returns:
            Storage URI with correct protocol (e.g., gs://bucket/path/to/file.parquet or s3://bucket/path/to/file.parquet)
        """
        pass

    def path_to_public_url(self, path: str, for_docker: bool = False) -> str:
        """Convert a storage path to public HTTP URL.

        Args:
            path: Relative path within the storage location
            for_docker: If True, use host.docker.internal instead of localhost
                       for Docker container access (e.g., when GeoServer is in Docker)

        Returns:
            Public HTTP URL for accessing the file
        """
        pass

    async def expand_glob_pattern(self, glob_path: str) -> List[str]:
        """Expand a glob pattern to list of matching file paths.

        Args:
            glob_path: Glob pattern path (e.g., "dataset/*.parquet")

        Returns:
            List of relative paths (not full URLs) matching the glob pattern
        """
        pass


class SeaweedFSFilerClient(StorageClient):
    """
    SeaweedFS storage client using the Filer HTTP API.

    Uses the filer's HTTP API for file operations, which doesn't require
    authentication unlike the S3 API.
    """

    def __init__(
        self,
        filer_url: str = "http://localhost:8888",
        s3_url: str = "http://localhost:8333",
        bucket: str = "hifld",
        timeout: float = 300.0,
    ):
        self.filer_url = filer_url.rstrip("/")
        self.s3_url = s3_url.rstrip("/")
        self.bucket = bucket
        self.timeout = timeout

    def _get_filer_path(self, remote_path: str) -> str:
        """Build the full filer path including bucket."""
        clean_path = remote_path.lstrip("/")
        return f"/buckets/{self.bucket}/{clean_path}"

    def _get_content_type(self, local_path: Path) -> str:
        """Determine content type from file extension."""
        ext = local_path.suffix.lower()
        content_type_map = {
            ".parquet": "application/x-parquet",
            ".pmtiles": "application/x-protobuf",
            ".json": "application/json",
            ".geojson": "application/geo+json",
            ".fgb": "application/octet-stream",
        }
        return content_type_map.get(ext, "application/octet-stream")

    async def _ensure_bucket_exists(self):
        """Ensure bucket directory exists in filer."""
        bucket_path = f"/buckets/{self.bucket}/"
        url = f"{self.filer_url}{bucket_path}"

        async with httpx.AsyncClient(timeout=30) as client:
            # Check if bucket exists
            response = await client.head(url)
            if response.status_code == 404:
                # Create bucket directory
                response = await client.post(url)
                if response.status_code in (200, 201):
                    logger.info(f"Created bucket: {self.bucket}")

    async def upload_file(
        self,
        local_path: Path,
        remote_path: str,
        content_type: Optional[str] = None,
    ) -> str:
        """Upload a file to SeaweedFS using the filer HTTP API."""
        await self._ensure_bucket_exists()

        content_type = content_type or self._get_content_type(local_path)
        filer_path = self._get_filer_path(remote_path)
        url = f"{self.filer_url}{filer_path}"

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            with open(local_path, "rb") as f:
                # Use multipart/form-data for filer uploads
                files = {"file": (local_path.name, f, content_type)}
                response = await client.post(url, files=files)
                response.raise_for_status()

        public_url = self.get_public_url(remote_path)
        logger.info(f"Uploaded {local_path.name} to {public_url}")
        return public_url

    async def download_file(self, remote_path: str, local_path: Path) -> None:
        """Download a file from SeaweedFS."""
        filer_path = self._get_filer_path(remote_path)
        url = f"{self.filer_url}{filer_path}"

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(url)
            response.raise_for_status()

            local_path.parent.mkdir(parents=True, exist_ok=True)
            with open(local_path, "wb") as f:
                f.write(response.content)

        logger.info(f"Downloaded {remote_path} to {local_path}")

    async def delete_file(self, remote_path: str) -> bool:
        """Delete a file from SeaweedFS."""
        filer_path = self._get_filer_path(remote_path)
        url = f"{self.filer_url}{filer_path}"

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.delete(url)
            return response.status_code in (200, 202, 204, 404)

    async def file_exists(self, remote_path: str) -> bool:
        """Check if a file exists in SeaweedFS."""
        filer_path = self._get_filer_path(remote_path)
        url = f"{self.filer_url}{filer_path}"

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.head(url)
            return response.status_code == 200

    def get_public_url(self, remote_path: str) -> str:
        """Get the public URL for a file (via filer HTTP endpoint)."""
        key = remote_path.lstrip("/")
        return f"{self.filer_url}/buckets/{self.bucket}/{key}"

    async def list_files(self, prefix: str) -> List[str]:
        """List all files in SeaweedFS with the given prefix."""
        clean_prefix = prefix.lstrip("/")

        # Use the buckets format with JSON accept header
        url = f"{self.filer_url}/buckets/{self.bucket}/{clean_prefix}"

        async with httpx.AsyncClient(timeout=30) as client:
            try:
                # Request JSON response explicitly
                response = await client.get(url, headers={"Accept": "application/json"})

                if response.status_code == 200:
                    try:
                        data = response.json()
                    except Exception:
                        # If JSON parsing fails, log and return empty
                        text = response.text[:200] if response.text else "(empty)"
                        logger.warning(
                            f"SeaweedFS returned non-JSON response: {text[:100]}..."
                        )
                        return []

                    files = []
                    # Parse the response (format depends on SeaweedFS version)
                    if "Files" in data:
                        for item in data["Files"]:
                            if "FullPath" in item:
                                # FullPath might include /buckets/{bucket}/ prefix
                                full_path = item["FullPath"].lstrip("/")
                                # Remove bucket prefix if present
                                if full_path.startswith(f"buckets/{self.bucket}/"):
                                    full_path = full_path[
                                        len(f"buckets/{self.bucket}/") :
                                    ]
                                files.append(full_path)
                            elif "name" in item:
                                # Relative path from prefix
                                full_path = f"{clean_prefix.rstrip('/')}/{item['name']}"
                                files.append(full_path)
                    elif "Entries" in data:
                        # Alternative response format
                        for item in data["Entries"]:
                            if "FullPath" in item:
                                full_path = item["FullPath"].lstrip("/")
                                if full_path.startswith(f"buckets/{self.bucket}/"):
                                    full_path = full_path[
                                        len(f"buckets/{self.bucket}/") :
                                    ]
                                files.append(full_path)
                            elif "name" in item:
                                full_path = f"{clean_prefix.rstrip('/')}/{item['name']}"
                                files.append(full_path)
                    elif isinstance(data, list):
                        # Response might be a direct list
                        for item in data:
                            if isinstance(item, dict):
                                if "FullPath" in item:
                                    full_path = item["FullPath"].lstrip("/")
                                    if full_path.startswith(f"buckets/{self.bucket}/"):
                                        full_path = full_path[
                                            len(f"buckets/{self.bucket}/") :
                                        ]
                                    files.append(full_path)
                                elif "name" in item:
                                    full_path = (
                                        f"{clean_prefix.rstrip('/')}/{item['name']}"
                                    )
                                    files.append(full_path)
                    # Filter out directories (paths ending with /)
                    return [f for f in files if not f.endswith("/")]
                elif response.status_code == 404:
                    # Directory doesn't exist, return empty list
                    return []
                else:
                    logger.warning(
                        f"SeaweedFS API returned status {response.status_code} for {url}"
                    )
                    return []
            except Exception as e:
                logger.warning(f"Error listing SeaweedFS files: {e}")
                return []

    def parse_url_to_path(self, url: str) -> Optional[str]:
        """Parse a SeaweedFS URL to extract the relative path."""
        # SeaweedFS format: http://localhost:8888/buckets/{bucket}/{path}
        if f"/buckets/{self.bucket}/" in url:
            parts = url.split(f"/buckets/{self.bucket}/")
            if len(parts) > 1:
                return parts[1]
        return None

    def path_to_s3_uri(self, path: str) -> str:
        """Convert a SeaweedFS path to S3-compatible URI.

        Note: SeaweedFS doesn't support S3 URIs directly, but we can construct
        an S3-compatible format for compatibility.
        """
        clean_path = path.lstrip("/")
        # For SeaweedFS, we can't use S3 URIs directly, but return a format
        # that indicates it's SeaweedFS (though GeoServer won't support this)
        return f"s3://{self.bucket}/{clean_path}"

    def path_to_storage_uri(self, path: str) -> str:
        """Convert a SeaweedFS path to storage URI (s3://) with endpoint parameter.

        Returns:
            S3 URI with endpoint parameter: s3://bucket/path?endpoint_url=http://localhost:8333
        """
        clean_path = path.lstrip("/")
        return f"s3://{self.bucket}/{clean_path}?endpoint_url={self.s3_url}"

    def path_to_public_url(self, path: str, for_docker: bool = False) -> str:
        """Convert a SeaweedFS path to public HTTP URL.

        Args:
            path: Relative path within the storage location
            for_docker: If True, use host.docker.internal instead of localhost
                       for Docker container access (e.g., when GeoServer is in Docker)
        """
        url = self.get_public_url(path)
        # If this URL is for use by Docker containers (like GeoServer),
        # replace localhost with host.docker.internal
        if for_docker and "localhost" in url:
            url = url.replace("localhost", "host.docker.internal")
        elif for_docker and "127.0.0.1" in url:
            url = url.replace("127.0.0.1", "host.docker.internal")
        return url

    async def expand_glob_pattern(self, glob_path: str) -> List[str]:
        """Expand a glob pattern to list of matching file paths using fsspec.

        Args:
            glob_path: Glob pattern path (e.g., "dataset/*.parquet")

        Returns:
            List of relative paths (not full URLs) matching the glob pattern
        """
        import s3fs

        # Construct full S3 URI with endpoint
        full_glob_path = f"s3://{self.bucket}/{glob_path.lstrip('/')}"

        # Use s3fs with custom endpoint
        fs = s3fs.S3FileSystem(
            client_kwargs={"endpoint_url": self.s3_url},
            key="",  # SeaweedFS doesn't require auth
            secret="",
        )

        # Use fsspec glob to find all matching files
        matching_files = fs.glob(full_glob_path)

        # Remove the protocol and bucket prefix(es) to get relative paths
        # Handle cases where bucket name might appear multiple times in the path
        cleaned_files = []
        for f in matching_files:
            # Remove s3:// protocol
            if f.startswith("s3://"):
                f = f[5:]  # Remove "s3://"
            # Remove all occurrences of bucket prefix
            while f.startswith(f"{self.bucket}/"):
                f = f[len(f"{self.bucket}/") :]
            f = f.lstrip("/")
            cleaned_files.append(f)

        # Filter out directories (they might end with /)
        matching_files = [f for f in cleaned_files if f and not f.endswith("/")]

        return matching_files


class GCSStorageClient(StorageClient):
    """
    Google Cloud Storage client that makes objects publicly readable.

    Uploads objects with public-read ACL so they can be accessed without authentication.
    """

    def __init__(
        self,
        bucket: str,
        project: Optional[str] = None,
        timeout: float = 300.0,
    ):
        try:
            from google.cloud import storage
        except ImportError:
            raise ImportError(
                "google-cloud-storage is required for GCS storage. "
                "Install with: pip install google-cloud-storage"
            )

        self.bucket_name = bucket
        self.project = project
        self.timeout = timeout
        self.client = storage.Client(project=project)
        self.bucket = self.client.bucket(bucket)

    def _get_content_type(self, local_path: Path) -> str:
        """Determine content type from file extension."""
        ext = local_path.suffix.lower()
        content_type_map = {
            ".parquet": "application/x-parquet",
            ".pmtiles": "application/x-protobuf",
            ".json": "application/json",
            ".geojson": "application/geo+json",
            ".fgb": "application/octet-stream",
        }
        return content_type_map.get(ext, "application/octet-stream")

    async def upload_file(
        self,
        local_path: Path,
        remote_path: str,
        content_type: Optional[str] = None,
    ) -> str:
        """Upload a file to GCS and make it publicly readable."""

        content_type = content_type or self._get_content_type(local_path)
        # Clean the remote path - ensure no leading slash
        clean_path = remote_path.lstrip("/")
        blob = self.bucket.blob(clean_path)
        blob.content_type = content_type

        # Upload file
        def _upload():
            blob.upload_from_filename(str(local_path))
            # Note: With uniform bucket-level access, objects inherit bucket IAM permissions
            # The bucket is already configured with public read access via IAM
            # blob.make_public() would fail with uniform bucket-level access enabled

        # Run in thread pool to avoid blocking
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _upload)

        # Construct the public URL explicitly
        # Format: https://storage.googleapis.com/{bucket}/{path}
        public_url = f"https://storage.googleapis.com/{self.bucket_name}/{clean_path}"

        logger.info(f"Uploaded {local_path.name} to {public_url}")
        return public_url

    async def download_file(self, remote_path: str, local_path: Path) -> None:
        """Download a file from GCS."""

        blob = self.bucket.blob(remote_path.lstrip("/"))

        def _download():
            local_path.parent.mkdir(parents=True, exist_ok=True)
            blob.download_to_filename(str(local_path))

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _download)

        logger.info(f"Downloaded {remote_path} to {local_path}")

    async def delete_file(self, remote_path: str) -> bool:
        """Delete a file from GCS."""

        blob = self.bucket.blob(remote_path.lstrip("/"))

        def _delete():
            try:
                blob.delete()
                return True
            except Exception as e:
                logger.warning(f"Failed to delete {remote_path}: {e}")
                return False

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _delete)

    async def file_exists(self, remote_path: str) -> bool:
        """Check if a file exists in GCS."""

        blob = self.bucket.blob(remote_path.lstrip("/"))

        def _exists():
            return blob.exists()

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _exists)

    def get_public_url(self, remote_path: str) -> str:
        """Get the public URL for a file."""
        clean_path = remote_path.lstrip("/")
        # Return the public URL directly without checking if blob exists
        # Format: https://storage.googleapis.com/{bucket}/{path}
        return f"https://storage.googleapis.com/{self.bucket_name}/{clean_path}"

    async def list_files(self, prefix: str) -> List[str]:
        """List all files in a GCS bucket with the given prefix."""

        def _list():
            blobs = self.bucket.list_blobs(prefix=prefix)
            return [blob.name for blob in blobs if not blob.name.endswith("/")]

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _list)

    def parse_url_to_path(self, url: str) -> Optional[str]:
        """Parse a GCS URL to extract the relative path."""
        # GCS format: https://storage.googleapis.com/{bucket}/{path}
        if "storage.googleapis.com" in url:
            parts = url.split(f"storage.googleapis.com/{self.bucket_name}/")
            if len(parts) > 1:
                return parts[1]
        return None

    def path_to_s3_uri(self, path: str) -> str:
        """Convert a GCS path to S3-compatible URI for GeoServer.

        GeoServer's GeoParquet plugin supports S3 URIs for GCS.
        """
        clean_path = path.lstrip("/")
        return f"s3://{self.bucket_name}/{clean_path}"

    def path_to_storage_uri(self, path: str) -> str:
        """Convert a GCS path to storage URI (gs://)."""
        clean_path = path.lstrip("/")
        return f"gs://{self.bucket_name}/{clean_path}"

    def path_to_public_url(self, path: str, for_docker: bool = False) -> str:
        """Convert a GCS path to public HTTP URL.

        Args:
            path: Relative path within the storage location
            for_docker: Not used for GCS (always uses public HTTPS URLs)
        """
        return f"https://storage.googleapis.com/{self.bucket_name}/{path}"

    async def expand_glob_pattern(self, glob_path: str) -> List[str]:
        """Expand a glob pattern to list of matching file paths using fsspec.

        Args:
            glob_path: Glob pattern path (e.g., "dataset/*.parquet")

        Returns:
            List of relative paths (not full URLs) matching the glob pattern
        """
        import gcsfs

        # Construct full GCS URI
        full_glob_path = f"gs://{self.bucket_name}/{glob_path.lstrip('/')}"

        # Use gcsfs
        fs = gcsfs.GCSFileSystem()

        # Use fsspec glob to find all matching files
        matching_files = fs.glob(full_glob_path)

        # Remove the protocol and bucket prefix(es) to get relative paths
        # Handle cases where bucket name might appear multiple times in the path
        cleaned_files = []
        for f in matching_files:
            # Remove gs:// protocol
            if f.startswith("gs://"):
                f = f[5:]  # Remove "gs://"
            # Remove all occurrences of bucket prefix
            while f.startswith(f"{self.bucket_name}/"):
                f = f[len(f"{self.bucket_name}/") :]
            f = f.lstrip("/")
            cleaned_files.append(f)

        # Filter out directories (they might end with /)
        matching_files = [f for f in cleaned_files if f and not f.endswith("/")]

        return matching_files


# Default client
SeaweedFSClient = SeaweedFSFilerClient


def create_storage_client(
    storage_type: Optional[str] = None,
    **kwargs,
) -> StorageClient:
    """
    Factory function to create the appropriate storage client.

    Args:
        storage_type: "seaweedfs" or "gcs" or auto-detect from environment
        **kwargs: Additional arguments for the storage client

    Environment variables:
        STORAGE_TYPE: "seaweedfs" (default) or "gcs"
        SEAWEEDFS_FILER_URL: Filer HTTP API URL (default: http://localhost:8888)
        SEAWEEDFS_S3_URL: S3 API URL for public access (default: http://localhost:8333)
        S3_BUCKET: Bucket name (default: hifld)
        GCS_BUCKET: GCS bucket name (required if STORAGE_TYPE=gcs)
        GCS_PROJECT: GCS project ID (optional, uses default credentials project)
    """
    storage_type = storage_type or os.getenv("STORAGE_TYPE", "seaweedfs")

    if storage_type == "seaweedfs":
        return SeaweedFSFilerClient(
            filer_url=kwargs.get("filer_url")
            or os.getenv("SEAWEEDFS_FILER_URL", "http://localhost:8888"),
            s3_url=kwargs.get("s3_url")
            or os.getenv("SEAWEEDFS_S3_URL", "http://localhost:8333"),
            bucket=kwargs.get("bucket") or os.getenv("S3_BUCKET", "hifld"),
        )
    elif storage_type == "gcs":
        bucket = kwargs.get("bucket") or os.getenv("GCS_BUCKET")
        if not bucket:
            raise ValueError(
                "GCS_BUCKET environment variable or bucket kwarg is required for GCS storage"
            )
        project = kwargs.get("project") or os.getenv("GCS_PROJECT")
        return GCSStorageClient(bucket=bucket, project=project)
    else:
        raise ValueError(f"Unsupported storage type: {storage_type}")


def create_storage_client_from_location(storage_location) -> Optional[StorageClient]:
    """
    Create a storage client from a StorageLocation model.

    Args:
        storage_location: StorageLocation model with config

    Returns:
        StorageClient instance or None if storage location is not bucket-based
    """
    if not storage_location or not storage_location.config:
        return None

    # Only bucket-based storage locations can create clients
    if storage_location.backend_type != "s3":
        return None

    # Handle both dict and Pydantic model configs
    # Import here to avoid circular dependencies
    try:
        from models.dataset import BucketStorageLocationConfig
    except ImportError:
        # If models not available, try to infer from dict
        BucketStorageLocationConfig = None

    if isinstance(storage_location.config, dict):
        config_type = storage_location.config.get("type")
        bucket = storage_location.config.get("bucket")
        base_url = storage_location.config.get("base_url")
    elif BucketStorageLocationConfig and isinstance(
        storage_location.config, BucketStorageLocationConfig
    ):
        config_type = storage_location.config.type
        bucket = storage_location.config.bucket
        base_url = storage_location.config.base_url
    else:
        return None

    if not bucket or not config_type:
        return None

    if config_type == "gcs":
        return GCSStorageClient(bucket=bucket)
    elif config_type == "seaweedfs":
        # Extract S3 endpoint from base_url (filer URL) - SeaweedFS S3 is typically on port 8333
        s3_url = (
            base_url.replace(":8888", ":8333")
            if ":8888" in base_url
            else base_url.replace("localhost", "localhost:8333")
        )
        if not s3_url.startswith("http"):
            s3_url = f"http://{s3_url}"
        return SeaweedFSFilerClient(
            filer_url=base_url,
            s3_url=s3_url,
            bucket=bucket,
        )
    else:
        return None
