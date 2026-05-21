"""Configurable storage client for SeaweedFS and S3-compatible storage.

This module provides an abstraction layer for object storage operations,
allowing the upload processor to work with different storage backends.
"""

import asyncio
import importlib
import logging
import os
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import cast
from urllib.parse import quote

import gcsfs
import httpx

from models.dataset import BucketStorageLocationConfig, StorageLocation
from schemas.types import JSONDict, json_dict


logger = logging.getLogger("storage-client")
HTTP_OK = 200
HTTP_CREATED = 201
HTTP_ACCEPTED = 202
HTTP_NO_CONTENT = 204
HTTP_NOT_FOUND = 404


@dataclass(frozen=True)
class StorageClientOptions:
    """Optional storage client factory settings."""

    bucket: str | None = None
    filer_url: str | None = None
    s3_url: str | None = None
    base_url: str | None = None
    project: str | None = None


class StorageClient(ABC):
    """Abstract base class for storage clients."""

    @abstractmethod
    async def upload_file(
        self,
        local_path: Path,
        remote_path: str,
        content_type: str | None = None,
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
    async def list_files(self, prefix: str = "") -> list[str]:
        """List all files with the given prefix.

        Args:
            prefix: Path prefix to search within (e.g., "dataset-name/")

        Returns:
            List of relative paths (not full URLs), excluding directories.
        """
        pass

    async def find_files_by_extensions(self, prefix: str, extensions: list[str]) -> dict[str, list[str]]:
        """Find files by extension within a prefix.

        Args:
            prefix: Path prefix to search within
            extensions: List of extensions (e.g., ['.parquet', '.pmtiles'])

        Returns:
            Dict mapping extension (without dot) to list of public URLs.
            Keys are normalized (e.g., 'parquet', 'pmtiles').
        """
        all_files = await self.list_files(prefix)
        result: dict[str, list[str]] = {}

        for file_path in all_files:
            # Check each extension
            for ext in extensions:
                # Normalize extension (remove leading dot, handle .zstd.parquet)
                normalized_ext = ext.lstrip(".")
                if file_path.endswith(ext) or (ext == ".parquet" and file_path.endswith(".zstd.parquet")):
                    # Use normalized extension as key
                    if normalized_ext not in result:
                        result[normalized_ext] = []
                    result[normalized_ext].append(self.get_public_url(file_path))
                    break  # File matched one extension, move to next file

        return result

    def parse_url_to_path(self, url: str) -> str | None:
        """Parse a storage URL to extract the relative path."""
        return None

    def path_to_s3_uri(self, path: str) -> str:
        """Convert a storage path to S3-compatible URI."""
        raise NotImplementedError

    def path_to_storage_uri(self, path: str) -> str:
        """Convert a storage path to the backend-native storage URI."""
        raise NotImplementedError

    def path_to_public_url(self, path: str, for_docker: bool = False) -> str:
        """Convert a storage path to public HTTP URL."""
        return self.get_public_url(path)

    async def expand_glob_pattern(self, glob_path: str) -> list[str]:
        """Expand a glob pattern to list of matching file paths."""
        return []

    @abstractmethod
    async def get_file_size(self, remote_path: str) -> int:
        """Get the size of a file in bytes.

        Args:
            remote_path: Relative path to the file

        Returns:
            File size in bytes, or 0 if file doesn't exist or size cannot be determined
        """
        pass

    async def calculate_total_size_for_glob(self, glob_path: str) -> int:
        """Calculate the total size in bytes of all files matching a glob pattern.

        Args:
            glob_path: Glob pattern path (e.g., "dataset/parquet/file-*.zstd.parquet")

        Returns:
            Total size in bytes of all matching files
        """
        try:
            matching_files = await self.expand_glob_pattern(glob_path)
            if not matching_files:
                return 0

            total_size = 0
            for file_path in matching_files:
                size = await self.get_file_size(file_path)
                total_size += size
        except Exception as e:
            logger.warning(f"Error calculating total size for pattern {glob_path}: {e}")
            return 0
        else:
            return total_size


class SeaweedFSFilerClient(StorageClient):
    """SeaweedFS storage client using the Filer HTTP API.

    Uses the filer's HTTP API for file operations, which doesn't require
    authentication unlike the S3 API.
    """

    def __init__(
        self,
        filer_url: str = "http://localhost:8888",
        s3_url: str = "http://localhost:8333",
        bucket: str = "hifld",
        timeout: float = 300.0,
    ) -> None:
        """Initialize a SeaweedFS filer-backed storage client."""
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

    async def _ensure_bucket_exists(self) -> None:
        """Ensure bucket directory exists in filer."""
        bucket_path = f"/buckets/{self.bucket}/"
        url = f"{self.filer_url}{bucket_path}"

        async with httpx.AsyncClient(timeout=30) as client:
            # Check if bucket exists
            response = await client.head(url)
            if response.status_code == HTTP_NOT_FOUND:
                # Create bucket directory
                response = await client.post(url)
                if response.status_code in (HTTP_OK, HTTP_CREATED):
                    logger.info(f"Created bucket: {self.bucket}")

    async def upload_file(
        self,
        local_path: Path,
        remote_path: str,
        content_type: str | None = None,
    ) -> str:
        """Upload a file to SeaweedFS using the filer HTTP API."""
        await self._ensure_bucket_exists()

        content_type = content_type or self._get_content_type(local_path)
        filer_path = self._get_filer_path(remote_path)
        url = f"{self.filer_url}{filer_path}"

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            with local_path.open("rb") as f:
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
            with local_path.open("wb") as f:
                f.write(response.content)

        logger.info(f"Downloaded {remote_path} to {local_path}")

    async def delete_file(self, remote_path: str) -> bool:
        """Delete a file from SeaweedFS."""
        filer_path = self._get_filer_path(remote_path)
        url = f"{self.filer_url}{filer_path}"

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.delete(url)
            return response.status_code in (HTTP_OK, HTTP_ACCEPTED, HTTP_NO_CONTENT, HTTP_NOT_FOUND)

    async def file_exists(self, remote_path: str) -> bool:
        """Check if a file exists in SeaweedFS."""
        filer_path = self._get_filer_path(remote_path)
        url = f"{self.filer_url}{filer_path}"

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.head(url)
            return response.status_code == HTTP_OK

    def get_public_url(self, remote_path: str) -> str:
        """Get the public URL for a file (via filer HTTP endpoint)."""
        key = remote_path.lstrip("/")
        return f"{self.filer_url}/buckets/{self.bucket}/{key}"

    async def list_files(self, prefix: str = "") -> list[str]:
        """List all files in SeaweedFS with the given prefix recursively."""
        clean_prefix = prefix.strip("/")
        start_path = self._get_filer_path(clean_prefix).rstrip("/") + "/"
        bucket_prefix = f"/buckets/{self.bucket}/"
        files: list[str] = []
        pending = [start_path]

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            while pending:
                current_path = pending.pop()
                encoded_path = quote(current_path, safe="/")
                url = f"{self.filer_url}{encoded_path}?limit=10000"
                response = await client.get(url, headers={"Accept": "application/json"})
                if response.status_code == HTTP_NOT_FOUND:
                    continue
                response.raise_for_status()

                payload = json_dict(response.json())
                entries = payload.get("Entries")
                if not isinstance(entries, list):
                    continue
                for raw_entry in entries:
                    if not isinstance(raw_entry, dict):
                        continue
                    entry = json_dict(raw_entry)
                    full_path = str(entry.get("FullPath", "")).rstrip("/")
                    if not full_path:
                        continue
                    if self._is_filer_directory(entry):
                        pending.append(f"{full_path}/")
                        continue
                    if full_path.startswith(bucket_prefix):
                        files.append(full_path[len(bucket_prefix) :])

        return sorted(files)

    def _is_filer_directory(self, entry: JSONDict) -> bool:
        file_size = entry.get("FileSize")
        size = int(file_size) if isinstance(file_size, (str, int)) else 0
        return not entry.get("Mime") and not entry.get("Md5") and size == 0

    def parse_url_to_path(self, url: str) -> str | None:
        """Parse a SeaweedFS URL to extract the relative path."""
        # SeaweedFS format: http://localhost:8888/buckets/{bucket}/{path}
        if f"/buckets/{self.bucket}/" in url:
            parts = url.split(f"/buckets/{self.bucket}/")
            if len(parts) > 1:
                return parts[1]
        return None

    def path_to_s3_uri(self, path: str) -> str:
        """Convert a SeaweedFS path to S3-compatible URI.

        SeaweedFS exposes an S3-compatible endpoint for local testing.
        """
        clean_path = path.lstrip("/")
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
            for_docker: Legacy compatibility flag. Ignored by production clients.
        """
        url = self.get_public_url(path)
        if for_docker and "localhost" in url:
            url = url.replace("localhost", "host.docker.internal")
        elif for_docker and "127.0.0.1" in url:
            url = url.replace("127.0.0.1", "host.docker.internal")
        return url

    async def expand_glob_pattern(self, glob_path: str) -> list[str]:
        """Expand a glob pattern to list of matching file paths using the filer API.

        Args:
            glob_path: Glob pattern path (e.g., "dataset/*.parquet")

        Returns:
            List of relative paths (not full URLs) matching the glob pattern
        """
        clean_glob = glob_path.lstrip("/")
        prefix = clean_glob.split("*", 1)[0] if "*" in clean_glob else clean_glob
        if not prefix.endswith("/"):
            prefix = "/".join(prefix.split("/")[:-1])
            if prefix:
                prefix = f"{prefix}/"

        logger.info(
            "Expanding SeaweedFS glob pattern through filer listing: path=%s bucket=%s prefix=%s",
            clean_glob,
            self.bucket,
            prefix,
        )

        candidate_files = await self.list_files(prefix)
        glob_regex = self._glob_pattern_to_regex(clean_glob)
        matching_files = [
            path for path in candidate_files if path and not path.endswith("/") and glob_regex.fullmatch(path)
        ]

        logger.info(
            "Filer glob expansion found %d individual files: %s",
            len(matching_files),
            matching_files[:5] if matching_files else [],
        )

        return matching_files

    def _glob_pattern_to_regex(self, glob_path: str) -> re.Pattern[str]:
        pattern = glob_path.lstrip("/")
        regex = ""
        index = 0
        while index < len(pattern):
            char = pattern[index]
            if char == "*":
                if index + 1 < len(pattern) and pattern[index + 1] == "*":
                    if index + 2 < len(pattern) and pattern[index + 2] == "/":
                        regex += "(?:.*/)?"
                        index += 3
                    else:
                        regex += ".*"
                        index += 2
                else:
                    regex += "[^/]*"
                    index += 1
            elif char == "?":
                regex += "[^/]"
                index += 1
            else:
                regex += re.escape(char)
                index += 1
        return re.compile(regex)

    async def get_file_size(self, remote_path: str) -> int:
        """Get the size of a file in bytes using the filer HTTP API.

        Args:
            remote_path: Relative path to the file

        Returns:
            File size in bytes, or 0 if file doesn't exist or size cannot be determined
        """
        try:
            filer_path = self._get_filer_path(remote_path)
            url = f"{self.filer_url}{filer_path}"
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.head(url)
                response.raise_for_status()
                content_length = response.headers.get("content-length")
                if content_length:
                    return int(content_length)
        except Exception as e:
            logger.warning(f"Could not get size for {remote_path}: {e}")
            return 0
        else:
            return 0


class GCSStorageClient(StorageClient):
    """Google Cloud Storage client that makes objects publicly readable.

    Uploads objects with public-read ACL so they can be accessed without authentication.
    """

    def __init__(
        self,
        bucket: str,
        project: str | None = None,
        timeout: float = 300.0,
        base_url: str | None = None,
    ) -> None:
        """Initialize a Google Cloud Storage-backed storage client."""
        try:
            storage = importlib.import_module("google.cloud.storage")
        except ImportError as exc:
            msg = "google-cloud-storage is required for GCS storage. Install with: pip install google-cloud-storage"
            raise ImportError(msg) from exc

        self.bucket_name = bucket
        # When set (e.g. https://domain/storage for load balancer), use for public URLs instead of storage.googleapis.com.
        # LB path rewrite sends /storage/* -> /, so URL is base_url + "/" + path (no bucket in path).
        self.base_url = (base_url or "").rstrip("/") or None
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
        content_type: str | None = None,
    ) -> str:
        """Upload a file to GCS and make it publicly readable."""
        content_type = content_type or self._get_content_type(local_path)
        # Clean the remote path - ensure no leading slash
        clean_path = remote_path.lstrip("/")
        blob = self.bucket.blob(clean_path)
        blob.content_type = content_type

        # Upload file
        def _upload() -> None:
            blob.upload_from_filename(str(local_path))
            # Note: With uniform bucket-level access, objects inherit bucket IAM permissions
            # The bucket is already configured with public read access via IAM
            # blob.make_public() would fail with uniform bucket-level access enabled

        # Run in thread pool to avoid blocking
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _upload)

        public_url = self.get_public_url(clean_path)

        logger.info(f"Uploaded {local_path.name} to {public_url}")
        return public_url

    async def download_file(self, remote_path: str, local_path: Path) -> None:
        """Download a file from GCS."""
        blob = self.bucket.blob(remote_path.lstrip("/"))

        def _download() -> None:
            local_path.parent.mkdir(parents=True, exist_ok=True)
            blob.download_to_filename(str(local_path))

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _download)

        logger.info(f"Downloaded {remote_path} to {local_path}")

    async def delete_file(self, remote_path: str) -> bool:
        """Delete a file from GCS."""
        blob = self.bucket.blob(remote_path.lstrip("/"))

        def _delete() -> bool:
            try:
                blob.delete()
            except Exception as e:
                logger.warning(f"Failed to delete {remote_path}: {e}")
                return False
            else:
                return True

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _delete)

    async def file_exists(self, remote_path: str) -> bool:
        """Check if a file exists in GCS."""
        blob = self.bucket.blob(remote_path.lstrip("/"))

        def _exists() -> bool:
            return bool(blob.exists())

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _exists)

    def get_public_url(self, remote_path: str) -> str:
        """Get the public URL for a file."""
        clean_path = remote_path.lstrip("/")
        if self.base_url:
            # Load balancer: base_url/storage -> backend receives path only (no bucket in URL)
            return f"{self.base_url}/{clean_path}"
        return f"https://storage.googleapis.com/{self.bucket_name}/{clean_path}"

    async def list_files(self, prefix: str = "") -> list[str]:
        """List all files in a GCS bucket with the given prefix."""

        def _list() -> list[str]:
            blobs = self.bucket.list_blobs(prefix=prefix)
            return [blob.name for blob in blobs if not blob.name.endswith("/")]

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _list)

    def parse_url_to_path(self, url: str) -> str | None:
        """Parse a GCS URL to extract the relative path."""
        if "storage.googleapis.com" in url:
            parts = url.split(f"storage.googleapis.com/{self.bucket_name}/")
            if len(parts) > 1:
                return parts[1]
        if self.base_url:
            prefix = self.base_url.rstrip("/") + "/"
            if prefix in url:
                idx = url.find(prefix)
                rest = url[idx + len(prefix) :].split("?", maxsplit=1)[0]
                if rest:
                    return rest
        return None

    def path_to_s3_uri(self, path: str) -> str:
        """Convert a GCS path to S3-compatible URI."""
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
            for_docker: Not used for GCS.
        """
        return self.get_public_url(path)

    async def expand_glob_pattern(self, glob_path: str) -> list[str]:
        """Expand a glob pattern to list of matching file paths using fsspec.

        Args:
            glob_path: Glob pattern path (e.g., "dataset/*.parquet" or "**/dataset/**/*.parquet")

        Returns:
            List of relative paths (not full URLs) matching the glob pattern
        """
        # Construct full GCS URI
        full_glob_path = f"gs://{self.bucket_name}/{glob_path.lstrip('/')}"

        # Use gcsfs
        fs = gcsfs.GCSFileSystem()

        # For patterns starting with ** (nested parent directories), use glob()
        # For direct prefix patterns (even with ** for subdirectories), use find() which is much faster
        if glob_path.startswith("**/"):
            # Use glob for nested parent patterns (e.g., "**/dataset/**/*.parquet")
            def _glob() -> list[str]:
                return [str(path) for path in cast(list[str], fs.glob(full_glob_path))]

            loop = asyncio.get_event_loop()
            matching_files = await loop.run_in_executor(None, _glob)
        else:
            # Use find() for direct prefix patterns - much faster!
            # Extract prefix from pattern (everything before the first wildcard)
            # e.g., "dataset/**/*.parquet" -> "dataset/"
            # e.g., "dataset/*.parquet" -> "dataset/"
            prefix = glob_path.split("*", maxsplit=1)[0] if "*" in glob_path else glob_path
            if not prefix.endswith("/"):
                # If no trailing slash, find the directory
                prefix = "/".join(prefix.split("/")[:-1]) + "/" if "/" in prefix else ""

            full_prefix = f"gs://{self.bucket_name}/{prefix.lstrip('/')}"

            def _find() -> list[str]:
                all_files = [str(path) for path in cast(list[str], fs.find(full_prefix, detail=False))]
                # Filter by extension if pattern has one
                if "*." in glob_path:
                    ext = glob_path.rsplit("*.", maxsplit=1)[-1].split("/", maxsplit=1)[0].split("*", maxsplit=1)[0]
                    return [f for f in all_files if f.endswith(f".{ext}")]
                return all_files

            loop = asyncio.get_event_loop()
            matching_files = await loop.run_in_executor(None, _find)

        # Remove the protocol and bucket prefix(es) to get relative paths
        # Handle cases where bucket name might appear multiple times in the path
        cleaned_files = []
        for matched_file in matching_files:
            # Remove gs:// protocol
            clean_file = matched_file
            if clean_file.startswith("gs://"):
                clean_file = clean_file[5:]
            # Remove all occurrences of bucket prefix
            while clean_file.startswith(f"{self.bucket_name}/"):
                clean_file = clean_file[len(f"{self.bucket_name}/") :]
            cleaned_files.append(clean_file.lstrip("/"))

        # Filter out directories (they might end with /)
        matching_files = [f for f in cleaned_files if f and not f.endswith("/")]

        return matching_files

    async def get_file_size(self, remote_path: str) -> int:
        """Get the size of a file in bytes using gcsfs.

        Args:
            remote_path: Relative path to the file

        Returns:
            File size in bytes, or 0 if file doesn't exist or size cannot be determined
        """
        try:
            # Construct full GCS URI
            full_path = f"gs://{self.bucket_name}/{remote_path.lstrip('/')}"

            # Use gcsfs
            fs = gcsfs.GCSFileSystem()

            # Get file info (includes size)
            info = fs.info(full_path)
            if info and "size" in info:
                return info["size"]
        except Exception as e:
            logger.warning(f"Could not get size for {remote_path}: {e}")
            return 0
        else:
            return 0


# Default client
SeaweedFSClient = SeaweedFSFilerClient


def _storage_location_config_values(storage_location: StorageLocation) -> tuple[str | None, str | None, str | None]:
    """Extract storage client fields from a storage location config."""
    if isinstance(storage_location.config, dict):
        return (
            storage_location.config.get("type"),
            storage_location.config.get("bucket"),
            storage_location.config.get("base_url"),
        )
    if isinstance(storage_location.config, BucketStorageLocationConfig):
        return (
            storage_location.config.type,
            storage_location.config.bucket,
            storage_location.config.base_url,
        )
    return None, None, None


def _seaweedfs_s3_url(base_url: str) -> str:
    """Infer the SeaweedFS S3 endpoint from the filer URL."""
    s3_url = (
        base_url.replace(":8888", ":8333") if ":8888" in base_url else base_url.replace("localhost", "localhost:8333")
    )
    if not s3_url.startswith("http"):
        return f"http://{s3_url}"
    return s3_url


def create_storage_client(
    storage_type: str | None = None,
    options: StorageClientOptions | None = None,
) -> StorageClient:
    """Factory function to create the appropriate storage client.

    Args:
        storage_type: "seaweedfs" or "gcs" or auto-detect from environment
        options: Typed optional client settings.

    Environment variables:
        STORAGE_TYPE: "seaweedfs" (default) or "gcs"
        SEAWEEDFS_FILER_URL: Filer HTTP API URL (default: http://localhost:8888)
        SEAWEEDFS_S3_URL: S3 API URL for public access (default: http://localhost:8333)
        S3_BUCKET: Bucket name (default: hifld)
        GCS_BUCKET: GCS bucket name (required if STORAGE_TYPE=gcs)
        GCS_PROJECT: GCS project ID (optional, uses default credentials project)
    """
    storage_type = storage_type or os.getenv("STORAGE_TYPE", "seaweedfs")
    options = options or StorageClientOptions()

    if storage_type == "seaweedfs":
        return SeaweedFSFilerClient(
            filer_url=options.filer_url
            or options.base_url
            or os.getenv("SEAWEEDFS_FILER_URL", "http://localhost:8888"),
            s3_url=options.s3_url or os.getenv("SEAWEEDFS_S3_URL", "http://localhost:8333"),
            bucket=options.bucket or os.getenv("S3_BUCKET", "hifld"),
        )
    elif storage_type == "gcs":
        bucket_name = options.bucket or os.getenv("GCS_BUCKET")
        if not bucket_name:
            msg = "GCS_BUCKET environment variable or bucket kwarg is required for GCS storage"
            raise ValueError(msg)
        project_id = options.project or os.getenv("GCS_PROJECT")
        return GCSStorageClient(bucket=bucket_name, project=project_id)
    else:
        msg = f"Unsupported storage type: {storage_type}"
        raise ValueError(msg)


def create_storage_client_from_location(storage_location: StorageLocation | None) -> StorageClient | None:
    """Create a storage client from a StorageLocation model.

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

    config_type, bucket, base_url = _storage_location_config_values(storage_location)
    if not bucket or not config_type:
        return None

    if config_type == "gcs":
        return GCSStorageClient(bucket=bucket, base_url=base_url)
    if config_type == "seaweedfs" and base_url:
        return SeaweedFSFilerClient(
            filer_url=base_url,
            s3_url=_seaweedfs_s3_url(base_url),
            bucket=bucket,
        )
    return None
