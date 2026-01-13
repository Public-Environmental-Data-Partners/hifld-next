#!/usr/bin/env python3
"""
Clean up GeoServer stores and layers.

This script deletes all datastores in a workspace, which also removes associated layers.
Useful when you need to recreate stores with updated data or schemas.

Usage:
    python -m scripts.cleanup_geoserver [--workspace WORKSPACE] [--dry-run]
"""

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from services.geoserver import GeoServerClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)

logger = logging.getLogger(__name__)


async def list_datastores(client: GeoServerClient, workspace: str) -> list[str]:
    """List all datastores in a workspace."""
    try:
        import httpx
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                f"{client.base_url}/rest/workspaces/{workspace}/datastores.json",
                headers={
                    "Authorization": client.auth_header,
                    "Accept": "application/json",
                },
                timeout=10.0,
            )
            if response.status_code == 200:
                data = response.json()
                if data.get("dataStores") and data["dataStores"].get("dataStore"):
                    stores = data["dataStores"]["dataStore"]
                    if isinstance(stores, list):
                        return [s["name"] for s in stores]
                    else:
                        return [stores["name"]]
            return []
    except Exception as e:
        logger.error(f"Error listing datastores: {e}")
        return []


async def delete_datastore(client: GeoServerClient, workspace: str, store_name: str, dry_run: bool = False) -> bool:
    """Delete a datastore (and its layers) from GeoServer."""
    if dry_run:
        logger.info(f"[DRY RUN] Would delete datastore: {workspace}:{store_name}")
        return True
    
    try:
        import httpx
        async with httpx.AsyncClient() as http_client:
            # Delete datastore with recurse=true to also delete layers
            response = await http_client.delete(
                f"{client.base_url}/rest/workspaces/{workspace}/datastores/{store_name}?recurse=true",
                headers={
                    "Authorization": client.auth_header,
                },
                timeout=30.0,
            )
            if response.status_code in [200, 204]:
                logger.info(f"✓ Deleted datastore: {workspace}:{store_name}")
                return True
            else:
                logger.error(f"✗ Failed to delete {store_name}: HTTP {response.status_code} - {response.text}")
                return False
    except Exception as e:
        logger.error(f"✗ Error deleting datastore {store_name}: {e}")
        return False


async def cleanup_workspace(workspace: str, dry_run: bool = False):
    """Clean up all datastores in a workspace."""
    client = GeoServerClient()
    
    # Check if workspace exists
    workspace_exists = await client.check_workspace_exists(workspace)
    if not workspace_exists:
        logger.error(f"Workspace '{workspace}' does not exist in GeoServer")
        return
    
    logger.info(f"Cleaning up workspace: {workspace}")
    
    # List all datastores
    stores = await list_datastores(client, workspace)
    
    if not stores:
        logger.info(f"No datastores found in workspace '{workspace}'")
        return
    
    logger.info(f"Found {len(stores)} datastore(s) to delete")
    
    # Delete each datastore
    deleted = 0
    failed = 0
    
    for store_name in stores:
        success = await delete_datastore(client, workspace, store_name, dry_run)
        if success:
            deleted += 1
        else:
            failed += 1
    
    logger.info(f"\nSummary:")
    logger.info(f"  Deleted: {deleted}")
    logger.info(f"  Failed: {failed}")
    logger.info(f"  Total: {len(stores)}")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Clean up GeoServer datastores and layers"
    )
    parser.add_argument(
        "--workspace",
        default=os.getenv("GEOSERVER_WORKSPACE", "hifld"),
        help="GeoServer workspace to clean up (default: hifld)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be deleted without actually deleting",
    )
    
    args = parser.parse_args()
    
    if args.dry_run:
        logger.info("Running in DRY RUN mode - no changes will be made")
    
    asyncio.run(cleanup_workspace(args.workspace, args.dry_run))


if __name__ == "__main__":
    main()

