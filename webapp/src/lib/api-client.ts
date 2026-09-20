/**
 * API client for dataset-api (Python FastAPI service)
 *
 * All API functions are server functions that can be called from both
 * server (loaders) and client (components) via RPC.
 */

import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { env } from "../env/server";
import { type CatalogAsset, type CatalogFileResponse, sqliteCatalogApi } from "./catalog-api";
import { activeCatalogStacUrl } from "./catalog-runtime";
import {
  fetchStacCatalog,
  fetchStacVersionCollection,
  type StacAsset,
  type StacCatalog,
  type StacVersionCollection,
  stacColumnMetadata,
} from "./stac-view-models";

export type { CatalogAsset } from "./catalog-api";

export interface CatalogFormatSource {
  asset_key: string;
  version: string;
  source_type: "file";
  url?: string | undefined;
  storage_location: { slug: string };
  size_bytes: number;
  sha256: string | null;
  checksum_multihash: string | null;
}

export interface CatalogFormatAdapter {
  format: { format_key: string; format_type: string; name: string; mime_type: string };
  sources: CatalogFormatSource[];
}

export interface CatalogDatasetFileAdapter extends Omit<CatalogFileResponse, "assets"> {
  formats: CatalogFormatAdapter[];
  assets: CatalogAsset[];
}

function encodeObjectPath(value: string): string {
  return value
    .split("/")
    .map((segment) => {
      if (segment === ".") return "%2E";
      if (segment === "..") return "%2E%2E";
      return encodeURIComponent(segment);
    })
    .join("/");
}

function catalogAssetUrl(asset: CatalogAsset): string | undefined {
  const object = asset.objects.length === 1 ? asset.objects[0] : undefined;
  if (!object) return undefined;
  const baseUrl = asset.storage_config.base_url.replace(/\/+$/, "");
  return `${baseUrl}/${encodeURIComponent(asset.storage_config.bucket)}/${encodeObjectPath(object.object_key)}`;
}

/**
 * SQLite catalog adapter for existing format/source presentation. Identity is
 * entirely slug/asset based; it intentionally has no numeric source IDs.
 */
export const getCatalogDatasetFileBySlug = createServerFn({ method: "GET" })
  .inputValidator((data: { collectionSlug: string; datasetSlug: string; fileSlug: string; version?: string }) => data)
  .handler(async ({ data }): Promise<CatalogDatasetFileAdapter | null> => {
    const catalog = await sqliteCatalogApi();
    if (!catalog) return null;
    const file = await catalog.file(data.collectionSlug, data.datasetSlug, data.fileSlug, data.version);
    if (!file) return null;
    const formats = new Map<string, CatalogFormatAdapter>();
    for (const asset of file.assets) {
      const url = catalogAssetUrl(asset);
      const existing = formats.get(asset.format_key) ?? {
        format: {
          format_key: asset.format_key,
          format_type: asset.format_key,
          name: asset.title,
          mime_type: asset.media_type,
        },
        sources: [],
      };
      existing.sources.push({
        asset_key: asset.asset_key,
        version: asset.version,
        source_type: "file",
        url,
        storage_location: { slug: asset.storage_location_slug },
        size_bytes: asset.size_bytes,
        sha256: asset.sha256,
        checksum_multihash: asset.checksum_multihash,
      });
      formats.set(asset.format_key, existing);
    }
    return { ...file, formats: [...formats.values()], assets: file.assets };
  });

// Type definitions matching Python Pydantic models

export type FormatType = "geoparquet" | "pmtiles" | "geopackage" | "shapefile" | "geojson" | "file_geodatabase";

export type BackendType = "s3";

export type SourceType = "file" | "api";

export type DatasetTagValue = string | string[];

export interface DatasetTags {
  [tagKey: string]: DatasetTagValue;
}

export interface CollectionDatasetQuery {
  collectionId: string;
  search?: string | undefined;
  includeUrls?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  tagFilters?: DatasetTags | undefined;
}

// Location schemas
export interface FileLocation {
  version: string;
  path: string;
}

