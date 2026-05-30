import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

const LinkMap = z.record(z.string(), z.string()).openapi("ApiLinkMap");

const Problem = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number(),
    detail: z.string().optional(),
    instance: z.string().optional(),
    links: LinkMap.optional(),
  })
  .openapi("Problem");

const DateTimeString = z.string().describe("ISO-like timestamp string from the catalog");

const FormatType = z
  .enum(["geoparquet", "pmtiles", "geopackage", "shapefile", "geojson", "file_geodatabase"])
  .openapi("FormatType");

const SourceType = z.enum(["file", "api"]).openapi("SourceType");

const DatasetTags = z.record(z.string(), z.union([z.string(), z.array(z.string())])).openapi("DatasetTags");

const Collection = z
  .object({
    id: z.number(),
    slug: z.string(),
    name: z.string(),
    description: z.string().optional(),
    created_at: DateTimeString.optional(),
    updated_at: DateTimeString.optional(),
  })
  .passthrough()
  .openapi("Collection");

const Dataset = z
  .object({
    id: z.number(),
    slug: z.string(),
    name: z.string(),
    description: z.string().optional(),
    collection_id: z.number().optional(),
    tags: DatasetTags.optional(),
    created_at: DateTimeString.optional(),
    updated_at: DateTimeString.optional(),
    links: LinkMap.optional(),
  })
  .passthrough()
  .openapi("Dataset");

const ColumnSchema = z
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
  .passthrough()
  .openapi("ColumnSchema");

const SpatialDatasetFileMetadata = z
  .object({
    version: z.string(),
    description: z.string().nullable().optional(),
    size_bytes: z.number().nullable().optional(),
    mime_type: z.string().nullable().optional(),
    feature_count: z.number().nullable().optional(),
    bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable().optional(),
    geometry_type: z.string().nullable().optional(),
    invalid_geometry_count: z.number().nullable().optional(),
    quality_check_passed: z.boolean().nullable().optional(),
    columns_hash: z.string().nullable().optional(),
    columns: z.array(ColumnSchema).optional(),
  })
  .passthrough()
  .openapi("SpatialDatasetFileMetadata");

const SourceLocation = z
  .union([
    z.object({ type: z.literal("file").optional(), version: z.string(), path: z.string() }).passthrough(),
    z
      .object({
        type: z.literal("api").optional(),
        version: z.string(),
        url: z.string(),
        method: z.string().optional(),
      })
      .passthrough(),
  ])
  .openapi("SourceLocation");

const StorageLocationConfig = z
  .object({
    type: z.string().optional(),
    version: z.string(),
    base_url: z.string(),
    bucket: z.string().optional(),
    endpoint_url: z.string().optional(),
  })
  .passthrough()
  .openapi("StorageLocationConfig");

const StorageLocation = z
  .object({
    id: z.number(),
    slug: z.string().optional(),
    name: z.string(),
    backend_type: z.string(),
    description: z.string().optional(),
    config: StorageLocationConfig.nullable().optional(),
    created_at: DateTimeString.optional(),
    updated_at: DateTimeString.optional(),
  })
  .passthrough()
  .openapi("StorageLocation");

const DatasetSource = z
  .object({
    id: z.number(),
    file_format_id: z.number().optional(),
    storage_location_id: z.number().nullable().optional(),
    version: z.union([z.string(), z.number()]).optional(),
    source_type: SourceType,
    location: SourceLocation,
    source_metadata: SpatialDatasetFileMetadata.nullable().optional(),
    url: z.string().nullable().optional(),
    storage_uri: z.string().nullable().optional(),
    glob_pattern: z.string().nullable().optional(),
    storage_location: StorageLocation.nullable().optional(),
    links: LinkMap.optional(),
    references_source_id: z.number().nullable().optional(),
    created_at: DateTimeString.optional(),
    updated_at: DateTimeString.optional(),
  })
  .passthrough()
  .openapi("DatasetSource");

