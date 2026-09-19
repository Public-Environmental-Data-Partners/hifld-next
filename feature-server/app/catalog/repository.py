"""Read-only SQLite validation and narrowly typed catalog access."""

from __future__ import annotations

import hashlib
import re
import sqlite3
from dataclasses import dataclass, replace
from pathlib import Path

from pydantic import TypeAdapter, ValidationError

CATALOG_APPLICATION_ID = 1212761676
SUPPORTED_CATALOG_SCHEMA_VERSIONS = frozenset({1, 2})


class CatalogValidationError(ValueError):
    """The downloaded catalog cannot be activated."""


@dataclass(frozen=True, slots=True)
class SpatialResourceRecord:
    collection_slug: str
    dataset_slug: str
    file_slug: str
    version_label: str
    collection_href: str
    crs84_bbox: tuple[float, float, float, float]
    native_crs: str
    geometry_column: str
    feature_count: int
    is_latest: bool
    title: str
    description: str
    asset_key: str
    asset_checksum: str
    storage_slug: str
    storage_href: str
    object_keys: tuple[str, ...]
    feature_id_column: str | None
    fields: dict[str, dict[str, str]]
    dataset_title: str = ""


_bbox = TypeAdapter(tuple[float, float, float, float])
_objects = TypeAdapter(tuple[str, ...])
_checksums = TypeAdapter(tuple[str, ...])
_fields = TypeAdapter(dict[str, dict[str, str]])
_sha256 = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True, slots=True)
class SQLiteCatalogRepository:
    path: Path
    generation: str

    @classmethod
    def open(cls, path: Path) -> SQLiteCatalogRepository:
        connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            app_id = connection.execute("PRAGMA application_id").fetchone()
            user_version = connection.execute("PRAGMA user_version").fetchone()
            quick_check = connection.execute("PRAGMA quick_check").fetchone()
            if app_id != (CATALOG_APPLICATION_ID,) or user_version is None:
                raise CatalogValidationError("unsupported catalog SQLite format")
            schema_version = user_version[0]
            if schema_version not in SUPPORTED_CATALOG_SCHEMA_VERSIONS:
                raise CatalogValidationError("unsupported catalog SQLite format")
            if quick_check != ("ok",):
                raise CatalogValidationError("catalog SQLite quick_check failed")
            metadata = connection.execute(
                "SELECT schema_version, catalog_generation "
                "FROM catalog_metadata WHERE singleton = 1"
            ).fetchone()
            if (
                metadata is None
                or metadata[0] != schema_version
                or not isinstance(metadata[1], str)
            ):
                raise CatalogValidationError("catalog metadata is invalid")
            if schema_version == 2:
                columns = {
                    row[1]
                    for row in connection.execute("PRAGMA table_info(assets)")
                    if isinstance(row[1], str)
                }
                object_columns = {
                    row[1]
                    for row in connection.execute("PRAGMA table_info(asset_objects)")
                    if isinstance(row[1], str)
                }
                if not {"sha256", "checksum_multihash"}.issubset(columns) or not {
                    "sha256",
                    "checksum_multihash",
                }.issubset(object_columns):
                    raise CatalogValidationError(
                        "catalog schema version 2 integrity columns missing"
                    )
            return cls(path=path, generation=metadata[1])
        except sqlite3.Error as error:
            raise CatalogValidationError("catalog SQLite validation failed") from error
        finally:
            connection.close()

    def connect(self) -> sqlite3.Connection:
        return sqlite3.connect(f"file:{self.path}?mode=ro", uri=True)

    def read_spatial_versions(self) -> tuple[SpatialResourceRecord, ...]:
        connection = self.connect()
        asset_columns = {
            row[1]
            for row in connection.execute("PRAGMA table_info(assets)")
            if isinstance(row[1], str)
        }
        object_columns = {
            row[1]
            for row in connection.execute("PRAGMA table_info(asset_objects)")
            if isinstance(row[1], str)
        }
        asset_checksum = (
            "COALESCE(a.sha256, a.checksum_multihash)"
            if "checksum_multihash" in asset_columns
            else "a.sha256"
        )
        object_checksum = (
            "COALESCE(ao.sha256, ao.checksum_multihash, '')"
            if "checksum_multihash" in object_columns
            else "COALESCE(ao.sha256, '')"
        )
        query = f"""
        SELECT c.collection_slug, d.dataset_slug, f.file_slug, v.version_label,
               v.collection_href, v.crs84_bbox_json, v.native_crs, v.geometry_column,
               v.feature_count, v.is_latest, f.title, f.description, a.asset_key,
               {asset_checksum}, al.storage_slug, al.href,
               (SELECT json_group_array(ao.object_key)
                  FROM asset_objects ao
                 WHERE ao.asset_path = a.asset_path
                   AND ao.asset_location_path = al.asset_location_path),
               (SELECT json_group_array({object_checksum})
                  FROM asset_objects ao
                 WHERE ao.asset_path = a.asset_path
                   AND ao.asset_location_path = al.asset_location_path),
               (SELECT json_group_array(COALESCE(ao.storage_revision, ''))
                  FROM asset_objects ao
                 WHERE ao.asset_path = a.asset_path
                   AND ao.asset_location_path = al.asset_location_path),
               v.feature_id_column,
               (SELECT json_group_object(
                           col.name,
                           json_object('type', CASE
                               WHEN upper(col.data_type) LIKE '%INT%' THEN 'integer'
                               WHEN upper(col.data_type) IN
                                    ('REAL', 'FLOAT', 'DOUBLE', 'DECIMAL', 'NUMERIC')
                               THEN 'number'
                               WHEN upper(col.data_type) IN ('BOOL', 'BOOLEAN') THEN 'boolean'
                               ELSE 'string'
                           END)
                       )
                  FROM columns col
                 WHERE col.version_path = v.version_path
                   AND col.is_geometry = 0), d.title
        FROM files f
        JOIN datasets d ON d.dataset_path = f.dataset_path
        JOIN collections c ON c.collection_path = d.collection_path
        JOIN versions v ON v.file_path = f.file_path
        JOIN assets a ON a.version_path = v.version_path AND a.format_key = 'geoparquet'
        JOIN asset_locations al ON al.asset_path = a.asset_path AND al.is_canonical = 1
        WHERE v.spatial_status = 'spatial'
        ORDER BY c.collection_slug, d.dataset_slug, f.file_slug, v.version_label
        """
        try:
            records: list[SpatialResourceRecord] = []
            for row in connection.execute(query):
                try:
                    bbox = _bbox.validate_json(_required_str(row[5], "CRS84 bbox"), strict=True)
                    objects = _objects.validate_json(
                        _required_str(row[16], "asset objects"), strict=True
                    )
                    object_checksums = _checksums.validate_json(
                        _required_str(row[17], "asset object checksums"), strict=True
                    )
                    revisions = _checksums.validate_json(
                        _required_str(row[18], "asset object revisions"), strict=True
                    )
                    fields = _fields.validate_json(
                        _required_str(row[20], "column fields"), strict=True
                    )
                except ValidationError as error:
                    raise CatalogValidationError("catalog spatial record is invalid") from error
                records.append(
                    SpatialResourceRecord(
                        collection_slug=_required_str(row[0], "collection slug"),
                        dataset_slug=_required_str(row[1], "dataset slug"),
                        file_slug=_required_str(row[2], "file slug"),
                        version_label=_required_str(row[3], "version label"),
                        collection_href=_required_str(row[4], "collection href"),
                        crs84_bbox=bbox,
                        native_crs=_required_str(row[6], "native CRS"),
                        geometry_column=_required_str(row[7], "geometry column"),
                        feature_count=_required_int(row[8], "feature count"),
                        is_latest=_required_int(row[9], "latest flag") == 1,
                        title=_required_str(row[10], "title"),
                        description=_required_str(row[11], "description"),
                        asset_key=_required_str(row[12], "asset key"),
                        asset_checksum=_asset_fingerprint(
                            row[13],
                            _required_str(row[14], "storage slug"),
                            _required_str(row[15], "storage href"),
                            objects,
                            object_checksums,
                            revisions,
                        ),
                        storage_slug=_required_str(row[14], "storage slug"),
                        storage_href=_required_str(row[15], "storage href"),
                        object_keys=objects,
                        feature_id_column=row[19] if isinstance(row[19], str) else None,
                        fields=fields,
                        dataset_title=_required_str(row[21], "dataset title"),
                    )
                )
            return _merge_spatial_records(tuple(records))
        except sqlite3.Error as error:
            raise CatalogValidationError("catalog spatial query failed") from error
        finally:
            connection.close()


