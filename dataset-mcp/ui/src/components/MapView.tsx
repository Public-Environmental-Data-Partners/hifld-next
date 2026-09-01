import "maplibre-gl/dist/maplibre-gl.css";
import "@hifld/map-ui/styles.css";
import {
  ESRI_WORLD_IMAGERY_TILE_URL,
  OPENFREEMAP_BRIGHT_STYLE_URL,
  type SelectionBoxFeature,
  selectionBoxFeature,
  selectionScreenBounds,
} from "@hifld/map-core";
import { SelectedFeaturesSummary, SelectedFeaturesTable } from "@hifld/map-ui";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
import type {
  AddLayerObject,
  GeoJSONSource,
  LayerSpecification,
  MapLayerMouseEvent,
  Map as MapLibreMap,
  MapOptions,
  RequestParameters,
} from "maplibre-gl";
import * as maplibregl from "maplibre-gl";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { z } from "zod";
import {
  type MapConfiguration,
  MapConfigurationSchema,
  type MapLayerConfiguration,
} from "../mcp/contracts";
import {
  type HighlightContextUpdateResult,
  updateHighlightContext,
} from "../mcp/highlightContext";
import { MapControls } from "./MapControls";
import { MapLegend } from "./MapLegend";
import {
  type HighlightedMapFeature,
  type MapHighlightSnapshot,
  normalizeHighlightedFeatures,
  snapshotMapHighlights,
} from "./mapSelection";
import {
  type ColorScheme,
  dataDrivenColor,
  dataDrivenSize,
  type LegendItem,
  type NumericScale,
} from "./mapStyle";
import { ResizableSelectedFeaturesPanel } from "./ResizableSelectedFeaturesPanel";

export type { MapConfiguration } from "../mcp/contracts";

type McpMapApp = Pick<
  McpApp,
  "getHostCapabilities" | "updateModelContext" | "getHostContext"
> & {
  requestDisplayMode?: McpApp["requestDisplayMode"];
};

export interface MapViewProps {
  configuration: MapConfiguration | null;
  queryTokens: Record<string, string>;
  app: McpMapApp | null;
  registerTeardownHandler?: (handler: (() => Promise<void>) | null) => void;
}

export interface TileRequest extends RequestParameters {
  headers?: Record<string, string>;
}

interface PublishedHighlightContextResult extends HighlightContextUpdateResult {
  isLatest: boolean;
}

interface LayerStyleState {
  color: string;
  colorProperty: string | null;
  colorScheme: ColorScheme;
  breaks: number[] | undefined;
  opacity: number;
  pointRadius: number;
  pointRadiusProperty: string | null;
  pointRadiusScale: NumericScale;
  lineWidth: number;
  lineWidthProperty: string | null;
  lineWidthScale: NumericScale;
}

interface MapViewStyle extends CSSProperties {
  "--selected-features-panel-height": string;
}

const OPENMAPTILES_SOURCE_IDS = new Set(["openmaptiles", "openfreemap"]);
const SATELLITE_SOURCE_ID = "esri-world-imagery";
const SATELLITE_LAYER_ID = "satellite-base";
const DEFAULT_QUERY_COLOR = "#440154";
const SELECTION_BOX_SOURCE_ID = "selection-box-source";
const SELECTION_BOX_FILL_LAYER_ID = "selection-box-fill";
const SELECTION_BOX_LINE_LAYER_ID = "selection-box-line";
const DEFAULT_SELECTED_FEATURES_PANEL_HEIGHT = 55;
const QUERY_TILE_PATH =
  /\/tiles\/([A-Za-z0-9_-]{20,64})\/(?:\d+|\{z\})\/(?:\d+|\{x\})\/(?:\d+|\{y\})\.mvt$/;
const TileErrorSchema = z
  .object({ code: z.string(), message: z.string() })
  .strict();

function parsedHttpUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function tileQueryId(value: string): string | null {
  const parsed = parsedHttpUrl(value);
  return parsed
    ? (decodeURIComponent(parsed.pathname).match(QUERY_TILE_PATH)?.[1] ?? null)
    : null;
}

export function normalizeMapConfiguration(
  configuration: MapConfiguration,
): MapConfiguration | null {
  const parsed = MapConfigurationSchema.safeParse(configuration);
  if (!parsed.success || !parsedHttpUrl(parsed.data.worker_url)) return null;
  for (const layer of parsed.data.layers) {
    if (
      !parsedHttpUrl(layer.tile_url) ||
      tileQueryId(layer.tile_url) !== layer.query_id
    ) {
      return null;
    }
  }
  return parsed.data;
}

