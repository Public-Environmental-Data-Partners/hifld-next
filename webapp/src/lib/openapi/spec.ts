import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { MAX_QUERY_SQL_BYTES } from "@/lib/query-api";

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

const STACLink = z
  .object({
    rel: z.string(),
    href: z.string(),
    type: z.string().optional(),
    title: z.string().optional(),
  })
  .passthrough()
  .openapi("STACLink");

const STACCatalog = z
  .object({
    type: z.literal("Catalog"),
    stac_version: z.string(),
    id: z.string(),
    title: z.string().optional(),
    description: z.string(),
    links: z.array(STACLink),
  })
  .passthrough()
  .openapi("STACCatalog");

const STACAsset = z
  .object({
    href: z.string(),
    title: z.string().optional(),
    type: z.string().optional(),
    roles: z.array(z.string()).optional(),
    "hifld:format_key": z.string().optional(),
    "hifld:sha256": z.string().optional(),
    "hifld:storage_location_slug": z.string().optional(),
  })
  .passthrough()
  .openapi("STACAsset");

const STACCollection = z
  .object({
    type: z.literal("Collection"),
    stac_version: z.string(),
    id: z.string(),
    title: z.string().optional(),
    description: z.string(),
    license: z.string(),
    extent: z.record(z.string(), z.unknown()),
    links: z.array(STACLink),
    assets: z.record(z.string(), STACAsset),
    "table:columns": z
      .array(
        z.object({ name: z.string(), type: z.string(), description: z.string().nullable().optional() }).passthrough(),
      )
      .optional(),
  })
  .passthrough()
  .openapi("STACCollection");

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

// The runtime result schema recursively models arbitrary JSON cells. Keep the
// generated OpenAPI contract finite while still describing all response fields.
const QuerySourceDocumentationSchema = z
  .object({
    alias: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/),
    collection_id: z.number().int().positive(),
    dataset_id: z.number().int().positive(),
    file_id: z.number().int().positive(),
    file_source_id: z.number().int().positive(),
  })
  .strict();
const OpenApiQueryRequestSchema = z
  .object({
    sources: z.array(QuerySourceDocumentationSchema).min(1).max(8),
    sql: z.string().min(1).max(MAX_QUERY_SQL_BYTES),
    limit: z.number().int().positive().max(1000).default(100),
    geometry_column: z.string().min(1).optional(),
    result_crs: z.string().min(1).optional(),
  })
  .strict()
  .openapi("QueryRequest");
const OpenApiQueryPageRequestSchema = z
  .object({
    offset: z.number().int().nonnegative(),
    page_size: z.number().int().positive().max(1000).default(100),
  })
  .strict()
  .openapi("QueryPageRequest");
const OpenApiQueryErrorSchema = z
  .object({ code: z.string().min(1), message: z.string().min(1) })
  .strict()
  .openapi("QueryError");
const OpenApiQueryBoundsSchema = z
  .object({
    bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  })
  .strict()
  .openapi("QueryBounds");
const QueryResultCellDocumentationSchema = z.union([
  z.null(),
  z.boolean(),
  z.number(),
  z.string(),
  z.object({}).passthrough(),
  z.array(z.object({}).passthrough()),
]);
const QueryResultDocumentationSchema = z
  .object({
    columns: z.array(z.object({ name: z.string().min(1), type: z.string().min(1), nullable: z.boolean() }).strict()),
    rows: z.array(z.record(z.string(), QueryResultCellDocumentationSchema)),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive().max(1000),
    returned_count: z.number().int().nonnegative(),
    result_status: z.enum(["rows_returned", "empty_result", "empty_page", "indeterminate"]).optional(),
    has_more: z.boolean(),
    next_offset: z.number().int().nonnegative().optional(),
    warnings: z.array(z.string()),
    elapsed_ms: z.number().finite().nonnegative(),
    bytes_read: z.number().int().nonnegative(),
    files_read: z.number().int().nonnegative(),
    response_truncated: z.boolean(),
    deterministic_order: z.boolean(),
    query_id: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/),
    query_token: z.string().min(1),
    map_configuration: z.object({}).passthrough().optional(),
  })
  .strict()
  .openapi("QueryResult");

const registry = new OpenAPIRegistry();

