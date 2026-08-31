import { z } from "zod";
import type {
  Collection,
  ColumnSchema,
  Dataset,
  DatasetFile,
  DatasetFileResponse,
  DatasetSource,
  FormatType,
  SpatialDatasetFileMetadata,
} from "@/lib/api-client";
import { collectionSelf, datasetSelf, fileSelf, schemaSelf } from "@/lib/api-links";

const MAX_SERIALIZED_CATALOG_RESULT = 1500;

export const QuerySourceRefSchema = z
  .object({
    alias: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/),
    collection_id: z.number().int().positive(),
    dataset_id: z.number().int().positive(),
    file_id: z.number().int().positive(),
    file_source_id: z.number().int().positive(),
  })
  .strict();

const CatalogLinksSchema = z.record(z.string(), z.string());

const CatalogIdentitySchema = z
  .object({
    id: z.number().int().positive(),
    slug: z.string(),
    name: z.string(),
    links: CatalogLinksSchema,
  })
  .strict();

const CatalogDatasetSchema = CatalogIdentitySchema.extend({
  collection_id: z.number().int().positive(),
  tags: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
}).strict();

const SpatialSummarySchema = z
  .object({
    version: z.union([z.string(), z.number()]),
    size_bytes: z.number().nullable(),
    feature_count: z.number().nullable(),
    bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
    geometry_type: z.string().nullable(),
    invalid_geometry_count: z.number().nullable(),
    quality_check_passed: z.boolean().nullable(),
    columns_hash: z.string().nullable(),
    column_count: z.number().int(),
    columns_available: z.boolean(),
  })
  .strict();

const CatalogSourceSchema = z
  .object({
    id: z.number().int().positive(),
    version: z.union([z.string(), z.number()]),
    source_type: z.enum(["file", "api"]),
    summary: SpatialSummarySchema.nullable(),
    query_source: QuerySourceRefSchema.nullable(),
  })
  .strict();

const CatalogFormatSchema = z
  .object({
    id: z.number().int().positive(),
    format_type: z.enum(["geoparquet", "pmtiles", "geopackage", "shapefile", "geojson", "file_geodatabase"]),
    name: z.string(),
    sources: z.array(CatalogSourceSchema),
  })
  .strict();

const CatalogFileSchema = z
  .object({
    id: z.number().int().positive(),
    dataset_id: z.number().int().positive(),
    slug: z.string(),
    name: z.string(),
    layer_name: z.string().nullable(),
    summary: SpatialSummarySchema.nullable(),
    links: CatalogLinksSchema,
  })
  .strict();

export const CatalogDatasetFileResponseSchema = z
  .object({
    collection: CatalogIdentitySchema,
    dataset: CatalogDatasetSchema,
    file: CatalogFileSchema,
    formats: z.array(CatalogFormatSchema),
    query_sources: z.array(QuerySourceRefSchema),
    links: CatalogLinksSchema,
    truncated: z.literal(true).optional(),
  })
  .strict();

export type QuerySourceRef = z.infer<typeof QuerySourceRefSchema>;
export type CatalogDatasetFileResponse = z.infer<typeof CatalogDatasetFileResponseSchema>;
export type CatalogDatasetFileShapeInput = DatasetFileResponse & { collection: Collection };

function identity(value: Collection | Dataset, links: string): z.infer<typeof CatalogIdentitySchema> {
  return { id: value.id, slug: value.slug, name: value.name, links: { self: links } };
}

function summary(metadata: SpatialDatasetFileMetadata | null | undefined): z.infer<typeof SpatialSummarySchema> | null {
  if (!metadata) return null;
  return {
    version: metadata.version,
    size_bytes: metadata.size_bytes ?? null,
    feature_count: metadata.feature_count ?? null,
    bounds: metadata.bounds ?? null,
    geometry_type: metadata.geometry_type ?? null,
    invalid_geometry_count: metadata.invalid_geometry_count ?? null,
    quality_check_passed: metadata.quality_check_passed ?? null,
    columns_hash: metadata.columns_hash ?? null,
    column_count: metadata.columns?.length ?? 0,
    columns_available: metadata.columns !== undefined,
  };
}

function sourceVersion(source: DatasetSource): string | number {
  return source.version ?? source.location.version ?? "1";
}

function sourceSummary(source: DatasetSource): z.infer<typeof SpatialSummarySchema> | null {
  return summary(source.source_metadata);
}