const Format = z
  .object({
    id: z.number(),
    format_type: FormatType,
    name: z.string(),
    description: z.string().optional(),
    mime_type: z.string().nullable().optional(),
    created_at: DateTimeString.optional(),
    updated_at: DateTimeString.optional(),
  })
  .passthrough()
  .openapi("Format");

const FileFormat = z
  .object({
    id: z.number(),
    file_id: z.number().optional(),
    dataset_id: z.number().optional(),
    format_id: z.number(),
    created_at: DateTimeString.optional(),
    updated_at: DateTimeString.optional(),
  })
  .passthrough()
  .openapi("FileFormat");

const DatasetFormat = z
  .object({
    format: Format,
    file_format: FileFormat.optional(),
    dataset_format: FileFormat.optional(),
    sources: z.array(DatasetSource),
  })
  .passthrough()
  .openapi("DatasetFormat");

const DatasetFile = z
  .object({
    id: z.number(),
    dataset_id: z.number(),
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable().optional(),
    layer_name: z.string().nullable().optional(),
    source_file_path: z.string().nullable().optional(),
    file_metadata: SpatialDatasetFileMetadata.nullable().optional(),
    formats: z.array(DatasetFormat).optional(),
    links: LinkMap.optional(),
    created_at: DateTimeString.optional(),
    updated_at: DateTimeString.optional(),
  })
  .passthrough()
  .openapi("DatasetFile");

const DatasetDetailResponse = z
  .object({
    links: LinkMap,
    collection: Collection,
    dataset: Dataset.extend({ files: z.array(DatasetFile).optional() }).passthrough(),
  })
  .passthrough()
  .openapi("DatasetDetailResponse");

const DatasetFileResponse = z
  .object({
    links: LinkMap,
    collection: Collection,
    dataset: Dataset,
    file: DatasetFile,
  })
  .passthrough()
  .openapi("DatasetFileResponse");

const registry = new OpenAPIRegistry();

registry.register("ColumnSchema", ColumnSchema);
registry.register("SpatialDatasetFileMetadata", SpatialDatasetFileMetadata);
registry.register("DatasetSource", DatasetSource);
registry.register("DatasetFile", DatasetFile);
registry.register("DatasetDetailResponse", DatasetDetailResponse);
registry.register("DatasetFileResponse", DatasetFileResponse);