registry.register("ColumnSchema", ColumnSchema);
registry.register("SpatialDatasetFileMetadata", SpatialDatasetFileMetadata);
registry.register("DatasetSource", DatasetSource);
registry.register("DatasetFile", DatasetFile);
const OpenApiQueryRequest = registry.register("QueryRequest", OpenApiQueryRequestSchema);
const OpenApiQueryPageRequest = registry.register("QueryPageRequest", OpenApiQueryPageRequestSchema);
const OpenApiQueryResult = registry.register("QueryResult", QueryResultDocumentationSchema);
const OpenApiQueryError = registry.register("QueryError", OpenApiQueryErrorSchema);
const OpenApiQueryBounds = registry.register("QueryBounds", OpenApiQueryBoundsSchema);

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
  summary: "Root STAC catalog",
  description: "Returns the authored root STAC Catalog. Follow child links to collection catalogs on this origin.",
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: STACCatalog,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/collections/{slug}",
  summary: "Collection STAC catalog",
  description:
    "Returns the authored STAC Catalog for one collection. Use the explicit /datasets child resource to search datasets.",
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: STACCatalog,
        },
      },
    },
    400: { description: "Bad request", content: { "application/problem+json": { schema: Problem } } },
    404: { description: "Not found", content: { "application/problem+json": { schema: Problem } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/collections/{slug}/datasets",
  summary: "List datasets in a collection (paginated)",
  description:
    "Search and page datasets in one collection. There is no /api/collections/{slug}/items or ?q= shortcut; use dataset slugs under .../datasets/{datasetSlug} for detail.",
  request: {
    query: z.object({
      query: z.string().optional().describe("Alias for the text filter"),
      search: z.string().optional().describe("Filter datasets by text"),
      limit: z.coerce.number().int().positive().optional().describe("Defaults to 50 when omitted"),
      offset: z.coerce.number().int().nonnegative().optional(),
      include_urls: z.enum(["true", "false"]).optional(),
      include: z.enum(["files"]).optional().describe("Add compact file/layer summaries to items"),
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
              datasets: z.array(STACCatalog),
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
  description: "Returns the raw dataset STAC Catalog with child links to file catalogs.",
  request: {
    params: z.object({
      collectionSlug: z.string(),
      datasetSlug: z.string(),
    }),
  },
  responses: {
    200: {
      description: "Dataset STAC Catalog",
      content: {
        "application/json": {
          schema: STACCatalog,
        },
      },
    },
    404: { description: "Not found", content: { "application/problem+json": { schema: Problem } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/collections/{collectionSlug}/datasets/{datasetSlug}/files/{fileSlug}",
  summary: "Selected dataset file version",
  description:
    "Returns the requested version as a raw STAC Collection, defaulting to latest. Assets are keyed by format and content hash; schema columns are in table:columns.",
  request: {
    params: z.object({
      collectionSlug: z.string(),
      datasetSlug: z.string(),
      fileSlug: z.string(),
    }),
    query: z.object({ version: z.string().optional() }),
  },
  responses: {
    200: {
      description: "Selected-version STAC Collection",
      content: {
        "application/json": {
          schema: STACCollection,
        },
      },
    },
    404: { description: "Not found", content: { "application/problem+json": { schema: Problem } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/collections/{collectionSlug}/datasets/{datasetSlug}/files/{fileSlug}/schema",
  summary: "Dataset file STAC Collection schema alias",
  description:
    "Exact alias of the selected-version file response. Read schema columns from table:columns; omit version to select latest.",
  request: {
    params: z.object({
      collectionSlug: z.string(),
      datasetSlug: z.string(),
      fileSlug: z.string(),
    }),
    query: z.object({
      version: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Selected-version STAC Collection",
      content: {
        "application/json": {
          schema: STACCollection,
        },
      },
    },
    404: { description: "Not found", content: { "application/problem+json": { schema: Problem } } },
  },
});

for (const [path, schema, description] of [
  [
    "/api/collections/{collectionSlug}/datasets/{datasetSlug}/metadata",
    STACCatalog,
    "Exact alias of the dataset STAC Catalog",
  ],
  [
    "/api/collections/{collectionSlug}/datasets/{datasetSlug}/files/{fileSlug}/metadata",
    STACCollection,
    "Exact alias of the selected-version file STAC Collection",
  ],
] as const) {
  registry.registerPath({
    method: "get",
    path,
    summary: description,
    request: {
      params: path.includes("fileSlug")
        ? z.object({ collectionSlug: z.string(), datasetSlug: z.string(), fileSlug: z.string() })
        : z.object({ collectionSlug: z.string(), datasetSlug: z.string() }),
      query: path.includes("fileSlug") ? z.object({ version: z.string().optional() }) : undefined,
    },
    responses: {
      200: { description, content: { "application/json": { schema } } },
      404: { description: "Not found", content: { "application/problem+json": { schema: Problem } } },
    },
  });
}

registry.registerPath({
  method: "get",
  path: "/api/datasets",
  summary: "List dataset STAC catalogs across collections",
  request: {
    query: z.object({
      search: z.string().optional(),
      query: z.string().optional(),
      tag_filters: z.string().optional(),
      limit: z.coerce.number().int().positive().optional(),
      offset: z.coerce.number().int().nonnegative().optional(),
    }),
  },
  responses: {
    200: {
      description: "Paginated custom wrapper of raw dataset STAC Catalogs",
      content: {
        "application/json": {
          schema: z.object({
            datasets: z.array(STACCatalog),
            total: z.number(),
            limit: z.number(),
            offset: z.number(),
            links: LinkMap.optional(),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/datasets/{id}",
  summary: "Dataset STAC Catalog by full slug identity",
  description:
    "Returns raw dataset STAC for a URL-encoded collection/dataset identity. Numeric legacy IDs are invalid.",
  request: {
    params: z.object({
      id: z.string().openapi({ param: { description: "URL-encoded collection/dataset identity" } }),
    }),
  },
  responses: {
    200: {
      description: "Dataset STAC Catalog",
      content: {
        "application/json": {
          schema: STACCatalog,
        },
      },
    },
    400: { description: "Invalid ID", content: { "application/problem+json": { schema: Problem } } },
    404: { description: "Dataset not found", content: { "application/problem+json": { schema: Problem } } },
    502: { description: "Failed to load dataset", content: { "application/problem+json": { schema: Problem } } },
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

registry.registerPath({
  method: "post",
  path: "/api/queries",
  summary: "Create a bounded dataset query",
  description:
    "Starts a bounded server-side query from catalog source identities. SQL is limited to 8 KiB UTF-8 and the request body is limited to 64 KiB.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: OpenApiQueryRequest } },
    },
  },
  responses: {
    200: {
      description: "Bounded query result page",
      content: { "application/json": { schema: OpenApiQueryResult } },
    },
    400: { description: "Invalid request", content: { "application/json": { schema: OpenApiQueryError } } },
    422: {
      description: "Query cannot be executed as requested",
      content: { "application/json": { schema: OpenApiQueryError } },
    },
    504: { description: "Query timed out", content: { "application/json": { schema: OpenApiQueryError } } },
    503: { description: "Query service unavailable", content: { "application/json": { schema: OpenApiQueryError } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/queries/{query_id}/pages",
  summary: "Fetch a bounded query page",
  description:
    "Re-executes one bounded query page. The opaque query_id path value must match the signed token sent in X-HIFLD-Query-Token.",
  request: {
    params: z.object({
      query_id: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/),
    }),
    headers: z.object({
      "X-HIFLD-Query-Token": z.string().min(1),
    }),
    body: {
      required: true,
      content: { "application/json": { schema: OpenApiQueryPageRequest } },
    },
  },
  responses: {
    200: {
      description: "Bounded query result page",
      content: { "application/json": { schema: OpenApiQueryResult } },
    },
    400: { description: "Invalid request", content: { "application/json": { schema: OpenApiQueryError } } },
    422: {
      description: "Query cannot be executed as requested",
      content: { "application/json": { schema: OpenApiQueryError } },
    },
    504: { description: "Query timed out", content: { "application/json": { schema: OpenApiQueryError } } },
    503: { description: "Query service unavailable", content: { "application/json": { schema: OpenApiQueryError } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/queries/{query_id}/bounds",
  summary: "Calculate query-result bounds for map framing",
  description:
    "Lazily re-executes the signed spatial query as an extent aggregate and returns WGS84 bounds. The query_id path value must match X-HIFLD-Query-Token.",
  request: {
    params: z.object({
      query_id: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/),
    }),
    headers: z.object({
      "X-HIFLD-Query-Token": z.string().min(1),
    }),
  },
  responses: {
    200: {
      description: "WGS84 result bounds",
      content: { "application/json": { schema: OpenApiQueryBounds } },
    },
    400: { description: "Invalid request", content: { "application/json": { schema: OpenApiQueryError } } },
    422: {
      description: "Query result cannot be framed",
      content: { "application/json": { schema: OpenApiQueryError } },
    },
    504: { description: "Bounds query timed out", content: { "application/json": { schema: OpenApiQueryError } } },
    503: { description: "Query service unavailable", content: { "application/json": { schema: OpenApiQueryError } } },
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
        "GET /api/collections and GET /api/collections/{slug} return authored STAC Catalog documents; this is not an OGC API-Features or STAC API /items surface.",
        "Search and pagination: only on GET /api/collections/{slug}/datasets using search, query, tag_filters, limit, offset, omit (not ?q= on other paths).",
        "Collection dataset listing defaults to limit=50 when omitted (breaking vs older unbounded responses).",
        "GET /api/datasets returns a custom paginated wrapper of raw dataset STAC Catalogs; it is not a STAC Item Search FeatureCollection.",
        "GET /api/datasets/{id} accepts a URL-encoded collection/dataset identity and returns the raw dataset STAC Catalog; numeric legacy IDs are invalid.",
        "Unknown GET paths under /api respond with 404 and application/problem+json including links to /api, /api/openapi, and /llms.txt.",
      ].join(" "),
    },
  });
}
