import asyncio
import json
import logging
import os
import string
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Literal, Optional, Sequence, Set, Tuple, Union
from uuid import uuid4

import duckdb
import geopandas as gpd
import httpx
import pandas as pd
from shapely import wkb, wkt
from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry
from fastapi import BackgroundTasks, FastAPI, Request
from google.cloud import storage
from sqlglot import parse_one, exp

from dotenv import load_dotenv

from pipeline_utils import (
    convert_to_geoparquet,
    extract_zip_if_needed,
    generate_data_dictionary,
    load_tabular_dataframe,
    load_upload_gdf,
    create_pmtiles,
    serialize_complex_columns,
)
from validation import validate_geojson_file, format_validation_errors
from pydantic import BaseModel

load_dotenv()


class SQLConfigData(BaseModel):
    """Configuration data for SQL transforms."""

    query: str


class GeocodeConfigData(BaseModel):
    """Configuration data for geocoding transforms."""

    address_column: str
    output_lat_column: str = "latitude"
    output_lng_column: str = "longitude"


class SQLTransformConfig(BaseModel):
    """SQL transform configuration."""

    type: Literal["sql"]
    config: SQLConfigData

    @classmethod
    def from_dict(cls, data: dict) -> "SQLTransformConfig":
        return cls(type="sql", config=SQLConfigData(**data.get("config", {})))


class GeocodeTransformConfig(BaseModel):
    """Geocoding transform configuration."""

    type: Literal["geocode"]
    config: GeocodeConfigData

    @classmethod
    def from_dict(cls, data: dict) -> "GeocodeTransformConfig":
        return cls(type="geocode", config=GeocodeConfigData(**data.get("config", {})))


# Union type for all transform configs
TransformConfig = SQLTransformConfig | GeocodeTransformConfig


def parse_transform_config(data: dict) -> TransformConfig:
    """Parse a transform config dict into the appropriate typed model."""
    config_type = data.get("type")
    if config_type == "sql":
        return SQLTransformConfig(
            type="sql", config=SQLConfigData(**data.get("config", {}))
        )
    elif config_type == "geocode":
        return GeocodeTransformConfig(
            type="geocode", config=GeocodeConfigData(**data.get("config", {}))
        )
    else:
        raise ValueError(f"Unknown transform type: {config_type}")


class TransformConfigInput(BaseModel):
    """Raw transform config input from API requests."""

    type: str
    config: dict

    def to_typed(self) -> TransformConfig:
        """Convert to the appropriate typed transform config."""
        return parse_transform_config({"type": self.type, "config": self.config})


class ProcessUploadRequest(BaseModel):
    """Request for processing file uploads."""

    dataset_name: str
    dataset_description: Optional[str] = None
    dataset_type: Optional[str] = None
    main_file: str  # Required for file uploads
    target_dataset_id: Optional[str] = None
    version_name: Optional[str] = None
    version_description: Optional[str] = None
    transform_config: Optional[TransformConfigInput] = None


class ExecuteTransformRequest(BaseModel):
    """Request for executing a transform to create/update a dataset."""

    dataset_id: str  # Dataset ID (placeholder or existing)
    dataset_name: str
    dataset_description: Optional[str] = None
    transform_config: TransformConfigInput
    transform_history_id: str  # For status updates
    is_new_dataset: bool = True  # True if creating new, False if updating


@dataclass(frozen=True)
class TableReference:
    """Structured reference to a table found in a SQL query."""

    schema: Optional[str]
    name: str


def build_dataset_version_path(dataset_id: str, version_id: str) -> str:
    """Construct the canonical GCS path for a dataset version."""
    return f"gs://{DATASETS_BUCKET_NAME}/{dataset_id}/{version_id}/data/*.parquet"


logger = logging.getLogger("upload-processor")
logging.basicConfig(level=logging.INFO)

UPLOADS_BUCKET_NAME = os.getenv("UPLOADS_BUCKET_NAME", "marauders-uploads-76981634530")
DATASETS_BUCKET_NAME = os.getenv(
    "DATASETS_BUCKET_NAME", "marauders-datasets-76981634530"
)
TILES_BUCKET_NAME = os.getenv("TILES_BUCKET_NAME", "marauders-tiles-76981634530")
APP_BASE_URL = os.getenv("APP_BASE_URL", "http://localhost:3000").rstrip("/")
API_BASE_URL = f"{APP_BASE_URL}/api/v1"

# GCS HMAC credentials for DuckDB access to cloud storage
# Generate HMAC keys in GCP Console > Cloud Storage > Settings > Interoperability
GCS_HMAC_KEY_ID = os.getenv("GCS_HMAC_KEY_ID")
GCS_HMAC_SECRET = os.getenv("GCS_HMAC_SECRET")

storage_client = storage.Client()

SUPPORTED_DATASET_TYPES = {"Tabular", "Geospatial", "Unstructured"}

ICON_BY_TYPE = {
    "Tabular": "FileSpreadsheet",
    "Geospatial": "Map",
    "Unstructured": "Waves",
}

DATASET_HEADERS = {
    "Content-Type": "application/json",
}


def build_api_headers(access_token: Optional[str] = None) -> Dict[str, str]:
    """Build headers for API requests, including bearer token if provided."""
    headers = {"Content-Type": "application/json"}
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    return headers


