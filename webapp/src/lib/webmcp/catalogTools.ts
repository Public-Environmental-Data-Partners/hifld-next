import { useCallback } from "react";
import { z } from "zod";
import type { Collection, ColumnSchema, DatasetTags, SpatialDatasetFileMetadata } from "@/lib/api-client";
import {
  type CatalogSchemaResponseInput,
  shapeDatasetFileResponse,
  shapeDatasetFileSchemaResponse,
} from "./catalogShapes";
import { failure, success, type WebMcpJsonValue, type WebMcpResult } from "./result";
import { useWebMcpTool } from "./useWebMcpTool";

const MAX_SEARCH_LIMIT = 20;
const MAX_SCHEMA_LIMIT = 50;
const READ_ANNOTATIONS: WebMCP.ToolAnnotations = { readOnlyHint: true, untrustedContentHint: true };
const SEARCH_ANNOTATIONS: WebMCP.ToolAnnotations = { readOnlyHint: false, untrustedContentHint: true };
const formatTypeSchema = z.enum(["geoparquet", "pmtiles", "geopackage", "shapefile", "geojson", "file_geodatabase"]);

const emptyInputSchema = z.object({}).strict();
const datasetInputSchema = z
  .object({ collection: z.string().min(1).max(200), dataset: z.string().min(1).max(200) })
  .strict();