export interface ApiLocation {
  version: string;
  url: string;
  method?: string | undefined;
}

export type DatasetSourceLocation = FileLocation | ApiLocation;

// Metadata schemas
export interface ColumnSchema {
  name: string;
  type: string;
  description?: string;
  nullable: boolean;
  num_null_values?: number | undefined;
  num_unique_values?: number | undefined;
  example_values?: string[] | undefined;
  min?: number | undefined;
  max?: number | undefined;
  length?: number | undefined;
  possible_values?: string[] | undefined;
}

export interface SpatialDatasetFileMetadata {
  version: string;
  description?: string | null;
  size_bytes?: number | null;
  mime_type?: string;
  feature_count?: number;
  bounds?: [number, number, number, number]; // [minx, miny, maxx, maxy]
  geometry_type?: string; // Geometry type (e.g. "Point", "Polygon", "LineString", "Mixed")
  invalid_geometry_count?: number;
  quality_check_passed?: boolean;
  columns_hash?: string;
  columns?: ColumnSchema[];
}

export interface Dataset {
  id: string;
  slug: string; // Unique identifier for the dataset
  dataset_slug?: string | undefined;
  name: string; // Human-readable name
  description?: string | undefined;
  tags?: DatasetTags | undefined; // Searchable metadata tags (e.g. {inventory_name: "...", geometry_type: "Point", categories: ["Boundaries", "Water Supply"]})
  collection_id?: string | undefined;
  created_at: string;
  updated_at: string;
}

export interface DatasetSource {
  id: string;
  asset_key?: string | undefined;
  version?: string | number | undefined;
  url?: string | undefined;
  storage_uri?: string | undefined; // Storage URI (gs:// or s3://) for file sources
  glob_pattern?: string | undefined; // Glob pattern (gs:// or s3://) for multiple files in same location/version
  source_type: SourceType;
  location: DatasetSourceLocation;
  source_metadata?: SpatialDatasetFileMetadata | undefined;
  storage_location?: StorageLocation | undefined;
  sha256?: string | null | undefined;
  checksum_multihash?: string | null | undefined;
  created_at?: string | undefined;
  updated_at?: string | undefined;
}

// Storage location config schemas
export interface BucketStorageLocationConfig {
  version: string;
  type?: string | undefined;
  base_url: string;
  bucket: string;
  endpoint_url?: string | undefined;
}

export type StorageLocationConfig = BucketStorageLocationConfig;

export interface StorageLocation {
  id: string;
  slug?: string | undefined;
  name: string;
  backend_type: BackendType;
  description?: string | undefined;
  config?: StorageLocationConfig | undefined;
  created_at: string;
  updated_at: string;
}

export interface Format {
  id: string;
  format_type: FormatType;
  name: string;
  description?: string | undefined;
  mime_type?: string | undefined;
  created_at: string;
  updated_at: string;
}

export interface DatasetFormatJoin {
  id: string;
  dataset_id: string;
  format_id: string;
  created_at: string;
  updated_at: string;
}

export interface FileFormatJoin {
  id: string;
  file_id: string;
  format_id: string;
  created_at: string;
  updated_at: string;
}

export interface DatasetFormat {
  format: Format;
  dataset_format?: DatasetFormatJoin | undefined;
  file_format?: FileFormatJoin | undefined;
  sources: DatasetSource[];
}

export interface DatasetFile {
  id: string;
  file_slug?: string | undefined;
  dataset_id: string;
  name: string;
  slug: string;
  description?: string | undefined;
  layer_name?: string | undefined;
  source_file_path?: string | undefined;
  file_metadata?: SpatialDatasetFileMetadata | undefined;
  created_at: string;
  updated_at: string;
  formats?: DatasetFormat[] | undefined;
}

export interface DatasetWithUrls extends Dataset {
  files?: DatasetFile[] | undefined;
  formats?: DatasetFormat[] | undefined;
}

export interface DatasetFileResponse {
  dataset: Dataset;
  file: DatasetFile;
}

