/**
 * API client for dataset-api (Python FastAPI service)
 *
 * All API functions are server functions that can be called from both
 * server (loaders) and client (components) via RPC.
 */

import { createServerFn } from "@tanstack/react-start";
import { env } from "../env/server";

// Type definitions matching Python Pydantic models

export type FormatType =
  | "geoparquet"
  | "pmtiles"
  | "geoserver"
  | "geopackage"
  | "shapefile"
  | "geojson"
  | "file_geodatabase";

export type BackendType = "s3" | "geoserver";

export type SourceType = "file" | "api" | "service";

// Location schemas
export interface FileLocation {
  version: string;
  path: string;
}

export interface ApiLocation {
  version: string;
  url: string;
  method?: string;
}

export interface GeoServerLocation {
  version: string;
  workspace: string;
  store_name: string;
  layer_name: string;
}

export type DatasetSourceLocation =
  | FileLocation
  | ApiLocation
  | GeoServerLocation;

// Metadata schemas
export interface ColumnSchema {
  name: string;
  type: string;
  description?: string;
  nullable: boolean;
  num_null_values?: number;
  num_unique_values?: number;
  example_values?: string[];
  min?: number;
  max?: number;
  length?: number;
  possible_values?: string[];
}

export interface SpatialDatasetFileMetadata {
  version: string;
  size_bytes?: number;
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
  id: number;
  slug: string; // Unique identifier for the dataset
  name: string; // Human-readable name
  description?: string;
  tags?: Record<string, string | string[]>; // Searchable metadata tags (e.g. {inventory_name: "...", geometry_type: "Point", categories: ["Boundaries", "Water Supply"]})
  collection_id?: number;
  created_at: string;
  updated_at: string;
}

export interface DatasetSource {
  id: number;
  version?: string | number;
  url?: string;
  storage_uri?: string; // Storage URI (gs:// or s3://) for file sources
  glob_pattern?: string; // Glob pattern (gs:// or s3://) for multiple files in same location/version
  source_type: SourceType;
  location: DatasetSourceLocation;
  source_metadata?: SpatialDatasetFileMetadata;
  storage_location?: StorageLocation;
}

// Storage location config schemas
export interface BucketStorageLocationConfig {
  version: string;
  base_url: string;
  bucket: string;
}

export interface GeoServerStorageLocationConfig {
  version: string;
  base_url: string;
  workspace: string;
}

export type StorageLocationConfig =
  | BucketStorageLocationConfig
  | GeoServerStorageLocationConfig;

export interface StorageLocation {
  id: number;
  name: string;
  backend_type: BackendType;
  description?: string;
  config?: StorageLocationConfig;
  created_at: string;
  updated_at: string;
}

export interface Format {
  id: number;
  format_type: FormatType;
  name: string;
  description?: string;
  mime_type?: string;
  created_at: string;
  updated_at: string;
}

export interface DatasetFormatJoin {
  id: number;
  dataset_id: number;
  format_id: number;
  created_at: string;
  updated_at: string;
}

export interface DatasetFormat {
  format: Format;
  dataset_format: DatasetFormatJoin;
  sources: DatasetSource[];
}

export interface DatasetFile {
  id: number;
  dataset_id: number;
  name: string;
  slug: string;
  description?: string;
  layer_name?: string;
  source_file_path?: string;
  file_metadata?: SpatialDatasetFileMetadata;
  created_at: string;
  updated_at: string;
  formats?: DatasetFormat[];
}

export interface DatasetWithUrls extends Dataset {
  files?: DatasetFile[];
}

export interface DatasetFileResponse {
  dataset: Dataset;
  file: DatasetFile;
}

