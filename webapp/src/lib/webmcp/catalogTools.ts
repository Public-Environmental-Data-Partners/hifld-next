import { useCallback } from "react";
import { z } from "zod";
import { failure, success, type WebMcpJsonValue, type WebMcpResult } from "./result";
import { useWebMcpTool } from "./useWebMcpTool";

const MAX_SEARCH_LIMIT = 20;
const MAX_SCHEMA_LIMIT = 50;
const READ: WebMCP.ToolAnnotations = { readOnlyHint: true, untrustedContentHint: true };
const SEARCH: WebMCP.ToolAnnotations = { readOnlyHint: false, untrustedContentHint: true };
const slug = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/);
const emptyInput = z.object({}).strict();
const datasetInput = z.object({ collection: slug, dataset: slug }).strict();
const fileInput = datasetInput.extend({ file: slug }).strict();
const searchInput = z
  .object({
    collection: slug,
    query: z.string().max(200).optional(),
    tag_filters: z
      .record(z.string().min(1).max(100), z.union([z.string().max(200), z.array(z.string().max(200))]))
      .optional(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(MAX_SEARCH_LIMIT).optional(),
  })
  .strict();
const collectionInput = searchInput
  .omit({ collection: true })
  .extend({
    slug,
    tag_key: z.string().min(1).max(100).optional(),
    tag_value: z.string().max(200).optional(),
  })
  .strict();
const schemaInput = fileInput
  .extend({
    version: z.union([z.string().min(1).max(100), z.number()]).optional(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(MAX_SCHEMA_LIMIT).optional(),
  })
  .strict();

interface Tags {
  [key: string]: string | string[];
}
type SearchParams = { query?: string; tag_filters?: Tags; offset?: number; limit?: number };
type SearchUrl = Omit<SearchParams, "tag_filters"> & { tag_filters?: string };
export type CollectionSearchNavigation = (collectionSlug: string, search: SearchUrl) => Promise<void>;
type EmptyInput = z.infer<typeof emptyInput>;
interface SourceOutput {
  [key: string]: WebMcpJsonValue;
}
export async function applyDatasetSearch(
  navigate: CollectionSearchNavigation,
  collectionSlug: string,
  search: SearchUrl,
) {
  await navigate(collectionSlug, search);
}

class CatalogRequestError extends Error {
  constructor(readonly code: "not_found" | "upstream_unavailable") {
    super(code);
  }
}
const linkSchema = z
  .object({ rel: z.string(), href: z.string(), title: z.string().optional(), type: z.string().optional() })
  .passthrough();
const catalogSchema = z
  .object({
    type: z.literal("Catalog"),
    stac_version: z.string(),
    id: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    links: z.array(linkSchema),
  })
  .strip();
const columnSchema = z
  .object({
    name: z.string(),
    type: z.string(),
    description: z.string().nullable().optional(),
    nullable: z.boolean().optional(),
    num_null_values: z.number().nullable().optional(),
    num_unique_values: z.number().nullable().optional(),
    example_values: z.array(z.string()).nullable().optional(),
    min: z.number().nullable().optional(),
    max: z.number().nullable().optional(),
    length: z.number().nullable().optional(),
    possible_values: z.array(z.string()).nullable().optional(),
  })
  .strip();
const assetSchema = z
  .object({
    href: z.string(),
    title: z.string().optional(),
    type: z.string().optional(),
    roles: z.array(z.string()).optional(),
    "hifld:format_key": z.string().optional(),
    "hifld:sha256": z.string().optional(),
    "hifld:storage_location_slug": z.string().optional(),
  })
  .passthrough();
const collectionSchema = z
  .object({
    type: z.literal("Collection"),
    stac_version: z.string(),
    id: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    links: z.array(linkSchema),
    assets: z.record(z.string(), assetSchema),
    "table:columns": z.array(columnSchema).optional(),
  })
  .passthrough();
const pageSchema = z
  .object({
    datasets: z.array(catalogSchema),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    links: z.record(z.string(), z.string()).optional(),
  })
  .strict();
const tagsSchema = z.object({ tags: z.record(z.string(), z.union([z.string(), z.array(z.string())])) }).passthrough();

const enc = encodeURIComponent;
function queryString(p: SearchParams) {
  const q = new URLSearchParams();
  if (p.query?.trim()) q.set("query", p.query.trim());
  if (p.tag_filters && Object.keys(p.tag_filters).length) q.set("tag_filters", JSON.stringify(p.tag_filters));
  if (p.limit !== undefined) q.set("limit", String(Math.min(p.limit, MAX_SEARCH_LIMIT)));
  if (p.offset !== undefined) q.set("offset", String(p.offset));
  return q.toString();
}
function searchParams(input: z.infer<typeof searchInput>): SearchParams {
  const params: SearchParams = {};
  if (input.query !== undefined) params.query = input.query;
  if (input.offset !== undefined) params.offset = input.offset;
  if (input.limit !== undefined) params.limit = input.limit;
  if (input.tag_filters !== undefined) params.tag_filters = input.tag_filters;
  return params;
}
async function getJson<T>(path: string, schema: z.ZodType<T>, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (response.status === 404) throw new CatalogRequestError("not_found");
  if (!response.ok) throw new CatalogRequestError("upstream_unavailable");
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new CatalogRequestError("upstream_unavailable");
  return parsed.data;
}
function failed(error: unknown): WebMcpResult<WebMcpJsonValue> {
  if (error instanceof CatalogRequestError && error.code === "not_found")
    return failure("not_found", "The requested catalog item was not found.");
  if (error instanceof CatalogRequestError)
    return failure("upstream_unavailable", "The catalog service is temporarily unavailable.");
  return failure("internal_error");
}
function childSlug(href: string) {
  try {
    const parts = new URL(href, "https://invalid.local/").pathname.split("/").filter(Boolean);
    if (!/[.]json$/.test(parts.at(-1) ?? "") || parts.length < 2) return undefined;
    return slug.safeParse(decodeURIComponent(parts.at(-2) ?? "")).data;
  } catch {
    return undefined;
  }
}
function datasetSummary(item: z.infer<typeof catalogSchema>, collection: string) {
  const dataset = item.id.split("/").at(-1) ?? "";
  if (item.id !== `${collection}/${dataset}` || !slug.safeParse(dataset).success)
    throw new CatalogRequestError("upstream_unavailable");
  return {
    id: item.id,
    slug: dataset,
    name: item.title ?? dataset,
    tags: item.keywords ? { keywords: item.keywords } : {},
    link: `/api/collections/${enc(collection)}/datasets/${enc(dataset)}`,
  };
}
async function listChildren(root: z.infer<typeof catalogSchema>, signal: AbortSignal) {
  return Promise.all(
    root.links
      .filter((x) => x.rel === "child")
      .map(async (x) => {
        const id = childSlug(x.href);
        if (!id) throw new CatalogRequestError("upstream_unavailable");
        if (x.title) return { id, slug: id, name: x.title, description: null, link: `/api/collections/${enc(id)}` };
        const child = await getJson(`/api/collections/${enc(id)}`, catalogSchema, signal);
        if (child.id !== id) throw new CatalogRequestError("upstream_unavailable");
        return {
          id,
          slug: id,
          name: child.title ?? id,
          description: child.description ?? null,
          link: `/api/collections/${enc(id)}`,
        };
      }),
  );
}
function fileChildren(item: z.infer<typeof catalogSchema>, collection: string, dataset: string) {
  if (item.id !== `${collection}/${dataset}`) throw new CatalogRequestError("upstream_unavailable");
  return item.links
    .filter((x) => x.rel === "child")
    .map((x) => {
      const file = childSlug(x.href);
      if (!file) throw new CatalogRequestError("upstream_unavailable");
      return {
        id: `${collection}/${dataset}/${file}`,
        slug: file,
        name: x.title ?? file,
        link: `/api/collections/${enc(collection)}/datasets/${enc(dataset)}/files/${enc(file)}`,
      };
    });
}
function selectedVersion(item: z.infer<typeof collectionSchema>, collection: string, dataset: string, file: string) {
  const prefix = `${collection}/${dataset}/${file}/`;
  if (!item.id.startsWith(prefix) || !item.id.slice(prefix.length))
    throw new CatalogRequestError("upstream_unavailable");
  return item.id.slice(prefix.length);
}
function fileShape(
  item: z.infer<typeof collectionSchema>,
  collection: string,
  dataset: string,
  file: string,
): WebMcpJsonValue {
  const version = selectedVersion(item, collection, dataset, file);
  const formats = new Map<string, SourceOutput[]>();
  const querySources: SourceOutput[] = [];
  for (const [assetKey, asset] of Object.entries(item.assets)) {
    const format = asset["hifld:format_key"] ?? assetKey.split("-")[0] ?? assetKey;
    const querySource =
      format === "geoparquet"
        ? {
            alias: `source_${querySources.length}`,
            collection_slug: collection,
            dataset_slug: dataset,
            file_slug: file,
            version,
            asset_key: assetKey,
            ...(asset["hifld:storage_location_slug"]
              ? { storage_location_slug: asset["hifld:storage_location_slug"] }
              : {}),
          }
        : null;
    if (querySource) querySources.push(querySource);
    const sources = formats.get(format) ?? [];
    sources.push({ asset_key: assetKey, version, source_type: "file", summary: null, query_source: querySource });
    formats.set(format, sources);
  }
  const self = `/api/collections/${enc(collection)}/datasets/${enc(dataset)}/files/${enc(file)}`;
  return {
    collection: { slug: collection, name: collection, links: { self: `/api/collections/${enc(collection)}` } },
    dataset: {
      slug: dataset,
      name: dataset,
      tags: {},
      links: { self: `/api/collections/${enc(collection)}/datasets/${enc(dataset)}` },
    },
    file: { slug: file, name: item.title ?? file, layer_name: null, summary: null, links: { self } },
    formats: [...formats].map(([format_type, sources]) => ({ format_type, name: format_type, sources })),
    query_sources: querySources,
    links: { self },
  };
}

export function CatalogTools({ applySearch, enabled }: { applySearch: CollectionSearchNavigation; enabled: boolean }) {
  const listCollections = useCallback(async (_: EmptyInput, signal: AbortSignal) => {
    try {
      return success("Loaded collections.", {
        collections: await listChildren(await getJson("/api/collections", catalogSchema, signal), signal),
      });
    } catch (e) {
      return failed(e);
    }
  }, []);
  const getCollection = useCallback(async (input: z.infer<typeof collectionInput>, signal: AbortSignal) => {
    try {
      const params = searchParams({ ...input, collection: input.slug });
      if (input.tag_key !== undefined && input.tag_value !== undefined)
        params.tag_filters = { [input.tag_key]: input.tag_value };
      const qs = queryString(params);
      const base = `/api/collections/${enc(input.slug)}`;
      const [catalog, page, tags] = await Promise.all([
        getJson(base, catalogSchema, signal),
        getJson(`${base}/datasets${qs ? `?${qs}` : ""}`, pageSchema, signal),
        getJson(`${base}/datasets/tags`, tagsSchema, signal),
      ]);
      if (catalog.id !== input.slug) throw new CatalogRequestError("upstream_unavailable");
      return success("Loaded collection.", {
        collection: {
          id: catalog.id,
          slug: input.slug,
          name: catalog.title ?? input.slug,
          description: catalog.description ?? null,
          link: base,
        },
        datasets: page.datasets.map((x) => datasetSummary(x, input.slug)),
        total: page.total,
        limit: page.limit,
        offset: page.offset,
        tags: tags.tags,
      });
    } catch (e) {
      return failed(e);
    }
  }, []);
  const searchDatasets = useCallback(
    async (input: z.infer<typeof searchInput>, signal: AbortSignal) => {
      try {
        const params = searchParams(input);
        const qs = queryString(params);
        const page = await getJson(
          `/api/collections/${enc(input.collection)}/datasets${qs ? `?${qs}` : ""}`,
          pageSchema,
          signal,
        );
        const nav: SearchUrl = {};
        if (input.query !== undefined) nav.query = input.query;
        if (input.offset !== undefined) nav.offset = input.offset;
        if (input.limit !== undefined) nav.limit = input.limit;
        if (input.tag_filters !== undefined) nav.tag_filters = JSON.stringify(input.tag_filters);
        await applyDatasetSearch(applySearch, input.collection, nav);
        return success("Updated the visible dataset search.", {
          datasets: page.datasets.map((x) => datasetSummary(x, input.collection)),
          total: page.total,
          limit: page.limit,
          offset: page.offset,
        });
      } catch (e) {
        return failed(e);
      }
    },
    [applySearch],
  );
  const getDataset = useCallback(async (input: z.infer<typeof datasetInput>, signal: AbortSignal) => {
    try {
      const item = await getJson(
        `/api/collections/${enc(input.collection)}/datasets/${enc(input.dataset)}`,
        catalogSchema,
        signal,
      );
      return success("Loaded dataset.", {
        dataset: datasetSummary(item, input.collection),
        files: fileChildren(item, input.collection, input.dataset),
      });
    } catch (e) {
      return failed(e);
    }
  }, []);
  const getFile = useCallback(async (input: z.infer<typeof fileInput>, signal: AbortSignal) => {
    try {
      return success(
        "Loaded dataset file.",
        fileShape(
          await getJson(
            `/api/collections/${enc(input.collection)}/datasets/${enc(input.dataset)}/files/${enc(input.file)}`,
            collectionSchema,
            signal,
          ),
          input.collection,
          input.dataset,
          input.file,
        ),
      );
    } catch (e) {
      return failed(e);
    }
  }, []);
  const getSchema = useCallback(async (input: z.infer<typeof schemaInput>, signal: AbortSignal) => {
    try {
      const params = new URLSearchParams();
      if (input.version !== undefined) params.set("version", String(input.version));
      const base = `/api/collections/${enc(input.collection)}/datasets/${enc(input.dataset)}/files/${enc(input.file)}`;
      const item = await getJson(`${base}${params.size ? `?${params}` : ""}`, collectionSchema, signal);
      const version = selectedVersion(item, input.collection, input.dataset, input.file);
      const all = item["table:columns"] ?? [];
      const offset = input.offset ?? 0;
      const limit = Math.min(input.limit ?? MAX_SCHEMA_LIMIT, MAX_SCHEMA_LIMIT);
      const columns = all.slice(offset, offset + limit);
      const data = {
        selected_version: version,
        versions: [version],
        file: { slug: input.file, name: item.title ?? input.file, layer_name: null },
        dataset: { slug: input.dataset, name: input.dataset, tags: {} },
        collection: { slug: input.collection, name: input.collection },
        links: { self: base, file: base },
        schema: {
          version,
          format_type: "geoparquet",
          format_name: "GeoParquet",
          source_id: `${item.id}/geoparquet`,
          summary: null,
          columns,
          total_columns: all.length,
          column_offset: offset,
          column_limit: limit,
          has_more: offset + columns.length < all.length,
        },
      };
      return success("Loaded dataset file schema.", JSON.parse(JSON.stringify(data)) as WebMcpJsonValue);
    } catch (e) {
      return failed(e);
    }
  }, []);
  useWebMcpTool({
    name: "list_collections",
    routeKind: "catalog",
    title: "List collections",
    description: "List HIFLD collections.",
    schema: emptyInput,
    execute: listCollections,
    enabled,
    annotations: READ,
  });
  useWebMcpTool({
    name: "get_collection",
    routeKind: "catalog",
    title: "Get collection",
    description: "Get collection metadata, tags, and a bounded dataset page.",
    schema: collectionInput,
    execute: getCollection,
    enabled,
    annotations: READ,
  });
  useWebMcpTool({
    name: "search_datasets",
    routeKind: "catalog",
    title: "Search datasets",
    description: "Search datasets in one collection and update its visible search.",
    schema: searchInput,
    execute: searchDatasets,
    enabled,
    annotations: SEARCH,
  });
  useWebMcpTool({
    name: "get_dataset",
    routeKind: "catalog",
    title: "Get dataset",
    description: "Get one dataset and its file children.",
    schema: datasetInput,
    execute: getDataset,
    enabled,
    annotations: READ,
  });
  useWebMcpTool({
    name: "get_dataset_file",
    routeKind: "catalog",
    title: "Get dataset file",
    description: "Get the selected version STAC Collection and query source identities.",
    schema: fileInput,
    execute: getFile,
    enabled,
    annotations: READ,
  });
  useWebMcpTool({
    name: "get_dataset_file_schema",
    routeKind: "schema",
    title: "Get dataset file schema",
    description: "Get one bounded page of table:columns from a dataset file version.",
    schema: schemaInput,
    execute: getSchema,
    enabled,
    annotations: READ,
  });
  return null;
}