export interface DatasetFileVersionsResponse {
  dataset_id: string;
  file_id: string;
  formats: DatasetFormat[];
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number | null;
  offset: number;
}

export interface DatasetStats {
  total: number;
}

export interface Collection {
  id: string;
  slug: string; // Unique identifier for the collection
  collection_slug?: string | undefined;
  name: string;
  description?: string | undefined;
  created_at: string;
  updated_at: string;
}

export const publishedCatalogUrl = createServerOnlyFn(async (): Promise<string> => {
  const url = await activeCatalogStacUrl();
  if (!url) throw new Error("An active catalog STAC URL is required for published metadata");
  return url;
});

async function publishedFileResponse(
  collectionSlug: string,
  datasetSlug: string,
  file: CatalogFileResponse,
): Promise<DatasetFileResponse> {
  const sqliteUrl = await publishedCatalogUrl();
  const [datasetStac, fileStac, versionEntries] = await Promise.all([
    fetchStacCatalog(sqliteUrl, `${collectionSlug}/${datasetSlug}/catalog.json`),
    fetchStacCatalog(sqliteUrl, `${file.file_path}/catalog.json`),
    Promise.all(
      file.version_metadata.map(async (metadata) => {
        const stac = await fetchStacVersionCollection(sqliteUrl, metadata.collection_href);
        return [metadata.version_label, stac] as const;
      }),
    ),
  ]);
  return catalogFileResponse(file, datasetStac, fileStac, new Map(versionEntries));
}

function catalogCollection(
  value: {
    collection_path: string;
    collection_slug: string;
    name: string;
    description: string;
    created_at: string | null;
    updated_at: string | null;
  },
  stac: StacCatalog,
): Collection {
  return {
    id: value.collection_path,
    slug: value.collection_slug,
    collection_slug: value.collection_slug,
    name: stac.title,
    description: stac.description,
    created_at: value.created_at ?? "",
    updated_at: value.updated_at ?? "",
  };
}

function catalogDataset(
  value: {
    dataset_path: string;
    collection_slug: string;
    dataset_slug: string;
    name: string;
    description: string;
    created_at: string | null;
    updated_at: string | null;
    tags: DatasetTags;
  },
  stac: StacCatalog,
): DatasetWithUrls {
  return {
    id: value.dataset_path,
    collection_id: value.collection_slug,
    slug: value.dataset_slug,
    dataset_slug: value.dataset_slug,
    name: stac.title,
    description: stac.description,
    tags: stac.tags,
    created_at: value.created_at ?? "",
    updated_at: value.updated_at ?? "",
  };
}

function catalogSourceMetadata(
  version: string,
  metadata: StacVersionCollection | undefined,
  asset: StacAsset | undefined,
): SpatialDatasetFileMetadata | undefined {
  if (!metadata) return undefined;
  return {
    version,
    description:
      metadata.sourceVersionDescription === undefined
        ? (asset?.description ?? metadata.description)
        : metadata.sourceVersionDescription,
    ...(asset?.["file:size"] === undefined ? {} : { size_bytes: asset["file:size"] }),
    ...(asset?.type === undefined ? {} : { mime_type: asset.type }),
    ...(metadata.featureCount == null ? {} : { feature_count: metadata.featureCount }),
    ...(metadata.sourceVersionBounds === undefined
      ? metadata.bounds
        ? { bounds: [...metadata.bounds] }
        : {}
      : metadata.sourceVersionBounds
        ? { bounds: [...metadata.sourceVersionBounds] }
        : {}),
    ...(metadata.geometryType ? { geometry_type: metadata.geometryType } : {}),
    ...(metadata.quality.invalid_geometry_count == null
      ? {}
      : { invalid_geometry_count: metadata.quality.invalid_geometry_count }),
    ...(metadata.quality.passed == null ? {} : { quality_check_passed: metadata.quality.passed }),
    ...(metadata.quality.columns_hash == null ? {} : { columns_hash: metadata.quality.columns_hash }),
    columns: metadata.columns.map(catalogColumnMetadata),
  };
}

