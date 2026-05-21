/**
 * Dataset functions - now using dataset-api (Python FastAPI service)
 * All backend logic has been moved to dataset-api
 */

import {
  getDatasetById as apiGetDatasetById,
  getDatasetStats as apiGetDatasetStats,
  getDatasets as apiGetDatasets,
  type Dataset,
  type DatasetWithUrls,
  getGeoparquetUrl,
  getPmtilesUrl,
} from "@/lib/api-client";

// Re-export types
export type { Dataset, DatasetWithUrls };

// Get all datasets with optional search (returns datasets with URLs)
// Wrapper for server function - can be called from loaders or components
export async function getDatasets(search?: string): Promise<DatasetWithUrls[]> {
  return apiGetDatasets({ data: { ...(search !== undefined ? { search } : {}), includeUrls: true } });
}

// Get a single dataset by ID (with URLs)
// Wrapper for server function - can be called from loaders or components
export async function getDatasetById(id: number): Promise<DatasetWithUrls | undefined> {
  const dataset = await apiGetDatasetById({ data: { id, includeUrls: true } });
  return dataset || undefined;
}

// Get a single dataset by name (with URLs)
// Wrapper for server function - can be called from loaders or components
export async function getDatasetByName(name: string): Promise<DatasetWithUrls | undefined> {
  const datasets = await apiGetDatasets({ data: { search: name, includeUrls: true } });
  return datasets.find((d) => d.name === name);
}

// Get dataset statistics
// Wrapper for server function - can be called from loaders or components
export async function getDatasetStats(): Promise<{
  total: number;
  ready: number;
  pending: number;
  processing: number;
  error: number;
}> {
  const stats = await apiGetDatasetStats();
  // API only returns total, so we map it to the expected format
  // Since API doesn't track status, we assume all are ready
  return {
    total: stats.total,
    ready: stats.total,
    pending: 0,
    processing: 0,
    error: 0,
  };
}

// Re-export URL helper functions
export { getGeoparquetUrl, getPmtilesUrl };