def _required_str(value: object, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise CatalogValidationError(f"catalog {field} is invalid")
    return value


def _required_int(value: object, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise CatalogValidationError(f"catalog {field} is invalid")
    return value


def _asset_fingerprint(
    value: object,
    storage_slug: str,
    storage_href: str,
    object_keys: tuple[str, ...],
    object_checksums: tuple[str, ...],
    object_revisions: tuple[str, ...],
) -> str:
    """Return a version-bound fingerprint, including source MD5 when available."""
    if isinstance(value, str) and _sha256.fullmatch(value):
        return value
    if (
        len(object_keys) != len(object_checksums)
        or len(object_keys) != len(object_revisions)
        or not object_keys
    ):
        raise CatalogValidationError("catalog asset fingerprint inputs are invalid")
    material = "\0".join(
        (storage_slug, storage_href, *object_keys, *object_checksums, *object_revisions)
    ).encode()
    return hashlib.sha256(material).hexdigest()


def _merge_spatial_records(
    records: tuple[SpatialResourceRecord, ...],
) -> tuple[SpatialResourceRecord, ...]:
    merged: dict[tuple[str, str, str, str, str], SpatialResourceRecord] = {}
    for record in records:
        key = (
            record.collection_slug,
            record.dataset_slug,
            record.file_slug,
            record.version_label,
            record.storage_slug,
        )
        previous = merged.get(key)
        if previous is None:
            merged[key] = record
            continue
        if previous.object_keys == record.object_keys:
            continue
        objects = tuple(dict.fromkeys((*previous.object_keys, *record.object_keys)))
        merge_material = "\0".join(
            (
                previous.storage_slug,
                previous.storage_href,
                *objects,
                previous.asset_checksum,
                record.asset_checksum,
            )
        ).encode()
        merged[key] = replace(
            previous,
            object_keys=objects,
            asset_checksum=hashlib.sha256(merge_material).hexdigest(),
        )
    return tuple(merged.values())


# Compatibility name for bootstrap/lifecycle code; projection depends on the
# neutral reader protocol rather than this SQLite implementation.
CatalogRepository = SQLiteCatalogRepository