export interface DatasetFileVersionsResponse {
  dataset_id: number;
  file_id: number;
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
  id: number;
  slug: string; // Unique identifier for the collection
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

/** Max rows returned by aggregate global dataset list (no unbounded fetch). */
const GLOBAL_DATASET_LIST_CAP = 200;

/**
 * List datasets across all collections by paging each collection's API.
 * Does not call a global /api/datasets on dataset-api (not exposed there).
 */
export const getDatasets = createServerFn({ method: "GET" })
  .inputValidator((data: { search?: string; includeUrls?: boolean }) => data)
  .handler(async ({ data }) => {
    const base = env.DATASET_API_URL;
    const colRes = await fetch(`${base}/api/collections`);
    if (!colRes.ok) {
      const t = await colRes.text().catch(() => colRes.statusText);
      throw new Error(`Failed to fetch collections: ${colRes.status} ${t}`);
    }
    const collections = (await colRes.json()) as Collection[];
    const out: DatasetWithUrls[] = [];
    const pageSize = 50;

    for (const c of collections) {
      let offset = 0;
      while (out.length < GLOBAL_DATASET_LIST_CAP) {
        const params = new URLSearchParams();
        if (data.search) params.set("search", data.search);
        if (data.includeUrls) params.set("include_urls", "true");
        params.set("limit", String(pageSize));
        params.set("offset", String(offset));
        const url = `${base}/api/collections/${c.id}/datasets?${params}`;
        const pageRes = await fetch(url);
        if (!pageRes.ok) {
          const t = await pageRes.text().catch(() => pageRes.statusText);
          throw new Error(
            `Failed to fetch datasets for collection ${c.id}: ${pageRes.status} ${t}`
          );
        }
        const page = (await pageRes.json()) as PaginatedResponse<DatasetWithUrls>;
        for (const item of page.items) {
          out.push(item);
          if (out.length >= GLOBAL_DATASET_LIST_CAP) {
            return out;
          }
        }
        if (page.items.length < pageSize) break;
        if (offset + page.items.length >= page.total) break;
        offset += pageSize;
      }
    }
    return out;
  });

/**
 * Get a single dataset by ID by probing collection-scoped dataset-api routes.
 */
export const getDatasetById = createServerFn({ method: "GET" })
  .inputValidator((data: { id: number; includeUrls?: boolean }) => data)
  .handler(async ({ data }) => {
    const base = env.DATASET_API_URL;
    const colRes = await fetch(`${base}/api/collections`);
    if (!colRes.ok) {
      const t = await colRes.text().catch(() => colRes.statusText);
      throw new Error(`Failed to fetch collections: ${colRes.status} ${t}`);
    }
    const collections = (await colRes.json()) as Collection[];
    const suffix = data.includeUrls ? "/urls" : "/files";

    for (const c of collections) {
      const url = `${base}/api/collections/${c.id}/datasets/${data.id}${suffix}`;
      const response = await fetch(url);
      if (response.status === 404) continue;
      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(
          `Failed to fetch dataset: ${response.status} ${errorText}`
        );
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
      throw new Error(
        `Failed to fetch dataset: ${response.status} ${errorText}`
      );
    }
    
    return (await response.json()) as DatasetWithUrls;
  });

/**
 * Get a single file by ID within a dataset by ID (includes URLs)
 */
export const getDatasetFileById = createServerFn({ method: "GET" })
  .inputValidator(
    (data: {
      collectionId: number;
      datasetId: number;
      fileId: number;
    }) => data
  )
  .handler(async ({ data }) => {
    const url = `${env.DATASET_API_URL}/api/collections/${data.collectionId}/datasets/${data.datasetId}/files/${data.fileId}`;
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(
        `Failed to fetch dataset file: ${response.status} ${errorText}`
      );
    }
    return (await response.json()) as DatasetFileResponse;
  });

export const getFileVersions = createServerFn({ method: "GET" })
  .inputValidator(
    (data: {
      collectionId: number;
      datasetId: number;
      fileId: number;
    }) => data
  )
  .handler(async ({ data }) => {
    const url = `${env.DATASET_API_URL}/api/collections/${data.collectionId}/datasets/${data.datasetId}/files/${data.fileId}/versions`;
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(
        `Failed to fetch file versions: ${response.status} ${errorText}`
      );
    }
    return (await response.json()) as DatasetFileVersionsResponse;
  });

/**
 * Get a single file by slug within a dataset by slug (includes URLs)
 */
export const getDatasetFileBySlug = createServerFn({ method: "GET" })
  .inputValidator(
    (data: {
      collectionSlug: string;
      datasetSlug: string;
      fileSlug: string;
    }) => data
  )
  .handler(async ({ data }) => {
    const collection = await getCollectionBySlug({ data: { slug: data.collectionSlug } });
    if (!collection) {
      console.error("[getDatasetFileBySlug] Collection not found:", data.collectionSlug);
      return null;
    }
    const url = `${env.DATASET_API_URL}/api/collections/${collection.id}/datasets/by-slug/${data.datasetSlug}/files/${data.fileSlug}`;
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(
        `Failed to fetch dataset file: ${response.status} ${errorText}`
      );
    }
    return (await response.json()) as DatasetFileResponse;
  });

/**
 * Get dataset statistics
 * Server function - can be called from loaders or components
 */
export const getDatasetStats = createServerFn({ method: "GET" }).handler(
  async () => {
    const base = env.DATASET_API_URL;
    const colRes = await fetch(`${base}/api/collections`);
    if (!colRes.ok) {
      const t = await colRes.text().catch(() => colRes.statusText);
      throw new Error(`Failed to fetch collections: ${colRes.status} ${t}`);
    }
    const collections = (await colRes.json()) as Collection[];
    let total = 0;
    for (const c of collections) {
      const r = await fetch(`${base}/api/collections/${c.id}/datasets/stats`);
      if (!r.ok) continue;
      const j = (await r.json()) as { total?: number };
      total += typeof j.total === "number" ? j.total : 0;
    }
    return { total } satisfies DatasetStats;
  }
);

