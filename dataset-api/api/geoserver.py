"""GeoServer API endpoints for getting URLs."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import httpx
import logging

from services.geoserver import GeoServerClient

router = APIRouter(prefix="/api/geoserver", tags=["geoserver"])

geoserver_client = GeoServerClient()
logger = logging.getLogger(__name__)


class GeoServerUrlsResponse(BaseModel):
    """Response model for GeoServer URLs."""

    wfsUrl: str
    wmsUrl: str
    featureApiUrl: str


@router.get("/urls/{workspace}/{layer_name}")
async def get_geoserver_urls(workspace: str, layer_name: str):
    """Get GeoServer URLs for a specific layer."""
    return {
        "wfsUrl": geoserver_client.get_wfs_url(workspace, layer_name),
        "wmsUrl": geoserver_client.get_wms_url(workspace, layer_name),
        "featureApiUrl": geoserver_client.get_feature_api_url(workspace, layer_name),
    }


@router.get("/export/geopackage/{workspace}/{layer_name}")
async def export_geopackage(workspace: str, layer_name: str):
    """
    Export a GeoServer layer as GeoPackage using WFS GetFeature.
    
    This endpoint proxies a WFS request to GeoServer with outputFormat=geopkg
    and returns the resulting GeoPackage file.
    """
    # Construct WFS GetFeature URL with GeoPackage output format
    # Using WFS 2.0.0 as recommended by GeoServer docs
    wfs_url = (
        f"{geoserver_client.base_url}/{workspace}/wfs"
        f"?service=wfs"
        f"&version=2.0.0"
        f"&request=GetFeature"
        f"&typeNames={workspace}:{layer_name}"
        f"&outputFormat=geopkg"
    )
    
    logger.info(f"Requesting GeoPackage export from: {wfs_url}")
    
    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            # Make request to GeoServer with authentication
            response = await client.get(
                wfs_url,
                headers={
                    "Authorization": geoserver_client.auth_header,
                },
                follow_redirects=True,
            )
            
            if not response.is_success:
                logger.error(
                    f"GeoServer returned error: {response.status_code} - {response.text}"
                )
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"GeoServer export failed: {response.text}",
                )
            
            # Return the GeoPackage file as a streaming response
            return StreamingResponse(
                iter([response.content]),
                media_type="application/geopackage+sqlite3",
                headers={
                    "Content-Disposition": f"attachment; filename={layer_name}.gpkg"
                },
            )
    
    except httpx.TimeoutException:
        logger.error(f"Timeout while exporting GeoPackage for {workspace}:{layer_name}")
        raise HTTPException(
            status_code=504,
            detail="Export request timed out. The dataset may be too large.",
        )
    except httpx.RequestError as e:
        logger.error(f"Request error while exporting GeoPackage: {e}")
        raise HTTPException(
            status_code=502,
            detail=f"Failed to connect to GeoServer: {str(e)}",
        )