function catalogColumnMetadata(column: StacVersionCollection["columns"][number]): ColumnSchema {
  const authored = stacColumnMetadata(column);
  const min = typeof authored.min === "number" ? authored.min : Number(authored.min);
  const max = typeof authored.max === "number" ? authored.max : Number(authored.max);
  return {
    name: authored.name,
    type: authored.type,
    ...(authored.description === undefined ? {} : { description: authored.description }),
    nullable: authored.nullable,
    ...(authored.num_null_values == null ? {} : { num_null_values: authored.num_null_values }),
    ...(authored.num_unique_values == null ? {} : { num_unique_values: authored.num_unique_values }),
    ...(authored.example_values == null ? {} : { example_values: authored.example_values.map(String) }),
    ...(authored.possible_values == null ? {} : { possible_values: authored.possible_values.map(String) }),
    ...(Number.isFinite(min) ? { min } : {}),
    ...(Number.isFinite(max) ? { max } : {}),
    ...(authored.length == null ? {} : { length: authored.length }),
  };
}

function catalogFormats(
  value: CatalogFileResponse,
  versionStac: ReadonlyMap<string, StacVersionCollection>,
): DatasetFormat[] {
  const formats = new Map<string, DatasetFormat>();
  for (const asset of value.assets) {
    const stacVersion = versionStac.get(asset.version);
    const stacAsset = stacVersion?.assets[asset.asset_key];
    if (versionStac.size > 0 && !stacAsset) {
      throw new Error(`Published STAC asset not found: ${asset.version}/${asset.asset_key}`);
    }
    const existing = formats.get(asset.format_key) ?? {
      format: {
        id: asset.format_key,
        format_type: asset.format_key as FormatType,
        name: stacAsset?.title ?? asset.title,
        mime_type: stacAsset?.type ?? asset.media_type,
        created_at: value.created_at ?? "",
        updated_at: value.updated_at ?? "",
      },
      sources: [],
    };
    existing.sources.push(catalogDatasetSource(value, asset, stacVersion, stacAsset));
    formats.set(asset.format_key, existing);
  }
  return [...formats.values()];
}

function catalogDatasetSource(
  value: CatalogFileResponse,
  asset: CatalogAsset,
  stacVersion: StacVersionCollection | undefined,
  stacAsset: StacAsset | undefined,
): DatasetSource {
  const sourceMetadata = catalogSourceMetadata(asset.version, stacVersion, stacAsset);
  return {
    id: `${asset.version}/${asset.asset_key}`,
    asset_key: asset.asset_key,
    version: asset.version,
    source_type: "file",
    url: catalogAssetUrl(asset),
    sha256: asset.sha256,
    checksum_multihash: asset.checksum_multihash,
    location: { version: asset.version, path: asset.objects.map((object) => object.object_key).join(",") },
    ...(sourceMetadata ? { source_metadata: sourceMetadata } : {}),
    storage_location: {
      id: asset.storage_location_slug,
      slug: asset.storage_location_slug,
      name: asset.storage_location_slug,
      backend_type: "s3",
      config: {
        version: asset.version,
        type: asset.storage_config.type,
        base_url: asset.storage_config.base_url,
        bucket: asset.storage_config.bucket,
        ...(asset.storage_config.endpoint_url ? { endpoint_url: asset.storage_config.endpoint_url } : {}),
      },
      created_at: value.created_at ?? "",
      updated_at: value.updated_at ?? "",
    },
  };
}

