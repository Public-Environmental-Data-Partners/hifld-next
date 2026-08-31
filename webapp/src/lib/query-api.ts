import { z } from "zod";

const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "URL must use HTTP or HTTPS");
const queryTilePathPattern = /^\/api\/queries\/([A-Za-z0-9_-]{20,64})\/tiles\/\{z\}\/\{x\}\/\{y\}\.mvt$/;

function queryTileId(url: string): string | undefined {
  try {
    return queryTilePathPattern.exec(decodeURIComponent(new URL(url).pathname))?.[1];
  } catch {
    return undefined;
  }
}

function decodedPath(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname);
  } catch {
    return "";
  }
}

export const QueryIdSchema = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/);
export const QueryTokenSchema = z.string().min(1).max(8192).regex(/^\S+$/);
export const JsonScalarSchema = z.union([z.null(), z.boolean(), z.number().finite(), z.string()]);
const geometrySummarySchema = z
  .object({
    $type: z.literal("geometry"),
    geometry_type: z.string().min(1).optional(),
    byte_length: z.number().int().nonnegative(),
    bounds: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]).optional(),
  })
  .strict();
const truncatedValueSchema = z
  .object({
    $type: z.literal("truncated"),
    byte_length: z.number().int().nonnegative(),
  })
  .strict();

export type QueryCell =
  | z.infer<typeof JsonScalarSchema>
  | z.infer<typeof geometrySummarySchema>
  | z.infer<typeof truncatedValueSchema>
  | QueryCell[]
  | { [key: string]: QueryCell };

type QueryRecord = { [key: string]: QueryCell };

const queryRecordSchema: z.ZodType<QueryRecord> = z.lazy(() =>
  z.record(z.string(), QueryCellSchema).superRefine((record, context) => {
    if (record["$type"] === "binary") {
      context.addIssue({ code: "custom", message: "binary cells are not supported" });
    }
    if ("type" in record && "coordinates" in record) {
      context.addIssue({ code: "custom", message: "raw geometry cells are not supported" });
    }
  }),
);

export const QueryCellSchema: z.ZodType<QueryCell> = z.lazy(() =>
  z.union([JsonScalarSchema, geometrySummarySchema, truncatedValueSchema, z.array(QueryCellSchema), queryRecordSchema]),
);

export const QuerySourceRefSchema = z
  .object({
    alias: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/),
    collection_id: z.number().int().positive(),
    dataset_id: z.number().int().positive(),
    file_id: z.number().int().positive(),
    file_source_id: z.number().int().positive(),
  })
  .strict();

export const QueryColumnSchema = z
  .object({
    name: z.string().min(1),
    type: z.string().min(1),
    nullable: z.boolean(),
  })
  .strict();

export const QueryMapConfigurationSchema = z
  .object({
    tile_url: httpUrlSchema.refine((value) => {
      const parsed = new URL(value);
      return (
        parsed.username === "" &&
        parsed.password === "" &&
        parsed.search === "" &&
        parsed.hash === "" &&
        queryTilePathPattern.test(decodedPath(value))
      );
    }, "tile_url must be a query tile template"),
    worker_url: httpUrlSchema.refine((value) => {
      const parsed = new URL(value);
      return (
        parsed.username === "" &&
        parsed.password === "" &&
        parsed.search === "" &&
        parsed.hash === "" &&
        parsed.pathname === "/assets/maplibre-gl-worker.mjs"
      );
    }, "worker_url must point to the MapLibre worker"),
    source_layer: z.string().min(1),
    geometry_column: z.string().min(1),
    result_crs: z.string().min(1),
    initial_bounds: z
      .tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
      .optional(),
  })
  .strict();

export const QueryPageRequestSchema = z
  .object({
    offset: z.number().int().nonnegative(),
    page_size: z.number().int().positive().max(1000).default(100),
  })
  .strict();

export const QueryRequestSchema = z
  .object({
    sources: z.array(QuerySourceRefSchema).min(1).max(8),
    sql: z.string().min(1),
    limit: z.number().int().positive().max(1000).default(100),
    geometry_column: z.string().min(1).optional(),
    result_crs: z.string().min(1).optional(),
  })
  .strict();

export const QueryRowSchema = z.record(z.string(), QueryCellSchema);

