#!/usr/bin/env python3
"""
Process datasets from storage (GCS or SeaweedFS) with chunked reading/writing.

This script:
1. Reads inventory_gcs.csv to find datasets (or discovers nested datasets)
2. Downloads dataset files from source storage
3. Processes each layer (for multi-layer formats like GeoPackage/File Geodatabase)
4. Converts to chunked GeoParquet and PMTiles
5. Uploads outputs to destination storage
"""

import argparse
import asyncio
import csv
import logging
import os
import subprocess
import sys
import tempfile
import warnings
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import psutil

    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import fiona
import geopandas as gpd
from storage.storage_client import StorageClient, create_storage_client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("process-gcs-datasets")

FORMAT_PRIORITY = [
    ("geopackage", ".gpkg"),
    ("shapefile", ".shp"),
    ("file_geodatabase", ".gdb"),
    ("geojson", ".geojson"),
]

CHUNKED_READABLE_FORMATS = {"geopackage", "shapefile", "file_geodatabase"}
FORMAT_SUFFIXES = [
    "-file_geodatabase",
    "-file-geodatabase",
    "-geopackage",
    "-shapefile",
    "-geojson",
]

DEFAULT_ROW_GROUP_SIZE = 100_000
DEFAULT_DATA_PAGE_SIZE_BYTES = 1024 * 1024


def parse_storage_url(url: str) -> Tuple[str, str, str]:
    """Parse a storage URL and return (storage_type, bucket, path)."""
    if url.startswith("gs://"):
        parts = url[5:].split("/", 1)
        bucket = parts[0]
        path = parts[1] if len(parts) > 1 else ""
        return ("gcs", bucket, path)
    if url.startswith("seaweedfs://") or url.startswith("s3://"):
        parts = url.split("://", 1)[1].split("/", 1)
        bucket = parts[0]
        path = parts[1] if len(parts) > 1 else ""
        return ("seaweedfs", bucket, path)
    return ("gcs", url, "")