export function catalogFileResponse(
  value: CatalogFileResponse,
  datasetStac?: StacCatalog,
  fileStac?: StacCatalog,
  versionStac: ReadonlyMap<string, StacVersionCollection> = new Map(),
): DatasetFileResponse {
  const dataset: Dataset = {
    id: `${value.collection_slug}/${value.dataset_slug}`,
    collection_id: value.collection_slug,
    slug: value.dataset_slug,
    dataset_slug: value.dataset_slug,
    name: datasetStac?.title ?? value.dataset_slug,
    ...(datasetStac ? { description: datasetStac.description, tags: datasetStac.tags } : {}),
    created_at: value.created_at ?? "",
    updated_at: value.updated_at ?? "",
  };
  return {
    dataset,
    file: {
      id: value.file_path,
      dataset_id: dataset.id,
      slug: value.file_slug,
      file_slug: value.file_slug,
      name: fileStac?.title ?? value.name,
      description: fileStac?.description ?? value.description,
      layer_name: undefined,
      source_file_path: undefined,
      created_at: value.created_at ?? "",
      updated_at: value.updated_at ?? "",
      formats: catalogFormats(value, versionStac),
    },
  };
}

/** Max rows returned by aggregate global dataset list (no unbounded fetch). */
const GLOBAL_DATASET_LIST_CAP = 200;
const GLOBAL_DATASET_PAGE_SIZE = 50;

async function fetchCollections(base: string): Promise<Collection[]> {
  const response = await fetch(`${base}/api/collections`);
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to fetch collections: ${response.status} ${text}`);
  }
  return (await response.json()) as Collection[];
}

function appendDatasetListParams(
  params: URLSearchParams,
  data: { search?: string | undefined; includeUrls?: boolean | undefined },
) {
  if (data.search) params.set("search", data.search);
  if (data.includeUrls) params.set("include_urls", "true");
}

async function fetchDatasetPage(
  base: string,
  collectionId: string,
  data: { search?: string | undefined; includeUrls?: boolean | undefined },
  offset: number,
): Promise<PaginatedResponse<DatasetWithUrls>> {
  const params = new URLSearchParams();
  appendDatasetListParams(params, data);
  params.set("limit", String(GLOBAL_DATASET_PAGE_SIZE));
  params.set("offset", String(offset));

  const response = await fetch(`${base}/api/collections/${collectionId}/datasets?${params}`);
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to fetch datasets for collection ${collectionId}: ${response.status} ${text}`);
  }
  return (await response.json()) as PaginatedResponse<DatasetWithUrls>;
}

function hasMoreDatasetPages(page: PaginatedResponse<DatasetWithUrls>, offset: number): boolean {
  return page.items.length >= GLOBAL_DATASET_PAGE_SIZE && offset + page.items.length < page.total;
}

/**
 * List datasets across all collections by paging each collection's API.
 * Does not call a global /api/datasets on dataset-api (not exposed there).
 */
export const getDatasets = createServerFn({ method: "GET" })
  .inputValidator((data: { search?: string | undefined; includeUrls?: boolean | undefined }) => data)
  .handler(async ({ data }) => {
    const base = env.DATASET_API_URL;
    const collections = await fetchCollections(base);
    const out: DatasetWithUrls[] = [];

    for (const c of collections) {
      let offset = 0;
      while (out.length < GLOBAL_DATASET_LIST_CAP) {
        const page = await fetchDatasetPage(base, c.id, data, offset);
        for (const item of page.items) {
          out.push(item);
          if (out.length >= GLOBAL_DATASET_LIST_CAP) {
            return out;
          }
        }
        if (!hasMoreDatasetPages(page, offset)) break;
        offset += GLOBAL_DATASET_PAGE_SIZE;
      }
    }
    return out;
  });

/**
 * Get a single dataset by ID by probing collection-scoped dataset-api routes.
 */
export const getDatasetById = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string; includeUrls?: boolean | undefined }) => data)
  .handler(async ({ data }) => {
    const base = env.DATASET_API_URL;
    const collections = await fetchCollections(base);
    const suffix = data.includeUrls ? "/urls" : "/files";

    for (const c of collections) {
      const url = `${base}/api/collections/${c.id}/datasets/${data.id}${suffix}`;
      const response = await fetch(url);
      if (response.status === 404) continue;
      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(`Failed to fetch dataset: ${response.status} ${errorText}`);
      }
      return (await response.json()) as DatasetWithUrls;
    }
    return null;
  });

/**
 * Get a single dataset by slug from a collection
 * Server function - can be called from loaders or components
 */
