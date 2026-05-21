"""Utility functions ported from edric-codegen for dataset processing."""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import zipfile
from enum import StrEnum
from pathlib import Path
from typing import cast

import geopandas as gpd
import pandas as pd
import pyogrio

from schemas.types import JSONDict, json_value


logger = logging.getLogger(__name__)
MIN_LATITUDE = -90
MAX_LATITUDE = 90
MIN_LONGITUDE = -180
MAX_LONGITUDE = 180
WGS84_EPSG = 4326
DICTIONARY_SAMPLE_THRESHOLD = 10_000
UNIQUE_COUNT_THRESHOLD = 100_000
STRING_VALUES_THRESHOLD = 50_000
MAX_POSSIBLE_VALUES = 20
DEFAULT_PARQUET_CHUNK_SIZE_MB = 512
MAX_PARQUET_CHUNKS = 100
SAMPLE_VALUE_COUNT = 5


class ColumnDatatype(StrEnum):
    """Normalized column data types for generated data dictionaries."""

    INTEGER = "integer"
    FLOAT = "float"
    BOOLEAN = "boolean"
    TIMESTAMP = "timestamp"
    STRING = "string"
    GEOMETRY = "geometry"


def extract_zip_if_needed(upload_folder: Path, main_file: str) -> str:
    """Extract ZIP uploads when needed and return the main relative dataset path."""
    file_path = upload_folder / main_file

    if not file_path.exists():
        matches = list(upload_folder.rglob(main_file))
        if matches:
            return str(matches[0].relative_to(upload_folder))
        msg = f"Could not locate {main_file} in uploaded bundle"
        raise FileNotFoundError(msg)

    if not main_file.lower().endswith(".zip"):
        return main_file

    extract_folder = upload_folder / "extracted"
    if extract_folder.exists():
        shutil.rmtree(extract_folder)
    with zipfile.ZipFile(file_path, "r") as archive:
        archive.extractall(extract_folder)

    gdb_dirs = [
        Path(root_dir) / dir_name
        for root_dir, dirs, _files in os.walk(extract_folder)
        for dir_name in dirs
        if dir_name.lower().endswith(".gdb")
    ]

    if not gdb_dirs:
        match = find_candidate_file(extract_folder, [".gpkg", ".geojson", ".shp"])
        if not match:
            msg = "ZIP file does not contain a supported data source"
            raise RuntimeError(msg)
        # Return path relative to upload_folder, keeping the file structure intact
        return str(match.relative_to(upload_folder))

    if len(gdb_dirs) > 1:
        logger.warning(
            "Multiple geodatabases found in ZIP: %s. Using the first one.",
            [path.name for path in gdb_dirs],
        )

    gdb_path = gdb_dirs[0]
    final_gdb_path = upload_folder / gdb_path.name
    if final_gdb_path.exists():
        shutil.rmtree(final_gdb_path)
    shutil.move(str(gdb_path), str(final_gdb_path))
    return final_gdb_path.name


def find_candidate_file(root: Path, extensions: list[str]) -> Path | None:
    """Find the first candidate file or geodatabase under a root path."""
    for path in root.rglob("*"):
        if path.is_file() and path.suffix.lower() in extensions:
            return path
        if path.is_dir() and path.suffix.lower() == ".gdb":
            return path
    return None


def _load_geodatabase_with_geometry(gdb_path: Path) -> gpd.GeoDataFrame:
    layers = pyogrio.list_layers(gdb_path)
    geometry_layer = None
    for layer_name, geom_type in layers:
        if geom_type is not None:
            geometry_layer = layer_name
            break

    if geometry_layer is None:
        msg = f"No layers with geometry found in geodatabase {gdb_path}"
        raise ValueError(msg)

    gdf = gpd.read_file(gdb_path, layer=geometry_layer)
    if not isinstance(gdf, gpd.GeoDataFrame):
        msg = f"Layer '{geometry_layer}' did not contain valid spatial data"
        raise TypeError(msg)
    return gdf


