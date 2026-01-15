"""
Configurable storage client for SeaweedFS and S3-compatible storage.

This module provides an abstraction layer for object storage operations,
allowing the upload processor to work with different storage backends.
"""

import logging
import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional

import httpx

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
        return f"/buckets/{self.bucket}/{remote_path.lstrip('/')}"

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
        import asyncio

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
        import asyncio

        blob = self.bucket.blob(remote_path.lstrip("/"))

        def _download():
            local_path.parent.mkdir(parents=True, exist_ok=True)
            blob.download_to_filename(str(local_path))

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _download)

        logger.info(f"Downloaded {remote_path} to {local_path}")

    async def delete_file(self, remote_path: str) -> bool:
        """Delete a file from GCS."""
        import asyncio

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
        import asyncio

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
