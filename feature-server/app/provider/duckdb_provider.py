"""Bounded DuckDB provider over catalog-approved GeoParquet only."""

from __future__ import annotations

import os
import re
from urllib.parse import urlsplit

import duckdb
from pydantic import TypeAdapter, ValidationError
from pygeoapi.provider.base import BaseProvider, ProviderItemNotFoundError, ProviderQueryError

from app.provider.ids import FeatureId, FeatureIdError
from app.storage.gcs import GCSStoragePolicy, GCSStoragePolicyError
from app.storage.seaweedfs import SeaweedFSStoragePolicy, StoragePolicyError

_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
type JsonScalar = None | bool | int | float | str
type JsonValue = JsonScalar | list[JsonValue] | dict[str, JsonValue]


_string_list = TypeAdapter(list[str])
_json_value: TypeAdapter[JsonValue] = TypeAdapter(JsonValue)
_bbox_values = TypeAdapter(list[float])
_row_number = TypeAdapter(int)
_property_values = TypeAdapter(list[tuple[str, str]])
_catalog_fields = TypeAdapter(dict[str, dict[str, str]])


def _quote(value: str) -> str:
    if _IDENTIFIER.fullmatch(value) is None:
        raise ProviderQueryError("catalog contains an unsafe column name")
    return f'"{value}"'


def _bbox(value: object) -> list[float]:
    try:
        return _bbox_values.validate_python(value, strict=True)
    except ValidationError as error:
        raise ProviderQueryError("invalid query") from error


def _properties(value: object) -> list[tuple[str, str]]:
    try:
        return _property_values.validate_python(value, strict=True)
    except ValidationError as error:
        raise ProviderQueryError("invalid query") from error