def _load_csv_as_geodataframe(csv_path: Path) -> gpd.GeoDataFrame:
    df = pd.read_csv(csv_path)

    lat_names = ["lat", "latitude", "Latitude", "LAT", "LATITUDE", "y", "Y"]
    lon_names = [
        "lon",
        "longitude",
        "lng",
        "Longitude",
        "LON",
        "LONGITUDE",
        "x",
        "X",
    ]

    lat_col = next((col for col in df.columns if col in lat_names), None)
    lon_col = next((col for col in df.columns if col in lon_names), None)

    if lat_col is None or lon_col is None:
        msg = (
            f"No spatial columns found. Supported latitude column names: {lat_names}. "
            f"Supported longitude column names: {lon_names}. "
            f"Found columns: {list(df.columns)}"
        )
        raise ValueError(msg)

    lat_values = cast(pd.Series, pd.to_numeric(df[lat_col], errors="coerce"))
    lon_values = cast(pd.Series, pd.to_numeric(df[lon_col], errors="coerce"))

    if lat_values.isna().any() or lon_values.isna().any():
        msg = f"Invalid coordinate values found in {lat_col} or {lon_col} columns. All values must be numeric."
        raise ValueError(msg)

    if (lat_values < MIN_LATITUDE).any() or (lat_values > MAX_LATITUDE).any():
        msg = f"Latitude values in {lat_col} must be between {MIN_LATITUDE} and {MAX_LATITUDE} degrees"
        raise ValueError(msg)

    if (lon_values < MIN_LONGITUDE).any() or (lon_values > MAX_LONGITUDE).any():
        msg = f"Longitude values in {lon_col} must be between {MIN_LONGITUDE} and {MAX_LONGITUDE} degrees"
        raise ValueError(msg)

    geometry = gpd.points_from_xy(lon_values, lat_values)
    return gpd.GeoDataFrame(df, geometry=geometry, crs="EPSG:4326")


def load_upload_gdf(upload_folder: Path, main_file: str) -> gpd.GeoDataFrame:
    """Load a geospatial file into a GeoDataFrame.

    Supports: GeoJSON, CSV (with lat/lon), Geodatabase, Shapefile, GeoPackage.
    Ensures data is in WGS84 (EPSG:4326).
    """
    file_path = upload_folder / main_file

    if main_file.lower().endswith(".csv"):
        gdf = _load_csv_as_geodataframe(file_path)
    elif main_file.lower().endswith(".gdb"):
        gdf = _load_geodatabase_with_geometry(file_path)
    else:
        gdf = gpd.read_file(file_path)

    if not isinstance(gdf, gpd.GeoDataFrame):
        msg = f"File {main_file} did not contain spatial data"
        raise TypeError(msg)

    if gdf.crs is None:
        gdf.crs = "EPSG:4326"
    elif gdf.crs.to_epsg() != WGS84_EPSG:
        gdf = gdf.to_crs(epsg=WGS84_EPSG)

    return gdf


def load_tabular_dataframe(path: Path) -> pd.DataFrame:
    """Load a tabular dataframe from a supported local file."""
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(path)
    if suffix in (".xlsx", ".xls"):
        return pd.read_excel(path)
    if suffix == ".parquet":
        return pd.read_parquet(path)
    if suffix == ".json":
        return pd.read_json(path)

    msg = f"Unsupported tabular file format: {suffix}"
    raise ValueError(msg)


def get_column_datatype(dtype: object) -> ColumnDatatype:
    """Map a pandas/geopandas dtype to a normalized data dictionary type."""
    # Check for geometry type first (from geopandas)
    dtype_str = str(dtype).lower()
    if dtype_str == "geometry":
        return ColumnDatatype.GEOMETRY
    if pd.api.types.is_integer_dtype(dtype):
        return ColumnDatatype.INTEGER
    if pd.api.types.is_float_dtype(dtype):
        return ColumnDatatype.FLOAT
    if pd.api.types.is_bool_dtype(dtype):
        return ColumnDatatype.BOOLEAN
    if pd.api.types.is_datetime64_any_dtype(dtype):
        return ColumnDatatype.TIMESTAMP
    return ColumnDatatype.STRING