export const getDatasetBySlug = createServerFn({ method: "GET" })
  .inputValidator((data: { collectionSlug: string; datasetSlug: string; includeUrls?: boolean }) => data)
  .handler(async ({ data }) => {
    const catalog = await sqliteCatalogApi();
    if (catalog) {
      const dataset = await catalog.dataset(data.collectionSlug, data.datasetSlug);
      if (!dataset) return null;
      const datasetStac = await fetchStacCatalog(await publishedCatalogUrl(), dataset.stac_href);
      const result = catalogDataset(dataset, datasetStac);
      const files = await catalog.files(data.collectionSlug, data.datasetSlug);
      const responses = await Promise.all(
        files.map((file) => catalog.file(data.collectionSlug, data.datasetSlug, file.file_slug)),
      );
      return {
        ...result,
        files: (
          await Promise.all(
            responses.flatMap((file) =>
              file ? [publishedFileResponse(data.collectionSlug, data.datasetSlug, file)] : [],
            ),
          )
        ).map((response) => response.file),
      };
    }
    // Get the collection first
    const collection = await getCollectionBySlug({ data: { slug: data.collectionSlug } });
    if (!collection) {
      return null;
    }

    // Use the appropriate endpoint based on includeUrls
    const includeUrls = data.includeUrls ?? false;
    let endpoint = `/api/collections/${collection.id}/datasets/by-slug/${data.datasetSlug}`;
    if (includeUrls) {
      endpoint += "/urls";
    } else {
      endpoint += "/files"; // Default to files endpoint for file tree
    }

    const url = `${env.DATASET_API_URL}${endpoint}`;
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to fetch dataset: ${response.status} ${errorText}`);
    }

    return (await response.json()) as DatasetWithUrls;
  });

/**
 * Get a single file by ID within a dataset by ID (includes URLs)
 */
export const getDatasetFileById = createServerFn({ method: "GET" })
  .inputValidator((data: { collectionId: string; datasetId: string; fileId: string }) => data)
  .handler(async ({ data }) => {
    const url = `${env.DATASET_API_URL}/api/collections/${data.collectionId}/datasets/${data.datasetId}/files/${data.fileId}`;
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to fetch dataset file: ${response.status} ${errorText}`);
    }
    return (await response.json()) as DatasetFileResponse;
  });

export const getFileVersions = createServerFn({ method: "GET" })
  .inputValidator((data: { collectionId: string; datasetId: string; fileId: string }) => data)
  .handler(async ({ data }) => {
    const url = `${env.DATASET_API_URL}/api/collections/${data.collectionId}/datasets/${data.datasetId}/files/${data.fileId}/versions`;
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to fetch file versions: ${response.status} ${errorText}`);
    }
    return (await response.json()) as DatasetFileVersionsResponse;
  });

/**
 * Get a single file by slug within a dataset by slug (includes URLs)
 */
export const getDatasetFileBySlug = createServerFn({ method: "GET" })
  .inputValidator((data: { collectionSlug: string; datasetSlug: string; fileSlug: string }) => data)
  .handler(async ({ data }) => {
    const catalog = await sqliteCatalogApi();
    if (catalog) {
      const file = await catalog.file(data.collectionSlug, data.datasetSlug, data.fileSlug);
      return file ? publishedFileResponse(data.collectionSlug, data.datasetSlug, file) : null;
    }
    const collection = await getCollectionBySlug({ data: { slug: data.collectionSlug } });
    if (!collection) {
      console.error("[getDatasetFileBySlug] Collection not found:", data.collectionSlug);
      return null;
    }
    const url = `${env.DATASET_API_URL}/api/collections/${collection.id}/datasets/by-slug/${data.datasetSlug}/files/${data.fileSlug}`;
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to fetch dataset file: ${response.status} ${errorText}`);
    }
    return (await response.json()) as DatasetFileResponse;
  });

/**
 * Get dataset statistics
 * Server function - can be called from loaders or components
 */