/**
 * Get collections
 * Server function - can be called from loaders or components
 */
export const getCollections = createServerFn({ method: "GET" }).handler(
  async () => {
    const response = await fetch(`${env.DATASET_API_URL}/api/collections`);
    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(
        `Failed to fetch collections: ${response.status} ${errorText}`
      );
    }
    return response.json();
  }
);

/**
 * Get a collection by ID
 * Server function - can be called from loaders or components
 */
export const getCollectionById = createServerFn({ method: "GET" })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    if (!data.id) {
      return null;
    }
    const response = await fetch(
      `${env.DATASET_API_URL}/api/collections/${data.id}`
    );
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(
        `Failed to fetch collection: ${response.status} ${errorText}`
      );
    }
    return response.json();
  });

/**
 * Get a collection by slug
 * Server function - can be called from loaders or components
 */
export const getCollectionBySlug = createServerFn({ method: "GET" })
  .inputValidator((data: { slug: string }) => data)
  .handler(async ({ data }) => {
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
  .inputValidator(
    (data: {
      collectionId: number;
      search?: string;
      includeUrls?: boolean;
      limit?: number;
      offset?: number;
      tagFilters?: Record<string, string | string[]>;
    }) => data
  )
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
        const errorText = await response
          .text()
          .catch(() => response.statusText);
        throw new Error(
          `Failed to fetch collection datasets: ${response.status} ${errorText}`
        );
      }
      const result = await response.json();
      return result as PaginatedResponse<DatasetWithUrls>;
    } catch (error) {
      // Log the error for debugging
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout: The server took too long to respond. This may be due to slow URL computation. Please try again or contact support.');
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
      search?: string;
      includeUrls?: boolean;
      limit?: number;
      offset?: number;
      tagFilters?: Record<string, string | string[]>;
    }) => data
  )
  .handler(async ({ data }) => {
    // First get the collection by slug to get its ID
    const collection = await getCollectionBySlug({ data: { slug: data.collectionSlug } });
    if (!collection) {
      throw new Error(`Collection not found: ${data.collectionSlug}`);
    }
    // Then use the existing function with the collection ID
    return getCollectionDatasets({
      data: {
        collectionId: collection.id,
        search: data.search,
        includeUrls: data.includeUrls,
        limit: data.limit,
        offset: data.offset,
        tagFilters: data.tagFilters,
      },
    });
  });

/**
 * Get available tag values for a collection
 * Server function - can be called from loaders or components
 */