async def generate_data_dictionary(dataset_name: str, df: pd.DataFrame) -> JSONDict:
    """Generate a compact data dictionary from dataframe columns."""
    columns: list[JSONDict] = []
    df_len = len(df)
    use_sampling = df_len > DICTIONARY_SAMPLE_THRESHOLD
    sample_size = min(5000, df_len) if use_sampling else df_len

    for col in df.columns:
        col_data = cast(pd.Series, df[col])
        col_dtype = get_column_datatype(col_data.dtype)

        # Skip detailed analysis for geometry columns - just track basics
        if col_dtype == ColumnDatatype.GEOMETRY:
            null_count = col_data.isnull().sum()
            columns.append(
                {
                    "name": str(col),
                    "type": ColumnDatatype.GEOMETRY.value,
                    "nullable": bool(null_count > 0),
                    "numNullValues": int(null_count),
                }
            )
            continue
        null_count = col_data.isnull().sum()

        unique_count = int(col_data.nunique()) if df_len < UNIQUE_COUNT_THRESHOLD else None

        # Get non-null data for sampling
        non_null_data = col_data.dropna()

        # Only sample if there are non-null values
        if len(non_null_data) > 0:
            if use_sampling and df_len > sample_size:
                sample_data = non_null_data.sample(min(SAMPLE_VALUE_COUNT, sample_size, len(non_null_data)))
            else:
                sample_data = non_null_data.sample(min(SAMPLE_VALUE_COUNT, len(non_null_data)))

            example_values = [str(x) for x in sample_data.values.tolist()]
        else:
            # Column is entirely null
            example_values = []

        column_entry: JSONDict = {
            "name": str(col),
            "type": col_dtype.value,
            "nullable": bool(null_count > 0),
            "numUniqueValues": unique_count,
            "numNullValues": int(null_count),
            "exampleValues": example_values,
        }

        if col_dtype in [ColumnDatatype.INTEGER, ColumnDatatype.FLOAT]:
            non_null_col = col_data.dropna()
            if len(non_null_col) > 0:
                sample_col = non_null_col.sample(min(sample_size, len(non_null_col))) if use_sampling else col_data
                column_entry["min"] = float(sample_col.min()) if not pd.isna(sample_col.min()) else None
                column_entry["max"] = float(sample_col.max()) if not pd.isna(sample_col.max()) else None
        if col_dtype == ColumnDatatype.STRING:
            add_string_column_details(column_entry, col_data, df_len, sample_size, use_sampling)

        columns.append(column_entry)

    return {
        "name": dataset_name,
        "columns": [json_value(column) for column in columns],
    }


def add_string_column_details(
    column_entry: JSONDict,
    col_data: pd.Series,
    df_len: int,
    sample_size: int,
    use_sampling: bool,
) -> None:
    """Add string length and low-cardinality possible values to a column entry."""
    try:
        non_null_col = col_data.dropna()
        if len(non_null_col) == 0:
            column_entry["length"] = None
            return
        sample_col = non_null_col.sample(min(sample_size, len(non_null_col))) if use_sampling else col_data
        max_length = sample_col.astype(str).str.len().max()
        column_entry["length"] = int(max_length) if not pd.isna(max_length) else None
        if df_len < STRING_VALUES_THRESHOLD:
            value_counts = sample_col.value_counts()
            if len(value_counts) <= MAX_POSSIBLE_VALUES:
                column_entry["possibleValues"] = json_value(sorted(value_counts.index.astype(str).tolist()))
    except Exception:
        column_entry["length"] = None


