import "maplibre-gl/dist/maplibre-gl.css";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
import type {
  MapLayerMouseEvent,
  Map as MapLibreMap,
  RequestParameters,
} from "maplibre-gl";
import * as maplibregl from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import type { JsonValue } from "../mcp/contracts";

const GeometryTypeSchema = z.enum([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
]);
const BoundsSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const MapConfigurationSchema = z
  .object({
    tileUrl: z.string().optional(),
    tile_url: z.string().optional(),
    tileOrigin: z.string().optional(),
    tile_origin: z.string().optional(),
    workerUrl: z.string().optional(),
    worker_url: z.string().optional(),
    geometryType: GeometryTypeSchema.optional(),
    geometry_type: GeometryTypeSchema.optional(),
    bounds: BoundsSchema.optional(),
    initial_bounds: BoundsSchema.optional(),
    sourceLayer: z.string().optional(),
    source_layer: z.string().optional(),
  })
  .transform((value) => ({
    tileUrl: resolveServerUrl(
      value.tileUrl ?? value.tile_url,
      value.tileOrigin ?? value.tile_origin,
    ),
    workerUrl: resolveServerUrl(
      value.workerUrl ?? value.worker_url,
      value.tileOrigin ?? value.tile_origin,
    ),
    geometryType: value.geometryType ?? value.geometry_type,
    bounds: value.bounds ?? value.initial_bounds,
    sourceLayer: value.sourceLayer ?? value.source_layer ?? "hifld",
  }))
  .refine(
    (value) => value.tileUrl !== undefined && value.workerUrl !== undefined,
    "absolute tile_url and worker_url are required",
  );
const GeoJsonSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(
    z.object({
      type: z.literal("Feature"),
      geometry: z.record(z.string(), z.json()).nullable(),
      properties: z.record(z.string(), z.json()).default({}),
    }),
  ),
  warnings: z.array(z.string()).optional(),
});
export type MapConfiguration = z.input<typeof MapConfigurationSchema>;
export type GeoJsonFeatureCollection = z.infer<typeof GeoJsonSchema>;

export interface MapViewProps {
  configuration: MapConfiguration | null;
  queryToken: string | null;
  app: McpApp | null;
}

export interface TileRequest extends RequestParameters {
  headers?: Record<string, string>;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(
      value
        .replaceAll("{z}", "0")
        .replaceAll("{x}", "0")
        .replaceAll("{y}", "0"),
    );
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveServerUrl(
  value: string | undefined,
  origin: string | undefined,
) {
  if (value && isHttpUrl(value)) return value;
  if (!value || !origin || !isHttpUrl(origin)) return undefined;
  if (!value.startsWith("/")) return undefined;
  const parsedOrigin = new URL(origin);
  return `${parsedOrigin.origin}${value}`;
}

export function normalizeMapConfiguration(
  configuration: MapConfiguration,
): z.output<typeof MapConfigurationSchema> | null {
  const parsed = MapConfigurationSchema.safeParse(configuration);
  return parsed.success ? parsed.data : null;
}

export function mapTileRequest(
  url: string,
  queryToken: string | null,
): TileRequest {
  if (!queryToken || !url.includes("/tiles/")) return { url };
  return { url, headers: { "X-HIFLD-Query-Token": queryToken } };
}

function layersForSource(sourceLayer: string) {
  return [
    {
      id: "hifld-polygons",
      type: "fill" as const,
      source: "hifld",
      "source-layer": sourceLayer,
    },
    {
      id: "hifld-lines",
      type: "line" as const,
      source: "hifld",
      "source-layer": sourceLayer,
    },
    {
      id: "hifld-points",
      type: "circle" as const,
      source: "hifld",
      "source-layer": sourceLayer,
    },
  ];
}

function boundsFromMap(map: MapLibreMap): [number, number, number, number] {
  const bounds = map.getBounds();
  return [
    bounds.getWest(),
    bounds.getSouth(),
    bounds.getEast(),
    bounds.getNorth(),
  ];
}

export function MapView({ configuration, queryToken, app }: MapViewProps) {
  const parsed = useMemo(
    () =>
      configuration === null
        ? { success: false as const }
        : (() => {
            const normalized = normalizeMapConfiguration(configuration);
            return normalized
              ? { success: true as const, data: normalized }
              : { success: false as const };
          })(),
    [configuration],
  );
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [features, setFeatures] = useState<GeoJsonFeatureCollection | null>(
    null,
  );
  const [selected, setSelected] = useState<Record<string, JsonValue> | null>(
    null,
  );

  const fallback = useCallback(
    async (map: MapLibreMap | null, reason: string) => {
      if (!app || !queryToken) {
        setMessage(reason);
        return;
      }
      const bbox = map
        ? boundsFromMap(map)
        : parsed.success && parsed.data.bounds
          ? parsed.data.bounds
          : [-180, -85, 180, 85];
      try {
        const result = await app.callServerTool({
          name: "get_map_features",
          arguments: {
            query_token: queryToken,
            bbox,
            zoom: Math.min(map?.getZoom() ?? 0, 24),
            feature_cap: 2000,
          },
        });
        const payload = GeoJsonSchema.safeParse(result.structuredContent);
        if (!payload.success)
          throw new Error("The map fallback returned invalid GeoJSON.");
        setFeatures(payload.data);
        setMessage(
          "Map compatibility mode: showing a bounded text and feature view.",
        );
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Map data could not be loaded.",
        );
      }
    },
    [app, parsed, queryToken],
  );