export const getCollectionTagValues = createServerFn({ method: "GET" })
  .inputValidator((data: { collectionId: number; tagKey?: string }) => data)
  .handler(async ({ data }) => {
    const params = new URLSearchParams();
    if (data.tagKey) params.set("tag_key", data.tagKey);

    const url = `${env.DATASET_API_URL}/api/collections/${data.collectionId}/datasets/tags${params.toString() ? `?${params}` : ""}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        const errorText = await response
          .text()
          .catch(() => response.statusText);
        throw new Error(
          `Failed to fetch collection tag values: ${response.status} ${errorText}`
        );
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
  .inputValidator((data: { collectionSlug: string; tagKey?: string }) => data)
  .handler(async ({ data }) => {
    const collection = await getCollectionBySlug({ data: { slug: data.collectionSlug } });
    if (!collection) {
      throw new Error(`Collection not found: ${data.collectionSlug}`);
    }
    return getCollectionTagValues({
      data: {
        collectionId: collection.id,
        tagKey: data.tagKey,
      },
    });
  });

/**
 * Extract GeoParquet URL from dataset with URLs
 */
export function getGeoparquetUrl(dataset: DatasetWithUrls): string | null {
  if (!dataset.formats) return null;
  const geoparquetFormat = dataset.formats.find(
    (f) => f.format.format_type === "geoparquet"
  );
  return geoparquetFormat?.sources[0]?.url || null;
}

/**
 * Extract PMTiles URL from dataset with URLs
 */
export function getPmtilesUrl(dataset: DatasetWithUrls): string | null {
  if (!dataset.formats) return null;
  const pmtilesFormat = dataset.formats.find(
    (f) => f.format.format_type === "pmtiles"
  );
  return pmtilesFormat?.sources[0]?.url || null;
}

/**
 * Get GeoServer format from dataset
 */
export function getGeoServerFormat(
  dataset: DatasetWithUrls
): DatasetFormat | null {
  if (!dataset.formats) return null;
  return (
    dataset.formats.find((f) => f.format.format_type === "geoserver") || null
  );
}

/**
 * Check if dataset has GeoServer sources available
 */
export function hasGeoServerSources(dataset: DatasetWithUrls): boolean {
  const geoserverFormat = getGeoServerFormat(dataset);
  return !!(geoserverFormat && geoserverFormat.sources.length > 0);
}

/**
 * Get all GeoServer sources for a dataset
 */
export function getGeoServerSources(dataset: DatasetWithUrls): DatasetSource[] {
  const geoserverFormat = getGeoServerFormat(dataset);
  return geoserverFormat?.sources || [];
}

/**
 * Get GeoPackage export URL from GeoServer source
 * Constructs URL from storage location + dataset source using WFS GetFeature with outputFormat=geopkg
 */
export function getGeoPackageUrl(
  source: DatasetSource,
  storageLocation: StorageLocation
): string | null {
  const config = storageLocation.config as
    | GeoServerStorageLocationConfig
    | undefined;
  if (!config?.base_url) return null;
  const location = source.location as GeoServerLocation;
  const workspace = location.workspace || "hifld";
  const layerName = location.layer_name || location.store_name || "";
  // GeoServer WFS GetFeature with GeoPackage output format
  return `${config.base_url}/${workspace}/wfs?service=wfs&version=2.0.0&request=GetFeature&typeNames=${workspace}:${layerName}&outputFormat=geopkg`;
}

/**
 * Get GeoJSON download URL from GeoServer source
 * Constructs URL from storage location + dataset source
 */
export function getGeoJsonUrl(
  source: DatasetSource,
  storageLocation: StorageLocation
): string | null {
  const config = storageLocation.config as
    | GeoServerStorageLocationConfig
    | undefined;
  if (!config?.base_url) return null;
  const location = source.location as GeoServerLocation;
  const workspace = location.workspace || "hifld";
  const layerName = location.layer_name || location.store_name || "";
  // GeoServer WFS GetFeature with GeoJSON output format
  return `${config.base_url}/${workspace}/wfs?service=wfs&version=2.0.0&request=GetFeature&typeNames=${workspace}:${layerName}&outputFormat=application/json`;
}

/**
 * Get Shapefile download URL from GeoServer source.
 * Constructs URL from storage location + dataset source.
 */
export function getShapefileUrl(
  source: DatasetSource,
  storageLocation: StorageLocation
): string | null {
  const config = storageLocation.config as
    | GeoServerStorageLocationConfig
    | undefined;
  if (!config?.base_url) return null;
  const location = source.location as GeoServerLocation;
  const workspace = location.workspace || "hifld";
  const layerName = location.layer_name || location.store_name || "";
  // GeoServer WFS GetFeature with Shapefile output format (zip)
  return `${config.base_url}/${workspace}/wfs?service=wfs&version=2.0.0&request=GetFeature&typeNames=${workspace}:${layerName}&outputFormat=shape-zip`;
}

/**
 * Get WFS URL from GeoServer source
 * Constructs URL from storage location + dataset source
 */
export function getWfsUrl(
  source: DatasetSource,
  storageLocation: StorageLocation
): string | null {
  const config = storageLocation.config as
    | GeoServerStorageLocationConfig
    | undefined;
  if (!config?.base_url) return null;
  const location = source.location as GeoServerLocation;
  const workspace = location.workspace || "hifld";
  return `${config.base_url}/${workspace}/wfs`;
}

/**
 * Get WMS URL from GeoServer source
 * Constructs URL from storage location + dataset source
 */
export function getWmsUrl(
  source: DatasetSource,
  storageLocation: StorageLocation
): string | null {
  const config = storageLocation.config as
    | GeoServerStorageLocationConfig
    | undefined;
  if (!config?.base_url) return null;
  const location = source.location as GeoServerLocation;
  const workspace = location.workspace || "hifld";
  return `${config.base_url}/${workspace}/wms`;
}

/**
 * Get OGC Features API URL from GeoServer source
 * Constructs URL from storage location + dataset source
 */
export function getOgcFeaturesUrl(
  source: DatasetSource,
  storageLocation: StorageLocation
): string | null {
  const config = storageLocation.config as
    | GeoServerStorageLocationConfig
    | undefined;
  if (!config?.base_url) return null;
  const location = source.location as GeoServerLocation;
  const workspace = location.workspace || "hifld";
  const layerName = location.layer_name || "";
  return `${config.base_url}/${workspace}/ogc/features/v1/collections/${layerName}`;
}

/**
 * Get full layer name (workspace:layer) from GeoServer source
 */
export function getFullLayerName(source: DatasetSource): string | null {
  const location = source.location as GeoServerLocation;
  const workspace = location.workspace;
  const layerName = location.layer_name;
  if (!workspace || !layerName) return null;
  return `${workspace}:${layerName}`;
}