def _gcs_https(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme == "gs" and parsed.netloc and parsed.path.startswith("/"):
        return f"https://storage.googleapis.com/{parsed.netloc}{parsed.path}"
    if (
        parsed.scheme == "https"
        and parsed.netloc == "storage.googleapis.com"
        and parsed.path.count("/") >= 2
        and not parsed.query
        and not parsed.fragment
    ):
        return value
    raise ValueError("catalog GCS source is invalid")


class DuckDBGeoParquetProvider(BaseProvider):
    def __init__(self, provider_def: dict[str, str]) -> None:
        super().__init__(provider_def)
        self._fields: dict[str, dict[str, str]] | None = None
        self._asset_key = provider_def["asset_key"]
        self._checksum = provider_def["asset_checksum"]
        self._native_id_column = provider_def.get("feature_id_column")
        self._geometry_column = provider_def.get("geometry_column", "geometry")
        configured_crs = provider_def.get(
            "native_crs", provider_def.get("storage_crs", "EPSG:4326")
        )
        self._storage_crs = (
            f"EPSG:{configured_crs.rsplit('/', 1)[-1]}"
            if configured_crs.startswith("http://www.opengis.net/def/crs/EPSG/")
            else configured_crs
        )
        objects_json = provider_def.get("objects_json")
        if objects_json is None:
            self._logical_objects = (self.data,)
            source_uris = (self.data,)
        else:
            self._logical_objects = tuple(_string_list.validate_json(objects_json))
            source_uris = tuple(
                _string_list.validate_json(provider_def.get("source_uris_json", objects_json))
            )
        if not self._logical_objects or len(self._logical_objects) != len(source_uris):
            raise ValueError("catalog GeoParquet objects are invalid")
        self._seaweed_endpoint = provider_def.get("seaweed_endpoint")
        self._uses_gcs = all(
            object_uri.startswith("gs://")
            or object_uri.startswith("https://storage.googleapis.com/")
            for object_uri in source_uris
        )
        self._uses_s3 = self._seaweed_endpoint is not None
        fields_json = provider_def.get("fields_json")
        if fields_json is not None:
            try:
                self._fields = _catalog_fields.validate_json(fields_json, strict=True)
            except ValidationError as error:
                raise ValueError("catalog field metadata is invalid") from error
        if self._uses_gcs:
            self._objects = tuple(_gcs_https(object_uri) for object_uri in source_uris)
        elif self._uses_s3:
            self._objects = source_uris
        else:
            self._objects = source_uris

    @property
    def fields(self) -> dict[str, dict[str, str]]:
        return self.get_fields()

    def get_fields(self) -> dict[str, dict[str, str]]:
        if self._fields is None:
            with self._connection() as connection:
                description = connection.execute(
                    "SELECT * FROM read_parquet(?) LIMIT 0", [list(self._objects)]
                ).description
            self._fields = {}
            for field in description:
                name, native_type = str(field[0]), str(field[1]).upper()
                if name == self._geometry_column:
                    continue
                if native_type.endswith("[]"):
                    field_type = "array"
                elif native_type.startswith(("STRUCT", "MAP")):
                    field_type = "object"
                elif "INT" in native_type:
                    field_type = "integer"
                elif native_type.startswith(("FLOAT", "DOUBLE", "DECIMAL")):
                    field_type = "number"
                elif native_type == "BOOLEAN":
                    field_type = "boolean"
                else:
                    field_type = "string"
                self._fields[name] = {"type": field_type}
        return self._fields

    def get_schema(self, schema_type: str = "item") -> tuple[str, dict[str, JsonValue]]:
        del schema_type
        return "application/schema+json", {"type": "object"}

    def _connection(self) -> duckdb.DuckDBPyConnection:
        connection = duckdb.connect(":memory:")
        try:
            connection.execute("SET autoinstall_known_extensions = false")
            connection.execute("SET autoload_known_extensions = false")
            extension_directory = os.environ.get("DUCKDB_EXTENSION_DIRECTORY")
            if extension_directory:
                connection.execute("SET extension_directory = ?", [extension_directory])
            connection.execute("LOAD spatial")
            connection.execute("SET threads = 1")
            connection.execute("SET memory_limit = '512MiB'")
            temp_directory = os.environ.get("FEATURE_SERVER_TEMP_DIRECTORY")
            if temp_directory:
                connection.execute("SET temp_directory = ?", [temp_directory])
                connection.execute("SET max_temp_directory_size = '1GiB'")
            if self._uses_s3:
                endpoint = self._seaweed_endpoint
                first = urlsplit(self._objects[0])
                if endpoint is None or first.scheme != "s3" or not first.netloc:
                    raise StoragePolicyError("SeaweedFS catalog source is invalid")
                policy = SeaweedFSStoragePolicy(endpoint=endpoint, bucket=first.netloc, prefix="")
                policy.approved_objects(self._objects)
                policy.configure(connection)
            elif self._uses_gcs:
                GCSStoragePolicy.configure(connection)
            return connection
        except (duckdb.Error, GCSStoragePolicyError, StoragePolicyError):
            connection.close()
            raise

    def _run(
        self,
        offset: int,
        limit: int,
        bbox: list[float],
        properties: list[tuple[str, str]],
        identifier: str | None = None,
        *,
        include_count: bool = True,
        include_page: bool = True,
    ) -> tuple[list[dict[str, JsonValue]], int]:
        physical = self._native_id_column is None
        source = f"read_parquet(?{', filename=true, file_row_number=true' if physical else ''})"
        connection = self._connection()
        try:
            description = connection.execute(
                f"SELECT * FROM {source} LIMIT 0", [list(self._objects)]
            ).description
            columns = {str(item[0]) for item in description}
            geometry_item = next(
                (item for item in description if str(item[0]) == self._geometry_column), None
            )
            clauses: list[str] = []
            params: list[object] = []
            if bbox:
                if len(bbox) != 4 or self._geometry_column not in columns:
                    raise ProviderQueryError("invalid bbox")
                geometry_sql = (
                    _quote(self._geometry_column)
                    if geometry_item is not None
                    and str(geometry_item[1]).upper().startswith("GEOMETRY")
                    else f"ST_GeomFromWKB({_quote(self._geometry_column)})"
                )
                clauses.append(
                    f"ST_Intersects({geometry_sql}, "
                    "ST_Transform(ST_MakeEnvelope(?, ?, ?, ?), 'EPSG:4326', ?, true))"
                )
                params.extend([*bbox, self._storage_crs])
            for name, value in properties:
                if name not in columns:
                    raise ProviderQueryError("unknown property filter")
                clauses.append(f"{_quote(name)} = ?")
                params.append(value)
            if identifier is not None:
                if physical:
                    decoded = FeatureId.decode(identifier)
                    if decoded.asset_key != self._asset_key or decoded.checksum != self._checksum:
                        raise ProviderItemNotFoundError("feature was not found")
                    clauses.extend(["filename = ?", "file_row_number = ?"])
                    expected_path = next(
                        (
                            object_uri
                            for logical_key, object_uri in zip(
                                self._logical_objects, self._objects, strict=True
                            )
                            if logical_key == decoded.relative_path
                        ),
                        None,
                    )
                    if expected_path is None:
                        raise ProviderItemNotFoundError("feature was not found")
                    params.extend([expected_path, decoded.row_number])
                else:
                    if self._native_id_column not in columns:
                        raise ProviderItemNotFoundError("feature was not found")
                    clauses.append(f"CAST({_quote(self._native_id_column)} AS VARCHAR) = ?")
                    params.append(identifier)
            where = " AND ".join(clauses) if clauses else "TRUE"
            count = 0
            if include_count:
                count_row = connection.execute(
                    f"SELECT count(*) FROM {source} WHERE {where}", [list(self._objects), *params]
                ).fetchone()
                if count_row is None:
                    raise ProviderQueryError("count query returned no result")
                count = int(count_row[0])
            rows: list[tuple[object, ...]] = []
            names: list[str] = []
            if include_page:
                geometry = (
                    _quote(self._geometry_column)
                    if geometry_item is not None
                    and str(geometry_item[1]).upper().startswith("GEOMETRY")
                    else f"ST_GeomFromWKB({_quote(self._geometry_column)})"
                )
                order = (
                    " ORDER BY filename, file_row_number"
                    if physical
                    else f" ORDER BY {_quote(self._native_id_column or '')}"
                )
                sql = (
                    f"SELECT *, ST_AsGeoJSON(ST_Transform({geometry}, ?, 'EPSG:4326', true)) "
                    f"AS __fs_geometry FROM {source} WHERE {where}{order} LIMIT ? OFFSET ?"
                )
                rows = connection.execute(
                    sql, [self._storage_crs, list(self._objects), *params, limit, offset]
                ).fetchall()
                names = [str(item[0]) for item in connection.description]
        except FeatureIdError as error:
            raise ProviderItemNotFoundError("feature was not found") from error
        except (duckdb.Error, StoragePolicyError) as error:
            raise ProviderQueryError("approved GeoParquet query could not be executed") from error
        finally:
            connection.close()
        features: list[dict[str, JsonValue]] = []
        for row in rows:
            values = dict(zip(names, row, strict=True))
            if physical:
                source_path = str(values["filename"])
                if self._uses_s3 or self._uses_gcs:
                    source_path = next(
                        (
                            logical_key
                            for logical_key, object_uri in zip(
                                self._logical_objects, self._objects, strict=True
                            )
                            if object_uri == source_path
                        ),
                        source_path,
                    )
                elif source_path.startswith("/"):
                    source_path = source_path.rsplit("/", 1)[-1]
                feature_id = FeatureId(
                    self._asset_key,
                    source_path,
                    self._checksum,
                    _row_number.validate_python(values["file_row_number"], strict=True),
                ).encode()
            else:
                native_id_column = self._native_id_column
                if native_id_column is None:
                    raise ProviderQueryError("native feature identifier is missing")
                feature_id = str(values[native_id_column])
            geometry_value = values.pop("__fs_geometry")
            features.append(
                {
                    "type": "Feature",
                    "id": feature_id,
                    "properties": {
                        name: _json_value.validate_python(value)
                        for name, value in values.items()
                        if name not in {self._geometry_column}
                        and (not physical or name not in {"filename", "file_row_number"})
                    },
                    "geometry": _json_value.validate_json(geometry_value)
                    if isinstance(geometry_value, str)
                    else None,
                }
            )
        return features, int(count)

    def query(
        self, offset: int = 0, limit: int = 10, resulttype: str = "results", **kwargs: object
    ) -> dict[str, JsonValue]:
        if offset < 0 or limit < 1 or limit > 1000:
            raise ProviderQueryError("invalid query")
        bbox = _bbox(kwargs.get("bbox", []))
        properties = _properties(kwargs.get("properties", []))
        features, count = self._run(
            offset, limit, bbox, properties, include_page=resulttype != "hits"
        )
        feature_values: list[JsonValue] = []
        feature_values.extend(features)
        result: dict[str, JsonValue] = {
            "type": "FeatureCollection",
            "numberMatched": count,
            "numberReturned": 0 if resulttype == "hits" else len(features),
            "features": [] if resulttype == "hits" else feature_values,
        }
        return result

    def get(self, identifier: str, **kwargs: object) -> dict[str, JsonValue]:
        features, _ = self._run(0, 1, [], [], identifier, include_count=False)
        if not features:
            raise ProviderItemNotFoundError("feature was not found")
        return features[0]