export function mapTileRequest(
  url: string,
  queryTokens: Record<string, string>,
): TileRequest {
  const queryId = tileQueryId(url);
  const token = queryId ? queryTokens[queryId] : undefined;
  return token ? { url, headers: { "X-HIFLD-Query-Token": token } } : { url };
}

function blobText(blob: Blob): Promise<string> {
  if (typeof blob.text === "function") return blob.text();
  return new Promise((resolveText, rejectText) => {
    const reader = new FileReader();
    reader.addEventListener("load", () =>
      resolveText(String(reader.result ?? "")),
    );
    reader.addEventListener("error", () =>
      rejectText(reader.error ?? new Error("Blob read failed")),
    );
    reader.readAsText(blob);
  });
}

export async function mapErrorMessage(error: Error): Promise<string> {
  if (error instanceof maplibregl.AJAXError) {
    try {
      const parsed = TileErrorSchema.safeParse(
        JSON.parse(await blobText(error.body)),
      );
      if (parsed.success) {
        return `${parsed.data.message} (${parsed.data.code})`;
      }
    } catch {
      // MapLibre's generic AJAX message remains useful when the body is not JSON.
    }
  }
  return /dense/i.test(error.message)
    ? "This tile is too dense. Filter, aggregate, or zoom in."
    : error.message;
}

function combinedBounds(
  layers: MapLayerConfiguration[],
): [number, number, number, number] | null {
  const available = layers.flatMap((layer) =>
    layer.initial_bounds ? [layer.initial_bounds] : [],
  );
  const first = available[0];
  if (first === undefined) return null;
  return available.reduce<[number, number, number, number]>(
    (result, bounds) => [
      Math.min(result[0], bounds[0]),
      Math.min(result[1], bounds[1]),
      Math.max(result[2], bounds[2]),
      Math.max(result[3], bounds[3]),
    ],
    [first[0], first[1], first[2], first[3]],
  );
}

export function initialMapView(
  configuration: MapConfiguration,
): Partial<MapOptions> {
  const camera = configuration.camera;
  const orientation = {
    ...(camera?.bearing === undefined ? {} : { bearing: camera.bearing }),
    ...(camera?.pitch === undefined ? {} : { pitch: camera.pitch }),
  };
  if (camera?.bounds) {
    return {
      bounds: camera.bounds,
      fitBoundsOptions: { padding: camera.padding ?? 24 },
      ...orientation,
    };
  }
  if (camera?.center) {
    return {
      center: camera.center,
      ...(camera.zoom === undefined ? {} : { zoom: camera.zoom }),
      ...orientation,
    };
  }
  const bounds = combinedBounds(configuration.layers);
  if (bounds) {
    return {
      bounds,
      fitBoundsOptions: { padding: camera?.padding ?? 24 },
      ...orientation,
    };
  }
  return { center: [0, 0], zoom: 1, ...orientation };
}

function querySourceId(queryId: string): string {
  return `hifld-query-${queryId}`;
}

function queryRenderLayerIds(queryId: string): [string, string, string] {
  const sourceId = querySourceId(queryId);
  return [`${sourceId}-polygons`, `${sourceId}-lines`, `${sourceId}-points`];
}

function initialLayerStyle(layer: MapLayerConfiguration): LayerStyleState {
  return {
    color: layer.style?.color ?? DEFAULT_QUERY_COLOR,
    colorProperty: layer.style?.color_property ?? null,
    colorScheme: layer.style?.color_scheme ?? "viridis",
    breaks: layer.style?.breaks,
    opacity: layer.style?.opacity ?? 0.7,
    pointRadius: layer.style?.point_radius ?? 4,
    pointRadiusProperty: layer.style?.point_radius_property ?? null,
    pointRadiusScale: layer.style?.point_radius_scale ?? "linear",
    lineWidth: layer.style?.line_width ?? 2,
    lineWidthProperty: layer.style?.line_width_property ?? null,
    lineWidthScale: layer.style?.line_width_scale ?? "linear",
  };
}