def build_gcs_secret_sql() -> str:
    """
    Build SQL to create a GCS secret for DuckDB.

    DuckDB's GCS secret type only supports HMAC keys (S3-compatible access).
    Set GCS_HMAC_KEY_ID and GCS_HMAC_SECRET env vars.

    To generate HMAC keys:
    1. Go to GCP Console > Cloud Storage > Settings > Interoperability
    2. Create a key for your service account

    See: https://duckdb.org/docs/stable/guides/network_cloud_storage/gcs_import
    """
    logger.info(
        "GCS credentials check: KEY_ID=%s, SECRET=%s",
        "set" if GCS_HMAC_KEY_ID else "NOT SET",
        "set" if GCS_HMAC_SECRET else "NOT SET",
    )

    if GCS_HMAC_KEY_ID and GCS_HMAC_SECRET:
        safe_key = GCS_HMAC_KEY_ID.replace("'", "''")
        safe_secret = GCS_HMAC_SECRET.replace("'", "''")
        return (
            f"CREATE OR REPLACE SECRET ("
            f"\n    TYPE gcs,"
            f"\n    KEY_ID '{safe_key}',"
            f"\n    SECRET '{safe_secret}'"
            f"\n);"
        )

    logger.warning(
        "GCS HMAC credentials are not configured. "
        "Set GCS_HMAC_KEY_ID and GCS_HMAC_SECRET environment variables. "
        "Generate HMAC keys in GCP Console > Cloud Storage > Settings > Interoperability."
    )
    return ""


def build_duckdb_pre_script() -> str:
    """Build the complete DuckDB initialization script (extensions + GCS secret)."""
    parts = [
        "INSTALL httpfs;",
        "LOAD httpfs;",
        "",
        "INSTALL spatial;",
        "LOAD spatial;",
    ]
    secret_sql = build_gcs_secret_sql()
    if secret_sql:
        parts.extend(["", secret_sql])
    return "\n".join(parts)


app = FastAPI(title="Marauders Upload Processor")


async def update_upload_status(
    upload_id: str,
    status: str,
    error: Optional[str] = None,
    access_token: Optional[str] = None,
) -> None:
    payload: Dict[str, Optional[str]] = {"status": status}
    if error is not None:
        payload["error"] = error

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.patch(
            f"{API_BASE_URL}/uploads/{upload_id}",
            json=payload,
            headers=build_api_headers(access_token),
        )
        response.raise_for_status()


async def update_transform_status(
    transform_history_id: str,
    status: str,
    error: Optional[str] = None,
    access_token: Optional[str] = None,
) -> None:
    """Update the status of a transform in the database."""
    payload: Dict[str, Optional[str]] = {"status": status}
    if error is not None:
        payload["error"] = error

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.patch(
            f"{API_BASE_URL}/transforms/{transform_history_id}",
            json=payload,
            headers=build_api_headers(access_token),
        )
        response.raise_for_status()


async def create_dataset_record(
    payload: Dict[str, object], access_token: Optional[str] = None
) -> Dict[str, object]:
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            f"{API_BASE_URL}/datasets",
            json=payload,
            headers=build_api_headers(access_token),
        )
        response.raise_for_status()
        return response.json()


async def update_dataset_record(
    dataset_id: str, payload: Dict[str, object], access_token: Optional[str] = None
) -> Dict[str, object]:
    # TODO: use a pydantic model for the payload
    body = {key: value for key, value in payload.items() if key != "id"}
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.put(
            f"{API_BASE_URL}/datasets/{dataset_id}",
            json=body,
            headers=build_api_headers(access_token),
        )
        response.raise_for_status()
        return response.json()


def build_dataset_configuration(columns: List[Dict[str, object]]) -> Dict[str, object]:
    return {
        "version": "v1",
        "columns": columns,
    }


def download_upload_bundle(upload_id: str, destination: Path) -> None:
    prefix = f"{upload_id}/"
    blobs = storage_client.list_blobs(UPLOADS_BUCKET_NAME, prefix=prefix)
    downloaded = 0
    for blob in blobs:
        if not blob.name or blob.name.endswith("/"):
            continue
        relative_path = blob.name[len(prefix) :]
        local_path = destination / relative_path
        local_path.parent.mkdir(parents=True, exist_ok=True)
        blob.download_to_filename(str(local_path))
        downloaded += 1

    if downloaded == 0:
        raise RuntimeError("No files found for upload bundle")


def resolve_uploaded_file(root: Path, relative_name: str) -> Path:
    candidate = root / relative_name
    if candidate.exists():
        return candidate

    matches = list(root.rglob(Path(relative_name).name))
    if matches:
        return matches[0]

    raise FileNotFoundError(f"Could not locate {relative_name} in uploaded bundle")


def upload_file(
    local_path: Path, destination: str, bucket_name: str = DATASETS_BUCKET_NAME
) -> None:
    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(destination)
    blob.upload_from_filename(str(local_path))
    logger.info("Uploaded %s to gs://%s/%s", local_path.name, bucket_name, destination)


def clear_dataset_prefix(dataset_id: str) -> None:
    prefix = f"{dataset_id}/"
    bucket = storage_client.bucket(DATASETS_BUCKET_NAME)
    blobs = list(bucket.list_blobs(prefix=prefix))
    if not blobs:
        return
    logger.info(
        "Clearing existing objects under gs://%s/%s", DATASETS_BUCKET_NAME, prefix
    )
    for blob in blobs:
        blob.delete()