function isQuerySource(source: DatasetSource, formatType: FormatType): boolean {
  return formatType === "geoparquet" && source.source_type === "file" && source.storage_location != null;
}

function boundFileShape(value: CatalogDatasetFileResponse): CatalogDatasetFileResponse {
  if (JSON.stringify(value).length <= MAX_SERIALIZED_CATALOG_RESULT) return value;

  const candidate = structuredClone(value) as CatalogDatasetFileResponse;
  let truncated = false;
  for (const format of candidate.formats) {
    for (const source of format.sources) {
      if (source.summary !== null) {
        source.summary = null;
        truncated = true;
      }
    }
  }
  if (JSON.stringify(candidate).length <= MAX_SERIALIZED_CATALOG_RESULT) {
    return { ...candidate, ...(truncated ? { truncated: true } : {}) };
  }

  if (candidate.dataset.tags && Object.keys(candidate.dataset.tags).length > 0) {
    candidate.dataset.tags = {};
    truncated = true;
  }
  while (candidate.formats.length > 0 && JSON.stringify(candidate).length > MAX_SERIALIZED_CATALOG_RESULT) {
    candidate.formats.pop();
    truncated = true;
  }
  return { ...candidate, ...(truncated ? { truncated: true } : {}) };
}

export function shapeDatasetFileResponse(
  response: CatalogDatasetFileShapeInput,
  origin: string,
  collectionSlug: string,
  datasetSlug: string,
  fileSlug: string,
): CatalogDatasetFileResponse {
  const collectionLink = collectionSelf(origin, collectionSlug);
  const datasetLink = datasetSelf(origin, collectionSlug, datasetSlug);
  const fileLink = fileSelf(origin, collectionSlug, datasetSlug, fileSlug);
  const schemaLink = schemaSelf(origin, collectionSlug, datasetSlug, fileSlug);
  const querySources: QuerySourceRef[] = [];
  let sourceIndex = 0;
  const formats = (response.file.formats ?? []).map((formatEntry) => ({
    id: formatEntry.format.id,
    format_type: formatEntry.format.format_type,
    name: formatEntry.format.name,
    sources: (formatEntry.sources ?? []).map((source) => {
      const querySource = isQuerySource(source, formatEntry.format.format_type)
        ? {
            alias: `source_${sourceIndex}`,
            collection_id: response.collection.id,
            dataset_id: response.dataset.id,
            file_id: response.file.id,
            file_source_id: source.id,
          }
        : null;
      if (querySource) {
        querySources.push(querySource);
        sourceIndex += 1;
      }
      return {
        id: source.id,
        version: sourceVersion(source),
        source_type: source.source_type,
        summary: sourceSummary(source),
        query_source: querySource,
      };
    }),
  }));
  const shaped: CatalogDatasetFileResponse = {
    collection: identity(response.collection, collectionLink),
    dataset: {
      ...identity(response.dataset, datasetLink),
      collection_id: response.dataset.collection_id ?? response.collection.id,
      tags: response.dataset.tags ?? {},
    },
    file: {
      id: response.file.id,
      dataset_id: response.file.dataset_id,
      slug: response.file.slug,
      name: response.file.name,
      layer_name: response.file.layer_name ?? null,
      summary: summary(response.file.file_metadata),
      links: { self: fileLink, schema: schemaLink },
    },
    formats,
    query_sources: querySources,
    links: { self: fileLink, collection: collectionLink, dataset: datasetLink, schema: schemaLink },
  };
  return boundFileShape(shaped);
}

export function serializedCatalogResult(value: CatalogDatasetFileResponse): string {
  return JSON.stringify(value);
}

export type CatalogSchemaResponseInput = {
  collection: Collection;
  dataset: Dataset;
  file: Pick<DatasetFile, "id" | "dataset_id" | "slug" | "name" | "layer_name">;
  versions: Array<string | number>;
  selected_version: string | number | null;
  schema: {
    version: string | number | null;
    format_type: FormatType;
    format_name: string;
    source_id: number;
    source_metadata: SpatialDatasetFileMetadata | null;
    columns: ColumnSchema[];
    total_columns?: number;
    column_offset?: number;
    column_limit?: number;
    has_more?: boolean;
  } | null;
};