const queryPageShape = z
  .object({
    columns: z.array(QueryColumnSchema),
    rows: z.array(QueryRowSchema),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive().max(1000),
    returned_count: z.number().int().nonnegative(),
    has_more: z.boolean(),
    next_offset: z.number().int().nonnegative().optional(),
    warnings: z.array(z.string()),
    elapsed_ms: z.number().finite().nonnegative(),
    bytes_read: z.number().int().nonnegative(),
    files_read: z.number().int().nonnegative(),
    response_truncated: z.boolean(),
    deterministic_order: z.boolean(),
    query_id: QueryIdSchema,
    query_token: QueryTokenSchema,
    map_configuration: QueryMapConfigurationSchema.optional(),
  })
  .strict()
  .superRefine((page, context) => {
    if (page.has_more !== (page.next_offset !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "next_offset must be present exactly when has_more is true",
        path: ["next_offset"],
      });
    }
    const columnNames = new Set(page.columns.map((column) => column.name));
    page.rows.forEach((row, rowIndex) => {
      for (const column of columnNames) {
        if (!(column in row)) {
          context.addIssue({
            code: "custom",
            message: `row is missing declared column ${column}`,
            path: ["rows", rowIndex, column],
          });
        }
      }
      for (const key of Object.keys(row)) {
        if (!columnNames.has(key)) {
          context.addIssue({
            code: "custom",
            message: `row contains undeclared column ${key}`,
            path: ["rows", rowIndex, key],
          });
        }
      }
    });
    if (page.map_configuration !== undefined) {
      const tileQueryId = queryTileId(page.map_configuration.tile_url);
      if (tileQueryId !== page.query_id) {
        context.addIssue({
          code: "custom",
          message: "map tile URL query ID must match query_id",
          path: ["map_configuration", "tile_url"],
        });
      }
    }
  });

export const QueryPageSchema = queryPageShape;

export const QueryResultSchema = queryPageShape;

export const QueryErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

export type QuerySourceRef = z.infer<typeof QuerySourceRefSchema>;
export type QueryColumn = z.infer<typeof QueryColumnSchema>;
export type QueryMapConfiguration = z.infer<typeof QueryMapConfigurationSchema>;
export type QueryPageRequest = z.input<typeof QueryPageRequestSchema>;
export type QueryRequest = z.input<typeof QueryRequestSchema>;
export type QueryPage = z.infer<typeof QueryPageSchema>;
export type QueryResult = z.infer<typeof QueryResultSchema>;
export type QueryError = z.infer<typeof QueryErrorSchema>;
export type JsonScalar = z.infer<typeof JsonScalarSchema>;

type QueryFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class QueryApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "QueryApiError";
    this.status = status;
    this.code = code;
  }
}

type QueryFetchOptions = {
  fetcher?: QueryFetcher;
  signal?: AbortSignal;
};

type QueryPageFetchOptions = QueryFetchOptions & {
  queryToken: string;
};

async function parseResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const text = await response.text();
  try {
    const payload = JSON.parse(text);
    if (!response.ok) {
      const error = QueryErrorSchema.safeParse(payload);
      if (!error.success) {
        throw new QueryApiError(
          response.status,
          "invalid_response",
          "The query service returned an invalid error response.",
        );
      }
      throw new QueryApiError(response.status, error.data.code, error.data.message);
    }
    const result = schema.safeParse(payload);
    if (!result.success) {
      throw new QueryApiError(response.status, "invalid_response", "The query service returned an invalid response.");
    }
    return result.data;
  } catch (error) {
    if (error instanceof QueryApiError) throw error;
    throw new QueryApiError(response.status, "invalid_response", "The query service returned invalid JSON.");
  }
}

function parseInput<Input, Output>(schema: z.ZodType<Output, Input>, input: Input): Output {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new QueryApiError(400, "invalid_request", "The query request is invalid.");
  }
  return result.data;
}

export async function createQuery(input: QueryRequest, options: QueryFetchOptions = {}): Promise<QueryResult> {
  const request = parseInput(QueryRequestSchema, input);
  const fetcher = options.fetcher ?? fetch;
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  };
  if (options.signal !== undefined) init.signal = options.signal;
  const response = await fetcher("/api/queries", init);
  return parseResponse(response, QueryResultSchema);
}

export async function getQueryPage(
  queryId: string,
  input: QueryPageRequest,
  options: QueryPageFetchOptions,
): Promise<QueryPage> {
  const validQueryId = parseInput(QueryIdSchema, queryId);
  const request = parseInput(QueryPageRequestSchema, input);
  const token = parseInput(QueryTokenSchema, options.queryToken);
  const fetcher = options.fetcher ?? fetch;
  const init: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-HIFLD-Query-Token": token,
    },
    body: JSON.stringify(request),
  };
  if (options.signal !== undefined) init.signal = options.signal;
  const response = await fetcher(`/api/queries/${encodeURIComponent(validQueryId)}/pages`, init);
  return parseResponse(response, QueryPageSchema);
}

export const queryPage = getQueryPage;
