"""GeoServer API integration service."""

import os
import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# GeoServer configuration from environment
GEOSERVER_URL = os.getenv("GEOSERVER_URL", "http://localhost:8080/geoserver")
GEOSERVER_USER = os.getenv("GEOSERVER_USER", "admin")
GEOSERVER_PASSWORD = os.getenv("GEOSERVER_PASSWORD", "geoserver")
GEOSERVER_WORKSPACE = os.getenv("GEOSERVER_WORKSPACE", "hifld")


class GeoServerClient:
    """Client for interacting with GeoServer REST API."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
    ):
        self.base_url = base_url or GEOSERVER_URL
        self.username = username or GEOSERVER_USER
        self.password = password or GEOSERVER_PASSWORD
        self.auth_header = self._get_auth_header()

    @staticmethod
    def get_versioned_store_name(
        dataset_name: str, storage_location_id: int, version: int
    ) -> str:
        """Generate unique store name for a dataset source version."""
        return f"{dataset_name}-loc{storage_location_id}-v{version}"

    def _get_auth_header(self) -> str:
        """Create authorization header for GeoServer."""
        import base64

        credentials = f"{self.username}:{self.password}"
        encoded = base64.b64encode(credentials.encode()).decode()
        return f"Basic {encoded}"

    def _to_docker_host_url(self, url: str) -> str:
        """Convert localhost URLs to appropriate host for GeoServer (running in Docker)."""
        if "localhost" in url or "127.0.0.1" in url:
            # If the URL is for SeaweedFS, use the service name
            if ":8888" in url or "seaweedfs" in url:
                # Use seaweedfs-filer:8888 for internal Docker networking
                return url.replace("localhost", "seaweedfs-filer").replace(
                    "127.0.0.1", "seaweedfs-filer"
                )
            return url.replace("localhost", "host.docker.internal").replace(
                "127.0.0.1", "host.docker.internal"
            )
        return url

    async def check_workspace_exists(self, workspace: str) -> bool:
        """Check if a workspace exists."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/rest/workspaces/{workspace}",
                    headers={
                        "Authorization": self.auth_header,
                        "Accept": "application/json",
                    },
                    timeout=10.0,
                )
                return response.is_success
        except Exception as e:
            logger.error(f"Error checking workspace existence: {e}")
            return False

    async def store_exists(self, workspace: str, store_name: str) -> bool:
        """Check if a datastore already exists in GeoServer."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/rest/workspaces/{workspace}/datastores/{store_name}",
                    headers={"Authorization": self.auth_header},
                    timeout=10.0,
                )
                return response.status_code == 200
        except Exception as e:
            logger.error(f"Error checking if store exists: {e}")
            return False

    async def delete_store(
        self, workspace: str, store_name: str, recurse: bool = True
    ) -> bool:
        """Delete a datastore from GeoServer.

        Args:
            workspace: GeoServer workspace name
            store_name: Name of the datastore to delete
            recurse: If True, delete all layers in the store first (required for stores with layers)
        """
        try:
            async with httpx.AsyncClient() as client:
                # Delete with recurse parameter to remove associated layers
                url = f"{self.base_url}/rest/workspaces/{workspace}/datastores/{store_name}"
                if recurse:
                    url += "?recurse=true"

                response = await client.delete(
                    url,
                    headers={"Authorization": self.auth_header},
                    timeout=30.0,
                )
                if response.is_success or response.status_code == 200:
                    logger.info(f"Deleted store '{store_name}' from GeoServer")
                    return True
                else:
                    logger.warning(
                        f"Failed to delete store '{store_name}': {response.status_code} - {response.text}"
                    )
                    return False
        except Exception as e:
            logger.error(f"Error deleting store: {e}")
            return False

    async def ensure_workspace_exists(self, workspace: str) -> bool:
        """Create workspace if it doesn't exist."""
        exists = await self.check_workspace_exists(workspace)
        if exists:
            return True

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/rest/workspaces",
                    headers={
                        "Authorization": self.auth_header,
                        "Content-Type": "application/json",
                    },
                    json={"workspace": {"name": workspace}},
                    timeout=10.0,
                )
                return response.is_success or response.status_code == 201
        except Exception as e:
            logger.error(f"Error creating workspace: {e}")
            return False

    async def create_pmtiles_store(
        self, workspace: str, store_name: str, pmtiles_url: str
    ) -> bool:
        """
        Create a PMTiles store in GeoServer.

        ✅ PMTiles supports HTTP/HTTPS URLs natively (unlike GeoPackage).
        PMTiles is designed for cloud storage and HTTP range requests, making it
        ideal for Cloud Run environments with ephemeral disks.

        This method will:
        - Use HTTP/HTTPS URLs directly (works in Cloud Run)
        - For Docker: Convert localhost to appropriate service name
        - Support file:// URLs if needed (though HTTP is preferred)
        """
        await self.ensure_workspace_exists(workspace)

        # Check if store already exists
        if await self.store_exists(workspace, store_name):
            logger.info(f"Store '{store_name}' already exists in GeoServer, reusing it")
            return True

        # Determine the URL to use
        # PMTiles supports HTTP URLs, but we should handle Docker networking
        if pmtiles_url.startswith("http://") or pmtiles_url.startswith("https://"):
            # For HTTP URLs, check if we're in a Docker environment
            if "localhost" in pmtiles_url or "127.0.0.1" in pmtiles_url:
                # Try Docker service name first (for same-network access)
                # This works when GeoServer and SeaweedFS are on the same Docker network
                if "seaweedfs" in pmtiles_url or "8888" in pmtiles_url:
                    docker_url = pmtiles_url.replace("localhost", "seaweedfs-filer")
                else:
                    docker_url = self._to_docker_host_url(pmtiles_url)
            else:
                # External HTTP URL - PMTiles supports this natively
                docker_url = pmtiles_url
        elif pmtiles_url.startswith("file://"):
            # File URL - use as-is (though HTTP is preferred for PMTiles)
            docker_url = pmtiles_url
        else:
            # Assume it's a file path, convert to file:// URL
            docker_url = f"file://{pmtiles_url}"

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/rest/workspaces/{workspace}/datastores",
                    headers={
                        "Authorization": self.auth_header,
                        "Content-Type": "application/json",
                    },
                    json={
                        "dataStore": {
                            "name": store_name,
                            "type": "PMTiles",
                            "connectionParameters": {
                                "entry": [{"@key": "url", "$": docker_url}],
                            },
                        },
                    },
                    timeout=30.0,
                )
                if response.is_success or response.status_code == 201:
                    return True
                else:
                    error_msg = response.text
                    logger.error(
                        f"GeoServer returned error {response.status_code}: {error_msg}"
                    )
                    return False
        except Exception as e:
            logger.error(f"Error creating PMTiles store: {e}")
            return False

    async def create_geopackage_store(
        self, workspace: str, store_name: str, geopackage_url: str
    ) -> bool:
        """
        Create a GeoPackage store in GeoServer (preferred open-source format).

        ⚠️  IMPORTANT LIMITATION: GeoServer's GeoPackage plugin requires file:// URLs,
        not HTTP URLs. This means:

        - ✅ Docker (local): Works if files are copied to GeoServer's data directory
        - ❌ Cloud Run: Will NOT work with HTTP URLs due to ephemeral disk

        For Cloud Run, recommended alternatives:
        1. Use GeoParquet instead (supports HTTP URLs via create_geoparquet_store)
        2. Use GCS volumes (mount GCS bucket as filesystem, then use file:// URLs)
        3. Download files to a mounted volume before creating the store

        This method will:
        - For HTTP/HTTPS URLs: Attempt to use them (will fail in Cloud Run)
        - For file:// URLs: Use them directly
        - For Docker: Convert localhost to appropriate service name
        """
        await self.ensure_workspace_exists(workspace)

        # Check if store already exists
        if await self.store_exists(workspace, store_name):
            logger.info(f"Store '{store_name}' already exists in GeoServer, reusing it")
            return True

        # Determine the URL to use
        # GeoPackage stores require file:// URLs, but we'll try HTTP URLs first
        # and let GeoServer return a clear error if it doesn't work
        if geopackage_url.startswith("http://") or geopackage_url.startswith(
            "https://"
        ):
            # For HTTP URLs, check if we're in a Docker environment
            # In Docker, convert localhost to the service name or host.docker.internal
            if "localhost" in geopackage_url or "127.0.0.1" in geopackage_url:
                # Try Docker service name first (for same-network access)
                # This works when GeoServer and SeaweedFS are on the same Docker network
                if "seaweedfs" in geopackage_url or "8888" in geopackage_url:
                    docker_url = geopackage_url.replace("localhost", "seaweedfs-filer")
                else:
                    docker_url = self._to_docker_host_url(geopackage_url)
            else:
                # External HTTP URL - GeoServer may not be able to access this
                # GeoPackage plugin typically requires file:// URLs
                logger.warning(
                    "GeoPackage store with HTTP URL will likely fail. "
                    "GeoServer's GeoPackage plugin requires file:// URLs. "
                    "For Cloud Run, use GeoParquet (supports HTTP URLs) instead."
                )
                docker_url = geopackage_url
        elif geopackage_url.startswith("file://"):
            # File URL - use as-is
            docker_url = geopackage_url
        else:
            # Assume it's a file path, convert to file:// URL
            docker_url = f"file://{geopackage_url}"

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/rest/workspaces/{workspace}/datastores",
                    headers={
                        "Authorization": self.auth_header,
                        "Content-Type": "application/json",
                    },
                    json={
                        "dataStore": {
                            "name": store_name,
                            "type": "GeoPackage",
                            "enabled": True,
                            "connectionParameters": {
                                "entry": [
                                    {"@key": "dbtype", "$": "geopkg"},
                                    {"@key": "database", "$": docker_url},
                                ],
                            },
                        },
                    },
                    timeout=30.0,
                )
                if response.is_success or response.status_code == 201:
                    return True
                else:
                    error_msg = response.text
                    logger.error(
                        f"GeoServer returned error {response.status_code}: {error_msg}"
                    )

                    # Provide helpful error message for Cloud Run scenarios
                    if "SQLITE_CANTOPEN" in error_msg or "Unable to open" in error_msg:
                        logger.warning(
                            "❌ GeoPackage plugin requires file:// URLs accessible to GeoServer.\n"
                            "   This will NOT work in Cloud Run with HTTP URLs (ephemeral disk).\n"
                            "   Solutions:\n"
                            "   1. Use GeoParquet instead (supports HTTP URLs)\n"
                            "   2. Configure GCS volumes and use file:// URLs\n"
                            "   3. Download files to a mounted volume before creating store"
                        )
                    return False
        except Exception as e:
            logger.error(f"Error creating GeoPackage store: {e}")
            return False

    async def create_geoparquet_store(
        self,
        workspace: str,
        store_name: str,
        geoparquet_url: str,
        s3_endpoint: Optional[str] = None,
    ) -> bool:
        """
        Create a GeoParquet store in GeoServer (or use existing if already exists).

        ✅ GeoParquet supports:
        - HTTP/HTTPS URLs (works in Cloud Run)
        - S3 URIs (e.g., `s3://bucket/path/file.parquet`) with glob patterns
        - Local files (file:// or absolute paths) with glob patterns
        - Multiple layers per dataset (each layer is a separate feature type)

        ⚠️  IMPORTANT: Glob patterns work differently depending on the URL type:

        - ✅ **S3 URIs**: Glob patterns ARE supported (e.g., `s3://bucket/**/*.parquet`)
          See: https://docs.geoserver.org/stable/en/user/community/geoparquet/configuration.html

        - ✅ **Local files**: Glob patterns ARE supported (e.g., `/data/**/*.parquet`)

        - ❌ **HTTP/HTTPS URLs**: Glob patterns do NOT work
          DuckDB's `read_parquet` function doesn't expand glob patterns for HTTP URLs.
          For chunked GeoParquet files over HTTP, you have two options:

          1. **Merge chunks into a single file** (recommended):
             - Use `merge_geoparquet_chunks()` to combine chunked files
             - Provide the merged file URL to this method

          2. **Use individual file URLs**:
             - Provide a single file URL (will only read that chunk)
             - Not recommended for chunked datasets

        - ❓ **GCS (gs://) URIs**: Not explicitly documented, but GCS is S3-compatible.
          May work if GeoServer's GeoParquet plugin supports gs:// URIs.

        **Using S3 URLs with SeaweedFS:**
        SeaweedFS provides an S3-compatible API (port 8333 by default).
        To use S3 URLs with SeaweedFS:
        1. Use S3 URL format: `s3://bucket-name/path/file.parquet`
        2. Provide `s3_endpoint` parameter: `http://localhost:8333` (or `http://seaweedfs-filer:8333` in Docker)
        3. Set up AWS credentials if required (SeaweedFS S3 may not require auth)

        Args:
            workspace: GeoServer workspace name
            store_name: Name for the data store
            geoparquet_url: URI to GeoParquet file(s) - supports glob patterns for S3 and local files
            s3_endpoint: Optional S3 endpoint URL for S3-compatible storage (e.g., SeaweedFS)

        Each layer in the GeoParquet files will be available as a separate feature type
        that can be published individually.
        """
        await self.ensure_workspace_exists(workspace)

        # Check if store already exists - delete it first to ensure correct URL
        if await self.store_exists(workspace, store_name):
            logger.info(
                f"Store '{store_name}' already exists in GeoServer, deleting to update URL..."
            )
            await self.delete_store(workspace, store_name, recurse=True)

        # Convert localhost to appropriate host for GeoServer access
        docker_url = self._to_docker_host_url(geoparquet_url)

        # Prepare connection parameters
        connection_params = [
            {"@key": "dbtype", "$": "geoparquet"},
            {"@key": "uri", "$": docker_url},
        ]

        # Add S3 endpoint configuration if provided
        if s3_endpoint and geoparquet_url.startswith("s3://"):
            # Convert endpoint for Docker network if needed
            docker_endpoint = self._to_docker_host_url(s3_endpoint)
            connection_params.extend(
                [
                    {"@key": "awsEndpoint", "$": docker_endpoint},
                    {
                        "@key": "awsRegion",
                        "$": "us-east-1",
                    },  # Dummy region for S3-compatible storage
                    {"@key": "useAwsCredentialChain", "$": "false"},
                ]
            )
            logger.info(f"Configuring S3 endpoint: {docker_endpoint}")

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/rest/workspaces/{workspace}/datastores",
                    headers={
                        "Authorization": self.auth_header,
                        "Content-Type": "application/json",
                    },
                    json={
                        "dataStore": {
                            "name": store_name,
                            "type": "GeoParquet",
                            "enabled": True,
                            "connectionParameters": {
                                "entry": connection_params,
                            },
                        },
                    },
                    timeout=30.0,
                )
                if response.is_success or response.status_code == 201:
                    return True
                else:
                    logger.error(
                        f"GeoServer returned error {response.status_code}: {response.text}"
                    )
                    return False
        except Exception as e:
            logger.error(f"Error creating GeoParquet store: {e}")
            return False

    async def get_available_feature_types(
        self, workspace: str, store_name: str
    ) -> list[str]:
        """Get available feature types from a store."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/rest/workspaces/{workspace}/datastores/{store_name}/featuretypes.json?list=available",
                    headers={
                        "Authorization": self.auth_header,
                        "Accept": "application/json",
                    },
                    timeout=10.0,
                )
                if response.is_success:
                    data = response.json()
                    if data.get("list") and data["list"].get("string"):
                        string_list = data["list"]["string"]
                        return (
                            string_list
                            if isinstance(string_list, list)
                            else [string_list]
                        )
                return []
        except Exception as e:
            logger.error(f"Error getting available feature types: {e}")
            return []

    async def layer_exists(self, workspace: str, layer_name: str) -> bool:
        """Check if a layer already exists in GeoServer."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/rest/workspaces/{workspace}/layers/{layer_name}",
                    headers={"Authorization": self.auth_header},
                    timeout=10.0,
                )
                return response.status_code == 200
        except Exception as e:
            logger.error(f"Error checking if layer exists: {e}")
            return False

    async def publish_layer(
        self, workspace: str, store_name: str, layer_name: str
    ) -> bool:
        """Publish a layer from a store (or use existing if already exists)."""
        try:
            # Check if layer already exists - delete it first to ensure it's published with latest settings
            if await self.layer_exists(workspace, layer_name):
                logger.info(
                    f"Layer '{layer_name}' already exists in GeoServer, deleting to republish..."
                )
                # We need to delete the feature type, not just the layer
                async with httpx.AsyncClient() as client:
                    await client.delete(
                        f"{self.base_url}/rest/workspaces/{workspace}/datastores/{store_name}/featuretypes/{layer_name}?recurse=true",
                        headers={"Authorization": self.auth_header},
                        timeout=10.0,
                    )

            # Get available native names from the store
            available_types = await self.get_available_feature_types(
                workspace, store_name
            )

            # Use the first available type as native name, or convert hyphens to underscores
            native_name = layer_name.replace("-", "_")
            if available_types:
                # Prefer an exact match or the first available
                exact_match = next(
                    (t for t in available_types if t == native_name or t == layer_name),
                    None,
                )
                # If no exact match, try matching without .zstd suffix
                if not exact_match:
                    base_name = layer_name.replace(".zstd", "")
                    exact_match = next(
                        (
                            t
                            for t in available_types
                            if t == base_name or t == base_name.replace("-", "_")
                        ),
                        None,
                    )
                native_name = exact_match or available_types[0]

            logger.info(
                f"Publishing layer '{layer_name}' with native name '{native_name}'"
            )

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/rest/workspaces/{workspace}/datastores/{store_name}/featuretypes",
                    headers={
                        "Authorization": self.auth_header,
                        "Content-Type": "application/json",
                    },
                    json={
                        "featureType": {
                            "name": layer_name,
                            "nativeName": native_name,
                            "enabled": True,
                        },
                    },
                    timeout=30.0,
                )
                if response.is_success or response.status_code == 201:
                    return True
                else:
                    logger.error(
                        f"GeoServer returned error {response.status_code} when publishing layer: {response.text}"
                    )
                    return False
        except Exception as e:
            logger.error(f"Error publishing layer: {e}")
            return False

    def get_feature_api_url(self, workspace: str, layer_name: str) -> str:
        """Get the OGC Feature API URL for a layer."""
        return f"{self.base_url}/{workspace}/ogc/features/v1/collections/{layer_name}"

    def get_wfs_url(self, workspace: str, layer_name: str) -> str:
        """Get the WFS service endpoint URL for a specific layer."""
        return f"{self.base_url}/{workspace}/{layer_name}/wfs"

    def get_wms_url(self, workspace: str, layer_name: str) -> str:
        """Get the WMS service endpoint URL for a specific layer."""
        return f"{self.base_url}/{workspace}/{layer_name}/wms"
