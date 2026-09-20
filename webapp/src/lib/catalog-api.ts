import { z } from "zod";
import { env } from "@/env/server";
import type {
  CatalogCollection,
  CatalogDataset,
  CatalogFile,
  CatalogFileVersion,
  CatalogPage,
  CatalogRepository,
  CatalogResolvedAsset,
  CatalogTags,
  CatalogTagValues,
  CatalogVersion,
} from "@/lib/catalog-repository";
import { activeCatalogLifecycle } from "@/lib/catalog-runtime";

const storageConfigSchema = z.object({
  type: z.enum(["gcs", "seaweedfs"]),
  base_url: z.string().url(),
  bucket: z.string().min(1),
  endpoint_url: z.string().url().optional(),
});
const storageLocationsSchema = z.record(z.string().min(1), storageConfigSchema);
export type CatalogStorageConfig = z.infer<typeof storageConfigSchema>;
export interface CatalogAsset {
  version: string;
  asset_key: string;
  format_key: string;
  title: string;
  media_type: string;
  size_bytes: number;
  sha256: string | null;
  checksum_multihash: string | null;
  storage_location_slug: string;
  storage_config: CatalogStorageConfig;
  objects: Array<{
    object_key: string;
    relative_path: string;
    size_bytes: number;
    sha256: string | null;
    checksum_multihash: string | null;
    storage_revision: string | null;
  }>;
}
function assetResponse(version: string, value: CatalogResolvedAsset): CatalogAsset | null {
  if (!value.storage_slug || !env.CATALOG_STORAGE_LOCATIONS_JSON) return null;
  const storage = storageLocationsSchema.parse(JSON.parse(env.CATALOG_STORAGE_LOCATIONS_JSON))[value.storage_slug];
  if (!storage) return null;
  return {
    version,
    asset_key: value.asset_key,
    format_key: value.format_key,
    title: value.title,
    media_type: value.media_type,
    size_bytes: value.size_bytes,
    sha256: value.sha256,
    checksum_multihash: value.checksum_multihash,
    storage_location_slug: value.storage_slug,
    storage_config: storage,
    objects: value.objects.map((object) => ({
      object_key: object.objectKey,
      relative_path: object.relativePath,
      size_bytes: object.sizeBytes,
      sha256: object.sha256,
      checksum_multihash: object.checksumMultihash,
      storage_revision: object.storageRevision,
    })),
  };
}

