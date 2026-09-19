import { createHash } from "node:crypto";
import { copyFile, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";

export const CATALOG_APPLICATION_ID = 1212761676;
export const CATALOG_SCHEMA_VERSION = 2;
const CATALOG_SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [1, CATALOG_SCHEMA_VERSION];

const metadataSchema = z.object({
  schema_version: z.number().int(),
  catalog_generation: z.string().min(1),
  created_at: z.string().min(1),
  portolan_profile_uri: z.string().min(1),
  root_href: z.string().min(1),
  root_title: z.string().min(1),
});

const collectionSchema = z.object({
  collection_path: z.string().min(1),
  collection_slug: z.string().min(1),
  title: z.string(),
  description: z.string(),
  catalog_href: z.string(),
  license_href: z.string().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});

const datasetSchema = z.object({
  dataset_path: z.string().min(1),
  collection_path: z.string().min(1),
  dataset_slug: z.string().min(1),
  title: z.string(),
  description: z.string(),
  catalog_href: z.string(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});

export type CatalogTagValue = string | string[];
export interface CatalogTags {
  [tagKey: string]: CatalogTagValue;
}
export interface CatalogTagValues {
  [tagKey: string]: string[];
}

const fileSchema = z.object({
  file_path: z.string().min(1),
  dataset_path: z.string().min(1),
  file_slug: z.string().min(1),
  title: z.string(),
  description: z.string(),
  latest_version: z.string().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});

const versionSchema = z.object({
  version_path: z.string().min(1),
  version_label: z.string().min(1),
  collection_href: z.string().min(1),
  spatial_status: z.enum(["spatial", "all_null_geometry", "non_spatial_source"]),
  crs84_bbox_json: z.string().nullable(),
  geometry_type: z.string().nullable(),
  feature_count: z.number().int().nonnegative(),
  is_latest: z.number().int().min(0).max(1),
});

const columnSchema = z.object({
  name: z.string().min(1),
  data_type: z.string().min(1),
  description: z.string().nullable(),
  nullable: z.number().int().min(0).max(1),
  null_count: z.number().int().nonnegative().nullable(),
  unique_count: z.number().int().nonnegative().nullable(),
  min_value: z.string().nullable(),
  max_value: z.string().nullable(),
  statistics_json: z.string().nullable(),
});

const columnStatisticsSchema = z.object({
  exampleValues: z.array(z.string()).optional(),
  possibleValues: z.array(z.string()).optional(),
  length: z.number().int().nonnegative().nullish(),
  numNullValues: z.number().int().nonnegative().nullish(),
  numUniqueValues: z.number().int().nonnegative().nullish(),
});

const qualitySchema = z.object({
  passed: z.number().int().min(0).max(1),
  invalid_geometry_count: z.number().int().nonnegative(),
  null_geometry_count: z.number().int().nonnegative(),
  columns_hash: z.string().min(1),
});

const pageSchema = z.object({ total: z.number().int().nonnegative() });

const assetSchema = z.object({
  asset_path: z.string().min(1),
  asset_key: z.string().min(1),
  format_key: z.string().min(1),
  title: z.string(),
  href: z.string().min(1),
  media_type: z.string().min(1),
  roles_json: z.string(),
  size_bytes: z.number().int().nonnegative(),
  sha256: z.string().min(1).nullable(),
  checksum_multihash: z.string().min(1).nullable(),
  asset_location_path: z.string().min(1).nullable(),
  storage_slug: z.string().nullable(),
  storage_href: z.string().nullable(),
});

const assetObjectSchema = z.object({
  object_key: z.string().min(1),
  relative_path: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  sha256: z.string().min(1).nullable(),
  checksum_multihash: z.string().min(1).nullable(),
  storage_revision: z.string().nullable(),
  partition_json: z.string().nullable(),
  covering_json: z.string().nullable(),
  native_bbox_json: z.string().nullable(),
  crs84_bbox_json: z.string().nullable(),
});

export type CatalogMetadata = z.infer<typeof metadataSchema>;
export type CatalogCollection = z.infer<typeof collectionSchema>;
export type CatalogDataset = z.infer<typeof datasetSchema> & { tags: CatalogTags };
export type CatalogFile = z.infer<typeof fileSchema>;
export type CatalogVersion = z.infer<typeof versionSchema>;

export interface CatalogColumn {
  name: string;
  data_type: string;
  description: string | null;
  nullable: boolean;
  null_count: number | null;
  unique_count: number | null;
  min_value: string | null;
  max_value: string | null;
  example_values: string[];
  possible_values: string[];
  length: number | null;
}

export interface CatalogQuality {
  passed: boolean;
  invalid_geometry_count: number;
  null_geometry_count: number;
  columns_hash: string;
}

export interface CatalogFileVersion extends CatalogVersion {
  columns: CatalogColumn[];
  quality: CatalogQuality | null;
}

export interface CatalogPage<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface CatalogAssetReference {
  collectionSlug: string;
  datasetSlug: string;
  fileSlug: string;
  version: string;
  assetKey: string;
  storageLocationSlug?: string;
}

export interface CatalogResolvedAsset extends z.infer<typeof assetSchema> {
  objects: CatalogAssetObject[];
}

export interface CatalogAssetObject {
  objectKey: string;
  relativePath: string;
  sizeBytes: number;
  sha256: string | null;
  checksumMultihash: string | null;
  storageRevision: string | null;
  partitionJson: string | null;
  coveringJson: string | null;
  nativeBboxJson: string | null;
  crs84BboxJson: string | null;
}

export interface CatalogValidation {
  generation: string;
  createdAt: string;
}

export type Awaitable<T> = T | Promise<T>;

/** Database-neutral catalog read boundary. Implementations keep join keys private. */
export interface CatalogRepository {
  readonly metadata: CatalogMetadata;
  close(): void;
  getCollection(collectionSlug: string): Awaitable<CatalogCollection | null>;
  listCollections(): Awaitable<CatalogCollection[]>;
  getDataset(collectionSlug: string, datasetSlug: string): Awaitable<CatalogDataset | null>;
  listDatasets(
    collectionSlug: string,
    query: { search?: string; limit: number; offset: number; tagFilters?: CatalogTags },
  ): Awaitable<CatalogPage<CatalogDataset>>;
  listDatasetTags(collectionSlug: string, tagKey?: string): Awaitable<CatalogTagValues>;
  listFiles(collectionSlug: string, datasetSlug: string): Awaitable<CatalogFile[]>;
  getFile(collectionSlug: string, datasetSlug: string, fileSlug: string): Awaitable<CatalogFile | null>;
  listVersions(collectionSlug: string, datasetSlug: string, fileSlug: string): Awaitable<CatalogVersion[]>;
  getFileVersion(
    collectionSlug: string,
    datasetSlug: string,
    fileSlug: string,
    version: string,
  ): Awaitable<CatalogFileVersion | null>;
  listAssets(
    collectionSlug: string,
    datasetSlug: string,
    fileSlug: string,
    version?: string,
  ): Awaitable<CatalogResolvedAsset[]>;
  resolveAsset(reference: CatalogAssetReference): Awaitable<CatalogResolvedAsset | null>;
}

function pragmaInteger(db: DatabaseSync, statement: string): number {
  const row = db.prepare(statement).get();
  const value = row ? Object.values(row)[0] : undefined;
  return z.number().int().parse(value);
}

function quickCheck(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA quick_check").get();
  const value = row ? Object.values(row)[0] : undefined;
  if (z.string().parse(value) !== "ok") throw new Error("Catalog SQLite quick_check failed");
}

function catalogMetadata(db: DatabaseSync): CatalogMetadata {
  const row = db
    .prepare(
      "SELECT schema_version, catalog_generation, created_at, portolan_profile_uri, root_href, root_title FROM catalog_metadata WHERE singleton = 1",
    )
    .get();
  if (!row) throw new Error("Catalog SQLite metadata is missing");
  return metadataSchema.parse(row);
}

function hasTableColumn(db: DatabaseSync, tableName: string, columnName: string): boolean {
  return (
    db.prepare("SELECT 1 FROM pragma_table_info(?) WHERE name = ? LIMIT 1").get(tableName, columnName) !== undefined
  );
}

/** Validates a local immutable candidate before it is allowed to serve requests. */
export function validateCatalogDatabase(path: string): CatalogValidation {
  const db = new DatabaseSync(path, { readOnly: true, allowExtension: false });
  try {
    if (pragmaInteger(db, "PRAGMA application_id") !== CATALOG_APPLICATION_ID) {
      throw new Error("Unsupported catalog SQLite application ID");
    }
    const schemaVersion = pragmaInteger(db, "PRAGMA user_version");
    if (!CATALOG_SUPPORTED_SCHEMA_VERSIONS.includes(schemaVersion)) {
      throw new Error("Unsupported catalog SQLite schema version");
    }
    quickCheck(db);
    const metadata = catalogMetadata(db);
    if (metadata.schema_version !== schemaVersion) {
      throw new Error("Catalog metadata schema version does not match SQLite schema version");
    }
    return { generation: metadata.catalog_generation, createdAt: metadata.created_at };
  } finally {
    db.close();
  }
}

/** A narrow, read-only boundary around publisher-generated SQLite values. */
export class SQLiteCatalogRepository implements CatalogRepository {
  readonly #db: DatabaseSync;
  readonly #assetChecksumMultihashColumn: boolean;
  readonly #assetObjectChecksumMultihashColumn: boolean;
  readonly metadata: CatalogMetadata;

  constructor(path: string) {
    validateCatalogDatabase(path);
    this.#db = new DatabaseSync(path, { readOnly: true, allowExtension: false });
    this.#assetChecksumMultihashColumn = hasTableColumn(this.#db, "assets", "checksum_multihash");
    this.#assetObjectChecksumMultihashColumn = hasTableColumn(this.#db, "asset_objects", "checksum_multihash");
    this.metadata = catalogMetadata(this.#db);
  }

  close(): void {
    this.#db.close();
  }

  getCollection(collectionSlug: string): CatalogCollection | null {
    const row = this.#db
      .prepare(
        "SELECT collection_path, collection_slug, title, description, catalog_href, license_href, created_at, updated_at FROM collections WHERE collection_slug = ?",
      )
      .get(collectionSlug);
    return row ? collectionSchema.parse(row) : null;
  }

  listCollections(): CatalogCollection[] {
    return this.#db
      .prepare(
        "SELECT collection_path, collection_slug, title, description, catalog_href, license_href, created_at, updated_at FROM collections ORDER BY title",
      )
      .all()
      .map((row) => collectionSchema.parse(row));
  }

  listDatasets(
    collectionSlug: string,
    query: { search?: string; limit: number; offset: number; tagFilters?: CatalogTags },
  ): CatalogPage<CatalogDataset> {
    const search = query.search?.trim();
    const match = search ? `%${search}%` : null;
    const predicates = ["c.collection_slug = ?"];
    const parameters: Array<string> = [collectionSlug];
    if (match) {
      predicates.push(
        "(d.dataset_slug LIKE ? OR d.title LIKE ? OR d.description LIKE ? OR EXISTS (SELECT 1 FROM tags search_tags WHERE search_tags.entity_path = d.dataset_path AND search_tags.tag_value LIKE ?))",
      );
      parameters.push(match, match, match, match);
    }
    for (const [tagKey, rawValues] of Object.entries(query.tagFilters ?? {})) {
      const values = Array.isArray(rawValues) ? rawValues : [rawValues];
      if (values.length === 0) continue;
      if (tagKey === "geometry_type") {
        predicates.push(
          `EXISTS (SELECT 1 FROM files geometry_files JOIN versions geometry_versions ON geometry_versions.file_path = geometry_files.file_path WHERE geometry_files.dataset_path = d.dataset_path AND geometry_versions.is_latest = 1 AND geometry_versions.geometry_type IN (${values.map(() => "?").join(", ")}))`,
        );
        parameters.push(...values);
        continue;
      }
      predicates.push(
        `EXISTS (SELECT 1 FROM tags filter_tags WHERE filter_tags.entity_path = d.dataset_path AND filter_tags.tag_key = ? AND filter_tags.tag_value IN (${values.map(() => "?").join(", ")}))`,
      );
      parameters.push(tagKey, ...values);
    }
    const where = predicates.join(" AND ");
    const countRow = this.#db
      .prepare(
        `SELECT count(*) AS total FROM datasets d JOIN collections c ON c.collection_path = d.collection_path WHERE ${where}`,
      )
      .get(...parameters);
    const total = pageSchema.parse(countRow).total;
    const items = this.#db
      .prepare(
        `SELECT d.dataset_path, d.collection_path, d.dataset_slug, d.title, d.description, d.catalog_href, d.created_at, d.updated_at FROM datasets d JOIN collections c ON c.collection_path = d.collection_path WHERE ${where} ORDER BY d.title, d.dataset_path LIMIT ? OFFSET ?`,
      )
      .all(...parameters, query.limit, query.offset)
      .map((row) => this.datasetWithTags(datasetSchema.parse(row)));
    return { items, total, limit: query.limit, offset: query.offset };
  }

  getDataset(collectionSlug: string, datasetSlug: string): CatalogDataset | null {
    const row = this.#db
      .prepare(
        `SELECT d.dataset_path, d.collection_path, d.dataset_slug, d.title, d.description, d.catalog_href, d.created_at, d.updated_at FROM datasets d JOIN collections c ON c.collection_path = d.collection_path WHERE c.collection_slug = ? AND d.dataset_slug = ?`,
      )
      .get(collectionSlug, datasetSlug);
    return row ? this.datasetWithTags(datasetSchema.parse(row)) : null;
  }

  listDatasetTags(collectionSlug: string, tagKey?: string): CatalogTagValues {
    const rows = this.#db
      .prepare(
        `SELECT t.tag_key, t.tag_value FROM tags t JOIN datasets d ON d.dataset_path = t.entity_path JOIN collections c ON c.collection_path = d.collection_path WHERE c.collection_slug = ? AND t.tag_key != 'geometry_type'${tagKey ? " AND t.tag_key = ?" : ""} GROUP BY t.tag_key, t.tag_value ORDER BY t.tag_key, t.tag_value`,
      )
      .all(...(tagKey ? [collectionSlug, tagKey] : [collectionSlug]))
      .map((row) => z.object({ tag_key: z.string(), tag_value: z.string() }).parse(row));
    const tags: CatalogTagValues = {};
    for (const row of rows) {
      const values = tags[row.tag_key] ?? [];
      values.push(row.tag_value);
      tags[row.tag_key] = values;
    }
    if (!tagKey || tagKey === "geometry_type") {
      const geometryTypes = this.#db
        .prepare(
          "SELECT DISTINCT v.geometry_type FROM versions v JOIN files f ON f.file_path = v.file_path JOIN datasets d ON d.dataset_path = f.dataset_path JOIN collections c ON c.collection_path = d.collection_path WHERE c.collection_slug = ? AND v.is_latest = 1 AND v.geometry_type IS NOT NULL AND v.geometry_type != '' ORDER BY v.geometry_type",
        )
        .all(collectionSlug)
        .map((row) => z.object({ geometry_type: z.string() }).parse(row).geometry_type);
      if (geometryTypes.length) tags["geometry_type"] = geometryTypes;
    }
    return tags;
  }

  listFiles(collectionSlug: string, datasetSlug: string): CatalogFile[] {
    return this.#db
      .prepare(
        "SELECT f.file_path, f.dataset_path, f.file_slug, f.title, f.description, f.latest_version, f.created_at, f.updated_at FROM files f JOIN datasets d ON d.dataset_path = f.dataset_path JOIN collections c ON c.collection_path = d.collection_path WHERE c.collection_slug = ? AND d.dataset_slug = ? ORDER BY f.title, f.file_path",
      )
      .all(collectionSlug, datasetSlug)
      .map((row) => fileSchema.parse(row));
  }

  private datasetWithTags(dataset: z.infer<typeof datasetSchema>): CatalogDataset {
    const rows = this.#db
      .prepare("SELECT tag_key, tag_value FROM tags WHERE entity_path = ? ORDER BY tag_key, tag_path")
      .all(dataset.dataset_path)
      .map((row) => z.object({ tag_key: z.string(), tag_value: z.string() }).parse(row));
    const grouped = new Map<string, string[]>();
    for (const row of rows) {
      const values = grouped.get(row.tag_key) ?? [];
      values.push(row.tag_value);
      grouped.set(row.tag_key, values);
    }
    const tags: CatalogTags = {};
    for (const [key, values] of grouped) {
      const first = values[0];
      if (first !== undefined) tags[key] = values.length === 1 ? first : values;
    }
    return { ...dataset, tags };
  }

  getFile(collectionSlug: string, datasetSlug: string, fileSlug: string): CatalogFile | null {
    const row = this.#db
      .prepare(
        "SELECT f.file_path, f.dataset_path, f.file_slug, f.title, f.description, f.latest_version, f.created_at, f.updated_at FROM files f JOIN datasets d ON d.dataset_path = f.dataset_path JOIN collections c ON c.collection_path = d.collection_path WHERE c.collection_slug = ? AND d.dataset_slug = ? AND f.file_slug = ?",
      )
      .get(collectionSlug, datasetSlug, fileSlug);
    return row ? fileSchema.parse(row) : null;
  }

  listVersions(collectionSlug: string, datasetSlug: string, fileSlug: string): CatalogVersion[] {
    return this.#db
      .prepare(
        "SELECT v.version_path, v.version_label, v.collection_href, v.spatial_status, v.crs84_bbox_json, v.geometry_type, v.feature_count, v.is_latest FROM versions v JOIN files f ON f.file_path = v.file_path JOIN datasets d ON d.dataset_path = f.dataset_path JOIN collections c ON c.collection_path = d.collection_path WHERE c.collection_slug = ? AND d.dataset_slug = ? AND f.file_slug = ? ORDER BY v.created_at DESC, v.version_label DESC",
      )
      .all(collectionSlug, datasetSlug, fileSlug)
      .map((row) => versionSchema.parse(row));
  }

  getFileVersion(
    collectionSlug: string,
    datasetSlug: string,
    fileSlug: string,
    version: string,
  ): CatalogFileVersion | null {
    const row = this.#db
      .prepare(
        "SELECT v.version_path, v.version_label, v.collection_href, v.spatial_status, v.crs84_bbox_json, v.geometry_type, v.feature_count, v.is_latest FROM versions v JOIN files f ON f.file_path = v.file_path JOIN datasets d ON d.dataset_path = f.dataset_path JOIN collections c ON c.collection_path = d.collection_path WHERE c.collection_slug = ? AND d.dataset_slug = ? AND f.file_slug = ? AND v.version_label = ?",
      )
      .get(collectionSlug, datasetSlug, fileSlug, version);
    if (!row) return null;
    const parsedVersion = versionSchema.parse(row);
    const columns = this.#db
      .prepare(
        "SELECT name, data_type, description, nullable, null_count, unique_count, min_value, max_value, statistics_json FROM columns WHERE version_path = ? ORDER BY ordinal",
      )
      .all(parsedVersion.version_path)
      .map((columnRow) => {
        const column = columnSchema.parse(columnRow);
        const statistics = column.statistics_json
          ? columnStatisticsSchema.parse(JSON.parse(column.statistics_json))
          : null;
        return {
          name: column.name,
          data_type: column.data_type,
          description: column.description,
          nullable: column.nullable === 1,
          null_count: column.null_count ?? statistics?.numNullValues ?? null,
          unique_count: column.unique_count ?? statistics?.numUniqueValues ?? null,
          min_value: column.min_value,
          max_value: column.max_value,
          example_values: statistics?.exampleValues ?? [],
          possible_values: statistics?.possibleValues ?? [],
          length: statistics?.length ?? null,
        };
      });
    const qualityRow = this.#db
      .prepare(
        "SELECT passed, invalid_geometry_count, null_geometry_count, columns_hash FROM quality WHERE version_path = ?",
      )
      .get(parsedVersion.version_path);
    const qualityValue = qualityRow ? qualitySchema.parse(qualityRow) : null;
    const quality = qualityValue ? { ...qualityValue, passed: qualityValue.passed === 1 } : null;
    return { ...parsedVersion, columns, quality };
  }

  listAssets(collectionSlug: string, datasetSlug: string, fileSlug: string, version?: string): CatalogResolvedAsset[] {
    const selectedVersion = version ?? this.getFile(collectionSlug, datasetSlug, fileSlug)?.latest_version;
    if (!selectedVersion) return [];
    const rows = this.#db
      .prepare(
        "SELECT a.asset_key FROM assets a JOIN versions v ON v.version_path = a.version_path JOIN files f ON f.file_path = v.file_path JOIN datasets d ON d.dataset_path = f.dataset_path JOIN collections c ON c.collection_path = d.collection_path WHERE c.collection_slug = ? AND d.dataset_slug = ? AND f.file_slug = ? AND v.version_label = ? ORDER BY a.asset_key",
      )
      .all(collectionSlug, datasetSlug, fileSlug, selectedVersion);
    return rows
      .map((row) => z.object({ asset_key: z.string().min(1) }).parse(row).asset_key)
      .flatMap((assetKey) => {
        const asset = this.resolveAsset({ collectionSlug, datasetSlug, fileSlug, version: selectedVersion, assetKey });
        return asset ? [asset] : [];
      });
  }

  resolveAsset(reference: CatalogAssetReference): CatalogResolvedAsset | null {
    const storagePredicate = reference.storageLocationSlug ? "al.storage_slug = ?" : "al.is_canonical = 1";
    const identityParameters = [
      reference.collectionSlug,
      reference.datasetSlug,
      reference.fileSlug,
      reference.version,
      reference.assetKey,
    ];
    const parameters = reference.storageLocationSlug
      ? [reference.storageLocationSlug, ...identityParameters]
      : identityParameters;
    const assetChecksumMultihash = this.#assetChecksumMultihashColumn
      ? "a.checksum_multihash"
      : "NULL AS checksum_multihash";
    const assetRow = this.#db
      .prepare(
        `SELECT a.asset_path, a.asset_key, a.format_key, a.title, a.href, a.media_type, a.roles_json, a.size_bytes, a.sha256, ${assetChecksumMultihash}, al.asset_location_path, al.storage_slug, al.href AS storage_href FROM assets a JOIN versions v ON v.version_path = a.version_path JOIN files f ON f.file_path = v.file_path JOIN datasets d ON d.dataset_path = f.dataset_path JOIN collections c ON c.collection_path = d.collection_path LEFT JOIN asset_locations al ON al.asset_path = a.asset_path AND ${storagePredicate} WHERE c.collection_slug = ? AND d.dataset_slug = ? AND f.file_slug = ? AND v.version_label = ? AND a.asset_key = ?`,
      )
      .get(...parameters);
    if (!assetRow) return null;
    const asset = assetSchema.parse(assetRow);
    if (!asset.asset_location_path) return null;
    const assetObjectChecksumMultihash = this.#assetObjectChecksumMultihashColumn
      ? "checksum_multihash"
      : "NULL AS checksum_multihash";
    const objects = this.#db
      .prepare(
        `SELECT object_key, relative_path, size_bytes, sha256, ${assetObjectChecksumMultihash}, storage_revision, partition_json, covering_json, native_bbox_json, crs84_bbox_json FROM asset_objects WHERE asset_location_path = ? ORDER BY relative_path`,
      )
      .all(asset.asset_location_path)
      .map((row) => {
        const object = assetObjectSchema.parse(row);
        return {
          objectKey: object.object_key,
          relativePath: object.relative_path,
          sizeBytes: object.size_bytes,
          sha256: object.sha256,
          checksumMultihash: object.checksum_multihash,
          storageRevision: object.storage_revision,
          partitionJson: object.partition_json,
          coveringJson: object.covering_json,
          nativeBboxJson: object.native_bbox_json,
          crs84BboxJson: object.crs84_bbox_json,
        };
      });
    return { ...asset, href: asset.storage_href ?? asset.href, objects };
  }
}

export type CatalogSource = { kind: "file"; path: string } | { kind: "url"; url: string };

export interface CatalogRuntimeStatus {
  generation: string | null;
  lastSuccessfulRefresh: string | null;
  lastError: string | null;
}

/**
 * Owns the currently active local catalog. Candidate files are completely
 * copied and validated before the reference changes, preserving last-known-good
 * reads after a bad publisher artifact.
 */
export class CatalogLifecycle {
  readonly #source: CatalogSource;
  #repository: CatalogRepository | null = null;
  #directory: string | null = null;
  #fingerprint: string | null = null;
  #lastSuccessfulRefresh: string | null = null;
  #lastError: string | null = null;
  #refreshing: Promise<boolean> | null = null;
  #leases = new Map<CatalogRepository, number>();
  #retired = new Set<CatalogRepository>();

  constructor(source: CatalogSource) {
    this.#source = source;
  }

  async start(): Promise<void> {
    const refreshed = await this.refresh();
    if (!refreshed || !this.#repository) throw new Error(this.#lastError ?? "Catalog is unavailable");
  }

  status(): CatalogRuntimeStatus {
    return {
      generation: this.#repository?.metadata.catalog_generation ?? null,
      lastSuccessfulRefresh: this.#lastSuccessfulRefresh,
      lastError: this.#lastError,
    };
  }

  repository(): CatalogRepository | null {
    return this.#repository;
  }

  async withRepository<T>(read: (repository: CatalogRepository) => Awaitable<T>): Promise<T | null> {
    const repository = this.#repository;
    if (!repository) return null;
    this.#leases.set(repository, (this.#leases.get(repository) ?? 0) + 1);
    try {
      return await read(repository);
    } finally {
      const remaining = (this.#leases.get(repository) ?? 1) - 1;
      if (remaining === 0) {
        this.#leases.delete(repository);
        if (this.#retired.delete(repository)) repository.close();
      } else {
        this.#leases.set(repository, remaining);
      }
    }
  }

  refresh(): Promise<boolean> {
    if (!this.#refreshing) {
      this.#refreshing = this.#refreshImpl().finally(() => {
        this.#refreshing = null;
      });
    }
    return this.#refreshing;
  }

  async #refreshImpl(): Promise<boolean> {
    try {
      const source = await this.#sourceSnapshot();
      const fingerprint = source.fingerprint;
      if (fingerprint === this.#fingerprint && this.#repository) return false;
      if (!this.#directory) this.#directory = await mkdtemp(join(tmpdir(), "hifld-catalog-runtime-"));
      const candidatePath = join(this.#directory, `candidate-${Date.now()}.sqlite`);
      await source.write(candidatePath);
      validateCatalogDatabase(candidatePath);
      const activePath = join(this.#directory, "active.sqlite");
      await rename(candidatePath, activePath);
      const candidate = new SQLiteCatalogRepository(activePath);
      const previous = this.#repository;
      this.#repository = candidate;
      this.#fingerprint = fingerprint;
      this.#lastSuccessfulRefresh = new Date().toISOString();
      this.#lastError = null;
      if (previous) {
        if ((this.#leases.get(previous) ?? 0) === 0) previous.close();
        else this.#retired.add(previous);
      }
      return true;
    } catch (error) {
      this.#lastError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  async close(): Promise<void> {
    this.#repository?.close();
    for (const repository of this.#retired) repository.close();
    this.#retired.clear();
    this.#repository = null;
    if (this.#directory) await rm(this.#directory, { recursive: true, force: true });
    this.#directory = null;
  }

  async #sourceSnapshot(): Promise<{ fingerprint: string; write: (path: string) => Promise<void> }> {
    const source = this.#source;
    if (source.kind === "file") {
      const sourceStat = await stat(source.path);
      return {
        fingerprint: `${sourceStat.size}:${sourceStat.mtimeMs}`,
        write: async (path) => copyFile(source.path, path),
      };
    }

    const head = await fetch(source.url, { method: "HEAD", cache: "no-store" });
    if (!head.ok) throw new Error(`Catalog SQLite HEAD failed: ${head.status}`);
    const etag = head.headers.get("etag");
    const contentLength = head.headers.get("content-length");
    const sha256 = head.headers.get("x-goog-meta-sha256") ?? head.headers.get("x-amz-meta-sha256");
    if (!etag || !contentLength || !sha256)
      throw new Error("Catalog SQLite metadata must include ETag, content length, and SHA-256");
    const expectedLength = z.coerce.number().int().nonnegative().parse(contentLength);
    return {
      fingerprint: etag,
      write: async (path) => {
        const response = await fetch(source.url, {
          headers: { "If-Match": etag },
          cache: "no-store",
        });
        if (response.status === 412) throw new Error("Catalog SQLite changed during download");
        if (!response.ok) throw new Error(`Catalog SQLite download failed: ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength !== expectedLength)
          throw new Error("Catalog SQLite content length does not match metadata");
        const actualSha256 = createHash("sha256").update(bytes).digest("hex");
        if (actualSha256 !== sha256.toLowerCase()) throw new Error("Catalog SQLite checksum does not match metadata");
        await writeFile(path, bytes);
      },
    };
  }
}

/** @deprecated Use `SQLiteCatalogRepository` for an explicit concrete dependency. */
export const CatalogRepository = SQLiteCatalogRepository;