  useEffect(() => {
    if (!parsed.success) {
      setMessage("Map configuration is missing absolute tile or worker URLs.");
      return;
    }
    if (!parsed.data.tileUrl || !parsed.data.workerUrl) {
      setMessage("Map configuration is missing absolute tile or worker URLs.");
      return;
    }
    if (!mapNode.current) return;
    if (maplibregl && typeof maplibregl.setWorkerUrl === "function") {
      maplibregl.setWorkerUrl(parsed.data.workerUrl);
    }
    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
        container: mapNode.current,
        center: [0, 0],
        zoom: 1,
        style: {
          version: 8,
          sources: {
            hifld: {
              type: "vector",
              tiles: [parsed.data.tileUrl],
              minzoom: 0,
              maxzoom: 22,
            },
          },
          layers: layersForSource(parsed.data.sourceLayer),
        },
        transformRequest: (url) => mapTileRequest(url, queryToken),
      });
      mapRef.current = map;
      map.once("load", () => {
        if (parsed.data.bounds)
          map.fitBounds(parsed.data.bounds, { padding: 24, animate: false });
      });
      map.on("error", (event) => {
        const errorText =
          event.error instanceof Error
            ? event.error.message
            : "Map rendering is unavailable.";
        void fallback(
          map,
          /dense/i.test(errorText)
            ? "This tile is too dense. Filter, aggregate, or zoom in."
            : errorText,
        );
      });
      map.on("click", (event: MapLayerMouseEvent) => {
        const rendered = map.queryRenderedFeatures(event.point, {
          layers: ["hifld-polygons", "hifld-lines", "hifld-points"],
        });
        const properties = rendered[0]?.properties;
        if (properties) setSelected(properties as Record<string, JsonValue>);
      });
    } catch {
      void fallback(
        null,
        "Map rendering is unavailable; showing bounded feature details.",
      );
    }
    return () => {
      mapRef.current = null;
      try {
        map?.remove();
      } catch {
        // MapLibre can fail to tear down an uninitialized WebGL context.
      }
    };
  }, [fallback, parsed, queryToken]);

  useEffect(() => {
    const onVisibility = () => {
      const map = mapRef.current;
      if (!map) return;
      if (document.visibilityState === "hidden") map.stop();
      else map.triggerRepaint();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const requestFullscreen = () => {
    if (app?.getHostContext()?.availableDisplayModes?.includes("fullscreen")) {
      void app.requestDisplayMode({ mode: "fullscreen" });
    }
  };
  const rows = features?.features ?? [];
  return (
    <section className="map-view" aria-label="Dataset map">
      <div className="map-toolbar">
        <button type="button" onClick={requestFullscreen}>
          Full screen map
        </button>
        <span role="status">{message ?? "Interactive map ready."}</span>
      </div>
      <div
        ref={mapNode}
        className="map-canvas"
        role="application"
        aria-label="Interactive dataset map"
      />
      <section className="map-alternative" aria-label="Map feature table">
        <h2>Text alternative</h2>
        <table>
          <thead>
            <tr>
              <th>Feature</th>
              <th>Properties</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((feature, index) => (
              <tr key={JSON.stringify(feature)}>
                <td>{index + 1}</td>
                <td>{JSON.stringify(feature.properties)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {selected ? <pre>{JSON.stringify(selected, null, 2)}</pre> : null}
      </section>
    </section>
  );
}