export interface CatalogCollectionResponse {
  collection_slug: string;
  collection_path: string;
  name: string;
  description: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface CatalogDatasetResponse {
  collection_slug: string;
  dataset_slug: string;
  dataset_path: string;
  name: string;
  description: string;
  created_at: string | null;
  updated_at: string | null;
  stac_href: string;
  tags: CatalogTags;
}

export interface CatalogFileResponse {
  collection_slug: string;
  dataset_slug: string;
  file_slug: string;
  file_path: string;
  name: string;
  description: string;
  latest_version: string | null;
  created_at: string | null;
  updated_at: string | null;
  versions: CatalogVersion[];
  assets: CatalogAsset[];
  stac_href: string | null;
  version_metadata: CatalogFileVersion[];
}

function collectionResponse(value: CatalogCollection): CatalogCollectionResponse {
  return {
    collection_slug: value.collection_slug,
    collection_path: value.collection_path,
    name: value.title,
    description: value.description,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

function datasetResponse(collectionSlug: string, value: CatalogDataset): CatalogDatasetResponse {
  return {
    collection_slug: collectionSlug,
    dataset_slug: value.dataset_slug,
    dataset_path: value.dataset_path,
    name: value.title,
    description: value.description,
    created_at: value.created_at,
    updated_at: value.updated_at,
    stac_href: value.catalog_href,
    tags: value.tags,
  };
}

function fileResponse(
  collectionSlug: string,
  datasetSlug: string,
  value: CatalogFile,
  versions: CatalogVersion[],
  assets: CatalogAsset[],
  versionMetadata: CatalogFileVersion[],
  selectedVersionMetadata: CatalogFileVersion | null,
): CatalogFileResponse {
  const assetVersion = value.latest_version ?? versions.find((version) => version.is_latest === 1)?.version_label;
  return {
    collection_slug: collectionSlug,
    dataset_slug: datasetSlug,
    file_slug: value.file_slug,
    file_path: value.file_path,
    name: value.title,
    description: value.description,
    latest_version: value.latest_version,
    created_at: value.created_at,
    updated_at: value.updated_at,
    versions,
    stac_href: selectedVersionMetadata?.collection_href ?? null,
    version_metadata: versionMetadata,
    assets: assetVersion ? assets : [],
  };
}

async function readCatalogFile(
  repository: CatalogRepository,
  collectionSlug: string,
  datasetSlug: string,
  fileSlug: string,
  version?: string,
): Promise<CatalogFileResponse | null> {
  const file = await repository.getFile(collectionSlug, datasetSlug, fileSlug);
  if (!file) return null;
  const versions = await repository.listVersions(collectionSlug, datasetSlug, fileSlug);
  const selectedVersion =
    version ?? file.latest_version ?? versions.find((item) => item.is_latest === 1)?.version_label;
  const versionLabels = version ? [version] : versions.map((item) => item.version_label);
  const assets: CatalogAsset[] = [];
  const versionMetadata: CatalogFileVersion[] = [];
  for (const versionLabel of versionLabels) {
    const metadata = await repository.getFileVersion(collectionSlug, datasetSlug, fileSlug, versionLabel);
    if (metadata) versionMetadata.push(metadata);
    for (const asset of await repository.listAssets(collectionSlug, datasetSlug, fileSlug, versionLabel)) {
      const shaped = assetResponse(versionLabel, asset);
      if (shaped) assets.push(shaped);
    }
  }
  const selectedVersionMetadata = selectedVersion
    ? (versionMetadata.find((item) => item.version_label === selectedVersion) ?? null)
    : null;
  return fileResponse(collectionSlug, datasetSlug, file, versions, assets, versionMetadata, selectedVersionMetadata);
}

export async function sqliteCatalogApi(): Promise<{
  generation: string;
  collections: () => Promise<CatalogCollectionResponse[]>;
  stats: () => Promise<{ total: number }>;
  collection: (slug: string) => Promise<CatalogCollectionResponse | null>;
  datasets: (
    collectionSlug: string,
    query: { search?: string; limit: number; offset: number; tagFilters?: CatalogTags },
  ) => Promise<CatalogPage<CatalogDatasetResponse>>;
  tags: (collectionSlug: string, tagKey?: string) => Promise<CatalogTagValues>;
  dataset: (collectionSlug: string, datasetSlug: string) => Promise<CatalogDatasetResponse | null>;
  files: (collectionSlug: string, datasetSlug: string) => Promise<CatalogFile[]>;
  file: (
    collectionSlug: string,
    datasetSlug: string,
    fileSlug: string,
    version?: string,
  ) => Promise<CatalogFileResponse | null>;
} | null> {
  const lifecycle = await activeCatalogLifecycle();
  if (!lifecycle?.repository()) return null;
  const generation = lifecycle.status().generation;
  if (!generation) return null;
  return {
    generation,
    collections: async () =>
      (await lifecycle.withRepository(async (repository) =>
        (await repository.listCollections()).map(collectionResponse),
      )) ?? [],
    stats: async () =>
      (await lifecycle.withRepository(async (repository) => {
        const collections = await repository.listCollections();
        let total = 0;
        for (const collection of collections) {
          total += (
            await repository.listDatasets(collection.collection_slug, {
              limit: 0,
              offset: 0,
            })
          ).total;
        }
        return { total };
      })) ?? { total: 0 },
    collection: async (slug) =>
      (await lifecycle.withRepository(async (repository) => {
        const collection = await repository.getCollection(slug);
        return collection ? collectionResponse(collection) : null;
      })) ?? null,
    datasets: async (collectionSlug, query) =>
      (await lifecycle.withRepository(async (repository) => {
        const page = await repository.listDatasets(collectionSlug, query);
        return { ...page, items: page.items.map((item) => datasetResponse(collectionSlug, item)) };
      })) ?? { items: [], total: 0, limit: query.limit, offset: query.offset },
    tags: async (collectionSlug, tagKey) =>
      (await lifecycle.withRepository((repository) => repository.listDatasetTags(collectionSlug, tagKey))) ?? {},
    dataset: async (collectionSlug, datasetSlug) =>
      (await lifecycle.withRepository(async (repository) => {
        const dataset = await repository.getDataset(collectionSlug, datasetSlug);
        return dataset ? datasetResponse(collectionSlug, dataset) : null;
      })) ?? null,
    files: async (collectionSlug, datasetSlug) =>
      (await lifecycle.withRepository((repository) => repository.listFiles(collectionSlug, datasetSlug))) ?? [],
    file: async (collectionSlug, datasetSlug, fileSlug, version) =>
      (await lifecycle.withRepository((repository) =>
        readCatalogFile(repository, collectionSlug, datasetSlug, fileSlug, version),
      )) ?? null,
  };
}
