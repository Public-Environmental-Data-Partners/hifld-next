/**
 * API client for dataset-api (Python FastAPI service)
 */

const DATASET_API_URL = process.env.DATASET_API_URL || "http://localhost:8000";

export interface Dataset {
  id: number;
  name: string;
  alias: string;
  description?: string;
  type: string;
  collection_id?: number;
  created_at: string;
  updated_at: string;
}

export interface DatasetSource {
  id: number;
  version?: number;
  url?: string;
  source_type: string;
  location: Record<string, any>;
  source_metadata?: Record<string, any>;
  storage_location?: {
    id: number;
    name: string;
    backend_type: string;
  };
}

export interface DatasetFormat {
  format: {
    id: number;
    format_type: string;
    name: string;
    description?: string;
    mime_type?: string;
  };
  dataset_format: {
    id: number;
    dataset_id: number;
    format_id: number;
    description?: string;
  };
  sources: DatasetSource[];
}

export interface DatasetWithUrls extends Dataset {
  formats?: DatasetFormat[];
  geoserver_info?: {
    dataset_name: string;
    workspace: string;
    sources: Array<{
      source_id: number;
      version: number;
      storage_location_id: number;
      storage_location_name: string | null;
      workspace: string;
      store_name: string;
      layer_name: string;
      feature_url: string;
      wfs_url: string;
      wms_url: string;
      source_geoparquet_id?: number;
      source_geoparquet_version?: number;
      source_storage_location_id?: number;
    }>;
  };
}

export interface DatasetStats {
  total: number;
}

/**
 * Get all datasets across all collections
 */
export async function getDatasets(
  search?: string,
  includeUrls = false
): Promise<Dataset[]> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (includeUrls) params.set("include_urls", "true");

  const url = `${DATASET_API_URL}/api/datasets${params.toString() ? `?${params}` : ""}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch datasets: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get a single dataset by ID with optional URLs
 * Note: We need to get the collection ID first, then fetch from collection endpoint
 * For now, we'll use the global endpoint and filter
 */
export async function getDatasetById(
  id: number,
  includeUrls = false
): Promise<DatasetWithUrls | null> {
  // Get all datasets and find the one we want
  // TODO: Add direct endpoint to dataset-api for getting by ID
  const datasets = await getDatasets(undefined, includeUrls);
  const dataset = datasets.find((d) => d.id === id);
  return (dataset as DatasetWithUrls) || null;
}

/**
 * Get dataset statistics
 */
export async function getDatasetStats(): Promise<DatasetStats> {
  const response = await fetch(`${DATASET_API_URL}/api/datasets/stats`);
  if (!response.ok) {
    throw new Error(`Failed to fetch stats: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get collections
 */
export async function getCollections(): Promise<
  Array<{ id: number; name: string; description?: string }>
> {
  const response = await fetch(`${DATASET_API_URL}/api/collections`);
  if (!response.ok) {
    throw new Error(`Failed to fetch collections: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get a collection by ID
 */
export async function getCollectionById(
  id: number
): Promise<{ id: number; name: string; description?: string } | null> {
  if (!id) {
    return null;
  }
  const response = await fetch(`${DATASET_API_URL}/api/collections/${id}`);
  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`Failed to fetch collection: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get datasets in a specific collection
 */
export async function getCollectionDatasets(
  collectionId: number,
  search?: string,
  includeUrls = false
): Promise<Dataset[]> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (includeUrls) params.set("include_urls", "true");

  const url = `${DATASET_API_URL}/api/collections/${collectionId}/datasets${params.toString() ? `?${params}` : ""}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch collection datasets: ${response.statusText}`
    );
  }
  return response.json();
}

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
export function getGeoServerFormat(dataset: DatasetWithUrls): DatasetFormat | null {
  if (!dataset.formats) return null;
  return dataset.formats.find((f) => f.format.format_type === "geoserver") || null;
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
 * Get GeoPackage export URL for a specific GeoServer source
 */
export function getGeoPackageUrl(source: DatasetSource): string {
  const workspace = source.location?.workspace || "hifld";
  const storeName = source.location?.store_name || "";
  return `http://localhost:8000/api/geoserver/export/geopackage/${workspace}/${storeName}`;
}

/**
 * Get WFS URL from GeoServer source
 */
export function getWfsUrl(source: DatasetSource): string | null {
  return source.source_metadata?.wfs_url || null;
}

/**
 * Get WMS URL from GeoServer source
 */
export function getWmsUrl(source: DatasetSource): string | null {
  return source.source_metadata?.wms_url || null;
}

/**
 * Get OGC Features API URL from GeoServer source
 */
export function getOgcFeaturesUrl(source: DatasetSource): string | null {
  return source.source_metadata?.feature_api_url || null;
}

/**
 * Get full layer name (workspace:layer) from GeoServer source
 */
export function getFullLayerName(source: DatasetSource): string | null {
  const workspace = source.location?.workspace;
  const layerName = source.location?.layer_name;
  if (!workspace || !layerName) return null;
  return `${workspace}:${layerName}`;
}