def load_inventory(inventory_path: Path) -> List[Dict[str, str]]:
    """Load inventory CSV."""
    datasets: List[Dict[str, str]] = []
    with open(inventory_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            datasets.append(row)
    return datasets


def _detect_format_from_path(path: str) -> str:
    path_lower = path.lower()
    for fmt, _ in FORMAT_PRIORITY:
        if f"-{fmt}.zip" in path_lower or f"-{fmt.replace('_', '-')}.zip" in path_lower:
            return fmt
    if path_lower.endswith(".geojson") or "-geojson.zip" in path_lower:
        return "geojson"
    if path_lower.endswith(".gpkg"):
        return "geopackage"
    if path_lower.endswith(".shp"):
        return "shapefile"
    if path_lower.endswith(".gdb"):
        return "file_geodatabase"
    return "unknown"


def _strip_format_suffix(name: str) -> str:
    base = name
    for suffix in FORMAT_SUFFIXES:
        if base.endswith(suffix):
            return base[: -len(suffix)]
    return base


def _normalize_duplicate_leading_folder(path: str) -> str:
    # Handle paths like folder/folder/file.zip that appear in some inventories.
    parts = [p for p in path.split("/") if p]
    while len(parts) >= 3 and parts[0] == parts[1]:
        parts = parts[1:]
    return "/".join(parts)


async def list_zip_files_in_folder(
    storage: StorageClient, folder_path: str
) -> List[str]:
    """List zip files under folder_path using the storage client abstraction."""
    prefix = folder_path.strip("/")
    files = await storage.list_files(prefix)
    return sorted([f for f in files if f.lower().endswith(".zip")])


async def discover_nested_datasets(
    source_storage: StorageClient, source_path: str
) -> List[Dict[str, str]]:
    """Discover datasets by scanning zip files and grouping by dataset base name."""
    datasets_by_name: Dict[str, Dict[str, str]] = {}
    zip_files = await list_zip_files_in_folder(source_storage, source_path)

    for zip_path in zip_files:
        zip_name = Path(zip_path).stem
        base_name = _strip_format_suffix(zip_name)
        format_name = _detect_format_from_path(zip_path)
        storage_url = source_storage.path_to_storage_uri(zip_path)

        if base_name not in datasets_by_name:
            datasets_by_name[base_name] = {
                "filename": base_name,
                "title": base_name.replace("-", " ").title(),
                "gcs_zip_path": storage_url,
                "gcs_match_found": "Yes",
                format_name: "1",
            }
            continue

        current = datasets_by_name[base_name]
        current[format_name] = "1"

        # Prefer chunk-readable formats for the canonical source path.
        current_fmt = _detect_format_from_path(current.get("gcs_zip_path", ""))
        if (
            format_name in CHUNKED_READABLE_FORMATS
            and current_fmt not in CHUNKED_READABLE_FORMATS
        ):
            current["gcs_zip_path"] = storage_url

    return list(datasets_by_name.values())


def get_memory_usage_mb() -> float:
    if not PSUTIL_AVAILABLE:
        return 0.0
    try:
        process = psutil.Process(os.getpid())
        return process.memory_info().rss / (1024 * 1024)
    except Exception:
        return 0.0


def get_system_memory_info() -> Dict[str, float]:
    if not PSUTIL_AVAILABLE:
        return {"available": 0.0, "total": 0.0, "percent": 0.0}
    try:
        mem = psutil.virtual_memory()
        return {
            "available": mem.available / (1024 * 1024),
            "total": mem.total / (1024 * 1024),
            "percent": mem.percent,
        }
    except Exception:
        return {"available": 0.0, "total": 0.0, "percent": 0.0}


def log_memory_usage(context: str = "") -> None:
    if not PSUTIL_AVAILABLE:
        return
    process_mb = get_memory_usage_mb()
    system_mem = get_system_memory_info()
    msg = f"  Memory: {process_mb:.1f} MB (process)"
    if system_mem["total"] > 0:
        msg += (
            f", {system_mem['available']:.1f} MB available "
            f"({system_mem['percent']:.1f}% used)"
        )
    if context:
        msg = f"{context} - {msg}"
    logger.info(msg)


def _get_fiona_driver(format_type: str) -> Optional[str]:
    driver_map = {
        "shapefile": "ESRI Shapefile",
        "geojson": "GeoJSON",
        "geopackage": "GPKG",
        "file_geodatabase": "OpenFileGDB",
    }
    return driver_map.get(format_type)


def _ensure_id_column(gdf: gpd.GeoDataFrame, start_id: int = 1) -> gpd.GeoDataFrame:
    if "id" not in gdf.columns:
        id_candidates = ["OBJECTID", "FID", "fid", "GlobalID", "gid", "ogc_fid"]
        id_col = next((c for c in id_candidates if c in gdf.columns), None)
        if id_col:
            gdf["id"] = gdf[id_col]
        else:
            gdf["id"] = range(start_id, start_id + len(gdf))
    # Avoid expensive full-frame copy/reorder for large chunks.
    return gdf


def _safe_layer_suffix(layer_name: str) -> str:
    return layer_name.replace("/", "-").replace("\\", "-")


def list_layers_in_file(
    file_path: Path, format_type: str
) -> List[Tuple[str, Optional[str]]]:
    import pyogrio

    if format_type in {"geopackage", "file_geodatabase"}:
        layers = pyogrio.list_layers(file_path)
        filtered = [
            (name, geom_type) for name, geom_type in layers if geom_type is not None
        ]
        return filtered or [("default", None)]
    return [("default", None)]


def _extract_geospatial_from_zip(
    zip_file: Path, extract_dir: Path
) -> Optional[Tuple[str, Path]]:
    with zipfile.ZipFile(zip_file, "r") as zf:
        zf.extractall(extract_dir)

    for p in extract_dir.rglob("*"):
        if p.is_dir() and p.suffix.lower() == ".gdb":
            return ("file_geodatabase", p)

    for ext, fmt in (
        (".gpkg", "geopackage"),
        (".shp", "shapefile"),
        (".geojson", "geojson"),
    ):
        found = next((p for p in extract_dir.rglob(f"*{ext}") if p.is_file()), None)
        if found:
            return (fmt, found)

    return None


async def unzip_from_storage(
    storage: StorageClient, remote_path: str, extract_dir: Path
) -> Optional[Tuple[str, Path]]:
    """
    Download a remote file and extract/resolve a geospatial input.
    Supports zip archives and direct geospatial files.
    """
    remote_name = Path(remote_path).name
    local_file = extract_dir / (remote_name or "source_file")
    await storage.download_file(remote_path, local_file)

    suffix = local_file.suffix.lower()
    if suffix in {".geojson", ".gpkg", ".shp"}:
        return (
            {".geojson": "geojson", ".gpkg": "geopackage", ".shp": "shapefile"}[suffix],
            local_file,
        )

    if suffix == ".zip":
        try:
            return _extract_geospatial_from_zip(local_file, extract_dir)
        except zipfile.BadZipFile:
            return None

    # Some files are zip content with non-.zip names.
    try:
        return _extract_geospatial_from_zip(local_file, extract_dir)
    except zipfile.BadZipFile:
        return None


def _build_dest_folder(source_rel_path: str) -> str:
    normalized = _normalize_duplicate_leading_folder(source_rel_path)
    parts = [p for p in normalized.split("/") if p]
    if not parts:
        return ""
    zip_stem = Path(parts[-1]).stem
    parent = "/".join(parts[:-1])
    if parent:
        return f"{parent}/{zip_stem}/"
    return f"{zip_stem}/"


def _build_layer_filename(base_filename: str, layer_name: str) -> str:
    if layer_name == "default":
        return base_filename
    return f"{base_filename}-{_safe_layer_suffix(layer_name)}"


async def _upload_geoparquet_files(
    dest_storage: StorageClient,
    geoparquet_files: List[Path],
    dest_folder: str,
    layer_filename: str,
) -> List[str]:
    urls: List[str] = []
    for i, gp_file in enumerate(geoparquet_files):
        remote_path = f"{dest_folder}parquet/{layer_filename}-{i}.zstd.parquet"
        await dest_storage.upload_file(gp_file, remote_path)
        urls.append(dest_storage.get_public_url(remote_path))
        logger.info(f"    Uploaded GeoParquet: {remote_path}")
    return urls


def _build_tippecanoe_cmd(
    pmtiles_path: Path, layer_filename: str, fgb_files: List[Path]
) -> List[str]:
    base = [
        "tippecanoe",
        "-zg",
        "--drop-densest-as-needed",
        "--extend-zooms-if-still-dropping",
        "--force",
        "--maximum-zoom=14",
    ]
    if len(fgb_files) > 1:
        base.extend(["-l", layer_filename])
    base.extend(["-o", str(pmtiles_path)])
    base.extend([str(f) for f in fgb_files])
    return base


async def _create_and_upload_pmtiles(
    dest_storage: StorageClient,
    fgb_files: List[Path],
    pmtiles_path: Path,
    dest_folder: str,
    layer_filename: str,
) -> Optional[str]:
    if not fgb_files:
        return None

    try:
        cmd = _build_tippecanoe_cmd(pmtiles_path, layer_filename, fgb_files)
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            logger.warning(f"    tippecanoe failed: {result.stderr}")
            return None

        remote_path = f"{dest_folder}pmtiles/{layer_filename}.pmtiles"
        await dest_storage.upload_file(pmtiles_path, remote_path)
        logger.info(f"    Uploaded PMTiles: {remote_path}")
        return dest_storage.get_public_url(remote_path)
    except FileNotFoundError:
        logger.warning("    tippecanoe not found, skipping PMTiles creation")
        return None
    except Exception as e:
        logger.warning(f"    PMTiles creation failed: {e}")
        return None


def _filter_valid_geometries(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", "GeoSeries.notna", UserWarning)
        return gdf[~gdf.geometry.is_empty & gdf.geometry.notna()].copy()


def _repair_geometries_for_fgb(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Best-effort geometry repair for FlatGeobuf writer compatibility."""
    repaired = gdf.copy()
    try:
        repaired.geometry = repaired.geometry.make_valid()
    except Exception:
        try:
            repaired.geometry = repaired.geometry.buffer(0)
        except Exception:
            return repaired.iloc[0:0]

    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", "GeoSeries.notna", UserWarning)
        repaired = repaired[
            repaired.geometry.notna()
            & ~repaired.geometry.is_empty
            & repaired.geometry.is_valid
        ].copy()
    return repaired


def _to_wgs84(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.crs is None:
        return gdf.set_crs("EPSG:4326")
    if gdf.crs.to_epsg() != 4326:
        return gdf.to_crs("EPSG:4326")
    return gdf


async def process_layer_chunked(
    file_path: Path,
    format_type: str,
    layer_name: Optional[str],
    layer_filename: str,
    dest_folder: str,
    dest_storage: StorageClient,
    work_dir: Path,
    geoparquet_chunk_size_mb: int = 250,
    row_group_size: int = DEFAULT_ROW_GROUP_SIZE,
    data_page_size_bytes: int = DEFAULT_DATA_PAGE_SIZE_BYTES,
) -> Dict[str, Any]:
    """Streaming reader/writer path with separate parquet and PMTiles passes."""
    mem_before = get_memory_usage_mb()
    driver = _get_fiona_driver(format_type)
    if not driver:
        return {"error": f"Unsupported format for streaming: {format_type}"}

    geoparquet_dir = work_dir / "geoparquet"
    pmtiles_dir = work_dir / "pmtiles"
    geoparquet_dir.mkdir(exist_ok=True)
    pmtiles_dir.mkdir(exist_ok=True)

    geoparquet_files: List[Path] = []
    fgb_files: List[Path] = []
    chunk_row_plan: List[int] = []

    feature_count = 0
    null_geometry_count = 0
    invalid_geometry_count = 0
    invalid_geometry_count_after_repair = 0
    dropped_for_pmtiles_count = 0
    pmtiles_write_failed = False

    bytes_per_feature: Optional[float] = None
    current_chunk_size: Optional[int] = None
    chunk_features: List[Dict[str, Any]] = []
    chunk_num = 0
    features_processed = 0
    estimate_sample_size = 10
    open_kwargs: Dict[str, Any] = {"driver": driver}
    if layer_name and format_type in {"geopackage", "file_geodatabase"}:
        open_kwargs["layer"] = layer_name

    def flush_parquet_chunk(
        crs: Any, features: List[Dict[str, Any]], idx: int, start_id: int
    ) -> int:
        nonlocal bytes_per_feature
        nonlocal current_chunk_size

        gdf_chunk = gpd.GeoDataFrame.from_features(features, crs=crs)
        gdf_chunk = _ensure_id_column(gdf_chunk, start_id=start_id)

        parquet_path = geoparquet_dir / f"{layer_filename}-{idx}.parquet"
        gdf_chunk.to_parquet(
            parquet_path,
            compression="zstd",
            schema_version="1.0.0",
            row_group_size=row_group_size,
            data_page_size=data_page_size_bytes,
        )
        geoparquet_files.append(parquet_path)
        chunk_row_plan.append(len(gdf_chunk))

        file_size_bytes = parquet_path.stat().st_size
        chunk_bytes_per_feature = file_size_bytes / max(1, len(gdf_chunk))
        if bytes_per_feature is None:
            bytes_per_feature = chunk_bytes_per_feature
        else:
            bytes_per_feature = (bytes_per_feature * 0.7) + (
                chunk_bytes_per_feature * 0.3
            )
        target_bytes = geoparquet_chunk_size_mb * 1024 * 1024
        proposed_chunk_size = max(1, int(target_bytes / max(bytes_per_feature, 1)))
        if current_chunk_size is None:
            current_chunk_size = proposed_chunk_size
        else:
            min_size = max(1, int(current_chunk_size * 0.75))
            max_size = max(1, int(current_chunk_size * 1.25))
            current_chunk_size = max(min_size, min(max_size, proposed_chunk_size))
        logger.info(
            "    Chunk sizing update: target_rows=%s (bytes_per_feature=%.1f, chunk=%.2fMB)",
            current_chunk_size,
            bytes_per_feature,
            file_size_bytes / (1024 * 1024),
        )
        return len(gdf_chunk)

    def flush_fgb_chunk(crs: Any, features: List[Dict[str, Any]], idx: int) -> None:
        nonlocal null_geometry_count
        nonlocal invalid_geometry_count
        nonlocal invalid_geometry_count_after_repair
        nonlocal dropped_for_pmtiles_count
        nonlocal pmtiles_write_failed

        gdf_chunk = gpd.GeoDataFrame.from_features(features, crs=crs)
        gdf_valid = _filter_valid_geometries(gdf_chunk)
        null_geometry_count += len(gdf_chunk) - len(gdf_valid)
        if len(gdf_valid) == 0:
            return

        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", "GeoSeries.notna", UserWarning)
            valid_mask = gdf_valid.geometry.is_valid
        invalid_before = int((~valid_mask).sum())
        invalid_geometry_count += invalid_before
        if invalid_before > 0:
            logger.warning(
                "    Chunk %s has invalid geometries before FGB write: %s/%s",
                idx,
                invalid_before,
                len(gdf_valid),
            )

        gdf_valid = _to_wgs84(gdf_valid)
        fgb_path = pmtiles_dir / f"{layer_filename}-chunk-{idx}.fgb"
        try:
            gdf_valid.to_file(fgb_path, driver="FlatGeobuf", engine="pyogrio")
            fgb_files.append(fgb_path)
        except Exception as e:
            logger.warning(
                "    FGB write failed for chunk %s (%s). Retrying with repaired geometries.",
                idx,
                e,
            )
            repaired = _repair_geometries_for_fgb(gdf_valid)
            if len(repaired) == 0:
                invalid_geometry_count_after_repair += invalid_before
                dropped_for_pmtiles_count += len(gdf_valid)
                pmtiles_write_failed = True
                logger.warning(
                    "    Could not repair geometries for chunk %s. "
                    "Skipping PMTiles for this layer.",
                    idx,
                )
            else:
                with warnings.catch_warnings():
                    warnings.filterwarnings("ignore", "GeoSeries.notna", UserWarning)
                    repaired_valid_mask = repaired.geometry.is_valid
                invalid_after = int((~repaired_valid_mask).sum())
                invalid_geometry_count_after_repair += invalid_after
                dropped = max(0, len(gdf_valid) - len(repaired))
                dropped_for_pmtiles_count += dropped
                try:
                    repaired.to_file(fgb_path, driver="FlatGeobuf", engine="pyogrio")
                    fgb_files.append(fgb_path)
                    logger.info(
                        "    Repaired geometries for FGB chunk %s: kept %s/%s "
                        "(invalid_before=%s, invalid_after=%s, dropped=%s)",
                        idx,
                        len(repaired),
                        len(gdf_valid),
                        invalid_before,
                        invalid_after,
                        dropped,
                    )
                except Exception as repair_err:
                    pmtiles_write_failed = True
                    logger.warning(
                        "    FGB retry failed for chunk %s (%s). Skipping PMTiles for this layer.",
                        idx,
                        repair_err,
                    )

    try:
        # Pass 1: stream source -> parquet only
        with fiona.open(str(file_path), **open_kwargs) as src:
            crs = src.crs if src.crs else "EPSG:4326"

            sample_features: List[Dict[str, Any]] = []
            for _ in range(estimate_sample_size):
                try:
                    sample_features.append(next(src))
                except StopIteration:
                    break

            if not sample_features:
                return {"geoparquet_urls": [], "pmtiles_url": None, "feature_count": 0}

            sample = _ensure_id_column(
                gpd.GeoDataFrame.from_features(sample_features, crs=crs), start_id=1
            )
            sample_path = geoparquet_dir / "_estimate.parquet"
            sample.to_parquet(
                sample_path,
                compression="zstd",
                schema_version="1.0.0",
                row_group_size=row_group_size,
                data_page_size=data_page_size_bytes,
            )
            bytes_per_feature = sample_path.stat().st_size / max(1, len(sample))
            sample_path.unlink(missing_ok=True)
            current_chunk_size = max(
                1,
                int(
                    (geoparquet_chunk_size_mb * 1024 * 1024) / max(bytes_per_feature, 1)
                ),
            )
            logger.info(
                "    Initial chunk sizing: target_rows=%s (bytes_per_feature=%.1f, sample_rows=%s)",
                current_chunk_size,
                bytes_per_feature,
                len(sample_features),
            )

            chunk_features.extend(sample_features)
            feature_count = len(sample_features)

            for feat in src:
                chunk_features.append(feat)
                feature_count += 1
                estimated_mb = (len(chunk_features) * bytes_per_feature) / (1024 * 1024)
                if (
                    len(chunk_features) >= current_chunk_size
                    or estimated_mb >= geoparquet_chunk_size_mb
                ):
                    logger.info(
                        "    Flushing parquet chunk %s at rows_in_buffer=%s (target_rows=%s, estimated=%.2fMB)",
                        chunk_num,
                        len(chunk_features),
                        current_chunk_size,
                        estimated_mb,
                    )
                    processed_count = flush_parquet_chunk(
                        crs=crs,
                        features=chunk_features,
                        idx=chunk_num,
                        start_id=features_processed + 1,
                    )
                    features_processed += processed_count
                    chunk_features = []
                    chunk_num += 1

            if chunk_features:
                processed_count = flush_parquet_chunk(
                    crs=crs,
                    features=chunk_features,
                    idx=chunk_num,
                    start_id=features_processed + 1,
                )
                features_processed += processed_count

        # Pass 2: stream source again -> FGB/PMTiles only
        if chunk_row_plan:
            logger.info(
                "    Starting PMTiles pass using parquet row plan (%s chunks).",
                len(chunk_row_plan),
            )
            with fiona.open(str(file_path), **open_kwargs) as src:
                crs = src.crs if src.crs else "EPSG:4326"
                plan_idx = 0
                target_rows = chunk_row_plan[plan_idx]
                chunk_features = []
                for feat in src:
                    chunk_features.append(feat)
                    if len(chunk_features) >= target_rows:
                        flush_fgb_chunk(crs=crs, features=chunk_features, idx=plan_idx)
                        chunk_features = []
                        plan_idx += 1
                        if plan_idx >= len(chunk_row_plan):
                            break
                        target_rows = chunk_row_plan[plan_idx]

                # Any trailing features (plan drift / source mutation)
                if chunk_features:
                    flush_fgb_chunk(
                        crs=crs,
                        features=chunk_features,
                        idx=min(plan_idx, max(0, len(chunk_row_plan) - 1)),
                    )

        mem_after = get_memory_usage_mb()
        logger.info(
            f"    Processed {feature_count} features in {len(geoparquet_files)} chunk(s) "
            f"(memory: {mem_after - mem_before:.1f} MB)"
        )
        if feature_count > 0 and null_geometry_count > 0:
            logger.info(
                f"    Filtered {null_geometry_count} NULL/empty geometries from FGB/PMTiles "
                f"({null_geometry_count / feature_count * 100:.1f}% of features)"
            )
        if invalid_geometry_count > 0 or dropped_for_pmtiles_count > 0:
            logger.info(
                "    Invalid geometry summary for PMTiles: "
                "invalid_before_repair=%s, invalid_after_repair=%s, dropped_for_pmtiles=%s",
                invalid_geometry_count,
                invalid_geometry_count_after_repair,
                dropped_for_pmtiles_count,
            )

        geoparquet_urls = await _upload_geoparquet_files(
            dest_storage=dest_storage,
            geoparquet_files=geoparquet_files,
            dest_folder=dest_folder,
            layer_filename=layer_filename,
        )

        pmtiles_url = None
        if not pmtiles_write_failed:
            pmtiles_url = await _create_and_upload_pmtiles(
                dest_storage=dest_storage,
                fgb_files=fgb_files,
                pmtiles_path=pmtiles_dir / f"{layer_filename}.pmtiles",
                dest_folder=dest_folder,
                layer_filename=layer_filename,
            )
        else:
            logger.warning(
                "    Skipping PMTiles creation for layer '%s' because one or more FGB chunks failed.",
                layer_filename,
            )

        return {
            "geoparquet_urls": geoparquet_urls,
            "pmtiles_url": pmtiles_url,
            "feature_count": feature_count,
        }
    except Exception as e:
        logger.error(f"    Error in chunked processing: {e}")
        return {"error": str(e)}


def read_chunked(
    file_path: Path,
    format_type: str,
    layer_name: Optional[str] = None,
) -> gpd.GeoDataFrame:
    """Fallback read path that loads the full layer into memory."""
    mem_before = get_memory_usage_mb()

    if format_type in {"geopackage", "file_geodatabase"}:
        gdf = gpd.read_file(file_path, layer=layer_name or None, engine="pyogrio")
    elif format_type in {"shapefile", "geojson"}:
        gdf = gpd.read_file(file_path, engine="pyogrio")
    else:
        raise ValueError(f"Unsupported format: {format_type}")

    mem_after = get_memory_usage_mb()
    logger.info(
        f"    Memory used for read: {mem_after - mem_before:.1f} MB "
        f"(total: {mem_after:.1f} MB)"
    )
    return gdf


def write_geoparquet_chunked(
    gdf: gpd.GeoDataFrame,
    output_path: Path,
    chunk_size_mb: int = 250,
    row_group_size: int = DEFAULT_ROW_GROUP_SIZE,
    data_page_size_bytes: int = DEFAULT_DATA_PAGE_SIZE_BYTES,
) -> List[Path]:
    """Write GeoParquet chunk files (always with -0, -1, ... suffixes)."""
    estimated_mb = len(gdf) * 0.001
    num_chunks = max(1, int(estimated_mb / chunk_size_mb) + 1)

    paths: List[Path] = []
    for i in range(num_chunks):
        start_idx = i * len(gdf) // num_chunks
        end_idx = (i + 1) * len(gdf) // num_chunks if i < num_chunks - 1 else len(gdf)
        chunk = gdf.iloc[start_idx:end_idx]
        chunk_path = output_path.parent / f"{output_path.stem}-{i}.parquet"
        chunk.to_parquet(
            chunk_path,
            compression="zstd",
            schema_version="1.0.0",
            row_group_size=row_group_size,
            data_page_size=data_page_size_bytes,
        )
        paths.append(chunk_path)
    return paths


def write_pmtiles_chunked(
    gdf: gpd.GeoDataFrame,
    output_path: Path,
    layer_filename: str,
    max_zoom: int = 14,
) -> Optional[Path]:
    """Create PMTiles from one or more FlatGeobuf intermediates."""
    gdf_valid = _filter_valid_geometries(gdf)
    if len(gdf_valid) == 0:
        logger.warning("No valid geometries to write")
        return None

    gdf_valid = _to_wgs84(gdf_valid)

    chunk_size = 100000
    num_chunks = max(1, (len(gdf_valid) + chunk_size - 1) // chunk_size)

    fgb_files: List[Path] = []
    for i in range(num_chunks):
        start_idx = i * chunk_size
        end_idx = min((i + 1) * chunk_size, len(gdf_valid))
        chunk = gdf_valid.iloc[start_idx:end_idx]
        fgb_path = output_path.parent / f"{output_path.stem}-chunk-{i}.fgb"
        chunk.to_file(fgb_path, driver="FlatGeobuf", engine="pyogrio")
        fgb_files.append(fgb_path)

    try:
        cmd = _build_tippecanoe_cmd(output_path, layer_filename, fgb_files)
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            logger.warning(f"tippecanoe failed: {result.stderr}")
            return None
        return output_path
    except FileNotFoundError:
        logger.warning("tippecanoe not found, skipping PMTiles creation")
        return None
    except Exception as e:
        logger.warning(f"PMTiles creation failed: {e}")
        return None


async def check_dataset_exists(
    dest_storage: StorageClient,
    dest_folder: str,
    base_filename: str,
    layers: List[Tuple[str, str]],
) -> bool:
    """Return True if at least one expected output artifact already exists."""
    for layer_name, _ in layers:
        layer_filename = _build_layer_filename(base_filename, layer_name)
        parquet_path = f"{dest_folder}parquet/{layer_filename}-0.zstd.parquet"
        if await dest_storage.file_exists(parquet_path):
            return True

        pmtiles_path = f"{dest_folder}pmtiles/{layer_filename}.pmtiles"
        if await dest_storage.file_exists(pmtiles_path):
            return True

    return False


def _extract_source_path(row: Dict[str, str]) -> Optional[str]:
    source_path = row.get("gcs_zip_path", "").strip()
    if not source_path:
        return None
    _, _, rel_path = parse_storage_url(source_path)
    return _normalize_duplicate_leading_folder(rel_path)


def _is_format_available_in_row(row: Dict[str, str], format_name: str) -> bool:
    value = str(row.get(format_name, "")).strip().lower()
    return value not in {"", "0", "no", "false", "none", "null"}


async def _select_preferred_source_path(
    row: Dict[str, str],
    source_storage: StorageClient,
    fallback_path: str,
) -> str:
    """
    Prefer chunk-friendly formats in the same dataset folder.
    This ensures shapefile is selected over geojson when both are present.
    """
    parent_prefix = str(Path(fallback_path).parent).strip(".")
    dataset_stem = Path(fallback_path).stem
    dataset_base = _strip_format_suffix(dataset_stem)

    try:
        sibling_files = await source_storage.list_files(parent_prefix)
    except Exception as e:
        logger.debug(f"Could not list sibling files for format selection: {e}")
        return fallback_path

    candidates_by_format: Dict[str, str] = {}
    for sibling in sibling_files:
        sibling_base = _strip_format_suffix(Path(sibling).stem)
        if sibling_base != dataset_base:
            continue
        fmt = _detect_format_from_path(sibling)
        if fmt == "unknown":
            continue
        candidates_by_format.setdefault(fmt, sibling)

    for fmt, _ in FORMAT_PRIORITY:
        if not _is_format_available_in_row(row, fmt):
            continue
        if fmt in candidates_by_format:
            return candidates_by_format[fmt]

    return fallback_path


def _detect_format_for_dry_run(source_path: str) -> str:
    return _detect_format_from_path(source_path)


async def process_dataset(
    row: Dict[str, str],
    source_storage: StorageClient,
    dest_storage: StorageClient,
    dry_run: bool = False,
    skip_existing: bool = False,
) -> Dict[str, Any]:
    """Process a single dataset: download, decode, transform, upload."""
    filename = row.get("filename", "").strip()
    title = row.get("title", "").strip()
    logger.info(f"Processing: {filename} - {title}")

    source_rel_path = _extract_source_path(row)
    if not source_rel_path:
        return {"success": False, "error": "No source path found", "filename": filename}

    source_rel_path = await _select_preferred_source_path(
        row=row,
        source_storage=source_storage,
        fallback_path=source_rel_path,
    )

    if dry_run:
        format_name = _detect_format_for_dry_run(source_rel_path)
        logger.info(f"  [DRY RUN] Would process {filename}")
        logger.info(f"    Format: {format_name}")
        logger.info(f"    Source: {source_rel_path}")
        logger.info("    Would create: GeoParquet and PMTiles for each layer")
        return {"success": True, "dry_run": True, "filename": filename}

    if not await source_storage.file_exists(source_rel_path):
        logger.warning(f"  ✗ Source file not found: {source_rel_path}")
        return {
            "success": False,
            "error": f"Source file not found: {source_rel_path}",
            "filename": filename,
        }

    path_parts = [p for p in source_rel_path.split("/") if p]
    zip_stem = Path(path_parts[-1]).stem if path_parts else filename
    base_filename = _strip_format_suffix(zip_stem)
    dest_folder = _build_dest_folder(source_rel_path)

    with tempfile.TemporaryDirectory() as temp_dir:
        work_dir = Path(temp_dir)
        extract_dir = work_dir / "extracted"
        extract_dir.mkdir(parents=True, exist_ok=True)

        unzip_result = await unzip_from_storage(
            source_storage, source_rel_path, extract_dir
        )
        if unzip_result is None:
            return {
                "success": False,
                "error": "Could not detect format (not a zip file or recognized geospatial format)",
                "filename": filename,
            }

        format_type, data_file = unzip_result
        logger.info(f"  Detected format: {format_type}, file: {data_file}")

        try:
            layers = list_layers_in_file(data_file, format_type)
        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to list layers: {e}",
                "filename": filename,
            }

        logger.info(f"  Found {len(layers)} layer(s)")

        if skip_existing:
            try:
                if await check_dataset_exists(
                    dest_storage, dest_folder, base_filename, layers
                ):
                    logger.info("  Dataset already exists, skipping...")
                    return {
                        "success": True,
                        "skipped": True,
                        "filename": filename,
                        "reason": "Output files already exist",
                    }
            except Exception as e:
                logger.warning(
                    f"  Error checking if dataset exists: {e}, continuing..."
                )

        results: List[Dict[str, Any]] = []

        for layer_name, _geom_type in layers:
            layer_filename = _build_layer_filename(base_filename, layer_name)
            logger.info(f"  Processing layer: {layer_name}")
            log_memory_usage(f"Before processing {layer_name}")

            try:
                with warnings.catch_warnings():
                    warnings.filterwarnings(
                        "ignore", category=UserWarning, message=".*parsing datetimes.*"
                    )
                    warnings.filterwarnings(
                        "ignore",
                        category=UserWarning,
                        message=".*Out of bounds nanosecond timestamp.*",
                    )

                    stream_result = await process_layer_chunked(
                        file_path=data_file,
                        format_type=format_type,
                        layer_name=layer_name if layer_name != "default" else None,
                        layer_filename=layer_filename,
                        dest_folder=dest_folder,
                        dest_storage=dest_storage,
                        work_dir=work_dir,
                        row_group_size=DEFAULT_ROW_GROUP_SIZE,
                        data_page_size_bytes=DEFAULT_DATA_PAGE_SIZE_BYTES,
                    )

                    if "error" not in stream_result:
                        log_memory_usage(f"After processing {layer_name}")
                        results.append(
                            {
                                "layer": layer_name,
                                "geoparquet_urls": stream_result.get(
                                    "geoparquet_urls", []
                                ),
                                "pmtiles_url": stream_result.get("pmtiles_url"),
                                "feature_count": stream_result.get("feature_count", 0),
                            }
                        )
                        continue

                    logger.warning(
                        f"    Streaming failed ({stream_result['error']}), falling back to full read..."
                    )

                    gdf = read_chunked(
                        file_path=data_file,
                        format_type=format_type,
                        layer_name=layer_name if layer_name != "default" else None,
                    )
                    gdf = _ensure_id_column(gdf, start_id=1)
                    log_memory_usage(f"After reading {layer_name}")

                    geoparquet_dir = work_dir / "geoparquet"
                    pmtiles_dir = work_dir / "pmtiles"
                    geoparquet_dir.mkdir(exist_ok=True)
                    pmtiles_dir.mkdir(exist_ok=True)

                    geoparquet_files = write_geoparquet_chunked(
                        gdf,
                        geoparquet_dir / layer_filename,
                        row_group_size=DEFAULT_ROW_GROUP_SIZE,
                        data_page_size_bytes=DEFAULT_DATA_PAGE_SIZE_BYTES,
                    )
                    geoparquet_urls = await _upload_geoparquet_files(
                        dest_storage=dest_storage,
                        geoparquet_files=geoparquet_files,
                        dest_folder=dest_folder,
                        layer_filename=layer_filename,
                    )

                    pmtiles_path = pmtiles_dir / f"{layer_filename}.pmtiles"
                    pmtiles_result = write_pmtiles_chunked(
                        gdf=gdf,
                        output_path=pmtiles_path,
                        layer_filename=layer_filename,
                    )

                    pmtiles_url = None
                    if pmtiles_result:
                        remote_path = f"{dest_folder}pmtiles/{layer_filename}.pmtiles"
                        await dest_storage.upload_file(pmtiles_result, remote_path)
                        pmtiles_url = dest_storage.get_public_url(remote_path)
                        logger.info(f"    Uploaded PMTiles: {remote_path}")

                    results.append(
                        {
                            "layer": layer_name,
                            "geoparquet_urls": geoparquet_urls,
                            "pmtiles_url": pmtiles_url,
                            "feature_count": len(gdf),
                        }
                    )
            except Exception as e:
                logger.error(f"    Error processing layer {layer_name}: {e}")
                results.append({"layer": layer_name, "error": str(e)})

        return {
            "success": True,
            "filename": filename,
            "format": format_type,
            "layers": results,
        }


async def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Process datasets from storage with chunked reading/writing"
    )
    parser.add_argument(
        "--inventory",
        type=Path,
        default=Path(__file__).parent / "inventory_gcs.csv",
        help="Path to inventory CSV file (or 'auto' to discover nested datasets)",
    )
    parser.add_argument(
        "--source",
        type=str,
        default="gs://drp-hifld-copy-49775666365",
        help="Source storage URL (gs://bucket or seaweedfs://bucket/path)",
    )
    parser.add_argument(
        "--dest",
        type=str,
        default="seaweedfs://drp-hifld-copy-formatted",
        help="Destination storage URL (gs://bucket or seaweedfs://bucket/path)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit number of datasets to process",
    )
    parser.add_argument(
        "--offset",
        type=int,
        default=0,
        help="Skip first N datasets",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be processed without making changes",
    )
    parser.add_argument(
        "--datasets",
        type=str,
        nargs="+",
        help="List of specific dataset filenames or paths to process (can be gs:// paths)",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Enable verbose logging",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Skip datasets that already have output files in destination storage",
    )

    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Parse source and destination storage
    source_type, source_bucket, source_path = parse_storage_url(args.source)
    dest_type, dest_bucket, dest_path = parse_storage_url(args.dest)

    # Create storage clients
    source_storage = create_storage_client(
        storage_type=source_type,
        bucket=source_bucket,
    )
    dest_storage = create_storage_client(
        storage_type=dest_type,
        bucket=dest_bucket,
    )

    # Load or discover datasets
    if args.inventory == Path("auto") or str(args.inventory) == "auto":
        # Discover nested datasets
        logger.info(f"Discovering nested datasets in {args.source}")
        datasets = await discover_nested_datasets(source_storage, source_path)
        logger.info(f"Discovered {len(datasets)} datasets")
    else:
        # Load from inventory CSV
        datasets = load_inventory(args.inventory)
        logger.info(f"Loaded {len(datasets)} datasets from inventory")

    # If source includes a path prefix, scope inventory datasets to that prefix.
    # Example: --source gs://bucket/nfhl keeps only rows whose object path starts with "nfhl/".
    if source_path:
        source_prefix = source_path.strip("/")
        filtered_by_source = []
        for d in datasets:
            storage_path = d.get("gcs_zip_path", "").strip()
            if not storage_path:
                continue
            _, _, rel_path = parse_storage_url(storage_path)
            rel_path = rel_path.strip("/")
            if rel_path == source_prefix or rel_path.startswith(f"{source_prefix}/"):
                filtered_by_source.append(d)
        datasets = filtered_by_source
        logger.info(
            f"Scoped to source prefix '{source_prefix}': {len(datasets)} dataset(s)"
        )

    # Filter by dataset list if provided
    if args.datasets:
        # Handle both filenames and full paths
        dataset_paths = set()
        dataset_names = set()
        for ds in args.datasets:
            if ds.startswith("gs://") or ds.startswith("seaweedfs://"):
                # Full path - extract filename
                _, _, path = parse_storage_url(ds)
                filename = Path(path).stem
                # Remove format suffix
                for fmt, _ in FORMAT_PRIORITY:
                    if filename.endswith(f"-{fmt}") or filename.endswith(
                        f"-{fmt.replace('_', '-')}"
                    ):
                        filename = filename[: -(len(fmt) + 1)]
                        break
                dataset_names.add(filename)
                dataset_paths.add(path)
            else:
                dataset_names.add(ds)

        # Filter datasets
        filtered = []
        for d in datasets:
            filename = d.get("filename", "").strip()
            storage_path = d.get("gcs_zip_path", "").strip()
            _, _, path = (
                parse_storage_url(storage_path) if storage_path else ("", "", "")
            )

            if filename in dataset_names or path in dataset_paths:
                filtered.append(d)

        datasets = filtered
        logger.info(f"Filtered to {len(datasets)} specified datasets")

    # Apply offset
    if args.offset:
        datasets = datasets[args.offset :]
        logger.info(f"Skipped first {args.offset} datasets")

    # Apply limit
    if args.limit:
        datasets = datasets[: args.limit]
        logger.info(f"Limited to {args.limit} datasets")

    logger.info(f"Will process {len(datasets)} datasets")
    if args.skip_existing:
        logger.info("  (Will skip datasets that already have output files)")

    # Process datasets
    results = {
        "success": 0,
        "skipped": 0,
        "failed": 0,
        "errors": [],
        "datasets": [],  # Track per-dataset results
    }

    for i, dataset in enumerate(datasets, 1):
        filename = dataset.get("filename", "").strip()
        title = dataset.get("title", "").strip()
        logger.info(f"\n[{i}/{len(datasets)}] Processing: {filename}")

        dataset_result = {
            "filename": filename,
            "title": title,
            "status": "unknown",
            "error": None,
            "layers": [],
            "formats": {
                "geoparquet": False,
                "pmtiles": False,
            },
        }

        try:
            result = await process_dataset(
                dataset,
                source_storage,
                dest_storage,
                dry_run=args.dry_run,
                skip_existing=args.skip_existing,
            )

            if result.get("success"):
                if result.get("skipped"):
                    results["skipped"] += 1
                    dataset_result["status"] = "skipped"
                    dataset_result["error"] = result.get("reason", "Already exists")
                    logger.info(
                        f"  ⊘ Skipped: {result.get('reason', 'Already exists')}"
                    )
                else:
                    results["success"] += 1
                    dataset_result["status"] = "success"
                    if not args.dry_run:
                        # Track format creation status
                        layers = result.get("layers", [])
                        logger.info(f"  ✓ Success: {len(layers)} layer(s) processed")

                        # Check which formats were created
                        for layer in layers:
                            layer_name = layer.get("layer", "unknown")
                            layer_info = {
                                "name": layer_name,
                                "error": layer.get("error"),
                                "formats": {
                                    "geoparquet": bool(layer.get("geoparquet_urls")),
                                    "pmtiles": bool(layer.get("pmtiles_url")),
                                },
                            }
                            dataset_result["layers"].append(layer_info)

                            # Update dataset-level format status
                            if layer_info["formats"]["geoparquet"]:
                                dataset_result["formats"]["geoparquet"] = True
                            if layer_info["formats"]["pmtiles"]:
                                dataset_result["formats"]["pmtiles"] = True
            else:
                results["failed"] += 1
                dataset_result["status"] = "failed"
                error_msg = result.get("error", "Unknown error")
                dataset_result["error"] = error_msg
                results["errors"].append(f"{filename}: {error_msg}")
                logger.error(f"  ✗ Failed: {error_msg}")

        except Exception as e:
            results["failed"] += 1
            dataset_result["status"] = "failed"
            error_msg = str(e)
            dataset_result["error"] = error_msg
            results["errors"].append(f"{filename}: {error_msg}")
            logger.exception(f"  ✗ Error: {error_msg}")

        results["datasets"].append(dataset_result)

        # Print progress summary after each dataset
        processed_count = results["success"] + results["skipped"]
        remaining_count = len(datasets) - i
        skipped_count = results["skipped"]
        failed_count = results["failed"]

        # Calculate offset for resume (initial offset + number of datasets processed so far)
        resume_offset = args.offset + i

        logger.info(
            f"\n  📊 Progress: {processed_count} processed ({results['success']} success, {skipped_count} skipped, {failed_count} failed), "
            f"{remaining_count} remaining"
        )
        logger.info(f"  → Resume with: --offset {resume_offset}")

    # Print summary
    print("\n" + "=" * 80)
    print("PROCESSING SUMMARY")
    print("=" * 80)
    print(f"  Success: {results['success']}")
    if results.get("skipped", 0) > 0:
        print(f"  Skipped: {results['skipped']}")
    print(f"  Failed:  {results['failed']}")

    # Print failed datasets with reasons
    failed_datasets = [d for d in results["datasets"] if d["status"] == "failed"]
    if failed_datasets:
        print("\n" + "-" * 80)
        print("FAILED DATASETS:")
        print("-" * 80)
        for ds in failed_datasets:
            print(f"\n  Dataset: {ds['filename']}")
            if ds.get("title"):
                print(f"    Title: {ds['title']}")
            print(f"    Error: {ds.get('error', 'Unknown error')}")

    # Print datasets with missing formats
    datasets_with_missing_formats = []
    for ds in results["datasets"]:
        if ds["status"] == "success" and ds.get("layers"):
            missing = []
            if not ds["formats"]["geoparquet"]:
                missing.append("GeoParquet")
            if not ds["formats"]["pmtiles"]:
                missing.append("PMTiles")

            if missing:
                datasets_with_missing_formats.append(
                    {"dataset": ds, "missing": missing}
                )

    if datasets_with_missing_formats:
        print("\n" + "-" * 80)
        print("DATASETS WITH MISSING FORMATS:")
        print("-" * 80)
        for item in datasets_with_missing_formats:
            ds = item["dataset"]
            print(f"\n  Dataset: {ds['filename']}")
            if ds.get("title"):
                print(f"    Title: {ds['title']}")
            print(f"    Missing formats: {', '.join(item['missing'])}")

            # Show layer-level details
            for layer in ds.get("layers", []):
                if layer.get("error"):
                    print(f"      Layer '{layer['name']}': ERROR - {layer['error']}")
                else:
                    layer_missing = []
                    if not layer["formats"]["geoparquet"]:
                        layer_missing.append("GeoParquet")
                    if not layer["formats"]["pmtiles"]:
                        layer_missing.append("PMTiles")
                    if layer_missing:
                        print(
                            f"      Layer '{layer['name']}': Missing {', '.join(layer_missing)}"
                        )

    # Print all errors if any
    if results["errors"]:
        print("\n" + "-" * 80)
        print("ALL ERRORS:")
        print("-" * 80)
        for error in results["errors"]:
            print(f"  - {error}")

    print("\n" + "=" * 80)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n⚠️  Interrupted by user")
        sys.exit(1)
    except Exception as e:
        import traceback

        print(f"\n\n❌ FATAL ERROR: {e}")
        print("\nFull traceback:")
        traceback.print_exc()
        sys.exit(1)
