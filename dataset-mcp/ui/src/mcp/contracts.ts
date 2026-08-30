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
  nullable: z.boolean().default(true),
});
export const GeometrySummarySchema = z.object({
  $type: z.literal("geometry"),
  geometry_type: z.string().optional(),
  byte_length: z.number().int().nonnegative().optional(),
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
export const MapConfigurationSchema = z.object({
  tileUrl: z.string().optional(),
  tile_url: z.string().optional(),
  tileOrigin: z.string().optional(),
  tile_origin: z.string().optional(),
  workerUrl: z.string().optional(),
  worker_url: z.string().optional(),
  geometryType: z
    .enum([
      "Point",
      "MultiPoint",
      "LineString",
      "MultiLineString",
      "Polygon",
      "MultiPolygon",
    ])
    .optional(),
  geometry_type: z
    .enum([
      "Point",
      "MultiPoint",
      "LineString",
      "MultiLineString",
      "Polygon",
      "MultiPolygon",
    ])
    .optional(),
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  initial_bounds: z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .optional(),
  sourceLayer: z.string().optional(),
  source_layer: z.string().optional(),
});
export const QueryPageSchema = z.object({
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
});
export const QueryResultSchema = QueryPageSchema;
export const ErrorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), JsonValueSchema).optional(),
});
export const DiscoveryDatasetSchema = z.object({
  id: z.union([z.string(), z.number()]),
  slug: z.string(),
  name: z.string(),
  description: z.string().optional(),
  collection_id: z.union([z.string(), z.number()]).optional(),
});
export const DiscoveryResponseSchema = z.object({
  items: z.array(DiscoveryDatasetSchema),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().positive(),
  has_more: z.boolean().default(false),
});
export const MapFeatureSchema = z.object({
  type: z.literal("Feature"),
  geometry: z.record(z.string(), JsonValueSchema).nullable(),
  properties: z.record(z.string(), JsonValueSchema).default({}),
});
export const MapPayloadSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(MapFeatureSchema),
  warnings: z.array(z.string()).optional(),
});
export type Column = z.infer<typeof ColumnSchema>;
export type QueryPage = z.infer<typeof QueryPageSchema>;
export type QueryResult = z.infer<typeof QueryResultSchema>;
export type MapConfiguration = z.infer<typeof MapConfigurationSchema>;
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;
export type DiscoveryResponse = z.infer<typeof DiscoveryResponseSchema>;
export type MapPayload = z.infer<typeof MapPayloadSchema>;

export function parseToolPayload(
  value: JsonValue,
): QueryResult | ErrorPayload | MapPayload {
  const result = QueryResultSchema.safeParse(value);
  if (result.success) return result.data;
  const error = ErrorPayloadSchema.safeParse(value);
  if (error.success) return error.data;
  return MapPayloadSchema.parse(value);
}