export const loadDatasetStats = createServerOnlyFn(async (): Promise<DatasetStats> => {
  const catalog = await sqliteCatalogApi();
  if (catalog) return catalog.stats();

  const base = env.DATASET_API_URL;
  const collections = await fetchCollections(base);
  let total = 0;
  for (const c of collections) {
    const r = await fetch(`${base}/api/collections/${c.id}/datasets/stats`);
    if (!r.ok) continue;
    const j = (await r.json()) as { total?: number };
    total += typeof j.total === "number" ? j.total : 0;
  }
  return { total } satisfies DatasetStats;
});

export const getDatasetStats = createServerFn({ method: "GET" }).handler(async () => loadDatasetStats());

/**
 * Get collections
 * Server function - can be called from loaders or components
 */
export const getCollections = createServerFn({ method: "GET" }).handler(async () => {
  const catalog = await sqliteCatalogApi();
  if (catalog) {
    return Promise.all(
      (await catalog.collections()).map(async (collection) =>
        catalogCollection(
          collection,
          await fetchStacCatalog(await publishedCatalogUrl(), `${collection.collection_path}/catalog.json`),
        ),
      ),
    );
  }
  const response = await fetch(`${env.DATASET_API_URL}/api/collections`);
  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to fetch collections: ${response.status} ${errorText}`);
  }
  return (await response.json()) as Collection[];
});

/**
 * Get a collection by ID
 * Server function - can be called from loaders or components
 */
export const getCollectionById = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    if (!data.id) {
      return null;
    }
    const response = await fetch(`${env.DATASET_API_URL}/api/collections/${data.id}`);
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to fetch collection: ${response.status} ${errorText}`);
    }
    return (await response.json()) as Collection;
  });

/**
 * Get a collection by slug
 * Server function - can be called from loaders or components
 */
export const getCollectionBySlug = createServerFn({ method: "GET" })
  .inputValidator((data: { slug: string }) => data)
  .handler(async ({ data }) => {
    const catalog = await sqliteCatalogApi();
    if (catalog) {
      const collection = await catalog.collection(data.slug);
      return collection
        ? catalogCollection(
            collection,
            await fetchStacCatalog(await publishedCatalogUrl(), `${collection.collection_path}/catalog.json`),
          )
        : null;
    }
    if (!data.slug) {
      return null;
    }
    // Fetch all collections and find by slug
    const collections = await getCollections();
    const collection = collections.find((c: Collection) => c.slug === data.slug);
    return collection || null;
  });

/**
 * Get datasets in a specific collection
 * Server function - can be called from loaders or components
 */