registry.registerPath({
  method: "get",
  path: "/api",
  summary: "API bootstrap and discovery",
  description:
    "Entry point with links to OpenAPI, /llms.txt, and collections. Call this first; do not assume OGC API-Features or STAC paths (/items, /features, ?q= on random segments).",
  responses: {
    200: {
      description: "Bootstrap JSON (title, description, links, hints)",
      content: {
        "application/json": {
          schema: z
            .object({
              title: z.string(),
              description: z.string(),
              links: LinkMap,
              hints: z.record(z.string(), z.string()).optional(),
            })
            .passthrough(),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/openapi",
  summary: "OpenAPI 3.1 document for this webapp surface",
  responses: {
    200: {
      description: "OpenAPI JSON",
      content: { "application/json": { schema: z.record(z.string(), z.unknown()) } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/health",
  summary: "Liveness / health",
  description: "Returns JSON suitable for RFC 9727 API catalog status links.",
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: z.object({ status: z.literal("ok") }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/collections",
  summary: "List collections",
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: z.array(
            z
              .object({
                id: z.number(),
                slug: z.string(),
                name: z.string(),
                links: z.object({ self: z.string() }).optional(),
              })
              .passthrough(),
          ),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/collections/{slug}",
  summary: "List datasets in a collection (paginated)",
  description:
    "This is the only collection-level list route: text search, tag filters, and pagination apply here (search, query, tag_filters, limit, offset, omit, include_urls). There is no /api/collections/{slug}/items, no ?q= shortcut on other paths, and no numeric dataset id in this URL—use dataset slug under .../datasets/{datasetSlug} next.",
  request: {
    query: z.object({
      query: z.string().optional().describe("Alias for text filter (same effect as search on this route)"),
      search: z.string().optional().describe("Filter datasets by text; use this or query, not q= on invented paths"),
      limit: z.coerce.number().int().positive().optional().describe("Defaults to 50 when omitted"),
      offset: z.coerce.number().int().nonnegative().optional(),
      include_urls: z.enum(["true", "false"]).optional(),
      tag_filters: z.string().optional().describe("Use GET .../datasets/tags to discover allowed values"),
      omit: z.string().optional().describe("Comma-separated; use 'description' to omit long descriptions"),
    }),
  },
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: z
            .object({
              collection: z.object({ id: z.number(), slug: z.string() }).passthrough(),
              datasets: z.array(z.object({ slug: z.string(), links: LinkMap.optional() }).passthrough()),
              total: z.number(),
              limit: z.number().nullable(),
              offset: z.number(),
              links: LinkMap.optional(),
            })
            .passthrough(),
        },
      },
    },
    400: { description: "Bad request", content: { "application/problem+json": { schema: Problem } } },
    404: { description: "Not found", content: { "application/problem+json": { schema: Problem } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/collections/{collectionSlug}/datasets/tags",
  summary: "Tag facets for filter discovery",
  request: {
    query: z.object({ tag_key: z.string().optional() }),
  },
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: z
            .object({
              links: LinkMap,
              tags: z.record(z.string(), z.array(z.string())),
            })
            .passthrough(),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/collections/{collectionSlug}/datasets/{datasetSlug}",
  summary: "Dataset detail in a collection",
  description:
    "Returns one dataset by collection and dataset slug. Use include_urls=true when source URLs are needed on nested file format sources.",
  request: {
    params: z.object({
      collectionSlug: z.string(),
      datasetSlug: z.string(),
    }),
    query: z.object({
      include_urls: z.enum(["true", "false"]).optional(),
    }),
  },
  responses: {
    200: {
      description: "Dataset detail with file links",
      content: {
        "application/json": {
          schema: DatasetDetailResponse,
        },
      },
    },
    404: { description: "Not found", content: { "application/problem+json": { schema: Problem } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/collections/{collectionSlug}/datasets/{datasetSlug}/files/{fileSlug}",
  summary: "Dataset file metadata and source URLs",
  description:
    "Raw file metadata used by the View metadata action. Includes formats, source versions, storage locations, source lifecycle timestamps, source_metadata.description, source_metadata.size_bytes, and download links.",
  request: {
    params: z.object({
      collectionSlug: z.string(),
      datasetSlug: z.string(),
      fileSlug: z.string(),
    }),
  },
  responses: {
    200: {
      description: "Dataset file metadata",
      content: {
        "application/json": {
          schema: DatasetFileResponse,
        },
      },
    },
    404: { description: "Not found", content: { "application/problem+json": { schema: Problem } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/datasets",
  summary: "List datasets (capped aggregate across collections)",
  responses: {
    200: {
      description: "JSON array; each row may include links",
      content: {
        "application/json": {
          schema: z.array(z.object({ id: z.number(), slug: z.string(), links: LinkMap.optional() }).passthrough()),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/datasets/stats",
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: z
            .object({
              total: z.number(),
              ready: z.number().optional(),
              links: LinkMap.optional(),
            })
            .passthrough(),
        },
      },
    },
  },
});

const generator = new OpenApiGeneratorV31(registry.definitions);

export function buildOpenApiDocument() {
  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "HIFLD Next public webapp API",
      version: "1.0.0",
      description: [
        "TanStack webapp JSON routes that proxy dataset-api. Start with GET /api or GET /llms.txt, then GET /api/openapi for the full contract.",
        "Not OGC API-Features or STAC: no /items or /features collections; dataset URLs use string slugs (not /datasets/3418).",
        "Search and pagination: only on GET /api/collections/{slug} using search, query, tag_filters, limit, offset, omit (not ?q= on other paths).",
        "Collection dataset listing defaults to limit=50 when omitted (breaking vs older unbounded responses).",
        "GET /api/datasets returns at most 200 rows aggregated across collections.",
        "Unknown GET paths under /api respond with 404 and application/problem+json including links to /api, /api/openapi, and /llms.txt.",
      ].join(" "),
    },
  });
}
