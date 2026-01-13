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
    def get_versioned_store_name(dataset_name: str, storage_location_id: int, version: int) -> str:
        """Generate unique store name for a dataset source version."""
        return f"{dataset_name}-loc{storage_location_id}-v{version}"

    def _get_auth_header(self) -> str:
        """Create authorization header for GeoServer."""
        import base64

        credentials = f"{self.username}:{self.password}"
        encoded = base64.b64encode(credentials.encode()).decode()
        return f"Basic {encoded}"

    def _to_docker_host_url(self, url: str) -> str:
        """Convert localhost URLs to host.docker.internal for GeoServer (running in Docker)."""
        return url.replace("localhost", "host.docker.internal")

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
        """Create a PMTiles store in GeoServer."""
        await self.ensure_workspace_exists(workspace)

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
                                "entry": [{"@key": "url", "$": pmtiles_url}],
                            },
                        },
                    },
                    timeout=30.0,
                )
                return response.is_success or response.status_code == 201
        except Exception as e:
            logger.error(f"Error creating PMTiles store: {e}")
            return False

    async def create_geoparquet_store(
        self, workspace: str, store_name: str, geoparquet_url: str
    ) -> bool:
        """Create a GeoParquet store in GeoServer (or use existing if already exists)."""
        await self.ensure_workspace_exists(workspace)

        # Check if store already exists
        if await self.store_exists(workspace, store_name):
            logger.info(f"Store '{store_name}' already exists in GeoServer, reusing it")
            return True

        # Convert localhost to host.docker.internal for GeoServer access
        docker_url = self._to_docker_host_url(geoparquet_url)

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
                                "entry": [
                                    {"@key": "dbtype", "$": "geoparquet"},
                                    {"@key": "uri", "$": docker_url},
                                ],
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
                            string_list if isinstance(string_list, list) else [string_list]
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
            # Check if layer already exists
            if await self.layer_exists(workspace, layer_name):
                logger.info(f"Layer '{layer_name}' already exists in GeoServer, reusing it")
                return True

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
                native_name = exact_match or available_types[0]

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






