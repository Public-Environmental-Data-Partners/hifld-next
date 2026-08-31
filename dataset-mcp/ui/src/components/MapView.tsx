import "maplibre-gl/dist/maplibre-gl.css";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
import type {
  MapLayerMouseEvent,
  Map as MapLibreMap,
  RequestParameters,
} from "maplibre-gl";
import * as maplibregl from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type JsonValue,
  type MapConfiguration,
  MapConfigurationSchema,
} from "../mcp/contracts";

export type { MapConfiguration } from "../mcp/contracts";

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

export function normalizeMapConfiguration(
  configuration: MapConfiguration,
): MapConfiguration | null {
  const parsed = MapConfigurationSchema.safeParse(configuration);
  if (!parsed.success) return null;
  if (!isHttpUrl(parsed.data.tile_url) || !isHttpUrl(parsed.data.worker_url))
    return null;
  return parsed.data;
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
  const [selected, setSelected] = useState<Record<string, JsonValue> | null>(
    null,
  );

  useEffect(() => {
    if (!parsed.success) {
      setMessage("Map configuration is missing absolute tile or worker URLs.");
      return;
    }
    if (!mapNode.current) return;
    let map: MapLibreMap;
    try {
      setMessage("Loading map…");
      maplibregl.setWorkerUrl(parsed.data.worker_url);
      const initialView = parsed.data.initial_bounds
        ? {
            bounds: parsed.data.initial_bounds,
            fitBoundsOptions: { padding: 24 },
          }
        : { center: [0, 0] as [number, number], zoom: 1 };
      map = new maplibregl.Map({
        container: mapNode.current,
        ...initialView,
        style: {
          version: 8,
          sources: {
            hifld: {
              type: "vector",
              tiles: [parsed.data.tile_url],
              minzoom: 0,
              maxzoom: 22,
            },
          },
          layers: layersForSource(parsed.data.source_layer),
        },
        transformRequest: (url) => mapTileRequest(url, queryToken),
      });
      mapRef.current = map;
      map.once("load", () => setMessage(null));
      map.on("error", (event) => {
        const errorText =
          event.error instanceof Error
            ? event.error.message
            : "Map rendering is unavailable.";
        setMessage(
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
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Map rendering is unavailable.",
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
  }, [parsed, queryToken]);

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
      {selected ? <pre>{JSON.stringify(selected, null, 2)}</pre> : null}
    </section>
  );
}