def infer_dataset_type(file_path: Path) -> str:
    ext = file_path.suffix.lower()
    if ext in {".geojson", ".shp", ".gpkg", ".fgb", ".kml", ".gpx"}:
        return "Geospatial"

    if ext == ".csv":
        try:
            # Quick check for spatial columns
            df = pd.read_csv(file_path, nrows=10)
            lat_names = {"lat", "latitude", "LAT", "LATITUDE", "y", "Y"}
            lon_names = {"lon", "longitude", "lng", "LONGITUDE", "x", "X"}
            has_lat = any(col in lat_names for col in df.columns)
            has_lon = any(col in lon_names for col in df.columns)
            if has_lat and has_lon:
                return "Geospatial"
        except Exception:
            pass

    return "Tabular"


def quote_identifier(identifier: str) -> str:
    """Quote a SQL identifier for DuckDB."""
    escaped = identifier.replace('"', '""')
    return f'"{escaped}"'


def extract_table_references(query: str) -> List[TableReference]:
    """
    Extract structured table references from a SQL query using sqlglot.
    """
    try:
        parsed = parse_one(query, dialect="duckdb")
        references: List[TableReference] = []
        seen: Set[Tuple[Optional[str], str]] = set()

        cte_names: Set[str] = set()
        for cte in parsed.find_all(exp.CTE):
            if cte.alias:
                cte_names.add(cte.alias)

        for node in parsed.find_all(exp.Table):
            table_identifier = node.this
            if not isinstance(table_identifier, exp.Identifier):
                continue

            table_name = table_identifier.this
            # node.db returns the schema/database name as a string (or empty string if not present)
            schema_name = node.db if node.db else None

            if schema_name is None and table_name in cte_names:
                continue

            key = (schema_name, table_name)
            if key in seen:
                continue
            seen.add(key)
            references.append(TableReference(schema=schema_name, name=table_name))

        return references
    except Exception as exc:
        logger.warning("Error parsing query for table references: %s", exc)
        return []


async def resolve_dataset_version(
    dataset_id: str,
    version_spec: Optional[str],
    client: Optional[httpx.AsyncClient] = None,
    access_token: Optional[str] = None,
) -> Tuple[str, str, str]:
    """
    Resolve a dataset reference to a version ID and GCS path.

    Args:
        dataset_id: Dataset ID
        version_spec: Version specifier ("latest", specific version ID, or None)
        cookie: Optional auth cookie for API requests

    Returns:
        Tuple of (dataset_id, version_id, gcs_path)
    """
    owns_client = False
    if client is None:
        client = httpx.AsyncClient(timeout=60)
        owns_client = True

    try:
        if version_spec is None or version_spec.lower() == "latest":
            response = await client.get(
                f"{API_BASE_URL}/datasets/{dataset_id}",
                headers=build_api_headers(access_token),
            )
            response.raise_for_status()
            dataset = response.json()
            version_id = dataset.get("currentVersionId")
            if not version_id:
                raise ValueError(f"Dataset {dataset_id} has no current version")
        else:
            version_id = version_spec

        gcs_path = build_dataset_version_path(dataset_id, version_id)
        return dataset_id, version_id, gcs_path
    finally:
        if owns_client:
            await client.aclose()


async def lookup_version_dataset(
    version_id: str, client: httpx.AsyncClient, access_token: Optional[str] = None
) -> Tuple[str, str, str]:
    """
    Look up which dataset a version belongs to using the version ID alone.

    Args:
        version_id: The version ID to look up
        client: HTTP client for API calls
        cookie: Optional auth cookie for API requests

    Returns:
        Tuple of (dataset_id, version_id, gcs_path)
    """
    response = await client.get(
        f"{API_BASE_URL}/versions/{version_id}",
        headers=build_api_headers(access_token),
    )
    response.raise_for_status()
    data = response.json()
    dataset_id = data["datasetId"]
    gcs_path = build_dataset_version_path(dataset_id, version_id)
    return dataset_id, version_id, gcs_path


async def resolve_table_versions_async(
    refs: Sequence[TableReference], access_token: Optional[str] = None
) -> Dict[TableReference, Tuple[str, str, str]]:
    """Resolve a collection of table references to version metadata.

    Supports three formats:
    - "dataset_id"."version_id" - specific version of a dataset
    - "dataset_id"."latest" - latest version of a dataset
    - "version_id" - bare version ID (looks up which dataset it belongs to)
    """
    if not refs:
        return {}

    async with httpx.AsyncClient(timeout=60) as client:

        async def _resolve(ref: TableReference) -> Tuple[str, str, str]:
            if ref.schema:
                # Schema-qualified: "dataset_id"."version_id" or "dataset_id"."latest"
                return await resolve_dataset_version(
                    ref.schema, ref.name, client, access_token
                )
            else:
                # Bare version ID - look up which dataset it belongs to
                return await lookup_version_dataset(ref.name, client, access_token)

        results = await asyncio.gather(*[_resolve(ref) for ref in refs])
    return {ref: result for ref, result in zip(refs, results)}


def resolve_table_versions_sync(
    refs: Sequence[TableReference], access_token: Optional[str] = None
) -> Dict[TableReference, Tuple[str, str, str]]:
    """Synchronous wrapper for resolving table references."""
    if not refs:
        return {}
    return asyncio.run(resolve_table_versions_async(refs, access_token))


async def resolve_source_version_ids_from_query(
    sql_query: str, access_token: Optional[str] = None
) -> List[str]:
    """Resolve dataset version IDs referenced in a SQL query."""
    refs = extract_table_references(sql_query)
    if not refs:
        return []

    version_map = await resolve_table_versions_async(refs, access_token)
    ordered_ids: List[str] = []
    for ref in refs:
        resolved = version_map.get(ref)
        if resolved:
            _, version_id, _ = resolved
            ordered_ids.append(version_id)

    seen: Set[str] = set()
    deduped: List[str] = []
    for version_id in ordered_ids:
        if version_id not in seen:
            seen.add(version_id)
            deduped.append(version_id)
    return deduped


