-- Generated from the canonical publisher; do not hand-edit the schema or seed rows.
-- Provenance: generated with dagster_hifld.portolan.catalog.build_catalog_sqlite
-- from src/dagster_hifld/portolan/catalog.py and its adjacent catalog_schema.sql,
-- then exported with sqlite3.Connection.iterdump(). The CatalogRecord values are
-- mirrored by test_asgi_catalog_integration.py; only volatile created_at values
-- were normalized and FTS shadow-table rows omitted for a small deterministic dump.
PRAGMA application_id = 1212761676;
PRAGMA user_version = 1;
PRAGMA foreign_keys = ON;

CREATE TABLE catalog_metadata (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    catalog_generation TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    portolan_profile_uri TEXT NOT NULL,
    root_href TEXT NOT NULL,
    root_title TEXT NOT NULL
) STRICT;
CREATE TABLE collections (
    collection_path TEXT PRIMARY KEY,
    collection_slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    catalog_href TEXT NOT NULL UNIQUE,
    license_href TEXT,
    created_at TEXT,
    updated_at TEXT
) STRICT;
CREATE TABLE datasets (
    dataset_path TEXT PRIMARY KEY,
    collection_path TEXT NOT NULL REFERENCES collections(collection_path),
    dataset_slug TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    catalog_href TEXT NOT NULL UNIQUE,
    created_at TEXT,
    updated_at TEXT,
    UNIQUE (collection_path, dataset_slug)
) STRICT;
CREATE TABLE files (
    file_path TEXT PRIMARY KEY,
    dataset_path TEXT NOT NULL REFERENCES datasets(dataset_path),
    file_slug TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    catalog_href TEXT NOT NULL UNIQUE,
    latest_version TEXT,
    created_at TEXT,
    updated_at TEXT,
    UNIQUE (dataset_path, file_slug)
) STRICT;
CREATE TABLE versions (
    version_path TEXT PRIMARY KEY,
    file_path TEXT NOT NULL REFERENCES files(file_path),
    version_label TEXT NOT NULL,
    collection_href TEXT NOT NULL UNIQUE,
    created_at TEXT,
    updated_at TEXT,
    spatial_status TEXT NOT NULL CHECK (spatial_status IN ('spatial', 'all_null_geometry', 'non_spatial_source')),
    native_bbox_json TEXT,
    crs84_bbox_json TEXT,
    native_crs TEXT,
    geometry_column TEXT,
    geometry_type TEXT,
    feature_id_column TEXT,
    feature_count INTEGER NOT NULL CHECK (feature_count >= 0),
    is_latest INTEGER NOT NULL CHECK (is_latest IN (0, 1)),
    UNIQUE (file_path, version_label)
) STRICT;
CREATE UNIQUE INDEX versions_one_latest_per_file ON versions(file_path) WHERE is_latest = 1;
CREATE TABLE formats (
    format_key TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    media_type TEXT NOT NULL UNIQUE,
    is_spatial INTEGER NOT NULL CHECK (is_spatial IN (0, 1))
) STRICT;
CREATE TABLE assets (
    asset_path TEXT PRIMARY KEY,
    version_path TEXT NOT NULL REFERENCES versions(version_path),
    asset_key TEXT NOT NULL,
    format_key TEXT NOT NULL REFERENCES formats(format_key),
    title TEXT NOT NULL,
    href TEXT NOT NULL,
    media_type TEXT NOT NULL,
    roles_json TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    sha256 TEXT NOT NULL,
    UNIQUE (version_path, asset_key)
) STRICT;
CREATE TABLE asset_locations (
    asset_location_path TEXT PRIMARY KEY,
    asset_path TEXT NOT NULL REFERENCES assets(asset_path),
    storage_slug TEXT NOT NULL,
    href TEXT NOT NULL,
    is_canonical INTEGER NOT NULL CHECK (is_canonical IN (0, 1)),
    UNIQUE (asset_path, storage_slug)
) STRICT;
CREATE UNIQUE INDEX asset_locations_one_canonical ON asset_locations(asset_path) WHERE is_canonical = 1;
CREATE TABLE asset_objects (
    asset_object_path TEXT PRIMARY KEY,
    asset_path TEXT NOT NULL REFERENCES assets(asset_path),
    asset_location_path TEXT NOT NULL REFERENCES asset_locations(asset_location_path),
    object_key TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    sha256 TEXT NOT NULL,
    storage_revision TEXT,
    partition_json TEXT,
    covering_json TEXT,
    native_bbox_json TEXT,
    crs84_bbox_json TEXT,
    UNIQUE (asset_location_path, relative_path)
) STRICT;
CREATE TABLE columns (
    column_path TEXT PRIMARY KEY,
    version_path TEXT NOT NULL REFERENCES versions(version_path),
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    name TEXT NOT NULL,
    data_type TEXT NOT NULL,
    description TEXT,
    nullable INTEGER NOT NULL CHECK (nullable IN (0, 1)),
    is_geometry INTEGER NOT NULL CHECK (is_geometry IN (0, 1)),
    null_count INTEGER,
    unique_count INTEGER,
    min_value TEXT,
    max_value TEXT,
    statistics_json TEXT,
    UNIQUE (version_path, ordinal),
    UNIQUE (version_path, name)
) STRICT;
CREATE TABLE quality (
    version_path TEXT PRIMARY KEY REFERENCES versions(version_path),
    manifest_href TEXT NOT NULL,
    passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
    invalid_geometry_count INTEGER NOT NULL CHECK (invalid_geometry_count >= 0),
    null_geometry_count INTEGER NOT NULL CHECK (null_geometry_count >= 0),
    columns_hash TEXT NOT NULL
) STRICT;
CREATE TABLE tags (
    tag_path TEXT PRIMARY KEY,
    entity_path TEXT NOT NULL,
    tag_key TEXT NOT NULL,
    tag_value TEXT NOT NULL,
    UNIQUE (entity_path, tag_key, tag_value)
) STRICT;
CREATE INDEX tags_entity_path ON tags(entity_path);
CREATE VIRTUAL TABLE dataset_fts USING fts5(
    dataset_path UNINDEXED, title, description, tags, slug,
    tokenize = 'unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE file_fts USING fts5(
    file_path UNINDEXED, title, description, tags, slug,
    tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO catalog_metadata VALUES (1, 1, 'publisher-generation', '2026-09-08T00:00:00Z', 'https://portolan.dev/profile/0.2', 'catalog.json', 'HIFLD catalog');
INSERT INTO collections VALUES ('hifld', 'hifld', 'hifld', 'HIFLD collection', 'hifld/catalog.json', NULL, '2026-09-08T00:00:00Z', '2026-09-08T00:00:00Z');
INSERT INTO datasets VALUES ('hifld/sample', 'hifld', 'sample', 'Sample points', 'Publisher-built integration fixture', 'hifld/sample/catalog.json', '2026-09-08T00:00:00Z', '2026-09-08T00:00:00Z');
INSERT INTO files VALUES ('hifld/sample/points', 'hifld/sample', 'points', 'Sample points', 'Publisher-built integration fixture', 'hifld/sample/points/catalog.json', 'v1.0.0', '2026-09-08T00:00:00Z', '2026-09-08T00:00:00Z');
INSERT INTO formats VALUES ('geoparquet', 'Geoparquet', 'application/vnd.apache.parquet', 1);
INSERT INTO versions VALUES ('hifld/sample/points/v1.0.0', 'hifld/sample/points', 'v1.0.0', 'hifld/sample/points/v1.0.0/collection.json', '2026-09-08T00:00:00Z', '2026-09-08T00:00:00Z', 'spatial', '[0,0,1,1]', '[0,0,1,1]', 'EPSG:4326', 'geometry', 'Point', 'objectid', 2, 1);
INSERT INTO assets VALUES ('hifld/sample/points/v1.0.0/geoparquet', 'hifld/sample/points/v1.0.0', 'geoparquet', 'geoparquet', 'GeoParquet', '__PARQUET_PATH__', 'application/vnd.apache.parquet', '["data"]', 0, '0000000000000000000000000000000000000000000000000000000000000000');
INSERT INTO asset_locations VALUES ('hifld/sample/points/v1.0.0/geoparquet/canonical', 'hifld/sample/points/v1.0.0/geoparquet', 'canonical', '__PARQUET_PATH__', 1);
INSERT INTO asset_objects VALUES ('hifld/sample/points/v1.0.0/geoparquet/canonical/0892bcd2e98c4cec', 'hifld/sample/points/v1.0.0/geoparquet', 'hifld/sample/points/v1.0.0/geoparquet/canonical', '__PARQUET_PATH__', '__PARQUET_PATH__', 0, '0000000000000000000000000000000000000000000000000000000000000000', NULL, NULL, NULL, '[0,0,1,1]', '[0,0,1,1]');
INSERT INTO columns VALUES ('hifld/sample/points/v1.0.0/0', 'hifld/sample/points/v1.0.0', 0, 'objectid', 'INTEGER', NULL, 0, 0, NULL, NULL, NULL, NULL, NULL);
INSERT INTO columns VALUES ('hifld/sample/points/v1.0.0/1', 'hifld/sample/points/v1.0.0', 1, 'name', 'VARCHAR', NULL, 0, 0, NULL, NULL, NULL, NULL, NULL);
INSERT INTO columns VALUES ('hifld/sample/points/v1.0.0/2', 'hifld/sample/points/v1.0.0', 2, 'geometry', 'BLOB', NULL, 0, 1, NULL, NULL, NULL, NULL, NULL);
INSERT INTO quality VALUES ('hifld/sample/points/v1.0.0', 'metadata/quality_manifest.json', 1, 0, 0, '4530d6692e146b6408f755bea6426fe39eb5e0c5c4ecb758413df6014f415afc');
INSERT INTO dataset_fts VALUES ('hifld/sample', 'Sample points', 'Publisher-built integration fixture', '', 'sample');
INSERT INTO file_fts VALUES ('hifld/sample/points', 'Sample points', 'Publisher-built integration fixture', '', 'points');