def serialize_complex_columns(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Serialize complex nested columns (dicts, lists) to JSON strings.

    This prevents PyArrow conversion errors when saving to Parquet.
    """
    gdf = gdf.copy()

    for col in gdf.columns:
        # Skip geometry column
        if col == gdf.geometry.name:
            continue

        # Check if column contains complex types
        if gdf[col].dtype == "object":
            # Sample first non-null value to check type
            non_null_values = gdf[col].dropna()
            if len(non_null_values) > 0:
                sample = non_null_values.iloc[0]
                # If it's a dict or list, serialize the entire column
                if isinstance(sample, (dict, list)):
                    logger.info(f"Serializing complex column '{col}' to JSON strings")
                    gdf[col] = gdf[col].apply(
                        lambda x: json.dumps(x) if x is not None and isinstance(x, (dict, list)) else x
                    )

    return gdf


async def convert_to_geoparquet(
    gdf: gpd.GeoDataFrame,
    output_folder: Path,
    chunk_size_mb: int = DEFAULT_PARQUET_CHUNK_SIZE_MB,
) -> list[Path]:
    """Write a GeoDataFrame to one or more GeoParquet chunks."""
    if len(gdf) == 0:
        empty_path = output_folder / "block-0.parquet"
        gdf.to_parquet(empty_path, compression="snappy", geometry_encoding="WKB")
        return [empty_path]

    if len(gdf) > DICTIONARY_SAMPLE_THRESHOLD:
        sample_size = min(1000, len(gdf))
        sample_gdf = gdf.sample(n=sample_size)
        sample_size_bytes = sample_gdf.memory_usage(deep=True).sum()
        estimated_total_size = sample_size_bytes * (len(gdf) / sample_size)
    else:
        estimated_total_size = gdf.memory_usage(deep=True).sum()

    chunk_size = chunk_size_mb * 1024 * 1024
    num_chunks = max(1, int((estimated_total_size + chunk_size - 1) // chunk_size))
    if num_chunks > MAX_PARQUET_CHUNKS:
        num_chunks = MAX_PARQUET_CHUNKS
        chunk_size = estimated_total_size // num_chunks

    paths: list[Path] = []
    for i in range(num_chunks):
        start_idx = i * len(gdf) // num_chunks
        end_idx = (i + 1) * len(gdf) // num_chunks if i < num_chunks - 1 else len(gdf)
        chunk = gdf.iloc[start_idx:end_idx]
        chunk_path = output_folder / f"block-{i}.parquet"
        chunk.to_parquet(
            chunk_path,
            compression="snappy",
            geometry_encoding="WKB",
            index=False,
        )
        paths.append(chunk_path)

    return paths


def create_pmtiles(fgb_path: Path, pmtiles_path: Path) -> None:
    """Create PMTiles from a FlatGeobuf file using tippecanoe.

    Input data must be in WGS84 (EPSG:4326) with coordinates in (longitude, latitude) order.
    """
    try:
        result = subprocess.run(
            [
                "tippecanoe",
                "-zg",
                "--drop-densest-as-needed",
                "--extend-zooms-if-still-dropping",
                "--force",  # Overwrite existing output
                "-o",
                str(pmtiles_path),
                str(fgb_path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        if result.stderr:
            # Log any warnings from tippecanoe
            for line in result.stderr.strip().split("\n"):
                if "wrong projection" in line.lower() or "clipped away" in line.lower():
                    logger.warning("tippecanoe warning: %s", line)
                else:
                    logger.info("tippecanoe: %s", line)
    except subprocess.CalledProcessError as exc:
        logger.exception("tippecanoe failed: stdout=%s, stderr=%s", exc.stdout, exc.stderr)
        msg = f"tippecanoe failed to create PMTiles: {exc.stderr}"
        raise RuntimeError(msg) from exc
    except FileNotFoundError as exc:
        msg = "tippecanoe CLI is required to generate PMTiles. Please install tippecanoe."
        raise RuntimeError(msg) from exc
