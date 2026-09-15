import "maplibre-gl/dist/maplibre-gl.css";
import "@hifld/map-ui/styles.css";
import {
  ESRI_WORLD_IMAGERY_TILE_URL,
  isSelectionDrag,
  OPENFREEMAP_BRIGHT_STYLE_URL,
  type SelectionBoxFeature,
  selectionBoxFeature,
  selectionScreenBounds,
} from "@hifld/map-core";
import { SelectedFeaturesSummary, SelectedFeaturesTable } from "@hifld/map-ui";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { X } from "lucide-react";
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
  type ExternalTileSource,
  type MapConfiguration,
  MapConfigurationSchema,
  type MapLayerConfiguration,
} from "../mcp/contracts";
import {
  type HighlightContextUpdateResult,
  updateHighlightContext,
} from "../mcp/highlightContext";
import type { LayerStatus, MapStatus } from "../mcp/mapStatus";
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
import {
  pmtilesProtocol,
  resolveTileSource,
  validatePublicTileUrl,
} from "./tileSources";

export type { MapConfiguration } from "../mcp/contracts";

type RenderLayer = Pick<
  MapLayerConfiguration,
  | "layer_name"
  | "visible"
  | "style"
  | "columns"
  | "source_layer"
  | "initial_bounds"
  | "result_status"
> & {
  id: string;
  query_id?: string;
  tile_url?: string;
  source?: ExternalTileSource;
  preparation_status?: "preparing" | "failed";
  preparation_error?: string;
};
type RenderConfiguration = Omit<MapConfiguration, "layers"> & {
  layers: RenderLayer[];
};

function mapLifecycleKey(configuration: RenderConfiguration): string {
  return JSON.stringify([
    configuration.worker_url,
    configuration.title,
    configuration.camera,
  ]);
}

function renderConfiguration(
  configuration: MapConfiguration,
): RenderConfiguration {
  return {
    ...configuration,
    layers: configuration.layers.map((layer) =>
      "query_id" in layer
        ? { ...layer, id: layer.query_id }
        : {
            ...layer,
            id: layer.layer_id,
            source_layer:
              "source" in layer ? (layer.source.source_layer ?? "") : "",
            columns: [],
          },
    ),
  };
}

type McpMapApp = Pick<
  McpApp,
  "getHostCapabilities" | "updateModelContext" | "getHostContext"
> & {
  requestDisplayMode?: McpApp["requestDisplayMode"];
};