HEX_DIGITS = set(string.hexdigits)


def _load_geojson_geometry(value: Union[str, dict]) -> Optional[BaseGeometry]:
    try:
        if isinstance(value, str):
            parsed = json.loads(value)
        else:
            parsed = value
        return shape(parsed)
    except Exception:
        return None


def _load_wkb_hex(value: str) -> Optional[BaseGeometry]:
    text = value.strip()
    if text.startswith(("0x", "0X")):
        text = text[2:]
    if len(text) < 16 or len(text) % 2 != 0:
        return None
    if not all(char in HEX_DIGITS for char in text):
        return None
    try:
        return wkb.loads(bytes.fromhex(text))
    except Exception:
        return None


def _convert_str_to_geometry(value: str) -> Optional[BaseGeometry]:
    text = value.strip()
    if not text:
        return None

    upper = text.upper()
    if upper.startswith("SRID="):
        parts = text.split(";", 1)
        text = parts[1] if len(parts) == 2 else text

    try:
        return wkt.loads(text)
    except Exception:
        pass

    geojson_geom = _load_geojson_geometry(text)
    if geojson_geom:
        return geojson_geom

    return _load_wkb_hex(text)


def _convert_value_to_geometry(value) -> Optional[BaseGeometry]:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None

    if isinstance(value, BaseGeometry):
        return value

    if isinstance(value, (bytes, bytearray, memoryview)):
        try:
            return wkb.loads(bytes(value))
        except Exception:
            return None

    if isinstance(value, str):
        return _convert_str_to_geometry(value)

    if hasattr(value, "as_py"):
        try:
            py_value = value.as_py()
        except Exception:
            py_value = None
        if py_value is not None:
            return _convert_value_to_geometry(py_value)

    if isinstance(value, dict):
        return _load_geojson_geometry(value)

    return None


def convert_series_to_geometry(series: pd.Series) -> Optional[gpd.GeoSeries]:
    """Attempt to convert a pandas Series to a GeoSeries based on value types."""
    dtype_str = str(getattr(series, "dtype", "")).lower()
    if dtype_str == "geometry" or isinstance(series, gpd.GeoSeries):
        geo_series = gpd.GeoSeries(series, crs="EPSG:4326")
        geo_series.name = series.name
        return geo_series

    converted = series.apply(_convert_value_to_geometry)
    if converted.notna().any():
        geo_series = gpd.GeoSeries(converted, crs="EPSG:4326")
        geo_series.name = series.name
        return geo_series

    return None


def detect_geometry_series(df: pd.DataFrame) -> Optional[gpd.GeoSeries]:
    """Return the first geometry series found in the DataFrame, if any."""
    if isinstance(df, gpd.GeoDataFrame):
        geometry = df.geometry
        geometry.name = geometry.name or "geometry"
        return geometry

    for col in df.columns:
        geometry_series = convert_series_to_geometry(df[col])
        if geometry_series is not None:
            return geometry_series
    return None


def infer_type_from_dataframe(df: pd.DataFrame) -> str:
    """Infer dataset type based on geometry column presence."""
    return "Geospatial" if detect_geometry_series(df) is not None else "Tabular"


def has_uploaded_files(upload_id: str) -> bool:
    """Check if there are any files in the upload bucket for this upload."""
    prefix = f"{upload_id}/"
    blobs = list(
        storage_client.list_blobs(UPLOADS_BUCKET_NAME, prefix=prefix, max_results=1)
    )
    return len(blobs) > 0


