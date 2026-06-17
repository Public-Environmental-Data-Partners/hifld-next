import { z } from "zod";
import { env } from "@/env/server";

const SITEMAP_DATASET_PAGE_SIZE = 500;

export const STATIC_SITEMAP_PATHS = [
  "/",
  "/collections",
  "/about",
  "/commons",
  "/api",
  "/api/openapi",
  "/llms.txt",
  "/.well-known/api-catalog",
  "/.well-known/agent-skills/index.json",
] as const;

const collectionSchema = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
});

const datasetSchema = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  files: z
    .array(
      z.object({
        id: z.number(),
        slug: z.string(),
        name: z.string(),
      }),
    )
    .optional(),
});

const datasetPageSchema = z.object({
  items: z.array(datasetSchema),
  total: z.number(),
  limit: z.number().nullable(),
  offset: z.number(),
});

const sitemapEntrySchema = z.object({
  collection_slug: z.string(),
  dataset_slug: z.string(),
  file_slug: z.string().nullable(),
});

export type SitemapCollection = z.infer<typeof collectionSchema>;
export type SitemapDataset = z.infer<typeof datasetSchema>;
export type SitemapDatasetFile = NonNullable<SitemapDataset["files"]>[number];
export type SitemapEntry = z.infer<typeof sitemapEntrySchema>;

export interface SitemapDatasetGroup {
  collection: SitemapCollection;
  datasets: SitemapDataset[];
}

export interface SitemapFetchClient {
  fetchSitemapEntries: () => Promise<SitemapEntry[]>;
  fetchCollections: () => Promise<SitemapCollection[]>;
  fetchDatasetPage: (collectionId: number, limit: number, offset: number) => Promise<z.infer<typeof datasetPageSchema>>;
  fetchDatasetFiles: (collectionId: number, datasetSlug: string) => Promise<SitemapDatasetFile[]>;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toAbsoluteUrl(origin: string, path: string): string {
  return new URL(path, origin).href;
}

export function buildSitemapXmlFromPaths(origin: string, paths: string[]): string {
  const urls = paths
    .map((path) => {
      const loc = escapeXml(toAbsoluteUrl(origin, path));
      return `  <url>\n    <loc>${loc}</loc>\n    <changefreq>weekly</changefreq>\n  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

export function buildStaticSitemapXml(origin: string): string {
  return buildSitemapXmlFromPaths(origin, [...STATIC_SITEMAP_PATHS]);
}

export function buildCatalogSitemapPaths(groups: SitemapDatasetGroup[]): string[] {
  const paths: string[] = [...STATIC_SITEMAP_PATHS];

  for (const group of groups) {
    const collectionSlug = encodeURIComponent(group.collection.slug);
    paths.push(`/collections/${collectionSlug}`);

    for (const dataset of group.datasets) {
      const datasetSlug = encodeURIComponent(dataset.slug);
      paths.push(`/collections/${collectionSlug}/datasets/${datasetSlug}`);
      for (const file of dataset.files ?? []) {
        paths.push(`/collections/${collectionSlug}/datasets/${datasetSlug}/files/${encodeURIComponent(file.slug)}`);
      }
    }
  }

  return paths;
}

export function buildCatalogSitemapPathsFromEntries(entries: SitemapEntry[]): string[] {
  const paths = new Set<string>(STATIC_SITEMAP_PATHS);

  for (const entry of entries) {
    const collectionSlug = encodeURIComponent(entry.collection_slug);
    const datasetSlug = encodeURIComponent(entry.dataset_slug);
    const datasetPath = `/collections/${collectionSlug}/datasets/${datasetSlug}`;

    paths.add(`/collections/${collectionSlug}`);
    paths.add(datasetPath);

    if (entry.file_slug) {
      paths.add(`${datasetPath}/files/${encodeURIComponent(entry.file_slug)}`);
    }
  }

  return [...paths];
}

async function fetchJson(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to fetch sitemap data from ${url}: ${response.status} ${text}`);
  }
  return response;
}

export function createDatasetApiSitemapClient(baseUrl: string): SitemapFetchClient {
  return {
    async fetchSitemapEntries() {
      const response = await fetchJson(`${baseUrl}/api/sitemap-entries`);
      return z.array(sitemapEntrySchema).parse(await response.json());
    },
    async fetchCollections() {
      const response = await fetchJson(`${baseUrl}/api/collections`);
      return z.array(collectionSchema).parse(await response.json());
    },
    async fetchDatasetPage(collectionId, limit, offset) {
      const params = new URLSearchParams({
        include_urls: "false",
        limit: String(limit),
        offset: String(offset),
      });
      const response = await fetchJson(`${baseUrl}/api/collections/${collectionId}/datasets?${params}`);
      return datasetPageSchema.parse(await response.json());
    },
    async fetchDatasetFiles(collectionId, datasetSlug) {
      const response = await fetchJson(
        `${baseUrl}/api/collections/${collectionId}/datasets/by-slug/${datasetSlug}/files`,
      );
      const dataset = datasetSchema.parse(await response.json());
      return dataset.files ?? [];
    },
  };
}

export async function fetchSitemapDatasetGroups(client: SitemapFetchClient): Promise<SitemapDatasetGroup[]> {
  const collections = await client.fetchCollections();
  const groups: SitemapDatasetGroup[] = [];

  for (const collection of collections) {
    const datasets: SitemapDataset[] = [];
    let offset = 0;

    while (true) {
      const page = await client.fetchDatasetPage(collection.id, SITEMAP_DATASET_PAGE_SIZE, offset);
      for (const dataset of page.items) {
        datasets.push({
          ...dataset,
          files: dataset.files ?? (await client.fetchDatasetFiles(collection.id, dataset.slug)),
        });
      }

      const nextOffset = offset + page.items.length;
      if (page.items.length === 0 || nextOffset >= page.total) {
        break;
      }
      offset = nextOffset;
    }

    groups.push({ collection, datasets });
  }

  return groups;
}

export async function buildCatalogSitemapXml(origin: string): Promise<string> {
  const client = createDatasetApiSitemapClient(env.DATASET_API_URL);
  try {
    const entries = await client.fetchSitemapEntries();
    return buildSitemapXmlFromPaths(origin, buildCatalogSitemapPathsFromEntries(entries));
  } catch (error) {
    console.warn("Failed to fetch compact sitemap entries; falling back to catalog walk:", error);
    const groups = await fetchSitemapDatasetGroups(client);
    return buildSitemapXmlFromPaths(origin, buildCatalogSitemapPaths(groups));
  }
}
