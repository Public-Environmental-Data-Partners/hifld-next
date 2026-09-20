import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogLifecycle, CatalogRepository, validateCatalogDatabase } from "@/lib/catalog-repository";

const paths: string[] = [];

afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

function catalogDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), "hifld-catalog-"));
  paths.push(directory);
  const path = join(directory, "catalog.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA application_id = 1212761676;
    PRAGMA user_version = 1;
    CREATE TABLE catalog_metadata (singleton INTEGER PRIMARY KEY, schema_version INTEGER NOT NULL, catalog_generation TEXT NOT NULL, created_at TEXT NOT NULL, portolan_profile_uri TEXT NOT NULL, root_href TEXT NOT NULL, root_title TEXT NOT NULL) STRICT;
    CREATE TABLE collections (collection_path TEXT PRIMARY KEY, collection_slug TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, catalog_href TEXT NOT NULL, license_href TEXT, created_at TEXT, updated_at TEXT) STRICT;
    CREATE TABLE datasets (dataset_path TEXT PRIMARY KEY, collection_path TEXT NOT NULL, dataset_slug TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, catalog_href TEXT NOT NULL, created_at TEXT, updated_at TEXT) STRICT;
    CREATE TABLE files (file_path TEXT PRIMARY KEY, dataset_path TEXT NOT NULL, file_slug TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, catalog_href TEXT NOT NULL, latest_version TEXT, created_at TEXT, updated_at TEXT) STRICT;
    CREATE TABLE versions (version_path TEXT PRIMARY KEY, file_path TEXT NOT NULL, version_label TEXT NOT NULL, collection_href TEXT NOT NULL, created_at TEXT, updated_at TEXT, spatial_status TEXT NOT NULL, native_bbox_json TEXT, crs84_bbox_json TEXT, native_crs TEXT, geometry_column TEXT, geometry_type TEXT, feature_count INTEGER NOT NULL, is_latest INTEGER NOT NULL) STRICT;
    CREATE TABLE formats (format_key TEXT PRIMARY KEY, title TEXT NOT NULL, media_type TEXT NOT NULL, is_spatial INTEGER NOT NULL) STRICT;
    CREATE TABLE assets (asset_path TEXT PRIMARY KEY, version_path TEXT NOT NULL, asset_key TEXT NOT NULL, format_key TEXT NOT NULL, title TEXT NOT NULL, href TEXT NOT NULL, media_type TEXT NOT NULL, roles_json TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT, checksum_multihash TEXT) STRICT;
    CREATE TABLE asset_locations (asset_location_path TEXT PRIMARY KEY, asset_path TEXT NOT NULL, storage_slug TEXT NOT NULL, href TEXT NOT NULL, is_canonical INTEGER NOT NULL) STRICT;
    CREATE TABLE asset_objects (asset_object_path TEXT PRIMARY KEY, asset_path TEXT NOT NULL, asset_location_path TEXT NOT NULL, object_key TEXT NOT NULL, relative_path TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT, checksum_multihash TEXT, storage_revision TEXT, partition_json TEXT, covering_json TEXT, native_bbox_json TEXT, crs84_bbox_json TEXT) STRICT;
    CREATE TABLE columns (column_path TEXT PRIMARY KEY, version_path TEXT NOT NULL, ordinal INTEGER NOT NULL, name TEXT NOT NULL, data_type TEXT NOT NULL, description TEXT, nullable INTEGER NOT NULL, is_geometry INTEGER NOT NULL, null_count INTEGER, unique_count INTEGER, min_value TEXT, max_value TEXT, statistics_json TEXT) STRICT;
    CREATE TABLE quality (version_path TEXT PRIMARY KEY, manifest_href TEXT NOT NULL, passed INTEGER NOT NULL, invalid_geometry_count INTEGER NOT NULL, null_geometry_count INTEGER NOT NULL, columns_hash TEXT NOT NULL) STRICT;
    CREATE TABLE tags (tag_path TEXT PRIMARY KEY, entity_path TEXT NOT NULL, tag_key TEXT NOT NULL, tag_value TEXT NOT NULL) STRICT;
    INSERT INTO catalog_metadata VALUES (1, 1, 'generation-1', '2026-09-08T00:00:00Z', 'https://example.test/profile', 'catalog.json', 'HIFLD');
    INSERT INTO collections VALUES ('hifld', 'hifld', 'HIFLD', 'Catalog', 'hifld/catalog.json', NULL, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
    INSERT INTO datasets VALUES ('hifld/stations', 'hifld', 'stations', 'Stations', 'Station locations', 'hifld/stations/catalog.json', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
    INSERT INTO datasets VALUES ('hifld/bridges', 'hifld', 'bridges', 'Bridges', 'Bridge locations', 'hifld/bridges/catalog.json', NULL, NULL);
    INSERT INTO datasets VALUES ('hifld/shelters', 'hifld', 'shelters', 'Shelters', 'Shelter locations', 'hifld/shelters/catalog.json', NULL, NULL);
    INSERT INTO files VALUES ('hifld/stations/stations', 'hifld/stations', 'stations', 'Stations', 'Station locations', 'hifld/stations/stations/catalog.json', 'v1.0.0', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
    INSERT INTO versions VALUES ('hifld/stations/stations/v1.0.0', 'hifld/stations/stations', 'v1.0.0', 'hifld/stations/stations/v1.0.0/collection.json', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', 'spatial', '[1,2,3,4]', '[1,2,3,4]', 'EPSG:4326', 'geometry', 'Point', 3, 1);
    INSERT INTO formats VALUES ('geoparquet', 'GeoParquet', 'application/vnd.apache.parquet', 1);
    INSERT INTO assets VALUES ('hifld/stations/stations/v1.0.0/geoparquet', 'hifld/stations/stations/v1.0.0', 'geoparquet', 'geoparquet', 'GeoParquet', 'data.parquet', 'application/vnd.apache.parquet', '["data"]', 12, NULL, 'd50110000102030405060708090a0b0c0d0e0f');
    INSERT INTO asset_locations VALUES ('hifld/stations/stations/v1.0.0/geoparquet/local', 'hifld/stations/stations/v1.0.0/geoparquet', 'local', 'https://storage.example/data.parquet', 1);
    INSERT INTO asset_objects VALUES ('hifld/stations/stations/v1.0.0/geoparquet/data.parquet', 'hifld/stations/stations/v1.0.0/geoparquet', 'hifld/stations/stations/v1.0.0/geoparquet/local', 'data.parquet', 'data.parquet', 12, NULL, 'd50110000102030405060708090a0b0c0d0e0f', '1', NULL, NULL, NULL, NULL);
    INSERT INTO columns VALUES ('hifld/stations/stations/v1.0.0/0', 'hifld/stations/stations/v1.0.0', 0, 'name', 'string', 'Station name', 1, 0, 0, 3, 'Alpha', 'Zulu', '{"exampleValues":["Alpha","Bravo"],"possibleValues":["Alpha","Bravo","Zulu"],"length":null,"numNullValues":0,"numUniqueValues":null}');
    INSERT INTO quality VALUES ('hifld/stations/stations/v1.0.0', 'quality.json', 1, 0, 0, 'hash');
    INSERT INTO tags VALUES ('hifld/stations/tag/category', 'hifld/stations', 'category', 'Public safety');
    INSERT INTO tags VALUES ('hifld/stations/tag/keyword/1', 'hifld/stations', 'keyword', 'critical');
    INSERT INTO tags VALUES ('hifld/bridges/tag/category', 'hifld/bridges', 'category', 'Transportation');
    INSERT INTO tags VALUES ('hifld/bridges/tag/keyword/1', 'hifld/bridges', 'keyword', 'critical');
    INSERT INTO tags VALUES ('hifld/shelters/tag/category', 'hifld/shelters', 'category', 'Public safety');
  `);
  db.close();
  return path;
}

describe("CatalogRepository", () => {
  it("validates a published database and resolves only approved slug assets", () => {
    const path = catalogDatabase();
    expect(validateCatalogDatabase(path)).toMatchObject({ generation: "generation-1" });

    const repository = new CatalogRepository(path);
    expect(repository.listCollections()).toHaveLength(1);
    expect(repository.listDatasets("hifld", { search: "station", limit: 10, offset: 0 })).toMatchObject({ total: 1 });
    expect(repository.getCollection("hifld")?.title).toBe("HIFLD");
    expect(repository.getDataset("hifld", "stations")?.dataset_path).toBe("hifld/stations");
    expect(repository.getFileVersion("hifld", "stations", "stations", "v1.0.0")).toMatchObject({
      collection_href: "hifld/stations/stations/v1.0.0/collection.json",
      geometry_type: "Point",
      columns: [
        {
          name: "name",
          data_type: "string",
          nullable: true,
          description: "Station name",
          min_value: "Alpha",
          max_value: "Zulu",
          example_values: ["Alpha", "Bravo"],
          possible_values: ["Alpha", "Bravo", "Zulu"],
          length: null,
        },
      ],
      quality: { passed: true, invalid_geometry_count: 0, columns_hash: "hash" },
    });
    expect(repository.resolveAsset({ collectionSlug: "hifld", datasetSlug: "stations", fileSlug: "stations", version: "v1.0.0", assetKey: "geoparquet", storageLocationSlug: "local" })).toMatchObject({
      href: "https://storage.example/data.parquet",
      sha256: null,
      checksum_multihash: "d50110000102030405060708090a0b0c0d0e0f",
      objects: [{ objectKey: "data.parquet", sha256: null, checksumMultihash: "d50110000102030405060708090a0b0c0d0e0f" }],
    });
    expect(repository.resolveAsset({ collectionSlug: "hifld", datasetSlug: "stations", fileSlug: "stations", version: "v1.0.0", assetKey: "untrusted" })).toBeNull();
    repository.close();
  });

  it("accepts a schema-version-2 catalog when metadata matches its SQLite pragma", () => {
    const path = catalogDatabase();
    const db = new DatabaseSync(path);
    db.exec("PRAGMA user_version = 2; UPDATE catalog_metadata SET schema_version = 2 WHERE singleton = 1;");
    db.close();

    expect(validateCatalogDatabase(path)).toMatchObject({ generation: "generation-1" });
  });

  it("rejects an unknown catalog schema version even when metadata matches its SQLite pragma", () => {
    const path = catalogDatabase();
    const db = new DatabaseSync(path);
    db.exec("PRAGMA user_version = 3; UPDATE catalog_metadata SET schema_version = 3 WHERE singleton = 1;");
    db.close();

    expect(() => validateCatalogDatabase(path)).toThrow("Unsupported catalog SQLite schema version");
  });

  it("continues to resolve schema-version-1 catalogs without generic checksum columns", () => {
    const path = catalogDatabase();
    const db = new DatabaseSync(path);
    db.exec(`
      UPDATE assets SET sha256 = 'abc';
      UPDATE asset_objects SET sha256 = 'abc';
      ALTER TABLE assets DROP COLUMN checksum_multihash;
      ALTER TABLE asset_objects DROP COLUMN checksum_multihash;
    `);
    db.close();

    const repository = new CatalogRepository(path);
    expect(
      repository.resolveAsset({
        collectionSlug: "hifld",
        datasetSlug: "stations",
        fileSlug: "stations",
        version: "v1.0.0",
        assetKey: "geoparquet",
        storageLocationSlug: "local",
      }),
    ).toMatchObject({ sha256: "abc", checksum_multihash: null, objects: [{ sha256: "abc", checksumMultihash: null }] });
    repository.close();
  });

  it("groups dataset tags and filters before count and pagination", () => {
    const repository = new CatalogRepository(catalogDatabase());

    expect(repository.getDataset("hifld", "stations")?.tags).toEqual({
      category: "Public safety",
      keyword: "critical",
    });
    expect(repository.listDatasetTags("hifld")).toEqual({
      category: ["Public safety", "Transportation"],
      geometry_type: ["Point"],
      keyword: ["critical"],
    });
    expect(repository.listDatasets("hifld", { search: "critical", limit: 10, offset: 0 })).toMatchObject({ total: 2 });
    expect(
      repository.listDatasets("hifld", {
        limit: 1,
        offset: 0,
        tagFilters: { category: ["Public safety", "Transportation"], keyword: "critical" },
      }),
    ).toMatchObject({ total: 2, items: [{ tags: { category: "Transportation", keyword: "critical" } }] });
    repository.close();
  });

  it("lists every file belonging to a dataset even when its slug differs", () => {
    const path = catalogDatabase();
    const db = new DatabaseSync(path);
    db.exec(
      "INSERT INTO files VALUES ('hifld/stations/alternate', 'hifld/stations', 'alternate', 'Alternate', '', 'hifld/stations/alternate/catalog.json', NULL, NULL, NULL)",
    );
    db.close();
    const repository = new CatalogRepository(path);
    expect(repository.listFiles("hifld", "stations").map((file) => file.file_slug)).toEqual(["alternate", "stations"]);
    repository.close();
  });

  it("facets and filters geometry types across current files, not historical versions", () => {
    const path = catalogDatabase();
    const db = new DatabaseSync(path);
    db.exec(`
      INSERT INTO files VALUES ('hifld/stations/areas', 'hifld/stations', 'areas', 'Areas', '', 'hifld/stations/areas/catalog.json', 'v1', NULL, NULL);
      INSERT INTO versions (version_path, file_path, version_label, collection_href, spatial_status, geometry_type, feature_count, is_latest)
        VALUES ('hifld/stations/areas/v1', 'hifld/stations/areas', 'v1', 'hifld/stations/areas/v1/collection.json', 'spatial', 'MultiPolygon', 2, 1),
               ('hifld/stations/stations/old', 'hifld/stations/stations', 'old', 'hifld/stations/stations/old/collection.json', 'spatial', 'LineString', 3, 0);
    `);
    db.close();
    const repository = new CatalogRepository(path);
    expect(repository.listDatasetTags("hifld", "geometry_type")).toEqual({ geometry_type: ["MultiPolygon", "Point"] });
    expect(repository.listDatasets("hifld", { tagFilters: { geometry_type: ["Point", "MultiPolygon"], category: "Public safety" }, limit: 1, offset: 0 })).toMatchObject({ total: 1, items: [{ dataset_slug: "stations" }] });
    expect(repository.listDatasets("hifld", { tagFilters: { geometry_type: "MultiPolygon" }, limit: 1, offset: 1 })).toMatchObject({ total: 1, items: [] });
    expect(repository.listDatasets("hifld", { tagFilters: { geometry_type: "LineString" }, limit: 1, offset: 0 })).toMatchObject({ total: 0 });
    repository.close();
  });

  it("retains the last known good generation when a local replacement is invalid", async () => {
    const validPath = catalogDatabase();
    const sourceDirectory = mkdtempSync(join(tmpdir(), "hifld-catalog-source-"));
    paths.push(sourceDirectory);
    const sourcePath = join(sourceDirectory, "catalog.sqlite");
    copyFileSync(validPath, sourcePath);
    const lifecycle = new CatalogLifecycle({ kind: "file", path: sourcePath });

    await lifecycle.start();
    expect(lifecycle.status().generation).toBe("generation-1");
    writeFileSync(sourcePath, "not a catalog");
    expect(await lifecycle.refresh()).toBe(false);
    expect(lifecycle.status().generation).toBe("generation-1");
    await lifecycle.close();
  });

  it("activates only the SQLite release selected by a valid pointer", async () => {
    const bytes = readFileSync(catalogDatabase());
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/_catalog/current.json")) {
          return new Response(
            JSON.stringify({
              protocol_version: 1,
              generation: "d8e9c0a1-9af9-4b7d-a9a2-70f2e912c3c6",
              catalog_key: "releases/d8e9c0a1-9af9-4b7d-a9a2-70f2e912c3c6/_catalog/catalog.sqlite",
              root_key: "releases/d8e9c0a1-9af9-4b7d-a9a2-70f2e912c3c6/catalog.json",
              sha256: checksum,
              size_bytes: bytes.byteLength,
              published_at: "2026-09-19T20:00:00Z",
            }),
            { headers: { etag: '"pointer-1"' } },
          );
        }
        return new Response(bytes, { headers: { etag: '"catalog-1"' } });
      }),
    );
    const lifecycle = new CatalogLifecycle({
      kind: "pointer",
      url: "https://storage.test/bucket/_catalog/current.json",
    });

    await lifecycle.start();

    expect(lifecycle.status().generation).toBe("generation-1");
    expect(calls).toEqual([
      "https://storage.test/bucket/_catalog/current.json",
      "https://storage.test/bucket/releases/d8e9c0a1-9af9-4b7d-a9a2-70f2e912c3c6/_catalog/catalog.sqlite",
    ]);
    await lifecycle.close();
  });
});