function initialLayerVisibility(
  configuration: MapConfiguration | null,
): Record<string, boolean> {
  return Object.fromEntries(
    (configuration?.layers ?? []).map((layer) => [
      layer.query_id,
      layer.visible,
    ]),
  );
}

function layersForQuery(
  queryId: string,
  layer: MapLayerConfiguration,
): AddLayerObject[] {
  const source = querySourceId(queryId);
  const [polygons, lines, points] = queryRenderLayerIds(queryId);
  const color = layer.style?.color ?? DEFAULT_QUERY_COLOR;
  const layout = {
    visibility: layer.visible ? ("visible" as const) : ("none" as const),
  };
  return [
    {
      id: polygons,
      type: "fill",
      source,
      "source-layer": layer.source_layer,
      layout,
      paint: {
        "fill-color": color,
        "fill-opacity": layer.style?.opacity ?? 0.7,
        "fill-outline-color": "#bbfeab",
      },
    },
    {
      id: lines,
      type: "line",
      source,
      "source-layer": layer.source_layer,
      layout,
      paint: {
        "line-color": color,
        "line-opacity": layer.style?.opacity ?? 0.7,
        "line-width": layer.style?.line_width ?? 2,
      },
    },
    {
      id: points,
      type: "circle",
      source,
      "source-layer": layer.source_layer,
      layout,
      paint: {
        "circle-color": color,
        "circle-opacity": layer.style?.opacity ?? 0.7,
        "circle-radius": layer.style?.point_radius ?? 4,
        "circle-stroke-color": "#bbfeab",
        "circle-stroke-width": 1,
      },
    },
  ];
}

function applyLayerStyle(
  map: MapLibreMap,
  layer: MapLayerConfiguration,
  index: number,
  queryId: string,
  style: LayerStyleState,
): LegendItem[] {
  const driven = dataDrivenColor(
    map,
    layer,
    index,
    style.colorProperty,
    style.colorScheme,
    style.breaks,
    style.color,
  );
  const [polygons, lines, points] = queryRenderLayerIds(queryId);
  map.setPaintProperty(polygons, "fill-color", driven.paint);
  map.setPaintProperty(lines, "line-color", driven.paint);
  map.setPaintProperty(points, "circle-color", driven.paint);
  map.setPaintProperty(polygons, "fill-opacity", style.opacity);
  map.setPaintProperty(lines, "line-opacity", style.opacity);
  map.setPaintProperty(points, "circle-opacity", style.opacity);
  map.setPaintProperty(
    points,
    "circle-radius",
    dataDrivenSize(
      map,
      layer,
      index,
      style.pointRadiusProperty,
      style.pointRadiusScale,
      style.pointRadius,
      2,
    ),
  );
  map.setPaintProperty(
    lines,
    "line-width",
    dataDrivenSize(
      map,
      layer,
      index,
      style.lineWidthProperty,
      style.lineWidthScale,
      style.lineWidth,
      1,
    ),
  );
  return driven.legendItems;
}

function styleLayerSourceId(layer: LayerSpecification): string | null {
  return "source" in layer && typeof layer.source === "string"
    ? layer.source
    : null;
}

function isStreetBasemapLayer(layer: LayerSpecification): boolean {
  const sourceId = styleLayerSourceId(layer);
  return sourceId
    ? OPENMAPTILES_SOURCE_IDS.has(sourceId)
    : layer.type === "background";
}

