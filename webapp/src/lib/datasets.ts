import { db } from "@/lib/db";
import { datasetsTable, type Dataset, type NewDataset } from "@/db/schema";
import { eq, like, or, sql } from "drizzle-orm";

// GeoServer configuration from environment
const GEOSERVER_URL =
  process.env.GEOSERVER_URL || "http://localhost:8080/geoserver";
const GEOSERVER_USER = process.env.GEOSERVER_USER || "admin";
const GEOSERVER_PASSWORD = process.env.GEOSERVER_PASSWORD || "geoserver";
const GEOSERVER_WORKSPACE = process.env.GEOSERVER_WORKSPACE || "hifld";

// Convert localhost URLs to host.docker.internal for GeoServer (running in Docker)
// This allows GeoServer to access services on the host machine
function toDockerHostUrl(url: string): string {
  // Replace localhost with host.docker.internal for Docker access
  let dockerUrl = url.replace(/localhost/g, "host.docker.internal");

  // Also handle filer URL format if present (convert /buckets/ path)
  // The filer URL format is http://localhost:8888/buckets/hifld/...
  // We keep this format as GeoServer can access via HTTP
  return dockerUrl;
}

// Get all datasets with optional search
export async function getDatasets(search?: string): Promise<Dataset[]> {
  if (search && search.trim()) {
    const searchPattern = `%${search.trim()}%`;
    return db
      .select()
      .from(datasetsTable)
      .where(
        or(
          like(datasetsTable.name, searchPattern),
          like(datasetsTable.alias, searchPattern),
          like(datasetsTable.description, searchPattern)
        )
      )
      .orderBy(datasetsTable.alias);
  }
  return db.select().from(datasetsTable).orderBy(datasetsTable.alias);
}

// Get a single dataset by ID
export async function getDatasetById(id: number): Promise<Dataset | undefined> {
  const results = await db
    .select()
    .from(datasetsTable)
    .where(eq(datasetsTable.id, id))
    .limit(1);
  return results[0];
}

// Get a single dataset by name
export async function getDatasetByName(
  name: string
): Promise<Dataset | undefined> {
  const results = await db
    .select()
    .from(datasetsTable)
    .where(eq(datasetsTable.name, name))
    .limit(1);
  return results[0];
}

