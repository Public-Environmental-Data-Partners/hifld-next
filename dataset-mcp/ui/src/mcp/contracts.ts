import { z } from "zod";

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.string(),
    z.number(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export const ColumnSchema = z.object({
  name: z.string(),
  type: z.string(),
  nullable: z.boolean(),
});
export const GeometrySummarySchema = z.object({
  $type: z.literal("geometry"),
  geometry_type: z.string().optional(),
  byte_length: z.number().int().nonnegative(),
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
});
export const BinarySummarySchema = z.object({
  $type: z.literal("binary"),
  byte_length: z.number().int().nonnegative(),
});
export const TruncatedValueSchema = z.object({
  $type: z.literal("truncated"),
  byte_length: z.number().int().nonnegative(),
});
export const CellSchema = z.union([
  GeometrySummarySchema,
  BinarySummarySchema,
  TruncatedValueSchema,
  JsonValueSchema,
]);
export const RowSchema = z.record(z.string(), CellSchema);
export const MapConfigurationSchema = z
  .object({
    tile_url: z.string(),
    worker_url: z.string(),
    source_layer: z.string(),
    geometry_column: z.string(),
    result_crs: z.string(),
    initial_bounds: z
      .tuple([z.number(), z.number(), z.number(), z.number()])
      .optional(),
  })
  .strict();
export const QueryPageSchema = z
  .object({
    columns: z.array(ColumnSchema),
    rows: z.array(RowSchema),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    has_more: z.boolean(),
    next_offset: z.number().int().nonnegative().optional(),
    response_truncated: z.boolean().optional(),
    deterministic_order: z.boolean().optional(),
    query_token: z.string().optional(),
    warnings: z.array(z.string()).optional(),
    map_configuration: MapConfigurationSchema.optional(),
  })
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
  });
export const QueryResultSchema = QueryPageSchema;
export const ErrorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), JsonValueSchema).optional(),
});
export const ErrorResultSchema = z.object({ error: ErrorPayloadSchema });
export const DiscoveryDatasetSchema = z.object({
  id: z.union([z.string(), z.number()]),
  slug: z.string(),
  name: z.string(),
  description: z.string().optional(),
  collection_id: z.union([z.string(), z.number()]).optional(),
});
export const DiscoveryResponseSchema = z.object({
  items: z.array(DiscoveryDatasetSchema),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  has_more: z.boolean(),
});
export type Column = z.infer<typeof ColumnSchema>;
export type QueryPage = z.infer<typeof QueryPageSchema>;
export type QueryResult = z.infer<typeof QueryResultSchema>;
export type MapConfiguration = z.infer<typeof MapConfigurationSchema>;
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;
export type DiscoveryResponse = z.infer<typeof DiscoveryResponseSchema>;
