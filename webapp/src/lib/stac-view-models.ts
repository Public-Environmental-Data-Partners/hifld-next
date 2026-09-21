import { z } from "zod";
import { catalogStacUrl } from "./catalog-stac";

const tagValueSchema = z.union([z.string(), z.array(z.string())]);
const jsonScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const boundsSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

const linkSchema = z
  .object({
    rel: z.string().min(1),
    href: z.string().min(1),
    type: z.string().optional(),
    title: z.string().optional(),
  })
  .catchall(z.json());

const catalogSchema = z
  .object({
    stac_version: z.string().min(1),
    type: z.literal("Catalog"),
    id: z.string().min(1),
    title: z.string().optional(),
    description: z.string(),
    keywords: z.array(z.string()).optional(),
    "hifld:tags": z.record(z.string(), tagValueSchema).optional(),
    links: z.array(linkSchema),
  })
  .catchall(z.json());

const columnSchema = z
  .object({
    name: z.string().min(1),
    type: z.string().min(1),
    description: z.string().optional(),
    nullable: z.boolean().optional(),
    null_count: z.number().int().nonnegative().nullable().optional(),
    numNullValues: z.number().int().nonnegative().nullable().optional(),
    numUniqueValues: z.number().int().nonnegative().nullable().optional(),
    exampleValues: z.array(jsonScalarSchema).nullable().optional(),
    possibleValues: z.array(jsonScalarSchema).nullable().optional(),
    min: jsonScalarSchema.optional(),
    max: jsonScalarSchema.optional(),
    length: z.number().int().nonnegative().nullable().optional(),
    is_geometry: z.boolean().optional(),
  })
  .catchall(z.json());

const qualitySchema = z
  .object({
    passed: z.boolean().nullable(),
    invalid_geometry_count: z.number().int().nonnegative().nullable(),
    null_geometry_count: z.number().int().nonnegative().nullable(),
    manifest_href: z.string().nullable(),
    sampled_feature_count: z.number().int().nonnegative().nullable(),
    sampled_invalid_geometry_count: z.number().int().nonnegative().nullable(),
    sampled_null_geometry_count: z.number().int().nonnegative().nullable(),
    columns_hash: z.string().nullable(),
    provenance: z.string().nullable(),
  })
  .catchall(z.json());

const assetSchema = z
  .object({
    href: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    type: z.string().optional(),
    roles: z.array(z.string()).optional(),
    "file:size": z.number().int().nonnegative().optional(),
    "file:checksum": z.string().optional(),
  })
  .catchall(z.json());

const sourceDatesSchema = z.object({
  issued: z.string().min(1).optional(),
  modified: z.string().min(1).optional(),
  provenance: z.object({ issued: z.string().min(1).optional(), modified: z.string().min(1).optional() }).optional(),
});

const versionCollectionSchema = z
  .object({
    stac_version: z.string().min(1),
    stac_extensions: z.array(z.string()).optional(),
    type: z.literal("Collection"),
    id: z.string().min(1),
    title: z.string().optional(),
    description: z.string(),
    keywords: z.array(z.string()).optional(),
    links: z.array(linkSchema),
    assets: z.record(z.string(), assetSchema),
    extent: z
      .object({
        spatial: z.object({ bbox: z.array(z.array(z.number())) }).catchall(z.json()),
        temporal: z.object({ interval: z.array(z.array(z.string().nullable())) }).catchall(z.json()),
      })
      .catchall(z.json()),
    "table:columns": z.array(columnSchema).optional(),
    "hifld:feature_count": z.number().int().nonnegative().nullable().optional(),
    "hifld:spatial_status": z.string().nullable().optional(),
    "hifld:native_crs": z.string().nullable().optional(),
    "hifld:geometry_column": z.string().nullable().optional(),
    "hifld:geometry_type": z.string().nullable().optional(),
    "hifld:feature_id_column": z.string().nullable().optional(),
    "hifld:native_bbox": z.array(z.number()).nullable().optional(),
    "hifld:source_version_description": z.string().nullable().optional(),
    "hifld:source_version_bounds": boundsSchema.nullable().optional(),
    "hifld:source_dates": sourceDatesSchema.optional(),
    "hifld:quality": qualitySchema,
  })
  .catchall(z.json());

export type StacLink = z.infer<typeof linkSchema>;
export type StacColumn = z.infer<typeof columnSchema>;
export type StacAsset = z.infer<typeof assetSchema>;
export type StacCatalog = ReturnType<typeof parseStacCatalog>;
export type StacVersionCollection = ReturnType<typeof parseStacVersionCollection>;

export function parseStacCatalog(input: z.input<typeof catalogSchema>) {
  const value = catalogSchema.parse(input);
  return {
    id: value.id,
    title: value.title ?? value.id.split("/").at(-1) ?? value.id,
    description: value.description,
    keywords: value.keywords ?? [],
    tags: value["hifld:tags"] ?? {},
    links: value.links,
  };
}

export function parseStacVersionCollection(input: z.input<typeof versionCollectionSchema>) {
  const value = versionCollectionSchema.parse(input);
  const bounds = boundsSchema.safeParse(value.extent.spatial.bbox[0]);
  return {
    id: value.id,
    title: value.title ?? value.id.split("/").at(-2) ?? value.id,
    description: value.description,
    keywords: value.keywords ?? [],
    links: value.links,
    assets: value.assets,
    columns: value["table:columns"] ?? [],
    featureCount: value["hifld:feature_count"],
    geometryType: value["hifld:geometry_type"],
    geometryColumn: value["hifld:geometry_column"],
    bounds: bounds.success ? bounds.data : undefined,
    sourceVersionDescription: value["hifld:source_version_description"],
    sourceVersionBounds: value["hifld:source_version_bounds"],
    sourceDates: value["hifld:source_dates"],
    quality: value["hifld:quality"],
  };
}

export function stacColumnMetadata(column: StacColumn) {
  return {
    name: column.name,
    type: column.type,
    ...(column.description === undefined ? {} : { description: column.description }),
    nullable: column.nullable ?? true,
    ...(column.numNullValues === undefined ? {} : { num_null_values: column.numNullValues }),
    ...(column.numUniqueValues === undefined ? {} : { num_unique_values: column.numUniqueValues }),
    ...(column.exampleValues === undefined ? {} : { example_values: column.exampleValues }),
    ...(column.possibleValues === undefined ? {} : { possible_values: column.possibleValues }),
    ...(column.min === undefined ? {} : { min: column.min }),
    ...(column.max === undefined ? {} : { max: column.max }),
    ...(column.length === undefined ? {} : { length: column.length }),
  };
}

async function fetchStacJson(sqliteUrl: string, href: string): Promise<z.infer<typeof z.json>> {
  const response = await fetch(catalogStacUrl(sqliteUrl, href), { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to fetch published STAC: ${response.status} ${href}`);
  return z.json().parse(await response.json());
}

export async function fetchStacCatalog(sqliteUrl: string, href: string): Promise<StacCatalog> {
  return parseStacCatalog(catalogSchema.parse(await fetchStacJson(sqliteUrl, href)));
}

export async function fetchStacVersionCollection(sqliteUrl: string, href: string): Promise<StacVersionCollection> {
  return parseStacVersionCollection(versionCollectionSchema.parse(await fetchStacJson(sqliteUrl, href)));
}