export const getCollectionDatasets = createServerFn({ method: "GET" })
  .inputValidator((data: CollectionDatasetQuery) => data)
  .handler(async ({ data }) => {
    const params = new URLSearchParams();
    if (data.search) params.set("search", data.search);
    if (data.includeUrls) params.set("include_urls", "true");
    if (data.limit !== undefined) params.set("limit", data.limit.toString());
    if (data.offset !== undefined) params.set("offset", data.offset.toString());
    if (data.tagFilters && Object.keys(data.tagFilters).length > 0) {
      params.set("tag_filters", JSON.stringify(data.tagFilters));
    }

    const url = `${env.DATASET_API_URL}/api/collections/${data.collectionId}/datasets${params.toString() ? `?${params}` : ""}`;

    try {
      // Add a timeout to prevent hanging requests
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 second timeout

      const response = await fetch(url, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(`Failed to fetch collection datasets: ${response.status} ${errorText}`);
      }
      const result = await response.json();
      return result as PaginatedResponse<DatasetWithUrls>;
    } catch (error) {
      // Log the error for debugging
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          "Request timeout: The server took too long to respond. This may be due to slow URL computation. Please try again or contact support.",
        );
      }
      console.error(`Error fetching collection datasets:`, {
        url,
        collectionId: data.collectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });

/**
 * Get datasets in a specific collection by collection slug
 * Server function - can be called from loaders or components
 */
export const getCollectionDatasetsBySlug = createServerFn({ method: "GET" })
  .inputValidator(
    (data: {
      collectionSlug: string;
      search?: string | undefined;
      includeUrls?: boolean | undefined;
      limit?: number | undefined;
      offset?: number | undefined;
      tagFilters?: DatasetTags | undefined;
    }) => data,
  )
  .handler(async ({ data }) => {
    const catalog = await sqliteCatalogApi();
    if (catalog) {
      const page = await catalog.datasets(data.collectionSlug, {
        ...(data.search ? { search: data.search } : {}),
        ...(data.tagFilters ? { tagFilters: data.tagFilters } : {}),
        limit: data.limit ?? 50,
        offset: data.offset ?? 0,
      });
      const items = await Promise.all(
        page.items.map(async (dataset) =>
          catalogDataset(dataset, await fetchStacCatalog(await publishedCatalogUrl(), dataset.stac_href)),
        ),
      );
      return { items, total: page.total, limit: page.limit, offset: page.offset };
    }
    // First get the collection by slug to get its ID
    const collection = await getCollectionBySlug({ data: { slug: data.collectionSlug } });
    if (!collection) {
      throw new Error(`Collection not found: ${data.collectionSlug}`);
    }
    // Then use the existing function with the collection ID
    return getCollectionDatasets({
      data: {
        collectionId: collection.id,
        ...(data.search !== undefined ? { search: data.search } : {}),
        ...(data.includeUrls !== undefined ? { includeUrls: data.includeUrls } : {}),
        ...(data.limit !== undefined ? { limit: data.limit } : {}),
        ...(data.offset !== undefined ? { offset: data.offset } : {}),
        ...(data.tagFilters !== undefined ? { tagFilters: data.tagFilters } : {}),
      },
    });
  });

/**
 * Get available tag values for a collection
 * Server function - can be called from loaders or components
 */
export const getCollectionTagValues = createServerFn({ method: "GET" })
  .inputValidator((data: { collectionId: string; tagKey?: string | undefined }) => data)
  .handler(async ({ data }) => {
    const catalog = await sqliteCatalogApi();
    if (catalog) return catalog.tags(data.collectionId, data.tagKey);
    const params = new URLSearchParams();
    if (data.tagKey) params.set("tag_key", data.tagKey);

    const url = `${env.DATASET_API_URL}/api/collections/${data.collectionId}/datasets/tags${params.toString() ? `?${params}` : ""}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(`Failed to fetch collection tag values: ${response.status} ${errorText}`);
      }
      return response.json();
    } catch (error) {
      console.error(`Error fetching collection tag values:`, {
        url,
        collectionId: data.collectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });

/**
 * Get available tag values for a collection by slug
 * Server function - can be called from loaders or components
 */
export const getCollectionTagValuesBySlug = createServerFn({ method: "GET" })
  .inputValidator((data: { collectionSlug: string; tagKey?: string | undefined }) => data)
  .handler(async ({ data }) => {
    const collection = await getCollectionBySlug({ data: { slug: data.collectionSlug } });
    if (!collection) {
      throw new Error(`Collection not found: ${data.collectionSlug}`);
    }
    return getCollectionTagValues({
      data: {
        collectionId: collection.id,
        ...(data.tagKey !== undefined ? { tagKey: data.tagKey } : {}),
      },
    });
  });

/**
 * Extract GeoParquet URL from dataset with URLs
 */
export function getGeoparquetUrl(dataset: DatasetWithUrls): string | null {
  if (!dataset.formats) return null;
  const geoparquetFormat = dataset.formats.find((f) => f.format.format_type === "geoparquet");
  return geoparquetFormat?.sources[0]?.url || null;
}

/**
 * Extract PMTiles URL from dataset with URLs
 */
export function getPmtilesUrl(dataset: DatasetWithUrls): string | null {
  if (!dataset.formats) return null;
  const pmtilesFormat = dataset.formats.find((f) => f.format.format_type === "pmtiles");
  return pmtilesFormat?.sources[0]?.url || null;
}