export interface MapViewProps {
  onStatus?: (status: MapStatus) => Promise<void>;
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
    if ("preparation_status" in layer) continue;
    if ("source" in layer) {
      try {
        if (layer.source.type === "vector_tiles")
          layer.source.tiles.forEach(validatePublicTileUrl);
        else validatePublicTileUrl(layer.source.url);
      } catch {
        return null;
      }
      continue;
    }
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
  trustedTileUrls?: readonly string[],
): TileRequest {
  const queryId = tileQueryId(url);
  const origin = parsedHttpUrl(url)?.origin;
  const trusted =
    trustedTileUrls === undefined ||
    trustedTileUrls.some(
      (tile) =>
        parsedHttpUrl(tile)?.origin === origin && tileQueryId(tile) === queryId,
    );
  const token = trusted && queryId ? queryTokens[queryId] : undefined;
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
  layers: Pick<MapLayerConfiguration, "initial_bounds">[],
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
  configuration: MapConfiguration | RenderConfiguration,
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
  const bounds = combinedBounds(
    configuration.layers.flatMap((layer) =>
      "initial_bounds" in layer ? [layer] : [],
    ),
  );
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

function initialLayerStyle(layer: RenderLayer): LayerStyleState {
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
  configuration: RenderConfiguration | null,
): Record<string, boolean> {
  return Object.fromEntries(
    (configuration?.layers ?? []).map((layer) => [layer.id, layer.visible]),
  );
}

function layersForQuery(queryId: string, layer: RenderLayer): AddLayerObject[] {
  const source = querySourceId(queryId);
  const [polygons, lines, points] = queryRenderLayerIds(queryId);
  const color = layer.style?.color ?? DEFAULT_QUERY_COLOR;
  // Layout visibility reloads and then unloads vector tiles in MapLibre.
  // Paint-only hiding retains them; picking explicitly excludes hidden layers.
  const layout = { visibility: "visible" as const };
  const opacity = layer.visible ? (layer.style?.opacity ?? 0.7) : 0;
  return [
    {
      id: polygons,
      type: "fill",
      source,
      "source-layer": layer.source_layer,
      filter: ["==", ["geometry-type"], "Polygon"],
      layout,
      paint: {
        "fill-color": color,
        "fill-opacity": opacity,
        "fill-outline-color": "#bbfeab",
      },
    },
    {
      id: lines,
      type: "line",
      source,
      "source-layer": layer.source_layer,
      filter: ["==", ["geometry-type"], "LineString"],
      layout,
      paint: {
        "line-color": color,
        "line-opacity": opacity,
        "line-width": layer.style?.line_width ?? 2,
      },
    },
    {
      id: points,
      type: "circle",
      source,
      "source-layer": layer.source_layer,
      filter: ["==", ["geometry-type"], "Point"],
      layout,
      paint: {
        "circle-color": color,
        "circle-opacity": opacity,
        "circle-stroke-opacity": layer.visible ? 1 : 0,
        "circle-radius": layer.style?.point_radius ?? 4,
        "circle-stroke-color": "#bbfeab",
        "circle-stroke-width": 1,
      },
    },
  ];
}

function applyLayerStyle(
  map: MapLibreMap,
  layer: RenderLayer,
  queryId: string,
  style: LayerStyleState,
): LegendItem[] {
  const sourceId = querySourceId(queryId);
  const driven = dataDrivenColor(
    map,
    layer,
    sourceId,
    style.colorProperty,
    style.colorScheme,
    style.breaks,
    style.color,
  );
  const [polygons, lines, points] = queryRenderLayerIds(queryId);
  map.setPaintProperty(polygons, "fill-color", driven.paint);
  map.setPaintProperty(lines, "line-color", driven.paint);
  map.setPaintProperty(points, "circle-color", driven.paint);
  map.setPaintProperty(
    polygons,
    "fill-opacity",
    layer.visible ? style.opacity : 0,
  );
  map.setPaintProperty(
    lines,
    "line-opacity",
    layer.visible ? style.opacity : 0,
  );
  map.setPaintProperty(
    points,
    "circle-opacity",
    layer.visible ? style.opacity : 0,
  );
  map.setPaintProperty(points, "circle-stroke-opacity", layer.visible ? 1 : 0);
  map.setPaintProperty(
    points,
    "circle-radius",
    dataDrivenSize(
      map,
      layer,
      sourceId,
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
      sourceId,
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

function addLayerOverlay(
  map: MapLibreMap,
  layer: RenderLayer,
  source: maplibregl.VectorSourceSpecification,
  before?: string,
): void {
  const firstLabel = map
    .getStyle()
    .layers?.find((layer) => layer.type === "symbol")?.id;
  const sourceId = querySourceId(layer.id);
  map.addSource(sourceId, source);
  for (const renderLayer of layersForQuery(layer.id, layer)) {
    map.addLayer(renderLayer, before ?? firstLabel);
  }
}

function allQueryRenderLayerIds(configuration: RenderConfiguration): string[] {
  return configuration.layers
    .filter((layer) => layer.visible)
    .flatMap((layer) => queryRenderLayerIds(layer.id));
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

function highlightedLayers(configuration: RenderConfiguration) {
  return configuration.layers.map((layer) => ({
    mapSourceId: querySourceId(layer.id),
    queryId: layer.query_id,
    layerId: layer.id,
    layerName: layer.layer_name,
    sourceLayerId: layer.source_layer,
  }));
}

export function MapView({
  onStatus,
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
              ? {
                  success: true as const,
                  data: renderConfiguration(normalized),
                }
              : { success: false as const };
          })(),
    [configuration],
  );
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const latestRef = useRef({ parsed, queryTokens, onStatus });
  latestRef.current = { parsed, queryTokens, onStatus };
  const reconcileRef = useRef<(() => void) | null>(null);
  const disposeMapRef = useRef<(() => void) | null>(null);
  const visibilityByNameRef = useRef(new Map<string, boolean>());
  const [runtimeStatuses, setRuntimeStatuses] = useState<LayerStatus[]>([]);
  const visibilityStatusRef = useRef<(id: string, visible: boolean) => void>(
    () => {},
  );
  const selectionActiveRef = useRef(false);
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const selectionStartLngLatRef = useRef<{ lng: number; lat: number } | null>(
    null,
  );
  const suppressNextClickSelectionRef = useRef(false);
  const contextRequestSequenceRef = useRef(0);
  const hasPublishedHighlightContextRef = useRef(false);
  const lastParsedConfigurationRef = useRef<RenderConfiguration | null>(null);
  const currentMapTitleRef = useRef<string | null>(null);
  const publishHighlightContextRef = useRef<
    (
      snapshot: MapHighlightSnapshot,
      updateStatus?: boolean,
    ) => Promise<PublishedHighlightContextResult>
  >(async () => ({ status: "unsupported", isLatest: true }));
  const [isMapLoading, setIsMapLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dismissedMessages, setDismissedMessages] = useState<
    ReadonlySet<string>
  >(() => new Set());
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
  >(() => initialLayerVisibility(parsed.success ? parsed.data : null));
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
    const previous = lastParsedConfigurationRef.current;
    const sameLifecycle =
      previous !== null &&
      mapLifecycleKey(previous) === mapLifecycleKey(parsed.data);
    const names = new Set(parsed.data.layers.map((layer) => layer.layer_name));
    for (const name of visibilityByNameRef.current.keys())
      if (!names.has(name) || !sameLifecycle)
        visibilityByNameRef.current.delete(name);
    for (const layer of parsed.data.layers) {
      layer.visible =
        visibilityByNameRef.current.get(layer.layer_name) ?? layer.visible;
    }
    setLayerVisibility(initialLayerVisibility(parsed.data));
    const ids = new Set(parsed.data.layers.map((layer) => layer.id));
    setLegendItems((items) =>
      Object.fromEntries(
        Object.entries(items).filter(([id]) => sameLifecycle && ids.has(id)),
      ),
    );
    lastParsedConfigurationRef.current = parsed.data;
    if (sameLifecycle) {
      // A changed tool input is authoritative. Unchanged inputs from layer
      // preparation must preserve the user's current basemap selection.
      if (previous.basemap !== parsed.data.basemap) {
        setBasemap(parsed.data.basemap);
        const map = mapRef.current;
        if (map?.getSource(SATELLITE_SOURCE_ID))
          configureBasemap(map, parsed.data.basemap);
      }
      return;
    }
    if (previous?.title !== parsed.data.title) setDismissedMessages(new Set());
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
    setBasemap(parsed.data.basemap);
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
      disposeMapRef.current?.();
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

  const workerUrl = parsed.success ? parsed.data.worker_url : null;
  const lifecycleKey = parsed.success ? mapLifecycleKey(parsed.data) : null;
  useEffect(() => {
    setDismissedMessages(new Set());
    const initialParsed = latestRef.current.parsed;
    const parsed = {
      get success() {
        return initialParsed.success;
      },
      get data(): RenderConfiguration {
        const current = latestRef.current.parsed;
        if (current.success) return current.data;
        if (initialParsed.success) return initialParsed.data;
        throw new Error("Invalid map configuration");
      },
    };
    if (!lifecycleKey || !workerUrl || !parsed.success) {
      setIsMapLoading(false);
      setMessage("Map configuration is missing absolute tile or worker URLs.");
      void latestRef.current.onStatus?.({
        status: "failed",
        layers: [],
        error:
          "validation_failed: map configuration is missing absolute tile or worker URLs.",
      });
      return;
    }
    if (!mapNode.current) return;
    let map: MapLibreMap;
    let disposed = false;
    const statuses = new Map<string, LayerStatus>(
      parsed.data.layers.map((layer) => [
        layer.id,
        {
          layer_name: layer.layer_name,
          status: !layer.visible
            ? "hidden"
            : layer.result_status === "empty_result"
              ? "empty_result"
              : (layer.preparation_status ?? "loading"),
          ...(layer.preparation_error
            ? { error: layer.preparation_error }
            : {}),
        },
      ]),
    );
    let lastStatus = "";
    let globalError: string | undefined;
    let feedback = Promise.resolve();
    const report = () => {
      const layers = [...statuses.values()].map((layer) => ({ ...layer }));
      const failures = layers.filter(
        (layer) => layer.status === "failed",
      ).length;
      const snapshot: MapStatus = {
        map_title: parsed.data.title,
        scope: "current_viewport",
        layers,
        status: globalError
          ? "failed"
          : failures
            ? failures === layers.length
              ? "failed"
              : "partial"
            : layers.some(
                  (layer) =>
                    layer.status === "loading" || layer.status === "preparing",
                )
              ? "loading"
              : "loaded",
        ...(globalError ? { error: globalError } : {}),
      };
      const serialized = JSON.stringify(snapshot);
      if (serialized === lastStatus) return;
      lastStatus = serialized;
      setRuntimeStatuses(layers);
      // Serialize delivery; a slower loading notification must not replace a later failure.
      feedback = feedback
        .then(async () => {
          if (!disposed) await latestRef.current.onStatus?.(snapshot);
        })
        .catch(() => {});
    };
    const failLayer = (id: string, error: string) => {
      const layer = statuses.get(id);
      if (layer) statuses.set(id, { ...layer, status: "failed", error });
      report();
    };
    visibilityStatusRef.current = (id, visible) => {
      const layer = statuses.get(id);
      if (layer)
        statuses.set(id, {
          layer_name: layer.layer_name,
          status: !visible
            ? "hidden"
            : parsed.data.layers.find((candidate) => candidate.id === id)
                  ?.result_status === "empty_result"
              ? "empty_result"
              : (parsed.data.layers.find((candidate) => candidate.id === id)
                  ?.preparation_status ?? (layer.error ? "failed" : "loading")),
          ...(layer.error ? { error: layer.error } : {}),
        });
      report();
    };
    report();
    try {
      setIsMapLoading(true);
      setMessage(null);
      maplibregl.setWorkerUrl(workerUrl);
      if (
        parsed.data.layers.some((layer) => layer.source?.type === "pmtiles")
      ) {
        maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);
      }
      map = new maplibregl.Map({
        container: mapNode.current,
        ...initialMapView(parsed.data),
        style: OPENFREEMAP_BRIGHT_STYLE_URL,
        transformRequest: (url) =>
          mapTileRequest(
            url,
            latestRef.current.queryTokens,
            parsed.data.layers.flatMap((layer) =>
              layer.tile_url ? [layer.tile_url] : [],
            ),
          ),
      });
      mapRef.current = map;
      const reportLoadedSources = () => {
        if (disposed) return;
        for (const [id, layer] of statuses) {
          if (layer.status !== "loading") continue;
          const sourceId = querySourceId(id);
          if (map.getSource(sourceId) && map.isSourceLoaded(sourceId)) {
            statuses.set(id, { ...layer, status: "loaded" });
          }
        }
        report();
      };
      map.on("render", reportLoadedSources);
      map.on("idle", reportLoadedSources);
      map.on("sourcedataloading", (event) => {
        for (const [id, layer] of statuses) {
          if (
            querySourceId(id) === event.sourceId &&
            layer.status === "loaded"
          ) {
            statuses.set(id, { ...layer, status: "loading" });
          }
        }
        report();
      });
      const activeLayers = new Map<string, RenderLayer>();
      let basemapConfigured = false;
      let awaitingInitialBounds =
        !parsed.data.camera && combinedBounds(parsed.data.layers) === null;
      const initializeQueryLayers = () => {
        if (disposed) return;
        try {
          if (awaitingInitialBounds) {
            const bounds = combinedBounds(parsed.data.layers);
            if (bounds) {
              map.fitBounds(bounds, { padding: 24 });
              awaitingInitialBounds = false;
            }
          }
          if (!basemapConfigured) {
            configureBasemap(map, parsed.data.basemap);
            basemapConfigured = true;
          }
          const wanted = new Map(
            parsed.data.layers.map((layer) => [layer.id, layer]),
          );
          for (const [id, previous] of activeLayers) {
            const next = wanted.get(id);
            if (
              next &&
              JSON.stringify([
                previous.source,
                previous.tile_url,
                previous.result_status,
                previous.preparation_status,
              ]) ===
                JSON.stringify([
                  next.source,
                  next.tile_url,
                  next.result_status,
                  next.preparation_status,
                ])
            )
              continue;
            for (const renderId of queryRenderLayerIds(id)) {
              if (map.getLayer(renderId)) map.removeLayer(renderId);
            }
            if (map.getSource(querySourceId(id)))
              map.removeSource(querySourceId(id));
            activeLayers.delete(id);
            statuses.delete(id);
          }
          for (const id of statuses.keys())
            if (!wanted.has(id)) statuses.delete(id);
          const addReadyLayer = (
            layer: RenderLayer,
            source: maplibregl.VectorSourceSpecification,
          ) => {
            if (disposed || activeLayers.get(layer.id) !== layer) return;
            const laterLayers = parsed.data.layers.slice(
              parsed.data.layers.findIndex(
                (candidate) => candidate.id === layer.id,
              ) + 1,
            );
            const before = laterLayers
              .flatMap((candidate) => queryRenderLayerIds(candidate.id))
              .find((id) => map.getLayer(id));
            addLayerOverlay(map, layer, source, before);
            const updateStyle = () => {
              if (disposed || activeLayers.get(layer.id) !== layer) return;
              const current = parsed.data.layers.find(
                (candidate) => candidate.id === layer.id,
              );
              if (!current) return;
              const items = applyLayerStyle(
                map,
                current,
                layer.id,
                initialLayerStyle(current),
              );
              setLegendItems((previous) => ({
                ...previous,
                [layer.id]: items,
              }));
            };
            updateStyle();
            map.once("idle", updateStyle);
          };
          for (const layer of parsed.data.layers) {
            const previous = activeLayers.get(layer.id);
            if (previous) {
              layer.source_layer = previous.source_layer;
              layer.columns = previous.columns;
              Object.assign(previous, layer);
              if (map.getLayer(queryRenderLayerIds(layer.id)[0]))
                applyLayerStyle(map, layer, layer.id, initialLayerStyle(layer));
              continue;
            }
            activeLayers.set(layer.id, layer);
            statuses.set(layer.id, {
              layer_name: layer.layer_name,
              status: !layer.visible
                ? "hidden"
                : (layer.preparation_status ??
                  (layer.result_status === "empty_result"
                    ? "empty_result"
                    : "loading")),
              ...(layer.preparation_error
                ? { error: layer.preparation_error }
                : {}),
            });
            if (layer.preparation_status) {
              if (
                layer.preparation_status === "failed" &&
                layer.preparation_error
              )
                setMessage(`${layer.layer_name}: ${layer.preparation_error}`);
              continue;
            }
            if (layer.result_status === "empty_result") continue;
            if (layer.source) {
              if (layer.source.type === "pmtiles")
                maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);
              void resolveTileSource(layer.source)
                .then((resolved) => {
                  if (disposed || activeLayers.get(layer.id) !== layer) return;
                  layer.source_layer = resolved.sourceLayer;
                  layer.columns = resolved.columns;
                  const current = parsed.data.layers.find(
                    (candidate) => candidate.id === layer.id,
                  );
                  if (current) {
                    current.source_layer = resolved.sourceLayer;
                    current.columns = resolved.columns;
                    layer.visible = current.visible;
                  }
                  addReadyLayer(layer, resolved.source);
                })
                .catch((error: Error) => {
                  if (disposed || activeLayers.get(layer.id) !== layer) return;
                  failLayer(
                    layer.id,
                    "source_metadata_failed: verify the tile URL is reachable, allows cross-origin requests, and names a valid vector layer.",
                  );
                  if (!disposed)
                    setMessage(`${layer.layer_name}: ${error.message}`);
                });
            } else if (layer.tile_url) {
              addReadyLayer(layer, {
                type: "vector",
                tiles: [layer.tile_url],
                minzoom: 0,
                maxzoom: 22,
              });
            }
          }
          report();
          setIsMapLoading(false);
        } catch (error) {
          globalError =
            "map_initialization_failed: the widget could not initialize map sources or styles.";
          report();
          setIsMapLoading(false);
          setMessage(
            error instanceof Error
              ? error.message
              : "Map rendering is unavailable.",
          );
        }
      };
      // isStyleLoaded() also waits for every source's tiles. Once the initial
      // style exists, source loading must not delay independent layer updates.
      let styleReady = map.isStyleLoaded();
      reconcileRef.current = () => {
        if (styleReady) initializeQueryLayers();
      };
      if (styleReady) initializeQueryLayers();
      else
        map.once("style.load", () => {
          styleReady = true;
          initializeQueryLayers();
        });
      map.on("error", (event) => {
        if (disposed) return;
        const provenance = z.object({ sourceId: z.string() }).safeParse(event);
        const layer = parsed.data.layers.find(
          (candidate) =>
            provenance.success &&
            querySourceId(candidate.id) === provenance.data.sourceId,
        );
        const detail =
          event.error instanceof maplibregl.AJAXError
            ? ` HTTP status ${event.error.status}.`
            : "";
        if (layer)
          failLayer(
            layer.id,
            `tile_load_failed:${detail} Check tile access, CORS, query expiry, or server errors. Other layers may still load.`,
          );
        else {
          globalError = `map_resource_failed:${detail} Check basemap, worker, and network access.`;
          report();
        }
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
          layers: allQueryRenderLayerIds(parsed.data).filter((id) =>
            map.getLayer(id),
          ),
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
        void publishHighlightContextRef
          .current(
            snapshotMapHighlights({
              mapTitle: parsed.data.title,
              features: normalized.features,
              wasCapped: normalized.wasCapped,
              selectionBounds: null,
            }),
          )
          .then((result) => {
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
        const end = { x: event.point.x, y: event.point.y };
        selectionStartRef.current = null;
        selectionStartLngLatRef.current = null;
        map.dragPan.enable();
        setMapSelectionCursor(map, selectionActiveRef.current);
        if (!isSelectionDrag(start, end)) {
          setSelectionBoxFeature(map, null);
          setSelectionBounds(null);
          setHasSelectionBox(false);
          return;
        }
        const endLngLat = { lng: event.lngLat.lng, lat: event.lngLat.lat };
        if (startLngLat) {
          setSelectionBoxFeature(
            map,
            selectionBoxFeature(startLngLat, endLngLat),
          );
        }
        suppressNextClickSelectionRef.current = true;
        window.setTimeout(() => {
          suppressNextClickSelectionRef.current = false;
        }, 0);
        const bounds = selectionScreenBounds(start, end);
        const rendered = map.queryRenderedFeatures(bounds, {
          layers: allQueryRenderLayerIds(parsed.data).filter((id) =>
            map.getLayer(id),
          ),
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
        void publishHighlightContextRef.current(
          snapshotMapHighlights({
            mapTitle: parsed.data.title,
            features: normalized.features,
            wasCapped: normalized.wasCapped,
            selectionBounds: normalizedBounds,
          }),
        );
      });
    } catch (error) {
      globalError =
        "map_initialization_failed: check WebGL support and worker access.";
      report();
      setIsMapLoading(false);
      setMessage(
        error instanceof Error
          ? error.message
          : "Map rendering is unavailable.",
      );
    }
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      reconcileRef.current = null;
      visibilityStatusRef.current = () => {};
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
    disposeMapRef.current = dispose;
    return dispose;
  }, [workerUrl, lifecycleKey]);

  useEffect(() => {
    if (parsed.success) reconcileRef.current?.();
  }, [parsed]);

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
    visibilityStatusRef.current(queryId, nextVisible);
    setLayerVisibility((current) => ({
      ...current,
      [queryId]: nextVisible,
    }));
    if (!parsed.success) return;
    const layer = parsed.data.layers.find(
      (candidate) => candidate.id === queryId,
    );
    if (layer) {
      layer.visible = nextVisible;
      visibilityByNameRef.current.set(layer.layer_name, nextVisible);
    }
    const map = mapRef.current;
    if (!map) return;
    if (layer && map.getLayer(queryRenderLayerIds(queryId)[0])) {
      applyLayerStyle(map, layer, queryId, initialLayerStyle(layer));
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
  const visibleMessage =
    message && !dismissedMessages.has(message) ? message : null;
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
      {visibleMessage || selectionContextStatus === "rejected" ? (
        <div className="map-notification-stack">
          {visibleMessage ? (
            <div className="map-message" role="alert">
              <span>{visibleMessage}</span>
              <button
                type="button"
                className="map-message-dismiss"
                aria-label="Dismiss map error"
                onClick={() =>
                  setDismissedMessages(
                    (current) => new Set([...current, visibleMessage]),
                  )
                }
              >
                <X aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {selectionContextStatus === "rejected" ? (
            <div className="map-selection-status" role="status">
              {!hasHighlight && selectionBounds === null
                ? "Highlight cleared locally, but the host context could not be cleared. The prior selection may remain available to the agent."
                : "Selection context could not be updated."}
            </div>
          ) : null}
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
      {parsed.success ? (
        <MapLegend
          groups={parsed.data.layers.map((layer) => {
            const style = initialLayerStyle(layer);
            const runtime = runtimeStatuses.find(
              (status) => status.layer_name === layer.layer_name,
            );
            return {
              id: layer.id,
              title: layer.layer_name,
              field: style.colorProperty,
              items:
                layer.preparation_status === "preparing"
                  ? [
                      {
                        color: style.color,
                        label: "Preparing query…",
                      },
                    ]
                  : runtime?.status === "failed"
                    ? [
                        {
                          color: style.color,
                          label: layer.preparation_status
                            ? "Failed: retry query"
                            : "Failed: check source URL",
                        },
                      ]
                    : layer.result_status === "empty_result"
                      ? [
                          {
                            color: style.color,
                            label: "No rows returned",
                          },
                        ]
                      : (legendItems[layer.id] ?? [
                          { color: style.color, label: "All values" },
                        ]),
              layerVisible: layerVisibility[layer.id] ?? layer.visible,
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
