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
  "/.well-known/mcp/server-card.json",
  "/.well-known/ai-catalog.json",
] as const;

const collectionSchema = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  updated_at: z.string().optional(),
});

const datasetSchema = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  updated_at: z.string().optional(),
  files: z
    .array(
      z.object({
        id: z.number(),
        slug: z.string(),
        name: z.string(),
        updated_at: z.string().optional(),
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

const expandedCollectionSchema = collectionSchema.extend({
  datasets: z.array(datasetSchema).optional(),
});

export type SitemapCollection = z.infer<typeof collectionSchema>;
export type SitemapDataset = z.infer<typeof datasetSchema>;
export type SitemapDatasetFile = NonNullable<SitemapDataset["files"]>[number];

export interface SitemapDatasetGroup {
  collection: SitemapCollection;
  datasets: SitemapDataset[];
}

export interface SitemapFetchClient {
  fetchCatalogGroups: () => Promise<SitemapDatasetGroup[]>;
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

export interface SitemapEntry {
  path: string;
  lastmod?: string;
}

/**
 * Normalize an API `updated_at` timestamp to a W3C Datetime `lastmod` value.
 * Backend timestamps look like "2026-05-19T21:53:21.876276" (date + time, no
 * timezone); we keep the date portion, which is a valid sitemap `lastmod`.
 */
export function toLastmod(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? match[0] : undefined;
}

export function buildSitemapXmlFromEntries(origin: string, entries: SitemapEntry[]): string {
  const urls = entries
    .map(({ path, lastmod }) => {
      const loc = escapeXml(toAbsoluteUrl(origin, path));
      const lastmodTag = lastmod ? `\n    <lastmod>${escapeXml(lastmod)}</lastmod>` : "";
      return `  <url>\n    <loc>${loc}</loc>${lastmodTag}\n    <changefreq>weekly</changefreq>\n  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

export function buildSitemapXmlFromPaths(origin: string, paths: string[]): string {
  return buildSitemapXmlFromEntries(
    origin,
    paths.map((path) => ({ path })),
  );
}

export function buildStaticSitemapXml(origin: string): string {
  return buildSitemapXmlFromPaths(origin, [...STATIC_SITEMAP_PATHS]);
}

function makeEntry(path: string, updatedAt: string | null | undefined): SitemapEntry {
  const lastmod = toLastmod(updatedAt);
  return lastmod ? { path, lastmod } : { path };
}

export function buildCatalogSitemapEntries(groups: SitemapDatasetGroup[]): SitemapEntry[] {
  const entries: SitemapEntry[] = STATIC_SITEMAP_PATHS.map((path) => ({ path }));

  for (const group of groups) {
    const collectionSlug = encodeURIComponent(group.collection.slug);
    entries.push(makeEntry(`/collections/${collectionSlug}`, group.collection.updated_at));

    for (const dataset of group.datasets) {
      const datasetSlug = encodeURIComponent(dataset.slug);
      entries.push(makeEntry(`/collections/${collectionSlug}/datasets/${datasetSlug}`, dataset.updated_at));
      for (const file of dataset.files ?? []) {
        entries.push(
          makeEntry(
            `/collections/${collectionSlug}/datasets/${datasetSlug}/files/${encodeURIComponent(file.slug)}`,
            file.updated_at ?? dataset.updated_at,
          ),
        );
      }
    }
  }

  return entries;
}

export function buildCatalogSitemapPaths(groups: SitemapDatasetGroup[]): string[] {
  return buildCatalogSitemapEntries(groups).map((entry) => entry.path);
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
    async fetchCatalogGroups() {
      const params = new URLSearchParams({ include: "datasets,files" });
      const response = await fetchJson(`${baseUrl}/api/collections?${params}`);
      const collections = z.array(expandedCollectionSchema).parse(await response.json());
      return collections.map((collection) => ({
        collection,
        datasets: collection.datasets ?? [],
      }));
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
    const groups = await client.fetchCatalogGroups();
    return buildSitemapXmlFromEntries(origin, buildCatalogSitemapEntries(groups));
  } catch (error) {
    console.warn("Failed to fetch expanded catalog sitemap data; falling back to catalog walk:", error);
    const groups = await fetchSitemapDatasetGroups(client);
    return buildSitemapXmlFromEntries(origin, buildCatalogSitemapEntries(groups));
  }
}