// Create a new dataset
export async function createDataset(data: NewDataset): Promise<Dataset> {
  const now = new Date().toISOString();
  const result = await db
    .insert(datasetsTable)
    .values({
      ...data,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return result[0];
}

// Update a dataset
export async function updateDataset(
  id: number,
  data: Partial<NewDataset>
): Promise<Dataset | undefined> {
  const now = new Date().toISOString();
  const result = await db
    .update(datasetsTable)
    .set({
      ...data,
      updatedAt: now,
    })
    .where(eq(datasetsTable.id, id))
    .returning();
  return result[0];
}

// Delete a dataset
export async function deleteDataset(id: number): Promise<boolean> {
  const result = await db
    .delete(datasetsTable)
    .where(eq(datasetsTable.id, id))
    .returning();
  return result.length > 0;
}

// GeoServer API integration
interface GeoServerStoreConfig {
  workspace: string;
  storeName: string;
  pmtilesUrl: string;
}

interface GeoServerLayerConfig {
  workspace: string;
  storeName: string;
  layerName: string;
}

// Create authorization header for GeoServer
function getGeoServerAuthHeader(): string {
  return `Basic ${Buffer.from(`${GEOSERVER_USER}:${GEOSERVER_PASSWORD}`).toString("base64")}`;
}

// Check if GeoServer workspace exists
export async function checkWorkspaceExists(
  workspace: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `${GEOSERVER_URL}/rest/workspaces/${workspace}`,
      {
        method: "GET",
        headers: {
          Authorization: getGeoServerAuthHeader(),
          Accept: "application/json",
        },
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

// Create GeoServer workspace if it doesn't exist
export async function ensureWorkspaceExists(
  workspace: string
): Promise<boolean> {
  const exists = await checkWorkspaceExists(workspace);
  if (exists) return true;

  try {
    const response = await fetch(`${GEOSERVER_URL}/rest/workspaces`, {
      method: "POST",
      headers: {
        Authorization: getGeoServerAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspace: {
          name: workspace,
        },
      }),
    });
    return response.ok || response.status === 201;
  } catch {
    return false;
  }
}

// Create a PMTiles store in GeoServer
export async function createPMTilesStore(
  config: GeoServerStoreConfig
): Promise<boolean> {
  await ensureWorkspaceExists(config.workspace);

  try {
    const response = await fetch(
      `${GEOSERVER_URL}/rest/workspaces/${config.workspace}/datastores`,
      {
        method: "POST",
        headers: {
          Authorization: getGeoServerAuthHeader(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dataStore: {
            name: config.storeName,
            type: "PMTiles",
            connectionParameters: {
              entry: [{ "@key": "url", $: config.pmtilesUrl }],
            },
          },
        }),
      }
    );
    return response.ok || response.status === 201;
  } catch {
    return false;
  }
}

// Create a GeoParquet store in GeoServer
export async function createGeoParquetStore(
  workspace: string,
  storeName: string,
  geoparquetUrl: string
): Promise<boolean> {
  await ensureWorkspaceExists(workspace);

  // Convert localhost to host.docker.internal for GeoServer access
  const dockerUrl = toDockerHostUrl(geoparquetUrl);

  try {
    const response = await fetch(
      `${GEOSERVER_URL}/rest/workspaces/${workspace}/datastores`,
      {
        method: "POST",
        headers: {
          Authorization: getGeoServerAuthHeader(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dataStore: {
            name: storeName,
            type: "GeoParquet",
            enabled: true,
            connectionParameters: {
              entry: [
                { "@key": "dbtype", $: "geoparquet" },
                { "@key": "uri", $: dockerUrl },
              ],
            },
          },
        }),
      }
    );
    return response.ok || response.status === 201;
  } catch {
    return false;
  }
}

// Get available feature types from a store
async function getAvailableFeatureTypes(
  workspace: string,
  storeName: string
): Promise<string[]> {
  try {
    const response = await fetch(
      `${GEOSERVER_URL}/rest/workspaces/${workspace}/datastores/${storeName}/featuretypes.json?list=available`,
      {
        method: "GET",
        headers: {
          Authorization: getGeoServerAuthHeader(),
          Accept: "application/json",
        },
      }
    );
    if (response.ok) {
      const data = await response.json();
      if (data.list && data.list.string) {
        return Array.isArray(data.list.string)
          ? data.list.string
          : [data.list.string];
      }
    }
    return [];
  } catch {
    return [];
  }
}

// Publish a layer from a store
export async function publishLayer(
  config: GeoServerLayerConfig
): Promise<boolean> {
  try {
    // Get available native names from the store
    const availableTypes = await getAvailableFeatureTypes(
      config.workspace,
      config.storeName
    );

    // Use the first available type as native name, or convert hyphens to underscores
    let nativeName = config.layerName.replace(/-/g, "_");
    if (availableTypes.length > 0) {
      // Prefer an exact match or the first available
      const exactMatch = availableTypes.find(
        (t) => t === nativeName || t === config.layerName
      );
      nativeName = exactMatch || availableTypes[0];
    }

    const response = await fetch(
      `${GEOSERVER_URL}/rest/workspaces/${config.workspace}/datastores/${config.storeName}/featuretypes`,
      {
        method: "POST",
        headers: {
          Authorization: getGeoServerAuthHeader(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          featureType: {
            name: config.layerName,
            nativeName: nativeName,
            enabled: true,
          },
        }),
      }
    );
    return response.ok || response.status === 201;
  } catch {
    return false;
  }
}

// Get the OGC Feature API URL for a layer
export function getFeatureApiUrl(workspace: string, layerName: string): string {
  return `${GEOSERVER_URL}/${workspace}/ogc/features/v1/collections/${layerName}`;
}

// Get the OWS (WMS/WFS) service endpoint URL for a specific layer
export function getOwsUrl(workspace: string, layerName: string): string {
  return `${GEOSERVER_URL}/${workspace}/${layerName}/ows`;
}

// Register a dataset in the catalog and optionally add to GeoServer
export async function registerDataset(
  data: NewDataset,
  addToGeoServer: boolean = true
): Promise<{ dataset: Dataset; geoserverSuccess: boolean }> {
  const workspace = data.geoserverWorkspace || GEOSERVER_WORKSPACE;
  const storeName = data.geoserverStore || data.name;
  const layerName = data.geoserverLayer || data.name;

  let geoserverSuccess = false;

  if (addToGeoServer && data.geoparquetUrl) {
    // Create store and publish layer
    const storeCreated = await createGeoParquetStore(
      workspace,
      storeName,
      data.geoparquetUrl
    );

    if (storeCreated) {
      geoserverSuccess = await publishLayer({
        workspace,
        storeName,
        layerName,
      });
    } else {
      throw new Error("Failed to create store");
    }
  }

  // Create dataset with GeoServer info
  const dataset = await createDataset({
    ...data,
    geoserverWorkspace: workspace,
    geoserverStore: storeName,
    geoserverLayer: layerName,
    featureUrl: geoserverSuccess
      ? getFeatureApiUrl(workspace, layerName)
      : undefined,
    status: geoserverSuccess ? "ready" : data.status,
  });

  return { dataset, geoserverSuccess };
}

// Get dataset statistics
export async function getDatasetStats(): Promise<{
  total: number;
  ready: number;
  pending: number;
  processing: number;
  error: number;
}> {
  const results = await db
    .select({
      status: datasetsTable.status,
      count: sql<number>`count(*)`,
    })
    .from(datasetsTable)
    .groupBy(datasetsTable.status);

  const stats = {
    total: 0,
    ready: 0,
    pending: 0,
    processing: 0,
    error: 0,
  };

  for (const row of results) {
    const count = Number(row.count);
    stats.total += count;
    if (row.status === "ready") stats.ready = count;
    else if (row.status === "pending") stats.pending = count;
    else if (row.status === "processing") stats.processing = count;
    else if (row.status === "error") stats.error = count;
  }

  return stats;
}
