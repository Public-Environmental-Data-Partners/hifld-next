import { z } from "zod";
import type { CatalogRepository } from "@/lib/catalog-repository";
import { activeCatalogLifecycle } from "@/lib/catalog-runtime";

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

export type SitemapCollection = z.infer<typeof collectionSchema>;
export type SitemapDataset = z.infer<typeof datasetSchema>;
export type SitemapDatasetFile = NonNullable<SitemapDataset["files"]>[number];

export interface SitemapDatasetGroup {
  collection: SitemapCollection;
  datasets: SitemapDataset[];
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

async function collectionSitemapEntries(
  repository: CatalogRepository,
  collectionSlug: string,
): Promise<SitemapEntry[]> {
  const result: SitemapEntry[] = [];
  const collectionPath = `/collections/${encodeURIComponent(collectionSlug)}`;
  let offset = 0;
  while (true) {
    const page = await repository.listDatasets(collectionSlug, { limit: SITEMAP_DATASET_PAGE_SIZE, offset });
    for (const dataset of page.items) {
      const datasetPath = `${collectionPath}/datasets/${encodeURIComponent(dataset.dataset_slug)}`;
      result.push(makeEntry(datasetPath, dataset.updated_at));
      for (const file of await repository.listFiles(collectionSlug, dataset.dataset_slug)) {
        result.push(
          makeEntry(
            `${datasetPath}/files/${encodeURIComponent(file.file_slug)}`,
            file.updated_at ?? dataset.updated_at,
          ),
        );
      }
    }
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) break;
  }
  return result;
}

export async function buildCatalogSitemapXml(origin: string): Promise<string> {
  const lifecycle = await activeCatalogLifecycle();
  if (lifecycle) {
    const entries = await lifecycle.withRepository(async (repository) => {
      const result: SitemapEntry[] = STATIC_SITEMAP_PATHS.map((path) => ({ path }));
      for (const collection of await repository.listCollections()) {
        const collectionPath = `/collections/${encodeURIComponent(collection.collection_slug)}`;
        result.push(makeEntry(collectionPath, collection.updated_at));
        result.push(...(await collectionSitemapEntries(repository, collection.collection_slug)));
      }
      return result;
    });
    if (!entries) throw new Error("Published catalog is unavailable for sitemap generation");
    return buildSitemapXmlFromEntries(origin, entries);
  }
  throw new Error("Published catalog is unavailable for sitemap generation");
}