function configureBasemap(
  map: MapLibreMap,
  basemap: MapConfiguration["basemap"],
): void {
  if (!map.getSource(SATELLITE_SOURCE_ID)) {
    map.addSource(SATELLITE_SOURCE_ID, {
      type: "raster",
      tiles: [ESRI_WORLD_IMAGERY_TILE_URL],
      tileSize: 256,
      attribution:
        "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    });
  }
  if (!map.getLayer(SATELLITE_LAYER_ID)) {
    map.addLayer(
      {
        id: SATELLITE_LAYER_ID,
        type: "raster",
        source: SATELLITE_SOURCE_ID,
        layout: { visibility: "none" },
      },
      map.getStyle().layers?.[0]?.id,
    );
  }
  for (const layer of map.getStyle().layers ?? []) {
    if (isStreetBasemapLayer(layer)) {
      map.setLayoutProperty(
        layer.id,
        "visibility",
        basemap === "street" ? "visible" : "none",
      );
    }
  }
  map.setLayoutProperty(
    SATELLITE_LAYER_ID,
    "visibility",
    basemap === "satellite" ? "visible" : "none",
  );
}

function addQueryOverlays(
  map: MapLibreMap,
  configuration: MapConfiguration,
): void {
  const firstLabel = map
    .getStyle()
    .layers?.find((layer) => layer.type === "symbol")?.id;
  configuration.layers.forEach((layer) => {
    const sourceId = querySourceId(layer.query_id);
    map.addSource(sourceId, {
      type: "vector",
      tiles: [layer.tile_url],
      minzoom: 0,
      maxzoom: 22,
    });
    for (const renderLayer of layersForQuery(layer.query_id, layer)) {
      map.addLayer(renderLayer, firstLabel);
    }
  });
}

function allQueryRenderLayerIds(configuration: MapConfiguration): string[] {
  return configuration.layers.flatMap((layer) =>
    queryRenderLayerIds(layer.query_id),
  );
}

function selectionBoxCollection(
  feature: SelectionBoxFeature | null,
): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  return { type: "FeatureCollection", features: feature ? [feature] : [] };
}

function selectionBoxSource(map: MapLibreMap): GeoJSONSource | null {
  const source = map.getSource(SELECTION_BOX_SOURCE_ID);
  return source && "setData" in source ? (source as GeoJSONSource) : null;
}

function ensureSelectionBoxLayers(map: MapLibreMap): GeoJSONSource {
  const existingSource = selectionBoxSource(map);
  if (existingSource) return existingSource;
  map.addSource(SELECTION_BOX_SOURCE_ID, {
    type: "geojson",
    data: selectionBoxCollection(null),
  });
  map.addLayer({
    id: SELECTION_BOX_FILL_LAYER_ID,
    type: "fill",
    source: SELECTION_BOX_SOURCE_ID,
    paint: { "fill-color": "#2563eb", "fill-opacity": 0.12 },
  });
  map.addLayer({
    id: SELECTION_BOX_LINE_LAYER_ID,
    type: "line",
    source: SELECTION_BOX_SOURCE_ID,
    paint: {
      "line-color": "#2563eb",
      "line-opacity": 0.9,
      "line-width": 2,
      "line-dasharray": [2, 1],
    },
  });
  const source = selectionBoxSource(map);
  if (!source) throw new Error("Unable to create the selection box source.");
  return source;
}

function setSelectionBoxFeature(
  map: MapLibreMap,
  feature: SelectionBoxFeature | null,
): void {
  ensureSelectionBoxLayers(map).setData(selectionBoxCollection(feature));
}

function setMapSelectionCursor(map: MapLibreMap, active: boolean): void {
  map.getCanvas().style.cursor = active ? "crosshair" : "";
}

function highlightedLayers(configuration: MapConfiguration) {
  return configuration.layers.map((layer) => ({
    mapSourceId: querySourceId(layer.query_id),
    queryId: layer.query_id,
    layerName: layer.layer_name,
    sourceLayerId: layer.source_layer,
  }));
}

export function MapView({
  configuration,
  queryTokens,
  app,
  registerTeardownHandler,
}: MapViewProps) {
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
  const selectionActiveRef = useRef(false);
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const selectionStartLngLatRef = useRef<{ lng: number; lat: number } | null>(
    null,
  );
  const suppressNextClickSelectionRef = useRef(false);
  const contextRequestSequenceRef = useRef(0);
  const hasPublishedHighlightContextRef = useRef(false);
  const lastParsedConfigurationRef = useRef<MapConfiguration | null>(null);
  const currentMapTitleRef = useRef<string | null>(null);
  const publishHighlightContextRef = useRef<
    (
      snapshot: MapHighlightSnapshot,
      updateStatus?: boolean,
    ) => Promise<PublishedHighlightContextResult>
  >(async () => ({ status: "unsupported", isLatest: true }));
  const [isMapLoading, setIsMapLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [highlightedFeatures, setHighlightedFeatures] = useState<
    HighlightedMapFeature[]
  >([]);
  const [wasSelectionCapped, setWasSelectionCapped] = useState(false);
  const [selectionBounds, setSelectionBounds] = useState<
    [number, number, number, number] | null
  >(null);
  const [selectionContextStatus, setSelectionContextStatus] = useState<
    "updated" | "unsupported" | "rejected" | null
  >(null);
  const [isSelectionActive, setIsSelectionActive] = useState(false);
  const [isShiftKeyHeld, setIsShiftKeyHeld] = useState(false);
  const [hasSelectionBox, setHasSelectionBox] = useState(false);
  const [legendVisible, setLegendVisible] = useState(true);
  const [selectedFeaturesPanelHeight, setSelectedFeaturesPanelHeight] =
    useState(DEFAULT_SELECTED_FEATURES_PANEL_HEIGHT);
  const [basemap, setBasemap] = useState<MapConfiguration["basemap"]>(
    configuration?.basemap ?? "street",
  );
  const [layerVisibility, setLayerVisibility] = useState<
    Record<string, boolean>
  >(() => initialLayerVisibility(configuration));
  const [legendItems, setLegendItems] = useState<Record<string, LegendItem[]>>(
    {},
  );

  const publishHighlightContext = useCallback(
    async (snapshot: MapHighlightSnapshot, updateStatus = true) => {
      const sequence = contextRequestSequenceRef.current + 1;
      contextRequestSequenceRef.current = sequence;
      if (updateStatus) setSelectionContextStatus(null);
      const result = await updateHighlightContext(app, snapshot);
      if (updateStatus && contextRequestSequenceRef.current === sequence) {
        setSelectionContextStatus(result.status);
      }
      return {
        ...result,
        isLatest: contextRequestSequenceRef.current === sequence,
      };
    },
    [app],
  );
  publishHighlightContextRef.current = publishHighlightContext;

  const cancelActiveBoxSelection = useCallback(() => {
    const map = mapRef.current;
    if (!map || selectionStartRef.current === null) return;
    selectionStartRef.current = null;
    selectionStartLngLatRef.current = null;
    map.dragPan.enable();
    setSelectionBoxFeature(map, null);
    setMapSelectionCursor(map, selectionActiveRef.current);
    setHasSelectionBox(false);
  }, []);

  const resetShiftSelectionOnBlur = useCallback(() => {
    setIsShiftKeyHeld(false);
    cancelActiveBoxSelection();
  }, [cancelActiveBoxSelection]);

  useEffect(() => {
    if (!parsed.success) return;
    if (lastParsedConfigurationRef.current === parsed.data) return;
    currentMapTitleRef.current = parsed.data.title;
    if (hasPublishedHighlightContextRef.current) {
      void publishHighlightContext(
        snapshotMapHighlights({
          mapTitle: parsed.data.title,
          features: [],
          wasCapped: false,
          selectionBounds: null,
        }),
      ).then((result) => {
        if (result.isLatest && result.status !== "rejected") {
          hasPublishedHighlightContextRef.current = false;
        }
      });
    }
    lastParsedConfigurationRef.current = parsed.data;
    setBasemap(parsed.data.basemap);
    setLayerVisibility(initialLayerVisibility(parsed.data));
    setLegendItems({});
    setHighlightedFeatures([]);
    setWasSelectionCapped(false);
    setSelectionBounds(null);
    setSelectionContextStatus(null);
    setIsSelectionActive(false);
    setIsShiftKeyHeld(false);
    setHasSelectionBox(false);
  }, [parsed, publishHighlightContext]);

  useEffect(
    () => () => {
      const mapTitle = currentMapTitleRef.current;
      if (!hasPublishedHighlightContextRef.current || !mapTitle) return;
      void publishHighlightContextRef
        .current(
          snapshotMapHighlights({
            mapTitle,
            features: [],
            wasCapped: false,
            selectionBounds: null,
          }),
          false,
        )
        .then((result) => {
          if (result.isLatest && result.status !== "rejected") {
            hasPublishedHighlightContextRef.current = false;
          }
        });
    },
    [],
  );

  useEffect(() => {
    if (!registerTeardownHandler) return;
    registerTeardownHandler(async () => {
      const mapTitle = currentMapTitleRef.current;
      if (!hasPublishedHighlightContextRef.current || !mapTitle) return;
      const result = await publishHighlightContextRef.current(
        snapshotMapHighlights({
          mapTitle,
          features: [],
          wasCapped: false,
          selectionBounds: null,
        }),
        false,
      );
      if (result.isLatest && result.status !== "rejected") {
        hasPublishedHighlightContextRef.current = false;
      }
    });
    return () => registerTeardownHandler(null);
  }, [registerTeardownHandler]);

  const selectionModeActive = isSelectionActive || isShiftKeyHeld;

  useEffect(() => {
    selectionActiveRef.current = selectionModeActive;
    const map = mapRef.current;
    if (map && selectionStartRef.current === null) {
      setMapSelectionCursor(map, selectionModeActive);
    }
  }, [selectionModeActive]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") setIsShiftKeyHeld(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") setIsShiftKeyHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    window.addEventListener("mouseup", cancelActiveBoxSelection);
    window.addEventListener("blur", resetShiftSelectionOnBlur);
    return () => {
      window.removeEventListener("mouseup", cancelActiveBoxSelection);
      window.removeEventListener("blur", resetShiftSelectionOnBlur);
    };
  }, [cancelActiveBoxSelection, resetShiftSelectionOnBlur]);

  useEffect(() => {
    if (!parsed.success) {
      setIsMapLoading(false);
      setMessage("Map configuration is missing absolute tile or worker URLs.");
      return;
    }
    if (!mapNode.current) return;
    let map: MapLibreMap;
    let disposed = false;
    try {
      setIsMapLoading(true);
      setMessage(null);
      maplibregl.setWorkerUrl(parsed.data.worker_url);
      map = new maplibregl.Map({
        container: mapNode.current,
        ...initialMapView(parsed.data),
        style: OPENFREEMAP_BRIGHT_STYLE_URL,
        transformRequest: (url) => mapTileRequest(url, queryTokens),
      });
      mapRef.current = map;
      const initializeQueryLayers = () => {
        if (disposed) return;
        try {
          configureBasemap(map, parsed.data.basemap);
          addQueryOverlays(map, parsed.data);
          const items = Object.fromEntries(
            parsed.data.layers.map((layer, index) => [
              layer.query_id,
              applyLayerStyle(
                map,
                layer,
                index,
                layer.query_id,
                initialLayerStyle(layer),
              ),
            ]),
          );
          setLegendItems(items);
          map.once("idle", () => {
            setLegendItems(
              Object.fromEntries(
                parsed.data.layers.map((layer, index) => [
                  layer.query_id,
                  applyLayerStyle(
                    map,
                    layer,
                    index,
                    layer.query_id,
                    initialLayerStyle(layer),
                  ),
                ]),
              ),
            );
          });
          setIsMapLoading(false);
        } catch (error) {
          setIsMapLoading(false);
          setMessage(
            error instanceof Error
              ? error.message
              : "Map rendering is unavailable.",
          );
        }
      };
      if (map.isStyleLoaded()) initializeQueryLayers();
      else map.once("style.load", initializeQueryLayers);
      map.on("error", (event) => {
        if (disposed) return;
        setIsMapLoading(false);
        if (event.error instanceof Error) {
          void mapErrorMessage(event.error).then(setMessage);
        } else {
          setMessage("Map rendering is unavailable.");
        }
      });
      map.on("click", (event: MapLayerMouseEvent) => {
        if (suppressNextClickSelectionRef.current) {
          suppressNextClickSelectionRef.current = false;
          return;
        }
        const rendered = map.queryRenderedFeatures(event.point, {
          layers: allQueryRenderLayerIds(parsed.data),
        });
        const normalized = normalizeHighlightedFeatures({
          features: rendered,
          layers: highlightedLayers(parsed.data),
        });
        if (selectionBoxSource(map)) setSelectionBoxFeature(map, null);
        setHighlightedFeatures(normalized.features);
        setWasSelectionCapped(normalized.wasCapped);
        setSelectionBounds(null);
        setHasSelectionBox(false);
        const hasHighlightedFeatures = normalized.features.length > 0;
        if (hasHighlightedFeatures) {
          hasPublishedHighlightContextRef.current = true;
        }
        void publishHighlightContext(
          snapshotMapHighlights({
            mapTitle: parsed.data.title,
            features: normalized.features,
            wasCapped: normalized.wasCapped,
            selectionBounds: null,
          }),
        ).then((result) => {
          if (
            !hasHighlightedFeatures &&
            result.isLatest &&
            result.status !== "rejected"
          ) {
            hasPublishedHighlightContextRef.current = false;
          }
        });
      });
      map.on("mousedown", (event: MapLayerMouseEvent) => {
        const shiftHeld = event.originalEvent.shiftKey;
        if (!selectionActiveRef.current && !shiftHeld) return;
        selectionStartRef.current = { x: event.point.x, y: event.point.y };
        selectionStartLngLatRef.current = {
          lng: event.lngLat.lng,
          lat: event.lngLat.lat,
        };
        setSelectionBoxFeature(
          map,
          selectionBoxFeature(
            selectionStartLngLatRef.current,
            selectionStartLngLatRef.current,
          ),
        );
        setHasSelectionBox(true);
        setMapSelectionCursor(map, true);
        map.dragPan.disable();
        event.preventDefault();
      });
      map.on("mousemove", (event: MapLayerMouseEvent) => {
        const startLngLat = selectionStartLngLatRef.current;
        if (!startLngLat) return;
        setSelectionBoxFeature(
          map,
          selectionBoxFeature(startLngLat, {
            lng: event.lngLat.lng,
            lat: event.lngLat.lat,
          }),
        );
      });
      map.on("mouseup", (event: MapLayerMouseEvent) => {
        const start = selectionStartRef.current;
        const startLngLat = selectionStartLngLatRef.current;
        if (!start) return;
        selectionStartRef.current = null;
        selectionStartLngLatRef.current = null;
        const endLngLat = { lng: event.lngLat.lng, lat: event.lngLat.lat };
        if (startLngLat) {
          setSelectionBoxFeature(
            map,
            selectionBoxFeature(startLngLat, endLngLat),
          );
        }
        map.dragPan.enable();
        setMapSelectionCursor(map, selectionActiveRef.current);
        suppressNextClickSelectionRef.current = true;
        window.setTimeout(() => {
          suppressNextClickSelectionRef.current = false;
        }, 0);
        const bounds = selectionScreenBounds(start, {
          x: event.point.x,
          y: event.point.y,
        });
        const rendered = map.queryRenderedFeatures(bounds, {
          layers: allQueryRenderLayerIds(parsed.data),
        });
        const normalized = normalizeHighlightedFeatures({
          features: rendered,
          layers: highlightedLayers(parsed.data),
        });
        setHighlightedFeatures(normalized.features);
        setWasSelectionCapped(normalized.wasCapped);
        const normalizedBounds: [number, number, number, number] = [
          Math.min(startLngLat?.lng ?? endLngLat.lng, endLngLat.lng),
          Math.min(startLngLat?.lat ?? endLngLat.lat, endLngLat.lat),
          Math.max(startLngLat?.lng ?? endLngLat.lng, endLngLat.lng),
          Math.max(startLngLat?.lat ?? endLngLat.lat, endLngLat.lat),
        ];
        setSelectionBounds(normalizedBounds);
        hasPublishedHighlightContextRef.current = true;
        void publishHighlightContext(
          snapshotMapHighlights({
            mapTitle: parsed.data.title,
            features: normalized.features,
            wasCapped: normalized.wasCapped,
            selectionBounds: normalizedBounds,
          }),
        );
      });
    } catch (error) {
      setIsMapLoading(false);
      setMessage(
        error instanceof Error
          ? error.message
          : "Map rendering is unavailable.",
      );
    }
    return () => {
      disposed = true;
      if (selectionStartRef.current !== null) map?.dragPan.enable();
      mapRef.current = null;
      selectionStartRef.current = null;
      selectionStartLngLatRef.current = null;
      try {
        map?.remove();
      } catch {
        // MapLibre can fail to tear down an uninitialized WebGL context.
      }
    };
  }, [parsed, publishHighlightContext, queryTokens]);

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
      void app.requestDisplayMode?.({ mode: "fullscreen" });
    }
  };
  const canFullscreen =
    app?.getHostContext()?.availableDisplayModes?.includes("fullscreen") ===
    true;
  const changeBasemap = (nextBasemap: MapConfiguration["basemap"]) => {
    setBasemap(nextBasemap);
    const map = mapRef.current;
    if (map) configureBasemap(map, nextBasemap);
  };
  const changeLayerVisibility = (queryId: string, nextVisible: boolean) => {
    setLayerVisibility((current) => ({
      ...current,
      [queryId]: nextVisible,
    }));
    if (!parsed.success) return;
    const map = mapRef.current;
    if (!map) return;
    for (const layerId of queryRenderLayerIds(queryId)) {
      map.setLayoutProperty(
        layerId,
        "visibility",
        nextVisible ? "visible" : "none",
      );
    }
  };
  const clearSelection = () => {
    const map = mapRef.current;
    if (map) {
      const wasDragging = selectionStartRef.current !== null;
      selectionStartRef.current = null;
      selectionStartLngLatRef.current = null;
      if (wasDragging) map.dragPan.enable();
      setSelectionBoxFeature(map, null);
      setMapSelectionCursor(map, selectionModeActive);
    }
    setHighlightedFeatures([]);
    setWasSelectionCapped(false);
    setSelectionBounds(null);
    setHasSelectionBox(false);
    if (!parsed.success) return;
    void publishHighlightContext(
      snapshotMapHighlights({
        mapTitle: parsed.data.title,
        features: [],
        wasCapped: false,
        selectionBounds: null,
      }),
    ).then((result) => {
      if (result.isLatest && result.status !== "rejected") {
        hasPublishedHighlightContextRef.current = false;
      }
    });
  };
  const hasHighlight = highlightedFeatures.length > 0;
  const hasClearableSelection = hasHighlight || hasSelectionBox;
  const selectedCountLabel = `${highlightedFeatures.length} ${
    highlightedFeatures.length === 1 ? "feature" : "features"
  } highlighted`;
  const mapViewStyle: MapViewStyle = {
    "--selected-features-panel-height": `${selectedFeaturesPanelHeight}%`,
  };
  return (
    <section
      className={`map-view${hasHighlight ? " map-view-has-selection" : ""}`}
      aria-label="Dataset map"
      style={mapViewStyle}
    >
      <div
        ref={mapNode}
        className="map-canvas"
        aria-busy={isMapLoading || undefined}
      />
      {isMapLoading ? (
        <div className="map-loading" role="status">
          <span className="map-loading-spinner" aria-hidden="true" />
          <span>Loading map…</span>
        </div>
      ) : null}
      {message ? (
        <div className="map-message" role="alert">
          {message}
        </div>
      ) : null}
      <MapControls
        mapRef={mapRef}
        basemap={basemap}
        onToggleBasemap={() =>
          changeBasemap(basemap === "street" ? "satellite" : "street")
        }
        isSelectionActive={selectionModeActive}
        onToggleSelection={() => setIsSelectionActive((current) => !current)}
        onClearSelection={hasClearableSelection ? clearSelection : undefined}
        onFullscreen={canFullscreen ? requestFullscreen : undefined}
      />
      {selectionContextStatus === "rejected" ? (
        <div className="map-selection-status" role="status">
          {!hasHighlight && selectionBounds === null
            ? "Highlight cleared locally, but the host context could not be cleared. The prior selection may remain available to the agent."
            : "Selection context could not be updated."}
        </div>
      ) : null}
      {parsed.success ? (
        <MapLegend
          groups={parsed.data.layers.map((layer) => {
            const style = initialLayerStyle(layer);
            return {
              id: layer.query_id,
              title: layer.layer_name,
              field: style.colorProperty,
              items: legendItems[layer.query_id] ?? [
                { color: style.color, label: "All values" },
              ],
              layerVisible: layerVisibility[layer.query_id] ?? layer.visible,
            };
          })}
          visible={legendVisible}
          onToggle={() => setLegendVisible((current) => !current)}
          onLayerVisibilityChange={changeLayerVisibility}
        />
      ) : null}
      {hasHighlight ? (
        <ResizableSelectedFeaturesPanel
          heightPercent={selectedFeaturesPanelHeight}
          onHeightPercentChange={setSelectedFeaturesPanelHeight}
        >
          <SelectedFeaturesSummary
            countLabel={selectedCountLabel}
            contextNote={
              selectionContextStatus === "unsupported"
                ? "The MCP client does not support adding selected features to chat context."
                : undefined
            }
            capMessage={
              wasSelectionCapped
                ? "Limited to 100 features per layer"
                : undefined
            }
            onClear={clearSelection}
          />
          <SelectedFeaturesTable
            features={highlightedFeatures}
            showSearch={false}
            isFeatureClickable={(feature) => feature.centroid !== null}
            onFeatureClick={(feature) => {
              const map = mapRef.current;
              if (!map || !feature.centroid) return;
              map.easeTo({
                center: feature.centroid,
                zoom: Math.max(map.getZoom(), 14),
                duration: 500,
              });
            }}
          />
        </ResizableSelectedFeaturesPanel>
      ) : null}
    </section>
  );
}
