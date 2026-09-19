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

export const MapLayerStyleSchema = z
  .object({
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional(),
    color_property: z.string().trim().min(1).max(200).optional(),
    color_scheme: z
      .enum([
        "blues",
        "greens",
        "oranges",
        "purples",
        "viridis",
        "plasma",
        "rdyblu",
        "rdyg",
      ])
      .optional(),
    breaks: z.array(z.number()).max(8).optional(),
    opacity: z.number().min(0).max(1).optional(),
    point_radius: z.number().positive().max(50).optional(),
    point_radius_property: z.string().trim().min(1).max(200).optional(),
    point_radius_scale: z.enum(["linear", "sqrt", "log"]).optional(),
    line_width: z.number().positive().max(20).optional(),
    line_width_property: z.string().trim().min(1).max(200).optional(),
    line_width_scale: z.enum(["linear", "sqrt", "log"]).optional(),
  })
  .strict();

export const MapQueryLayerSpecSchema = MapLayerStyleSchema.extend({
  layer_name: z.string().trim().min(1).max(200),
  sources: z.array(z.record(z.string(), JsonValueSchema)).min(1).max(8),
  sql: z.string().trim().min(1).max(50_000),
  geometry_column: z.string().optional(),
  result_crs: z.string().optional(),
  visible: z.boolean(),
}).strict();

export const MapCameraSchema = z
  .object({
    bounds: z
      .tuple([z.number(), z.number(), z.number(), z.number()])
      .optional(),
    center: z
      .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
      .optional(),
    zoom: z.number().min(0).max(22).optional(),
    bearing: z.number().min(-180).max(180).optional(),
    pitch: z.number().min(0).max(85).optional(),
    padding: z.number().min(0).max(256).optional(),
  })
  .strict()
  .superRefine((camera, context) => {
    if (camera.bounds && camera.center) {
      context.addIssue({
        code: "custom",
        message: "camera accepts bounds or center, not both",
      });
    }
    if (camera.bounds) {
      const [west, south, east, north] = camera.bounds;
      if (west >= east || south >= north) {
        context.addIssue({
          code: "custom",
          message: "camera bounds must have increasing coordinates",
        });
      }
      if (camera.zoom !== undefined) {
        context.addIssue({
          code: "custom",
          message: "camera zoom cannot be combined with bounds",
        });
      }
    }
    if (camera.zoom !== undefined && !camera.center) {
      context.addIssue({
        code: "custom",
        message: "camera zoom requires center",
      });
    }
  });

export const ExternalTileSourceSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("pmtiles"),
      url: z.string(),
      source_layer: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tilejson"),
      url: z.string(),
      source_layer: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("vector_tiles"),
      tiles: z.array(z.string()).min(1).max(8),
      source_layer: z.string().min(1),
      minzoom: z.number().int().min(0).max(22).optional(),
      maxzoom: z.number().int().min(0).max(22).optional(),
      bounds: z
        .tuple([z.number(), z.number(), z.number(), z.number()])
        .optional(),
    })
    .strict(),
]);
export type ExternalTileSource = z.infer<typeof ExternalTileSourceSchema>;

const MapSourceLayerSpecSchema = MapLayerStyleSchema.extend({
  layer_name: z.string().trim().min(1).max(200),
  visible: z.boolean(),
  source: z.union([
    ExternalTileSourceSchema,
    z
      .object({
        type: z.literal("query"),
        inputs: z.array(z.record(z.string(), JsonValueSchema)).min(1).max(8),
        sql: z.string().min(1),
        geometry_column: z.string().optional(),
        result_crs: z.string().optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("catalog"),
        collection_id: z.number().int().positive(),
        dataset_id: z.number().int().positive(),
        file_id: z.number().int().positive(),
        file_source_id: z.number().int().positive(),
      })
      .strict(),
  ]),
}).strict();

export const MapDefinitionSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    basemap: z.enum(["street", "satellite"]),
    camera: MapCameraSchema.optional(),
    layers: z
      .array(z.union([MapQueryLayerSpecSchema, MapSourceLayerSpecSchema]))
      .min(1)
      .max(8),
  })
  .strict();