const fileInputSchema = datasetInputSchema.extend({ file: z.string().min(1).max(200) }).strict();
const collectionSearchInputSchema = z
  .object({
    collection: z.string().min(1).max(200),
    query: z.string().max(200).optional(),
    tag_filters: z
      .record(z.string().min(1).max(100), z.union([z.string().max(200), z.array(z.string().max(200))]))
      .optional(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(MAX_SEARCH_LIMIT).optional(),
  })
  .strict();
const collectionDetailInputSchema = collectionSearchInputSchema
  .omit({ collection: true })
  .extend({
    slug: z.string().min(1).max(200),
    tag_key: z.string().min(1).max(100).optional(),
    tag_value: z.string().max(200).optional(),
  })
  .strict();
const schemaInputSchema = fileInputSchema
  .extend({
    version: z.union([z.string().min(1).max(100), z.number()]).optional(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(MAX_SCHEMA_LIMIT).optional(),
  })
  .strict();
type EmptyInput = z.infer<typeof emptyInputSchema>;

type SearchParams = {
  query?: string;
  tag_filters?: DatasetTags;
  offset?: number;
  limit?: number;
};

type CollectionSearchUrl = Omit<SearchParams, "tag_filters"> & { tag_filters?: string };

export type CollectionSearchNavigation = (collectionSlug: string, search: CollectionSearchUrl) => Promise<void>;

export async function applyDatasetSearch(
  navigate: CollectionSearchNavigation,
  collectionSlug: string,
  search: CollectionSearchUrl,
): Promise<void> {
  await navigate(collectionSlug, search);
}

type ApiErrorCode = "not_found" | "upstream_unavailable";

class CatalogRequestError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode) {
    super(code);
    this.code = code;
  }
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

function buildQuery(params: SearchParams): string {
  const query = new URLSearchParams();
  if (params.query?.trim()) query.set("query", params.query.trim());
  if (params.tag_filters && Object.keys(params.tag_filters).length > 0) {
    query.set("tag_filters", JSON.stringify(params.tag_filters));
  }
  if (params.limit !== undefined) query.set("limit", String(Math.min(params.limit, MAX_SEARCH_LIMIT)));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  return query.toString();
}

async function requestJson<T>(path: string, schema: z.ZodType<T>, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (response.status === 404) throw new CatalogRequestError("not_found");
  if (!response.ok) throw new CatalogRequestError("upstream_unavailable");
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new CatalogRequestError("upstream_unavailable");
  return parsed.data;
}

function failureFor(error: CatalogRequestError): WebMcpResult<WebMcpJsonValue> {
  return error.code === "not_found"
    ? failure("not_found", "The requested catalog item was not found.")
    : failure("upstream_unavailable", "The catalog service is temporarily unavailable.");
}

const collectionSchema = z
  .object({
    id: z.number().int().positive(),
    slug: z.string().min(1),
    name: z.string(),
    description: z.string().optional(),
    created_at: z.string(),
    updated_at: z.string(),
    links: z.record(z.string(), z.string()).optional(),
  })
  .strip();
const columnSchema = z
  .object({
    name: z.string(),
    type: z.string(),
    description: z.string().optional(),
    nullable: z.boolean(),
    num_null_values: z.number().optional(),
    num_unique_values: z.number().optional(),
    example_values: z.array(z.string()).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    length: z.number().optional(),
    possible_values: z.array(z.string()).optional(),
  })
  .strip()
  .transform(
    (column): ColumnSchema => ({
      name: column.name,
      type: column.type,
      ...(column.description !== undefined ? { description: column.description } : {}),
      nullable: column.nullable,
      ...(column.num_null_values !== undefined ? { num_null_values: column.num_null_values } : {}),
      ...(column.num_unique_values !== undefined ? { num_unique_values: column.num_unique_values } : {}),
      ...(column.example_values !== undefined ? { example_values: column.example_values } : {}),
      ...(column.min !== undefined ? { min: column.min } : {}),
      ...(column.max !== undefined ? { max: column.max } : {}),
      ...(column.length !== undefined ? { length: column.length } : {}),
      ...(column.possible_values !== undefined ? { possible_values: column.possible_values } : {}),
    }),
  );
const metadataSchema = z
  .object({
    version: z.string(),
    description: z.string().nullable().default(null),
    size_bytes: z.number().nullable().optional(),
    mime_type: z.string().optional(),
    feature_count: z.number().optional(),
    bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
    geometry_type: z.string().optional(),
    invalid_geometry_count: z.number().optional(),
    quality_check_passed: z.boolean().optional(),
    columns_hash: z.string().optional(),
    columns: z.array(columnSchema).optional(),
  })
  .strip()
  .transform(
    (metadata): SpatialDatasetFileMetadata => ({
      version: metadata.version,
      ...(metadata.description !== undefined ? { description: metadata.description } : {}),
      ...(metadata.size_bytes !== undefined ? { size_bytes: metadata.size_bytes } : {}),
      ...(metadata.mime_type !== undefined ? { mime_type: metadata.mime_type } : {}),
      ...(metadata.feature_count !== undefined ? { feature_count: metadata.feature_count } : {}),
      ...(metadata.bounds !== undefined ? { bounds: metadata.bounds } : {}),
      ...(metadata.geometry_type !== undefined ? { geometry_type: metadata.geometry_type } : {}),
      ...(metadata.invalid_geometry_count !== undefined
        ? { invalid_geometry_count: metadata.invalid_geometry_count }
        : {}),
      ...(metadata.quality_check_passed !== undefined ? { quality_check_passed: metadata.quality_check_passed } : {}),
      ...(metadata.columns_hash !== undefined ? { columns_hash: metadata.columns_hash } : {}),
      ...(metadata.columns !== undefined ? { columns: metadata.columns } : {}),
    }),
  );
const locationSchema = z.union([
  z.object({ version: z.string(), path: z.string() }).strict(),
  z.object({ version: z.string(), url: z.string(), method: z.string().optional() }).strict(),
]);
const sourceSchema = z
  .object({
    id: z.number().int().positive(),
    version: z.union([z.string(), z.number()]).optional(),
    url: z.string().optional(),
    storage_uri: z.string().optional(),
    glob_pattern: z.string().optional(),
    source_type: z.enum(["file", "api"]),
    location: locationSchema,
    source_metadata: metadataSchema.optional(),
    storage_location: z
      .object({
        id: z.number().int().positive(),
        name: z.string(),
        backend_type: z.literal("s3"),
        description: z.string().optional(),
        config: z.object({ version: z.string(), base_url: z.string(), bucket: z.string() }).strict().optional(),
        created_at: z.string(),
        updated_at: z.string(),
      })
      .optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .strip();
const formatSchema = z
  .object({
    format: z
      .object({
        id: z.number().int().positive(),
        format_type: formatTypeSchema,
        name: z.string(),
        created_at: z.string(),
        updated_at: z.string(),
      })
      .strict(),
    dataset_format: z
      .object({
        id: z.number().int().positive(),
        dataset_id: z.number(),
        format_id: z.number(),
        created_at: z.string(),
        updated_at: z.string(),
      })
      .strict(),
    sources: z.array(sourceSchema),
  })
  .strip();
const fileSchema = z
  .object({
    id: z.number().int().positive(),
    dataset_id: z.number().int().positive(),
    name: z.string(),
    slug: z.string().min(1),
    description: z.string().optional(),
    layer_name: z.string().optional(),
    source_file_path: z.string().optional(),
    file_metadata: metadataSchema.optional(),
    created_at: z.string(),
    updated_at: z.string(),
    formats: z.array(formatSchema).optional(),
  })
  .strip();
const schemaFileSchema = z
  .object({
    id: z.number().int().positive(),
    dataset_id: z.number().int().positive(),
    name: z.string(),
    slug: z.string().min(1),
    description: z.string().optional(),
    layer_name: z.string().optional(),
  })
  .strip();
const datasetSchema = z
  .object({
    id: z.number().int().positive(),
    slug: z.string().min(1),
    name: z.string(),
    description: z.string().optional(),
    tags: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
    collection_id: z.number().int().positive().optional(),
    created_at: z.string(),
    updated_at: z.string(),
    files: z.array(fileSchema).optional(),
    formats: z.array(formatSchema).optional(),
  })
  .strict();
const datasetSummaryResponseSchema = z
  .object({
    id: z.number().int().positive(),
    slug: z.string().min(1),
    name: z.string(),
    tags: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
    collection_id: z.number().int().positive().optional(),
  })
  .strip();
const datasetFileSummaryResponseSchema = z
  .object({
    id: z.number().int().positive(),
    slug: z.string().min(1),
    name: z.string(),
  })
  .strip();
const datasetDetailResponseSchema = datasetSummaryResponseSchema
  .extend({ files: z.array(datasetFileSummaryResponseSchema).optional() })
  .strip();
const collectionPageResponseSchema = z
  .object({
    links: z.record(z.string(), z.string()).optional(),
    collection: collectionSchema,
    datasets: z.array(datasetSummaryResponseSchema),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  })
  .strict();
const tagsResponseSchema = z
  .object({
    links: z.record(z.string(), z.string()).optional(),
    tags: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  })
  .strip();
const datasetResponseSchema = z
  .object({
    links: z.record(z.string(), z.string()).optional(),
    collection: collectionSchema,
    dataset: datasetDetailResponseSchema,
  })
  .strict();

const schemaResponseSchema = z
  .object({
    links: z.record(z.string(), z.string()).optional(),
    collection: collectionSchema,
    dataset: datasetSchema,
    file: schemaFileSchema,
    versions: z.array(z.union([z.string(), z.number()])),
    selected_version: z.union([z.string(), z.number()]).nullable(),
    schema: z
      .object({
        version: z.union([z.string(), z.number()]).nullable(),
        format_type: formatTypeSchema,
        format_name: z.string(),
        source_id: z.number().int().positive(),
        source_metadata: metadataSchema.nullable(),
        columns: z.array(columnSchema),
        total_columns: z.number().int().nonnegative().optional(),
        column_offset: z.number().int().nonnegative().optional(),
        column_limit: z.number().int().positive().optional(),
        has_more: z.boolean().optional(),
      })
      .strip()
      .nullable(),
  })
  .strict();
const rawFileResponseSchema = z
  .object({
    links: z.record(z.string(), z.string()).optional(),
    collection: collectionSchema,
    dataset: datasetSchema,
    file: fileSchema,
  })
  .strict();
type CollectionPageResponse = z.infer<typeof collectionPageResponseSchema>;
type SchemaResponse = z.infer<typeof schemaResponseSchema>;

function schemaShapeInput(response: SchemaResponse): CatalogSchemaResponseInput {
  return {
    collection: response.collection,
    dataset: response.dataset,
    file: response.file,
    versions: response.versions,
    selected_version: response.selected_version,
    schema: response.schema
      ? {
          version: response.schema.version,
          format_type: response.schema.format_type,
          format_name: response.schema.format_name,
          source_id: response.schema.source_id,
          source_metadata: response.schema.source_metadata,
          columns: response.schema.columns,
          ...(response.schema.total_columns !== undefined ? { total_columns: response.schema.total_columns } : {}),
          ...(response.schema.column_offset !== undefined ? { column_offset: response.schema.column_offset } : {}),
          ...(response.schema.column_limit !== undefined ? { column_limit: response.schema.column_limit } : {}),
          ...(response.schema.has_more !== undefined ? { has_more: response.schema.has_more } : {}),
        }
      : null,
  };
}

interface CollectionSummary {
  [key: string]: WebMcpJsonValue;
  id: number;
  slug: string;
  name: string;
  description: string | null;
  link: string;
}

interface DatasetSummary {
  [key: string]: WebMcpJsonValue;
  id: number;
  slug: string;
  name: string;
  collection_id: number | null;
  tags: { [key: string]: WebMcpJsonValue };
  link: string;
}

interface FileSummary {
  [key: string]: WebMcpJsonValue;
  id: number;
  slug: string;
  name: string;
  link: string;
}

function collectionSummary(collection: Collection): CollectionSummary {
  return {
    id: collection.id,
    slug: collection.slug,
    name: collection.name,
    description: collection.description ?? null,
    link: `/api/collections/${encodePath(collection.slug)}`,
  };
}

function tagsSummary(tags: DatasetTags | undefined): { [key: string]: WebMcpJsonValue } {
  const result: { [key: string]: WebMcpJsonValue } = {};
  for (const [key, value] of Object.entries(tags ?? {})) {
    result[key] = Array.isArray(value) ? [...value] : value;
  }
  return result;
}

function datasetSummary(dataset: z.infer<typeof datasetSummaryResponseSchema>, collectionSlug: string): DatasetSummary {
  return {
    id: dataset.id,
    slug: dataset.slug,
    name: dataset.name,
    collection_id: dataset.collection_id ?? null,
    tags: tagsSummary(dataset.tags),
    link: `/api/collections/${encodePath(collectionSlug)}/datasets/${encodePath(dataset.slug)}`,
  };
}

function fileSummary(
  file: { id: number; slug: string; name: string },
  collectionSlug: string,
  datasetSlug: string,
): FileSummary {
  return {
    id: file.id,
    slug: file.slug,
    name: file.name,
    link: `/api/collections/${encodePath(collectionSlug)}/datasets/${encodePath(datasetSlug)}/files/${encodePath(file.slug)}`,
  };
}

function errorResult(error: Error): WebMcpResult<WebMcpJsonValue> {
  return error instanceof CatalogRequestError ? failureFor(error) : failure("internal_error");
}

type SearchInputFields = {
  query?: string | undefined;
  tag_filters?: DatasetTags | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
};

function searchParamsForInput(input: SearchInputFields): SearchParams {
  const params: SearchParams = {};
  if (input.query !== undefined) params.query = input.query;
  if (input.tag_filters !== undefined) params.tag_filters = input.tag_filters;
  if (input.offset !== undefined) params.offset = input.offset;
  if (input.limit !== undefined) params.limit = input.limit;
  return params;
}

interface CollectionPageResult {
  [key: string]: WebMcpJsonValue;
  collection: CollectionSummary;
  datasets: DatasetSummary[];
  total: number;
  offset: number;
  limit: number;
}

function collectionPageResult(response: CollectionPageResponse, collectionSlug: string): CollectionPageResult {
  return {
    collection: collectionSummary(response.collection),
    datasets: response.datasets.map((dataset) => datasetSummary(dataset, collectionSlug)),
    total: response.total,
    offset: response.offset,
    limit: response.limit,
  };
}

function collectionDetailQuery(input: z.infer<typeof collectionDetailInputSchema>): string {
  const params = searchParamsForInput(input);
  if (input.tag_key !== undefined && input.tag_value !== undefined) {
    params.tag_filters = { [input.tag_key]: input.tag_value };
  }
  return buildQuery(params);
}

export function CatalogTools({ applySearch, enabled }: { applySearch: CollectionSearchNavigation; enabled: boolean }) {
  const listCollections = useCallback(async (_input: EmptyInput, signal: AbortSignal) => {
    try {
      const collections = await requestJson("/api/collections", z.array(collectionSchema), signal);
      return success("Loaded collections.", { collections: collections.map(collectionSummary) });
    } catch (error) {
      return errorResult(error instanceof Error ? error : new Error("catalog request failed"));
    }
  }, []);

  const getCollection = useCallback(async (input: z.infer<typeof collectionDetailInputSchema>, signal: AbortSignal) => {
    try {
      const query = collectionDetailQuery(input);
      const suffix = query ? `?${query}` : "";
      const [response, tagsResponse] = await Promise.all([
        requestJson(`/api/collections/${encodePath(input.slug)}${suffix}`, collectionPageResponseSchema, signal),
        requestJson(`/api/collections/${encodePath(input.slug)}/datasets/tags`, tagsResponseSchema, signal),
      ]);
      return success("Loaded collection.", {
        ...collectionPageResult(response, input.slug),
        tags: tagsSummary(tagsResponse.tags),
      });
    } catch (error) {
      return errorResult(error instanceof Error ? error : new Error("catalog request failed"));
    }
  }, []);

  const searchDatasets = useCallback(
    async (input: z.infer<typeof collectionSearchInputSchema>, signal: AbortSignal) => {
      try {
        const params = searchParamsForInput(input);
        const query = buildQuery(params);
        const response = await requestJson(
          `/api/collections/${encodePath(input.collection)}${query ? `?${query}` : ""}`,
          collectionPageResponseSchema,
          signal,
        );
        const urlSearch: CollectionSearchUrl = {};
        if (params.query !== undefined) urlSearch.query = params.query;
        if (params.offset !== undefined) urlSearch.offset = params.offset;
        if (params.limit !== undefined) urlSearch.limit = params.limit;
        if (input.tag_filters !== undefined) urlSearch.tag_filters = JSON.stringify(input.tag_filters);
        await applyDatasetSearch(applySearch, input.collection, urlSearch);
        return success("Updated the visible dataset search.", collectionPageResult(response, input.collection));
      } catch (error) {
        return errorResult(error instanceof Error ? error : new Error("catalog request failed"));
      }
    },
    [applySearch],
  );

  const getDataset = useCallback(async (input: z.infer<typeof datasetInputSchema>, signal: AbortSignal) => {
    try {
      const response = await requestJson(
        `/api/collections/${encodePath(input.collection)}/datasets/${encodePath(input.dataset)}`,
        datasetResponseSchema,
        signal,
      );
      return success("Loaded dataset.", {
        collection: collectionSummary(response.collection),
        dataset: datasetSummary(response.dataset, input.collection),
        files: (response.dataset.files ?? []).map((file) => fileSummary(file, input.collection, input.dataset)),
      });
    } catch (error) {
      return errorResult(error instanceof Error ? error : new Error("catalog request failed"));
    }
  }, []);

  const getDatasetFile = useCallback(async (input: z.infer<typeof fileInputSchema>, signal: AbortSignal) => {
    try {
      const response = await requestJson(
        `/api/collections/${encodePath(input.collection)}/datasets/${encodePath(input.dataset)}/files/${encodePath(input.file)}`,
        rawFileResponseSchema,
        signal,
      );
      const shaped = shapeDatasetFileResponse(
        response,
        window.location.origin,
        input.collection,
        input.dataset,
        input.file,
      );
      return success<WebMcpJsonValue>("Loaded dataset file.", JSON.parse(JSON.stringify(shaped)) as WebMcpJsonValue);
    } catch (error) {
      return errorResult(error instanceof Error ? error : new Error("catalog request failed"));
    }
  }, []);

  const getDatasetFileSchema = useCallback(async (input: z.infer<typeof schemaInputSchema>, signal: AbortSignal) => {
    try {
      const params = new URLSearchParams();
      if (input.version !== undefined) params.set("version", String(input.version));
      params.set("column_offset", String(input.offset ?? 0));
      params.set("column_limit", String(Math.min(input.limit ?? MAX_SCHEMA_LIMIT, MAX_SCHEMA_LIMIT)));
      const response = await requestJson(
        `/api/collections/${encodePath(input.collection)}/datasets/${encodePath(input.dataset)}/files/${encodePath(input.file)}/schema?${params}`,
        schemaResponseSchema,
        signal,
      );
      const shaped = shapeDatasetFileSchemaResponse(
        schemaShapeInput(response),
        window.location.origin,
        input.collection,
        input.dataset,
        input.file,
      );
      return success<WebMcpJsonValue>(
        "Loaded dataset file schema.",
        JSON.parse(JSON.stringify(shaped)) as WebMcpJsonValue,
      );
    } catch (error) {
      return errorResult(error instanceof Error ? error : new Error("catalog request failed"));
    }
  }, []);

  useWebMcpTool({
    name: "list_collections",
    routeKind: "catalog",
    title: "List collections",
    description: "List HIFLD collections.",
    schema: emptyInputSchema,
    execute: listCollections,
    enabled,
    annotations: READ_ANNOTATIONS,
  });
  useWebMcpTool({
    name: "get_collection",
    routeKind: "catalog",
    title: "Get collection",
    description: "Get collection metadata, tags, and a bounded dataset page.",
    schema: collectionDetailInputSchema,
    execute: getCollection,
    enabled,
    annotations: READ_ANNOTATIONS,
  });
  useWebMcpTool({
    name: "search_datasets",
    routeKind: "catalog",
    title: "Search datasets",
    description: "Search datasets in one collection and update its visible search.",
    schema: collectionSearchInputSchema,
    execute: searchDatasets,
    enabled,
    annotations: SEARCH_ANNOTATIONS,
  });
  useWebMcpTool({
    name: "get_dataset",
    routeKind: "catalog",
    title: "Get dataset",
    description: "Get bounded metadata and files for one dataset.",
    schema: datasetInputSchema,
    execute: getDataset,
    enabled,
    annotations: READ_ANNOTATIONS,
  });
  useWebMcpTool({
    name: "get_dataset_file",
    routeKind: "catalog",
    title: "Get dataset file",
    description: "Get bounded metadata, versions, formats, and canonical links for one file.",
    schema: fileInputSchema,
    execute: getDatasetFile,
    enabled,
    annotations: READ_ANNOTATIONS,
  });
  useWebMcpTool({
    name: "get_dataset_file_schema",
    routeKind: "schema",
    title: "Get dataset file schema",
    description: "Get one bounded page of columns for a dataset file.",
    schema: schemaInputSchema,
    execute: getDatasetFileSchema,
    enabled,
    annotations: READ_ANNOTATIONS,
  });
  return null;
}