export const CatalogSchemaResponseSchema = z
  .object({
    links: CatalogLinksSchema,
    collection: CatalogIdentitySchema,
    dataset: CatalogDatasetSchema,
    file: CatalogFileSchema,
    versions: z.array(z.union([z.string(), z.number()])),
    selected_version: z.union([z.string(), z.number()]).nullable(),
    schema: z
      .object({
        version: z.union([z.string(), z.number()]).nullable(),
        format_type: z.enum(["geoparquet", "pmtiles", "geopackage", "shapefile", "geojson", "file_geodatabase"]),
        format_name: z.string(),
        source_id: z.number().int().positive(),
        summary: SpatialSummarySchema.nullable(),
        columns: z.array(
          z
            .object({
              name: z.string(),
              type: z.string(),
              description: z.string().nullable().optional(),
              nullable: z.boolean(),
              num_null_values: z.number().nullable().optional(),
              num_unique_values: z.number().nullable().optional(),
              example_values: z.array(z.string()).nullable().optional(),
              min: z.number().nullable().optional(),
              max: z.number().nullable().optional(),
              length: z.number().nullable().optional(),
              possible_values: z.array(z.string()).nullable().optional(),
            })
            .strict(),
        ),
        total_columns: z.number().int().nonnegative().optional(),
        column_offset: z.number().int().nonnegative().optional(),
        column_limit: z.number().int().positive().max(50).optional(),
        has_more: z.boolean().optional(),
      })
      .strict()
      .nullable(),
    truncated: z.literal(true).optional(),
  })
  .strict();

export type CatalogSchemaResponse = z.infer<typeof CatalogSchemaResponseSchema>;

function boundSchemaShape(value: CatalogSchemaResponse): CatalogSchemaResponse {
  if (JSON.stringify(value).length <= MAX_SERIALIZED_CATALOG_RESULT) return value;
  const candidate = structuredClone(value) as CatalogSchemaResponse;
  while (
    candidate.schema &&
    candidate.schema.columns.length > 0 &&
    JSON.stringify(candidate).length > MAX_SERIALIZED_CATALOG_RESULT
  ) {
    candidate.schema.columns.pop();
  }
  return { ...candidate, truncated: true };
}

export function shapeDatasetFileSchemaResponse(
  response: CatalogSchemaResponseInput,
  origin: string,
  collectionSlug: string,
  datasetSlug: string,
  fileSlug: string,
): CatalogSchemaResponse {
  const collectionLink = collectionSelf(origin, collectionSlug);
  const datasetLink = datasetSelf(origin, collectionSlug, datasetSlug);
  const fileLink = fileSelf(origin, collectionSlug, datasetSlug, fileSlug);
  const schemaLink = schemaSelf(origin, collectionSlug, datasetSlug, fileSlug, {
    version: response.selected_version,
    ...(response.schema?.column_offset !== undefined ? { column_offset: response.schema.column_offset } : {}),
    ...(response.schema?.column_limit !== undefined ? { column_limit: response.schema.column_limit } : {}),
  });
  const shaped: CatalogSchemaResponse = {
    links: { self: schemaLink, file: fileLink, dataset: datasetLink, collection: collectionLink },
    collection: identity(response.collection, collectionLink),
    dataset: {
      ...identity(response.dataset, datasetLink),
      collection_id: response.dataset.collection_id ?? response.collection.id,
      tags: response.dataset.tags ?? {},
    },
    file: {
      id: response.file.id,
      dataset_id: response.file.dataset_id,
      slug: response.file.slug,
      name: response.file.name,
      layer_name: response.file.layer_name ?? null,
      summary: null,
      links: { self: fileLink, schema: schemaLink },
    },
    versions: response.versions,
    selected_version: response.selected_version,
    schema: response.schema
      ? {
          version: response.schema.version,
          format_type: response.schema.format_type,
          format_name: response.schema.format_name,
          source_id: response.schema.source_id,
          summary: summary(response.schema.source_metadata),
          columns: response.schema.columns.map((column) => ({ ...column })),
          ...(response.schema.total_columns !== undefined ? { total_columns: response.schema.total_columns } : {}),
          ...(response.schema.column_offset !== undefined ? { column_offset: response.schema.column_offset } : {}),
          ...(response.schema.column_limit !== undefined ? { column_limit: response.schema.column_limit } : {}),
          ...(response.schema.has_more !== undefined ? { has_more: response.schema.has_more } : {}),
        }
      : null,
  };
  return boundSchemaShape(CatalogSchemaResponseSchema.parse(shaped));
}
