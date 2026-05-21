"""Quality metadata helpers for published dataset sources."""

import mimetypes
import tempfile
import zipfile
from pathlib import Path

import geopandas as gpd
from pydantic import BaseModel

from models.dataset import FileLocation, FileSource, SpatialDatasetFileMetadata
from schemas.types import APIDict, json_value, model_json_dict
from storage.storage_client import StorageClient, create_storage_client_from_location


class DatasetQualityError(ValueError):
    """Quality computation error."""


def metadata_to_dict(source_metadata: object) -> APIDict:
    """Convert source metadata models or mappings to a plain dict."""
    if isinstance(source_metadata, dict):
        return {str(key): json_value(value) for key, value in source_metadata.items()}
    if isinstance(source_metadata, BaseModel):
        return model_json_dict(source_metadata)
    return {}


def source_path(file_source: FileSource) -> str | None:
    """Return the path for a file source location."""
    location = file_source.location
    if isinstance(location, FileLocation):
        return location.path
    return None


def combine_bounds(bounds_list: list[list[float]]) -> list[float] | None:
    """Combine multiple spatial bounds into one bounding box."""
    if not bounds_list:
        return None
    min_x = min(bounds[0] for bounds in bounds_list)
    min_y = min(bounds[1] for bounds in bounds_list)
    max_x = max(bounds[2] for bounds in bounds_list)
    max_y = max(bounds[3] for bounds in bounds_list)
    return [min_x, min_y, max_x, max_y]


async def resolve_quality_remote_paths(file_source: FileSource) -> tuple[list[str], StorageClient]:
    """Resolve remote paths and storage client for quality computation."""
    storage_location = file_source.storage_location
    if not storage_location:
        msg = "FileSource has no storage location"
        raise DatasetQualityError(msg)

    storage_client = create_storage_client_from_location(storage_location)
    if not storage_client:
        msg = "Storage location is not bucket-backed"
        raise DatasetQualityError(msg)

    path = source_path(file_source)
    if not path:
        msg = "FileSource location has no path"
        raise DatasetQualityError(msg)

    if "*" in path:
        remote_paths = await storage_client.expand_glob_pattern(path)
    elif path.lower().endswith(".shp"):
        folder_prefix = path.rsplit("/", 1)[0] + "/" if "/" in path else ""
        stem = Path(path).stem
        candidates = await storage_client.list_files(folder_prefix)
        remote_paths = [path for path in candidates if Path(path).stem == stem and not path.endswith("/")]
    else:
        remote_paths = [path]

    if not remote_paths:
        msg = "No files found for source path"
        raise DatasetQualityError(msg)
    return remote_paths, storage_client


def read_geospatial_datasets(local_paths: list[Path], temp_dir: Path) -> list[gpd.GeoDataFrame]:
    """Read supported geospatial files from local downloaded paths."""
    datasets: list[gpd.GeoDataFrame] = []
    for local_path in local_paths:
        name = local_path.name.lower()
        if name.endswith(".parquet"):
            datasets.append(gpd.read_parquet(local_path))
        elif name.endswith(".zip"):
            datasets.extend(_read_zipped_geospatial_dataset(local_path, temp_dir))
        elif name.endswith((".shp", ".gpkg", ".geojson", ".json")):
            datasets.append(gpd.read_file(local_path))
    return datasets


def _read_zipped_geospatial_dataset(local_path: Path, temp_dir: Path) -> list[gpd.GeoDataFrame]:
    """Read the first supported dataset from a zip file."""
    extract_dir = temp_dir / f"extract_{local_path.stem}"
    extract_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(local_path, "r") as archive:
        archive.extractall(extract_dir)
    shp_candidates = list(extract_dir.rglob("*.shp"))
    gpkg_candidates = list(extract_dir.rglob("*.gpkg"))
    if shp_candidates:
        return [gpd.read_file(shp_candidates[0])]
    if gpkg_candidates:
        return [gpd.read_file(gpkg_candidates[0])]
    return []


def summarize_geodataframes(datasets: list[gpd.GeoDataFrame]) -> tuple[int, int, str | None, list[list[float]]]:
    """Summarize row counts, invalid geometries, geometry types, and bounds."""
    row_count = 0
    invalid_geometry_count = 0
    geometry_types: set[str] = set()
    bounds_list: list[list[float]] = []

    for geodataframe in datasets:
        row_count += len(geodataframe)
        if len(geodataframe) == 0:
            continue
        if hasattr(geodataframe, "geometry") and geodataframe.geometry is not None:
            valid = geodataframe.geometry.is_valid
            invalid_geometry_count += int((~valid).sum())
            geometry_types.update(
                {str(geom) for geom in geodataframe.geometry.geom_type.dropna().unique().tolist() if geom}
            )
            if geodataframe.total_bounds is not None:
                bounds_list.append([float(value) for value in geodataframe.total_bounds.tolist()])

    geometry_type = None
    if len(geometry_types) == 1:
        geometry_type = next(iter(geometry_types))
    elif len(geometry_types) > 1:
        geometry_type = "Mixed"
    return row_count, invalid_geometry_count, geometry_type, bounds_list


async def compute_quality_for_source(file_source: FileSource) -> SpatialDatasetFileMetadata:
    """Compute quality metadata for an existing published source."""
    remote_paths, storage_client = await resolve_quality_remote_paths(file_source)

    with tempfile.TemporaryDirectory(prefix="dq_source_") as tmpdir:
        temp_dir = Path(tmpdir)
        local_paths: list[Path] = []
        for remote_path in remote_paths:
            local_path = temp_dir / Path(remote_path).name
            await storage_client.download_file(remote_path, local_path)
            local_paths.append(local_path)

        datasets = read_geospatial_datasets(local_paths, temp_dir)
        if not datasets:
            msg = "No supported geospatial file found for quality compute"
            raise DatasetQualityError(msg)

        row_count, invalid_geometry_count, geometry_type, bounds_list = summarize_geodataframes(datasets)

        total_size = 0
        for remote_path in remote_paths:
            total_size += await storage_client.get_file_size(remote_path)

        extension = Path(remote_paths[0]).suffix.lower()
        mime_type = mimetypes.types_map.get(extension) or "application/octet-stream"

        return SpatialDatasetFileMetadata(
            version="v1",
            feature_count=row_count,
            invalid_geometry_count=invalid_geometry_count,
            quality_check_passed=invalid_geometry_count == 0,
            geometry_type=geometry_type,
            bounds=combine_bounds(bounds_list),
            size_bytes=total_size,
            mime_type=mime_type,
        )