const QueryIdSchema = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/);

const MapColumnSchema = z
  .object({
    name: z.string().min(1),
    type: z.string().min(1),
    nullable: z.boolean(),
  })
  .strict();

export const MapLayerConfigurationSchema = z
  .object({
    query_id: QueryIdSchema,
    query_token: z.string().min(1),
    layer_name: z.string().trim().min(1).max(200),
    tile_url: z.string(),
    source_layer: z.string(),
    geometry_column: z.string(),
    result_crs: z.string(),
    columns: z.array(MapColumnSchema),
    preview: z
      .object({
        rows: z.array(z.record(z.string(), JsonValueSchema)).max(1),
        limit: z.literal(1),
        warnings: z.array(z.string()),
      })
      .strict()
      .optional(),
    result_status: z
      .enum(["rows_returned", "empty_result", "empty_page", "indeterminate"])
      .optional(),
    style: MapLayerStyleSchema.optional(),
    visible: z.boolean(),
    initial_bounds: z
      .tuple([z.number(), z.number(), z.number(), z.number()])
      .optional(),
  })
  .strict();

export const ExternalMapLayerSchema = z
  .object({
    layer_id: z.string().regex(/^external-\d+$/),
    layer_name: z.string().trim().min(1).max(200),
    source: ExternalTileSourceSchema,
    style: MapLayerStyleSchema.optional(),
    visible: z.boolean(),
  })
  .strict();

export const PendingMapLayerSchema = z
  .object({
    layer_id: z.string().regex(/^preparing-\d+$/),
    layer_name: z.string().trim().min(1).max(200),
    preparation_status: z.enum(["preparing", "failed"]),
    preparation_error: z.string().optional(),
    style: MapLayerStyleSchema.optional(),
    visible: z.boolean(),
  })
  .strict();

export const MapConfigurationSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    basemap: z.enum(["street", "satellite"]),
    worker_url: z.string(),
    camera: MapCameraSchema.optional(),
    layers: z
      .array(
        z.union([
          MapLayerConfigurationSchema,
          ExternalMapLayerSchema,
          PendingMapLayerSchema,
        ]),
      )
      .min(1)
      .max(8),
  })
  .strict()
  .superRefine((configuration, context) => {
    const queryIds = configuration.layers.map((layer) =>
      "query_id" in layer ? layer.query_id : layer.layer_id,
    );
    if (new Set(queryIds).size !== queryIds.length) {
      context.addIssue({ code: "custom", message: "query IDs must be unique" });
    }
    const names = configuration.layers.map((layer) =>
      layer.layer_name.toLocaleLowerCase(),
    );
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: "custom",
        message: "layer names must be unique",
      });
    }
  });

const MapResultLayerSchema = MapLayerConfigurationSchema.extend({
  expires_at: z.string().datetime({ offset: true }),
}).strict();

export const PreparedMapLayerResultSchema = z
  .object({
    layer: MapResultLayerSchema,
    worker_url: z.string().url(),
  })
  .strict();

export const MapResultSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    basemap: z.enum(["street", "satellite"]),
    worker_url: z.string(),
    camera: MapCameraSchema.optional(),
    layers: z
      .array(
        z.union([
          MapResultLayerSchema,
          ExternalMapLayerSchema,
          PendingMapLayerSchema,
        ]),
      )
      .min(1)
      .max(8),
    map_spec: MapDefinitionSchema,
  })
  .strict();

export const ErrorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), JsonValueSchema).optional(),
});
export const ErrorResultSchema = z.object({ error: ErrorPayloadSchema });

export type MapConfiguration = z.infer<typeof MapConfigurationSchema>;
export type MapDefinition = z.infer<typeof MapDefinitionSchema>;
export type MapLayerConfiguration = z.infer<typeof MapLayerConfigurationSchema>;
export type MapResult = z.infer<typeof MapResultSchema>;