def execute_sql_transform(
    sql_query: str,
    working_dir: Path,
    access_token: Optional[str] = None,
) -> Tuple[pd.DataFrame, str, Set[str]]:
    """
    Execute a SQL transform query.

    Args:
        sql_query: SQL query to execute
        working_dir: Working directory for temporary files
        cookie: Optional auth cookie for API requests

    Returns:
        Tuple of (result_dataframe, inferred_type, source_version_ids)
    """
    logger.info("Executing SQL transform")

    # Extract table references from query
    table_refs = extract_table_references(sql_query)
    logger.info("Found table references: %s", table_refs)

    if not table_refs:
        raise ValueError("No table references found in SQL query")

    # Resolve table references to dataset/version metadata
    version_map = resolve_table_versions_sync(table_refs, access_token)
    logger.info(
        "Resolved table references: %s",
        {(ref.schema, ref.name): version_map.get(ref) for ref in table_refs},
    )

    # Setup DuckDB with spatial extension
    db_path = working_dir / "workspace.db"
    conn = duckdb.connect(str(db_path))

    try:
        # Initialize DuckDB with extensions and GCS credentials
        # Uses the same pattern as the MCP agent (conn.sql with combined script)
        pre_script = build_duckdb_pre_script()
        logger.info("Executing DuckDB pre-script:\n%s", pre_script)
        conn.sql(pre_script)
        logger.info("DuckDB extensions and GCS credentials loaded")

        # Create views for each resolved dataset/version
        # For each unique (dataset_id, version_id), create:
        # 1. Schema-qualified view: "dataset_id"."version_id"
        # 2. Bare version view: "version_id" (in default schema)
        # 3. If "latest" was used: "dataset_id"."latest"
        created_schemas: Set[str] = set()
        created_views: Set[str] = set()

        for ref in table_refs:
            resolved = version_map.get(ref)
            if not resolved:
                logger.warning(
                    "No resolution for ref: schema=%s, name=%s", ref.schema, ref.name
                )
                continue

            dataset_id, version_id, gcs_path = resolved

            # Use gs:// URLs directly - DuckDB with GCS secret handles authentication
            # See: https://duckdb.org/docs/stable/guides/network_cloud_storage/gcs_import
            parquet_select = f"SELECT * FROM read_parquet('{gcs_path}')"

            # Create schema for dataset if not already created
            if dataset_id not in created_schemas:
                schema_identifier = quote_identifier(dataset_id)
                conn.sql(f"CREATE SCHEMA IF NOT EXISTS {schema_identifier};")
                created_schemas.add(dataset_id)
                logger.info("Created schema: %s", dataset_id)

            # 1. Create schema-qualified view: "dataset_id"."version_id"
            qualified_view = (
                f"{quote_identifier(dataset_id)}.{quote_identifier(version_id)}"
            )
            if qualified_view not in created_views:
                view_sql = (
                    f"CREATE OR REPLACE VIEW {qualified_view} AS {parquet_select}"
                )
                logger.info("Creating view SQL: %s", view_sql)
                conn.sql(view_sql)
                created_views.add(qualified_view)
                logger.info("Created view: %s", qualified_view)

            # 2. Create bare version view: "version_id" (in default schema)
            bare_view = quote_identifier(version_id)
            if bare_view not in created_views:
                conn.sql(f"CREATE OR REPLACE VIEW {bare_view} AS {parquet_select}")
                created_views.add(bare_view)
                logger.info("Created view: %s", bare_view)

            # 3. If the reference used "latest", also create "dataset_id"."latest"
            if ref.name.lower() == "latest":
                latest_view = (
                    f"{quote_identifier(dataset_id)}.{quote_identifier('latest')}"
                )
                if latest_view not in created_views:
                    conn.sql(
                        f"CREATE OR REPLACE VIEW {latest_view} AS {parquet_select}"
                    )
                    created_views.add(latest_view)
                    logger.info("Created view: %s", latest_view)

        # Execute the query - keep DuckDB result to inspect column types
        logger.info(
            "Executing query: %s",
            sql_query[:200] + "..." if len(sql_query) > 200 else sql_query,
        )
        result = conn.sql(sql_query)
        logger.info("Query returned %d rows", result.shape[0])

        # Check for geometry column by DuckDB type (like spatial_query does)
        # This must happen BEFORE converting to DataFrame
        geometry_column = None
        for col, dtype in zip(result.columns, result.types):
            dtype_str = str(dtype).upper()
            logger.info("Column %s has DuckDB type: %s", col, dtype_str)
            if dtype_str == "GEOMETRY":
                geometry_column = col
                break

        if geometry_column:
            logger.info("Found geometry column: %s", geometry_column)
            inferred_type = "Geospatial"

            # Export to GeoJSON using DuckDB's GDAL driver (same as spatial_query)
            geojson_path = working_dir / "result.geojson"
            copy_query = (
                f"COPY result TO '{geojson_path}' WITH (FORMAT GDAL, DRIVER 'GeoJSON')"
            )
            conn.sql(copy_query)

            # Read back as GeoDataFrame
            result_df = gpd.read_file(geojson_path)
            logger.info("Loaded GeoDataFrame with %d rows", len(result_df))
        else:
            logger.info("No geometry column found, treating as tabular")
            inferred_type = "Tabular"
            result_df = result.df()

        logger.info("Inferred dataset type: %s", inferred_type)

        # Extract source version IDs for lineage
        source_version_ids = {value[1] for value in version_map.values()}

        return result_df, inferred_type, source_version_ids

    finally:
        conn.close()


def process_tabular_dataset(
    dataset_id: str,
    dataset_version_id: str,
    source_path: Path,
    dataset_name: str,
    working_dir: Path,
) -> Dict[str, object]:
    df = load_tabular_dataframe(source_path)
    records = len(df)

    data_dir = working_dir / "processed" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    parquet_path = data_dir / "block-0.parquet"
    df.to_parquet(parquet_path, compression="snappy", index=False)
    data_key = f"{dataset_id}/{dataset_version_id}/data/{parquet_path.name}"
    upload_file(parquet_path, data_key)

    data_dictionary = asyncio.run(generate_data_dictionary(dataset_name, df))
    columns = data_dictionary["columns"]
    return {
        "datasetId": dataset_id,
        "datasetVersionId": dataset_version_id,
        "records": records,
        "columns": columns,
    }


