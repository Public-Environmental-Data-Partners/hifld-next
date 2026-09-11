import ipaddr from "ipaddr.js";
import type { VectorSourceSpecification } from "maplibre-gl";
import { FetchSource, PMTiles, Protocol, TileType } from "pmtiles";
import { z } from "zod";
import type { ExternalTileSource, JsonValue } from "../mcp/contracts";

export const pmtilesProtocol = new Protocol();

class TimedFetchSource extends FetchSource {
  override getBytes(
    offset: number,
    length: number,
    signal?: AbortSignal,
    etag?: string,
  ) {
    return super.getBytes(
      offset,
      length,
      signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
      etag,
    );
  }
}

export function validatePublicTileUrl(value: string): string {
  const url = new URL(value);
  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  const isIp = ipaddr.isValid(host);
  const privateIp = isIp && ipaddr.process(host).range() !== "unicast";
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (!isIp && !host.includes(".")) ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    privateIp
  ) {
    throw new Error(
      "Tile sources must use public HTTPS URLs without credentials or fragments.",
    );
  }
  return value;
}

const TileMetadataSchema = z
  .object({
    tiles: z
      .array(
        z
          .string()
          .refine(
            (url) => ["{z}", "{x}", "{y}"].every((part) => url.includes(part)),
            "Tile URLs must contain {z}, {x}, and {y} placeholders",
          ),
      )
      .min(1)
      .optional(),
    minzoom: z.number().int().min(0).max(22).optional(),
    maxzoom: z.number().int().min(0).max(22).optional(),
    bounds: z
      .tuple([
        z.number().min(-180).max(180),
        z.number().min(-90).max(90),
        z.number().min(-180).max(180),
        z.number().min(-90).max(90),
      ])
      .optional(),
    attribution: z.string().optional(),
    scheme: z.enum(["xyz", "tms"]).optional(),
    vector_layers: z
      .array(
        z.object({
          id: z.string().min(1),
          fields: z.record(z.string(), z.string()).optional(),
        }),
      )
      .optional(),
  })
  .superRefine((metadata, context) => {
    if ((metadata.minzoom ?? 0) > (metadata.maxzoom ?? 22))
      context.addIssue({
        code: "custom",
        message: "minzoom must not exceed maxzoom",
      });
    if (
      metadata.bounds &&
      (metadata.bounds[0] >= metadata.bounds[2] ||
        metadata.bounds[1] >= metadata.bounds[3])
    )
      context.addIssue({
        code: "custom",
        message: "bounds must have increasing coordinates",
      });
  });

export interface ResolvedTileSource {
  source: VectorSourceSpecification;
  sourceLayer: string;
  columns: { name: string; type: string; nullable: boolean }[];
}

async function fetchTileJson(url: string): Promise<JsonValue> {
  const response = await fetch(url, {
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`TileJSON request failed (HTTP ${response.status}).`);
  // JSON is validated against the metadata schema before use.
  return response.json();
}

export async function resolveTileSource(
  source: ExternalTileSource,
  readTileJson: (url: string) => Promise<JsonValue> = fetchTileJson,
): Promise<ResolvedTileSource> {
  if (source.type === "vector_tiles") {
    TileMetadataSchema.parse(source);
    source.tiles.forEach(validatePublicTileUrl);
    if (
      source.tiles.some(
        (url) => !["{z}", "{x}", "{y}"].every((part) => url.includes(part)),
      )
    ) {
      throw new Error(
        "Vector tile URLs must contain {z}, {x}, and {y} placeholders.",
      );
    }
    return {
      source: {
        type: "vector",
        tiles: source.tiles,
        minzoom: source.minzoom ?? 0,
        maxzoom: source.maxzoom ?? 22,
        ...(source.bounds ? { bounds: source.bounds } : {}),
      },
      sourceLayer: source.source_layer,
      columns: [],
    };
  }
  validatePublicTileUrl(source.url);
  const archive =
    source.type === "pmtiles"
      ? new PMTiles(new TimedFetchSource(source.url))
      : null;
  if (archive && (await archive.getHeader()).tileType !== TileType.Mvt) {
    throw new Error(
      "PMTiles source must contain vector (MVT) tiles, not raster tiles.",
    );
  }
  const metadata = TileMetadataSchema.parse(
    archive
      ? await archive.getTileJson(`pmtiles://${source.url}`)
      : await readTileJson(source.url),
  );
  const names = metadata.vector_layers?.map((layer) => layer.id) ?? [];
  const sourceLayer =
    source.source_layer ?? (names.length === 1 ? names[0] : undefined);
  if (!sourceLayer)
    throw new Error(
      `Specify source_layer; available vector layers: ${names.join(", ") || "not declared in metadata"}.`,
    );
  if (names.length > 0 && !names.includes(sourceLayer)) {
    throw new Error(
      `Unknown source_layer '${sourceLayer}'; available vector layers: ${names.join(", ")}.`,
    );
  }
  if (!metadata.tiles?.length)
    throw new Error("Tile metadata does not declare any vector tile URLs.");
  if (!archive) metadata.tiles.forEach(validatePublicTileUrl);
  if (archive) pmtilesProtocol.add(archive);
  const fields =
    metadata.vector_layers?.find((layer) => layer.id === sourceLayer)?.fields ??
    {};
  return {
    source: {
      type: "vector",
      tiles: metadata.tiles,
      minzoom: metadata.minzoom ?? 0,
      maxzoom: metadata.maxzoom ?? 22,
      ...(metadata.bounds ? { bounds: metadata.bounds } : {}),
      ...(metadata.attribution ? { attribution: metadata.attribution } : {}),
      ...(metadata.scheme ? { scheme: metadata.scheme } : {}),
    },
    sourceLayer,
    columns: Object.entries(fields).map(([name, type]) => ({
      name,
      type: type.toLowerCase() === "number" ? "DOUBLE" : type,
      nullable: true,
    })),
  };
}