def validate_and_fix_coordinates(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """
    Validate that GeoDataFrame coordinates are within WGS84 bounds.
    If coordinates appear to be swapped (lat/lon instead of lon/lat), fix them.
    """
    if len(gdf) == 0:
        return gdf

    bounds = gdf.total_bounds  # (minx, miny, maxx, maxy)
    minx, miny, maxx, maxy = bounds
    logger.info(
        "GeoDataFrame bounds: minx=%.4f, miny=%.4f, maxx=%.4f, maxy=%.4f",
        minx,
        miny,
        maxx,
        maxy,
    )

    # Check if coordinates are within valid WGS84 bounds
    # Longitude: -180 to 180, Latitude: -90 to 90
    lon_valid = -180 <= minx <= 180 and -180 <= maxx <= 180
    lat_valid = -90 <= miny <= 90 and -90 <= maxy <= 90

    if lon_valid and lat_valid:
        logger.info("Coordinates are within valid WGS84 bounds")
        return gdf

    # Check if coordinates might be swapped (lat where lon should be and vice versa)
    # This would mean: minx/maxx are latitude values, miny/maxy are longitude values
    swapped_lon_valid = -180 <= miny <= 180 and -180 <= maxy <= 180
    swapped_lat_valid = -90 <= minx <= 90 and -90 <= maxx <= 90

    if swapped_lon_valid and swapped_lat_valid:
        logger.warning(
            "Coordinates appear to be swapped (lat/lon instead of lon/lat). "
            "Applying ST_FlipCoordinates to fix."
        )
        # Use shapely's affine_transform to swap x and y
        from shapely import ops

        gdf = gdf.copy()
        gdf["geometry"] = gdf["geometry"].apply(
            lambda geom: (
                ops.transform(
                    lambda x, y, z=None: (y, x) if z is None else (y, x, z), geom
                )
                if geom
                else geom
            )
        )

        # Log the new bounds
        new_bounds = gdf.total_bounds
        logger.info(
            "Fixed bounds: minx=%.4f, miny=%.4f, maxx=%.4f, maxy=%.4f",
            new_bounds[0],
            new_bounds[1],
            new_bounds[2],
            new_bounds[3],
        )
        return gdf

    logger.warning(
        "Coordinates are out of WGS84 bounds and don't appear to be simply swapped. "
        "minx=%.4f (valid lon: -180 to 180), miny=%.4f (valid lat: -90 to 90), "
        "maxx=%.4f, maxy=%.4f. PMTiles generation may fail.",
        minx,
        miny,
        maxx,
        maxy,
    )
    return gdf


def process_geospatial_dataset(
    dataset_id: str,
    dataset_version_id: str,
    upload_folder: Path,
    main_file: str,
    dataset_name: str,
) -> Dict[str, object]:
    file_path = upload_folder / main_file

    # Validate GeoJSON files for data quality issues
    if main_file.lower().endswith((".geojson", ".json")):
        logger.info("Validating GeoJSON data quality...")
        validation_result = validate_geojson_file(file_path)

        if not validation_result.valid:
            error_msg = format_validation_errors(validation_result)
            logger.error("Data validation failed:\n%s", error_msg)
            raise ValueError(f"Data validation failed:\n\n{error_msg}")

        if validation_result.warnings:
            warning_msg = format_validation_errors(validation_result)
            logger.warning("Data validation warnings:\n%s", warning_msg)

    gdf = load_upload_gdf(upload_folder, main_file)
    records = len(gdf)
    geometry_column = gdf.geometry.name or "geometry"

    # Log CRS info for debugging
    logger.info("GeoDataFrame CRS: %s", gdf.crs)

    # Validate and potentially fix coordinate order issues
    gdf = validate_and_fix_coordinates(gdf)

    # Serialize complex nested columns (dicts, lists) to JSON strings
    # Even though we validate top-level properties, nested objects often have
    # inconsistent schemas that cause PyArrow conversion errors.
    # JSON strings are reliable and still queryable with json_extract functions.
    gdf = serialize_complex_columns(gdf)

    data_dir = upload_folder / "processed" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    geoparquet_paths = asyncio.run(convert_to_geoparquet(gdf, data_dir))
    for path in geoparquet_paths:
        upload_file(path, f"{dataset_id}/{dataset_version_id}/data/{path.name}")

    full_parquet_path = data_dir / "full.parquet"
    gdf.to_parquet(
        full_parquet_path, compression="snappy", geometry_encoding="WKB", index=False
    )
    upload_file(
        full_parquet_path,
        f"{dataset_id}/{dataset_version_id}/data/{full_parquet_path.name}",
    )

    tiles_dir = upload_folder / "processed" / "tiles"
    tiles_dir.mkdir(parents=True, exist_ok=True)
    fgb_path = tiles_dir / "layer.fgb"

    # Filter out NULL geometries for FlatGeobuf/tiles
    # FlatGeobuf doesn't support NULL geometries with spatial indexing
    null_geom_count = gdf.geometry.isna().sum()
    if null_geom_count > 0:
        logger.warning(
            f"Filtering out {null_geom_count} features with NULL geometries before FlatGeobuf export"
        )
        gdf_for_tiles = gdf[~gdf.geometry.isna()].copy()

        if len(gdf_for_tiles) == 0:
            raise ValueError(
                f"All {len(gdf)} features have NULL geometries. "
                "Cannot create tiles without valid geometries."
            )
        logger.info(
            f"Using {len(gdf_for_tiles)} features with valid geometries for tiles"
        )
    else:
        gdf_for_tiles = gdf

    # Ensure CRS is explicitly set to EPSG:4326 for FlatGeobuf/tippecanoe
    if gdf_for_tiles.crs is None:
        logger.warning("Setting CRS to EPSG:4326 before FlatGeobuf export")
        gdf_for_tiles = gdf_for_tiles.set_crs("EPSG:4326")

    gdf_for_tiles.to_file(fgb_path, driver="FlatGeobuf", engine="pyogrio")
    pmtiles_path = tiles_dir / "tiles.pmtiles"
    create_pmtiles(fgb_path, pmtiles_path)
    upload_file(
        pmtiles_path,
        f"{dataset_id}/{dataset_version_id}.pmtiles",
        TILES_BUCKET_NAME,
    )

    data_dictionary = asyncio.run(generate_data_dictionary(dataset_name, gdf))

    return {
        "datasetId": dataset_id,
        "datasetVersionId": dataset_version_id,
        "records": records,
        "columns": data_dictionary["columns"],
    }


def process_upload_locally(
    upload_id: str, request: ProcessUploadRequest
) -> Dict[str, object]:
    """
    Process a file upload request.

    Downloads and processes uploaded files to create a dataset.
    """
    main_file = request.main_file
    dataset_name = request.dataset_name
    dataset_description = request.dataset_description
    is_refresh = (
        isinstance(request.target_dataset_id, str)
        and len(request.target_dataset_id) > 0
    )

    # Generate IDs: use existing dataset_id for refreshes, generate new for new datasets
    dataset_id = request.target_dataset_id if is_refresh else str(uuid4())
    dataset_version_id = str(uuid4())  # Always generate new version ID

    with tempfile.TemporaryDirectory() as temp_dir:
        working_dir = Path(temp_dir)
        download_upload_bundle(upload_id, working_dir)
        actual_main_file = extract_zip_if_needed(working_dir, main_file)

        source_path = resolve_uploaded_file(working_dir, actual_main_file)

        # TODO: always infer the dataset type
        # Geospatial has a geometry column that is actually a geometry (not a string or something)
        if request.dataset_type and request.dataset_type in SUPPORTED_DATASET_TYPES:
            dataset_type = request.dataset_type
        else:
            dataset_type = infer_dataset_type(source_path)

        if dataset_type == "Geospatial":
            stats = process_geospatial_dataset(
                dataset_id,
                dataset_version_id,
                working_dir,
                actual_main_file,
                dataset_name,
            )
        else:
            stats = process_tabular_dataset(
                dataset_id,
                dataset_version_id,
                source_path,
                dataset_name,
                working_dir,
            )

    stats.update(
        {
            "datasetId": dataset_id,
            "datasetVersionId": dataset_version_id,
            "datasetName": dataset_name,
            "datasetDescription": dataset_description,
            "datasetType": (
                dataset_type if dataset_type in SUPPORTED_DATASET_TYPES else "Tabular"
            ),
            "isRefresh": is_refresh,
            "versionName": request.version_name,
            "versionDescription": request.version_description,
        }
    )
    return stats


@app.get("/health")
async def health_check():  #
    return {"status": "ok"}


@app.post("/uploads/{upload_id}")
async def process_upload(
    upload_id: str,
    request: ProcessUploadRequest,
    background_tasks: BackgroundTasks,
    http_request: Request,
):
    """Process a file upload to create a dataset."""
    # Extract bearer token from Authorization header
    auth_header = http_request.headers.get("authorization", "")
    access_token = None
    if auth_header.startswith("Bearer "):
        access_token = auth_header[7:]  # Remove "Bearer " prefix
    background_tasks.add_task(run_upload_pipeline, upload_id, request, access_token)
    return {"status": "accepted"}


@app.post("/transforms")
async def execute_transform(
    request: ExecuteTransformRequest,
    background_tasks: BackgroundTasks,
    http_request: Request,
):
    """Execute a transform to create or update a dataset."""
    # Extract bearer token from Authorization header
    auth_header = http_request.headers.get("authorization", "")
    access_token = None
    if auth_header.startswith("Bearer "):
        access_token = auth_header[7:]  # Remove "Bearer " prefix
    background_tasks.add_task(run_transform_pipeline, request, access_token)
    return {"status": "accepted", "transformId": request.transform_history_id}


async def run_transform_pipeline(
    request: ExecuteTransformRequest, access_token: Optional[str] = None
) -> None:
    """Execute a transform and update dataset."""
    transform_id = request.transform_history_id
    try:
        await update_transform_status(
            transform_id, "running", access_token=access_token
        )

        # Execute the transform
        result = await asyncio.to_thread(
            process_transform_request, request, access_token
        )

        dataset_type = result["datasetType"]
        dataset_id = result["datasetId"]
        normalized_type = dataset_type if dataset_type in ICON_BY_TYPE else "Tabular"

        # Build dataset payload
        dataset_payload: Dict[str, object] = {
            "id": dataset_id,
            "type": normalized_type,
            "records": result["records"],
            "iconName": ICON_BY_TYPE.get(normalized_type, "FileSpreadsheet"),
            "configuration": build_dataset_configuration(result["columns"]),
            "versionLabel": request.dataset_name,
            "versionDescription": request.dataset_description,
            "versionId": result["datasetVersionId"],
            "transformConfig": {
                "version": "v1",
                "type": request.transform_config.type,
                "config": request.transform_config.config,  # Already a dict
            },
        }

        # For new datasets, include name/description
        if request.is_new_dataset:
            dataset_payload["name"] = request.dataset_name
            dataset_payload["description"] = request.dataset_description

        # Add source version IDs for lineage
        source_version_ids = result.get("sourceVersionIds")
        if source_version_ids:
            dataset_payload["sourceVersionIds"] = source_version_ids
            logger.info(
                "Using source version IDs from transform: %s", source_version_ids
            )

        # Create or update dataset via API
        if request.is_new_dataset:
            # Update the placeholder dataset
            await update_dataset_record(dataset_id, dataset_payload, access_token)
        else:
            # Add new version to existing dataset
            await update_dataset_record(dataset_id, dataset_payload, access_token)

        await update_transform_status(
            transform_id, "completed", access_token=access_token
        )
        logger.info("Transform %s completed successfully", transform_id)

    except Exception as exc:
        logger.exception("Transform %s failed", transform_id)
        try:
            await update_transform_status(
                transform_id, "failed", str(exc), access_token
            )
        except Exception as status_error:
            logger.exception(
                "Unable to update transform status %s: %s", transform_id, status_error
            )


def process_transform_request(
    request: ExecuteTransformRequest, access_token: Optional[str] = None
) -> Dict[str, object]:
    """
    Process a transform request.

    Args:
        request: Transform execution request
        access_token: Optional bearer token for API requests

    Returns:
        Processing result dict
    """
    typed_config = request.transform_config.to_typed()
    if not isinstance(typed_config, SQLTransformConfig):
        raise ValueError(f"Unsupported transform type: {request.transform_config.type}")

    sql_query = typed_config.config.query

    dataset_id = request.dataset_id
    dataset_name = request.dataset_name
    dataset_description = request.dataset_description
    dataset_version_id = str(uuid4())

    with tempfile.TemporaryDirectory() as temp_dir:
        working_dir = Path(temp_dir)

        # Execute SQL transform
        result_df, _, source_version_ids = execute_sql_transform(
            sql_query, working_dir, access_token
        )

        geometry_series = detect_geometry_series(result_df)
        geospatial_df: Optional[gpd.GeoDataFrame] = None

        if geometry_series is not None:
            dataset_type = "Geospatial"
            if isinstance(result_df, gpd.GeoDataFrame):
                geospatial_df = result_df
            else:
                geospatial_df = gpd.GeoDataFrame(
                    result_df.copy(),
                    geometry=geometry_series,
                    crs=geometry_series.crs or "EPSG:4326",
                )
        else:
            dataset_type = "Tabular"

        if dataset_type == "Geospatial" and geospatial_df is None:
            logger.warning(
                "Unable to determine geometry column from SQL result; falling back to tabular dataset."
            )
            dataset_type = "Tabular"

        # Validate and fix coordinates for geospatial data
        if dataset_type == "Geospatial" and geospatial_df is not None:
            geospatial_df = validate_and_fix_coordinates(geospatial_df)

        # Save result and process
        if dataset_type == "Geospatial" and geospatial_df is not None:
            result_path = working_dir / "result.geojson"
            geospatial_df.to_file(result_path, driver="GeoJSON")

            stats = process_geospatial_dataset(
                dataset_id,
                dataset_version_id,
                working_dir,
                "result.geojson",
                dataset_name,
            )
        else:
            result_path = working_dir / "result.csv"
            result_df.to_csv(result_path, index=False)

            stats = process_tabular_dataset(
                dataset_id,
                dataset_version_id,
                result_path,
                dataset_name,
                working_dir,
            )
            dataset_type = "Tabular"

    stats.update(
        {
            "datasetId": dataset_id,
            "datasetVersionId": dataset_version_id,
            "datasetName": dataset_name,
            "datasetDescription": dataset_description,
            "datasetType": dataset_type,
            "sourceVersionIds": list(source_version_ids),
        }
    )

    return stats


async def run_upload_pipeline(
    upload_id: str, request: ProcessUploadRequest, access_token: Optional[str] = None
) -> None:
    """Process a file upload to create a dataset."""
    try:
        await update_upload_status(upload_id, "processing", access_token=access_token)
        result = await asyncio.to_thread(process_upload_locally, upload_id, request)
        dataset_type = result["datasetType"]
        dataset_id = result["datasetId"]
        normalized_type = dataset_type if dataset_type in ICON_BY_TYPE else "Tabular"
        is_refresh = result.get("isRefresh")
        version_label = result.get("versionName")
        if not version_label and not is_refresh:
            version_label = result["datasetName"]
        version_description = result.get("versionDescription")
        if version_description is None and not is_refresh:
            version_description = result.get("datasetDescription")
        dataset_payload: Dict[str, object] = {
            "id": dataset_id,
            "type": normalized_type,
            "records": result["records"],
            "iconName": ICON_BY_TYPE.get(normalized_type, "FileSpreadsheet"),
            "configuration": build_dataset_configuration(result["columns"]),
            "versionLabel": version_label,
            "versionDescription": version_description,
            "versionId": result["datasetVersionId"],
        }

        if not is_refresh:
            dataset_payload["name"] = result["datasetName"]
            dataset_payload["description"] = result.get("datasetDescription")

        # Attach transform config metadata and derive lineage automatically
        if request.transform_config:
            dataset_payload["transformConfig"] = {
                "version": "v1",
                "type": request.transform_config.type,
                "config": request.transform_config.config,  # Already a dict
            }
            if request.transform_config.type == "sql":
                typed_config = request.transform_config.to_typed()
                if isinstance(typed_config, SQLTransformConfig):
                    sql_query = typed_config.config.query
                    if sql_query.strip():
                        lineage_ids = await resolve_source_version_ids_from_query(
                            sql_query, access_token
                        )
                        if lineage_ids:
                            dataset_payload["sourceVersionIds"] = lineage_ids

        if is_refresh:
            await update_dataset_record(dataset_id, dataset_payload, access_token)
        else:
            await create_dataset_record(dataset_payload, access_token)

        await update_upload_status(upload_id, "completed", access_token=access_token)
        logger.info("Upload %s completed successfully", upload_id)
    except Exception as exc:
        logger.exception("Upload %s failed", upload_id)
        try:
            await update_upload_status(upload_id, "failed", str(exc), access_token)
        except Exception as status_error:
            logger.exception(
                "Unable to update status for upload %s: %s", upload_id, status_error
            )
