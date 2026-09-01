import type { BasemapMode } from "@hifld/map-core";
import {
  ESRI_WORLD_IMAGERY_TILE_URL,
  selectionBoxFeature as mapCoreSelectionBoxFeature,
  OPENFREEMAP_BRIGHT_STYLE_URL,
} from "@hifld/map-core";
import maplibregl from "maplibre-gl";
import { type RefObject, useCallback, useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { PMTiles, Protocol } from "pmtiles";
import type { LoadedMapLayer, QueryMvtLayer } from "@/components/map/multiLayerSources";
import type { ColumnSchema } from "@/lib/api-client";
import type { HoverInfo, NumericFieldSummary, VectorLayerInfo } from "./types";
import { DEFAULT_STYLE } from "./utils";

interface PMTilesVectorLayerMetadata {
  id?: string;
  fields?: {
    [fieldName: string]: string | number | boolean | undefined;
  };
}

interface PMTilesMetadata {
  vector_layers?: PMTilesVectorLayerMetadata[];
}

interface VectorLayersBySource {
  [sourceId: string]: VectorLayerInfo[] | undefined;
}

class QueryLayerSyncError extends Error {
  constructor(
    readonly queryId: string,
    message: string,
  ) {
    super(message);
  }
}

interface MapSourceSyncResult {
  layers: VectorLayerInfo[];
  interactiveLayerIds: string[];
}

interface LoadedMapSourceResult {
  vectorLayers: VectorLayerInfo[];
  interactiveLayerIds: string[];
}

function isNumericFieldType(type: string | number | boolean | undefined): boolean {
  if (typeof type === "number") {
    return true;
  }
  if (typeof type !== "string") {
    return false;
  }
  const normalized = type.toLowerCase();
  return (
    normalized.includes("number") ||
    normalized.includes("int") ||
    normalized.includes("float") ||
    normalized.includes("double") ||
    normalized.includes("decimal")
  );
}

function isNumericColumn(column: ColumnSchema | undefined): boolean {
  if (!column) {
    return false;
  }
  return isNumericFieldType(column.type) || column.min !== undefined || column.max !== undefined;
}

function numericFieldSummaries({
  fields,
  metadataColumns,
}: {
  fields: PMTilesVectorLayerMetadata["fields"];
  metadataColumns: ColumnSchema[] | undefined;
}): NumericFieldSummary[] {
  const summaries = new Map<string, NumericFieldSummary>();
  const fieldEntries = Object.entries(fields ?? {});

  for (const [name, type] of fieldEntries) {
    if (isNumericFieldType(type)) {
      summaries.set(name, { name });
    }
  }

  for (const column of metadataColumns ?? []) {
    if (!isNumericColumn(column)) {
      continue;
    }
    const hasField = fieldEntries.length === 0 || fields?.[column.name] !== undefined;
    if (!hasField) {
      continue;
    }
    summaries.set(column.name, {
      name: column.name,
      min: column.min,
      max: column.max,
    });
  }

  return [...summaries.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export type FeatureSelectionMode = "replace" | "append";
export type { BasemapMode } from "@hifld/map-core";

interface SelectionLngLat {
  lng: number;
  lat: number;
}

type SelectionBoxFeature = GeoJSON.Feature<GeoJSON.Polygon>;
type SelectionBoxFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon>;
type PopupLngLat = NonNullable<HoverInfo["lngLat"]>;

const SELECTION_BOX_SOURCE_ID = "selection-box-source";
const SELECTION_BOX_FILL_LAYER_ID = "selection-box-fill";
const SELECTION_BOX_LINE_LAYER_ID = "selection-box-line";
const OPENMAPTILES_SOURCE_IDS = new Set(["openmaptiles", "openfreemap"]);
const STREET_BASE_LAYER_ID = "osm-base";
const STREET_BASE_SOURCE_ID = "osm-tiles";
const SATELLITE_BASE_LAYER_ID = "satellite-base";
const SATELLITE_BASE_SOURCE_ID = "esri-world-imagery";
const EMPTY_SELECTION_BOX_FEATURES: SelectionBoxFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};
const mapsWithInitialStyle = new WeakSet<maplibregl.Map>();

function fallbackBasemapStyle(mode: BasemapMode): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      [STREET_BASE_SOURCE_ID]: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors",
      },
      [SATELLITE_BASE_SOURCE_ID]: {
        type: "raster",
        tiles: [ESRI_WORLD_IMAGERY_TILE_URL],
        tileSize: 256,
        attribution: "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      },
    },
    layers: [
      {
        id: STREET_BASE_LAYER_ID,
        type: "raster",
        source: STREET_BASE_SOURCE_ID,
        layout: {
          visibility: mode === "street" ? "visible" : "none",
        },
      },
      {
        id: SATELLITE_BASE_LAYER_ID,
        type: "raster",
        source: SATELLITE_BASE_SOURCE_ID,
        layout: {
          visibility: mode === "satellite" ? "visible" : "none",
        },
      },
    ],
  };
}

export function getVectorLayers(metadata: PMTilesMetadata): VectorLayerInfo[] {
  const vectorLayers = metadata.vector_layers ?? [];
  const layers: VectorLayerInfo[] = [];

  for (const layer of vectorLayers) {
    if (typeof layer.id === "string") {
      layers.push({
        id: layer.id,
        fields: Object.keys(layer.fields ?? {}),
        numericFields: numericFieldSummaries({ fields: layer.fields, metadataColumns: undefined }),
      });
    }
  }

  return layers;
}

export function getVectorLayersForSource(metadata: PMTilesMetadata, source: LoadedMapLayer): VectorLayerInfo[] {
  if (source.kind === "query_mvt") {
    return getVectorLayersForQuerySource(source);
  }
  return getVectorLayers(metadata).map((layer) => ({
    ...layer,
    id: `${source.id}:${layer.id}`,
    sourceLayerId: layer.id,
    loadedLayerId: source.id,
    mapSourceId: source.mapSourceId,
    mapLayerBaseId: `${source.mapSourceId}-${layer.id}`,
    numericFields: numericFieldSummaries({
      fields: metadata.vector_layers?.find((metadataLayer) => metadataLayer.id === layer.id)?.fields,
      metadataColumns: source.sourceMetadata?.columns,
    }),
    geometryType: source.sourceMetadata?.geometry_type,
  }));
}

export function getVectorLayersForQuerySource(source: QueryMvtLayer): VectorLayerInfo[] {
  return [
    {
      id: `${source.id}:${source.sourceLayerId}`,
      sourceLayerId: source.sourceLayerId,
      loadedLayerId: source.id,
      mapSourceId: source.mapSourceId,
      mapLayerBaseId: `${source.mapSourceId}-${source.sourceLayerId}`,
      fields: source.scalarFields.map((field) => field.name),
      numericFields: source.scalarFields
        .filter((field) => isNumericFieldType(field.logicalType) || field.min !== undefined || field.max !== undefined)
        .map((field) => ({ name: field.name, min: field.min, max: field.max })),
    },
  ];
}

export function queryVectorSourceSpecification(source: QueryMvtLayer): { type: "vector"; tiles: [string] } {
  return {
    type: "vector",
    tiles: [source.tileTemplate],
  };
}

export type QueryTileRequest =
  | { url: string; headers: { "X-HIFLD-Query-Token": string } }
  | { blocked: true; queryId: string; reason: "unknown_query" };

const QUERY_TILE_PATH = /^\/api\/queries\/([^/]+)\/tiles\/[^/]+\/[^/]+\/[^/]+\.mvt$/;

export function transformQueryTileRequest(
  requestUrl: string,
  queryTokens: ReadonlyMap<string, string>,
): QueryTileRequest | null {
  let pathname: string;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(requestUrl, "http://localhost");
    pathname = parsedUrl.pathname;
  } catch {
    return null;
  }
  const match = QUERY_TILE_PATH.exec(pathname);
  if (!match) {
    return null;
  }
  const queryId = match[1];
  if (!queryId) {
    return { blocked: true, queryId: "", reason: "unknown_query" };
  }
  const token = queryTokens.get(decodeURIComponent(queryId));
  if (!token) {
    return { blocked: true, queryId: decodeURIComponent(queryId), reason: "unknown_query" };
  }
  parsedUrl.searchParams.delete("token");
  parsedUrl.searchParams.delete("query_token");
  parsedUrl.searchParams.delete("queryToken");
  const isAbsoluteUrl = /^[a-z][a-z\d+.-]*:/i.test(requestUrl);
  const safeUrl = isAbsoluteUrl ? parsedUrl.toString() : `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
  return {
    url: safeUrl,
    headers: { "X-HIFLD-Query-Token": token },
  };
}

function sourceLayerForFeature(feature: maplibregl.MapGeoJSONFeature): string | undefined {
  if (feature.sourceLayer) {
    return feature.sourceLayer;
  }
  return "source-layer" in feature.layer && typeof feature.layer["source-layer"] === "string"
    ? feature.layer["source-layer"]
    : undefined;
}

export function handleMapClick({
  map,
  point,
  lngLat,
  interactiveLayerIds,
  onPinnedPopup,
}: {
  map: maplibregl.Map;
  point: maplibregl.Point;
  lngLat: maplibregl.LngLat;
  interactiveLayerIds: string[];
  onPinnedPopup: ((info: HoverInfo | null) => void) | undefined;
}): void {
  if (!onPinnedPopup || interactiveLayerIds.length === 0) {
    return;
  }

  const features = map.queryRenderedFeatures(point, {
    layers: interactiveLayerIds,
  });

  if (features.length === 0) {
    onPinnedPopup(null);
    return;
  }

  onPinnedPopup({
    x: point.x,
    y: point.y,
    features,
    layerLabel: layerLabelForFeature(features[0]),
    selectedIndex: 0,
    isPinned: true,
    lngLat,
  });
}

export function syncPinnedPopupPosition({
  map,
  lngLat,
  element,
}: {
  map: Pick<maplibregl.Map, "project">;
  lngLat: PopupLngLat | null | undefined;
  element: HTMLDivElement | null | undefined;
}): void {
  if (!lngLat || !element) {
    return;
  }

  const point = map.project({ lng: lngLat.lng, lat: lngLat.lat });
  element.style.left = `${point.x + 12}px`;
  element.style.top = `${point.y + 12}px`;
}

function queryRenderedSelectionFeatures({
  map,
  point,
  interactiveLayerIds,
}: {
  map: maplibregl.Map;
  point: maplibregl.Point;
  interactiveLayerIds: string[];
}): maplibregl.MapGeoJSONFeature[] {
  if (interactiveLayerIds.length === 0) {
    return [];
  }
  return map.queryRenderedFeatures(point, {
    layers: interactiveLayerIds,
  });
}

function queryRenderedBoxFeatures({
  map,
  start,
  end,
  interactiveLayerIds,
}: {
  map: maplibregl.Map;
  start: { x: number; y: number };
  end: { x: number; y: number };
  interactiveLayerIds: string[];
}): maplibregl.MapGeoJSONFeature[] {
  if (interactiveLayerIds.length === 0) {
    return [];
  }
  const minX = Math.min(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxX = Math.max(start.x, end.x);
  const maxY = Math.max(start.y, end.y);
  return map.queryRenderedFeatures(
    [
      [minX, minY],
      [maxX, maxY],
    ],
    { layers: interactiveLayerIds },
  );
}

export function selectionBoxFeature(start: SelectionLngLat, end: SelectionLngLat): SelectionBoxFeature {
  return mapCoreSelectionBoxFeature(start, end);
}

function selectionBoxFeatureCollection(feature: SelectionBoxFeature | null): SelectionBoxFeatureCollection {
  return {
    type: "FeatureCollection",
    features: feature ? [feature] : [],
  };
}

function selectionBoxSource(map: maplibregl.Map): maplibregl.GeoJSONSource | null {
  const source = map.getSource(SELECTION_BOX_SOURCE_ID);
  return source && "setData" in source ? (source as maplibregl.GeoJSONSource) : null;
}

function ensureSelectionBoxLayers(map: maplibregl.Map): maplibregl.GeoJSONSource {
  const existingSource = selectionBoxSource(map);
  if (existingSource) {
    return existingSource;
  }

  map.addSource(SELECTION_BOX_SOURCE_ID, {
    type: "geojson",
    data: EMPTY_SELECTION_BOX_FEATURES,
  });

  map.addLayer({
    id: SELECTION_BOX_FILL_LAYER_ID,
    type: "fill",
    source: SELECTION_BOX_SOURCE_ID,
    paint: {
      "fill-color": "#2563eb",
      "fill-opacity": 0.12,
    },
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

  return selectionBoxSource(map) as maplibregl.GeoJSONSource;
}

function setSelectionBoxFeature(map: maplibregl.Map, feature: SelectionBoxFeature | null): void {
  ensureSelectionBoxLayers(map).setData(selectionBoxFeatureCollection(feature));
}

function setMapSelectionCursor(map: maplibregl.Map, active: boolean): void {
  map.getCanvas().style.cursor = active ? "crosshair" : "";
}

function layerLabelForFeature(feature: maplibregl.MapGeoJSONFeature | undefined): string | undefined {
  if (!feature) return undefined;
  const sourceLayer = sourceLayerForFeature(feature);
  return sourceLayer;
}

function mapSourceForFeature(feature: maplibregl.MapGeoJSONFeature): string {
  const source = feature.source;
  return typeof source === "string" && source.length > 0 ? source : "pmtiles";
}

function addRenderedLayersForVectorLayer(
  map: maplibregl.Map,
  source: LoadedMapLayer,
  layer: VectorLayerInfo,
): string[] {
  const sourceLayerId = layer.sourceLayerId ?? layer.id;
  const baseId = layer.mapLayerBaseId ?? `${source.mapSourceId}-${sourceLayerId}`;
  const fillId = `${baseId}-fill`;
  const lineId = `${baseId}-line`;
  const circleId = `${baseId}-circle`;
  const visibility = source.visible ? "visible" : "none";

  if (!map.getLayer(fillId)) {
    map.addLayer({
      id: fillId,
      type: "fill",
      source: source.mapSourceId,
      "source-layer": sourceLayerId,
      filter: ["==", "$type", "Polygon"],
      layout: {
        visibility,
      },
      paint: {
        "fill-color": "#C5E8FF",
        "fill-opacity": source.opacity,
      },
    });
  }

  if (!map.getLayer(lineId)) {
    map.addLayer({
      id: lineId,
      type: "line",
      source: source.mapSourceId,
      "source-layer": sourceLayerId,
      filter: ["==", "$type", "LineString"],
      layout: {
        visibility,
      },
      paint: {
        "line-color": "#6D6659",
        "line-opacity": source.opacity,
        "line-width": DEFAULT_STYLE.lineWidth,
      },
    });
  }

  if (!map.getLayer(circleId)) {
    map.addLayer({
      id: circleId,
      type: "circle",
      source: source.mapSourceId,
      "source-layer": sourceLayerId,
      filter: ["==", "$type", "Point"],
      layout: {
        visibility,
      },
      paint: {
        "circle-color": "#C0E6AA",
        "circle-opacity": source.opacity,
        "circle-radius": DEFAULT_STYLE.radius,
      },
    });
  }

  return source.visible ? [fillId, lineId, circleId] : [];
}

export function syncExistingRenderedLayers(map: maplibregl.Map, source: LoadedMapLayer): string[] {
  const layerIds: string[] = [];
  const visibility = source.visible ? "visible" : "none";

  for (const styleLayer of map.getStyle().layers ?? []) {
    if (!("source" in styleLayer) || styleLayer.source !== source.mapSourceId) {
      continue;
    }
    map.setLayoutProperty(styleLayer.id, "visibility", visibility);
    if (source.visible) {
      layerIds.push(styleLayer.id);
    }
  }

  return layerIds;
}

export function syncRenderedLayerOrder(
  map: Pick<maplibregl.Map, "getLayer" | "moveLayer">,
  sources: readonly Pick<LoadedMapLayer, "id">[],
  vectorLayersBySource: Readonly<VectorLayersBySource>,
): void {
  for (const source of sources) {
    for (const layer of vectorLayersBySource[source.id] ?? []) {
      const baseId = layer.mapLayerBaseId ?? `${source.id}-${layer.sourceLayerId ?? layer.id}`;
      for (const styleLayerId of [`${baseId}-fill`, `${baseId}-line`, `${baseId}-circle`]) {
        if (map.getLayer(styleLayerId)) {
          map.moveLayer(styleLayerId);
        }
      }
    }
  }
}

export function syncBasemapVisibility(map: maplibregl.Map, mode: BasemapMode): void {
  const style = map.getStyle();
  for (const styleLayer of style?.layers ?? []) {
    if (isStreetBasemapStyleLayer(styleLayer)) {
      map.setLayoutProperty(styleLayer.id, "visibility", mode === "street" ? "visible" : "none");
    }
  }

  if (map.getLayer(STREET_BASE_LAYER_ID)) {
    map.setLayoutProperty(STREET_BASE_LAYER_ID, "visibility", mode === "street" ? "visible" : "none");
  }
  if (map.getLayer(SATELLITE_BASE_LAYER_ID)) {
    map.setLayoutProperty(SATELLITE_BASE_LAYER_ID, "visibility", mode === "satellite" ? "visible" : "none");
  }
}

function ensureSatelliteBasemapLayer(map: maplibregl.Map): void {
  if (!map.getSource(SATELLITE_BASE_SOURCE_ID)) {
    map.addSource(SATELLITE_BASE_SOURCE_ID, {
      type: "raster",
      tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      attribution: "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    });
  }

  if (map.getLayer(SATELLITE_BASE_LAYER_ID)) {
    return;
  }

  const firstLayerId = map.getStyle().layers?.[0]?.id;
  map.addLayer(
    {
      id: SATELLITE_BASE_LAYER_ID,
      type: "raster",
      source: SATELLITE_BASE_SOURCE_ID,
      layout: {
        visibility: "none",
      },
    },
    firstLayerId,
  );
}

export function syncBasemapVisibilityAfterStyleLoad(map: maplibregl.Map, basemapModeRef: RefObject<BasemapMode>): void {
  ensureSatelliteBasemapLayer(map);
  syncBasemapVisibility(map, basemapModeRef.current);
}

function styleLayerSourceId(styleLayer: maplibregl.LayerSpecification): string | null {
  if (!("source" in styleLayer) || typeof styleLayer.source !== "string") {
    return null;
  }
  return styleLayer.source;
}

function isStreetBasemapStyleLayer(styleLayer: maplibregl.LayerSpecification): boolean {
  const sourceId = styleLayerSourceId(styleLayer);
  return sourceId ? OPENMAPTILES_SOURCE_IDS.has(sourceId) : styleLayer.type === "background";
}

function hasRemainingStyleLayerForSource(
  styleLayers: maplibregl.LayerSpecification[],
  sourceId: string,
  removedLayerIds: Set<string>,
): boolean {
  return styleLayers.some(
    (styleLayer) => styleLayerSourceId(styleLayer) === sourceId && !removedLayerIds.has(styleLayer.id),
  );
}

export function removeInactiveMapSources(
  map: maplibregl.Map,
  activeSourceIds: Set<string>,
  managedSourceIds: Set<string>,
) {
  const style = map.getStyle();
  const styleLayers = style.layers ?? [];
  const removedLayerIds = new Set<string>();

  for (const styleLayer of styleLayers) {
    const sourceId = styleLayerSourceId(styleLayer);
    if (!sourceId) {
      continue;
    }
    if (!managedSourceIds.has(sourceId) || activeSourceIds.has(sourceId)) {
      continue;
    }
    if (map.getLayer(styleLayer.id)) {
      map.removeLayer(styleLayer.id);
      removedLayerIds.add(styleLayer.id);
    }
  }

  for (const sourceId of managedSourceIds) {
    if (activeSourceIds.has(sourceId)) {
      continue;
    }

    const hasReferencedStyleLayer = hasRemainingStyleLayerForSource(styleLayers, sourceId, removedLayerIds);

    if (!hasReferencedStyleLayer && map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }
    managedSourceIds.delete(sourceId);
  }
}

async function loadMapSource(
  map: maplibregl.Map,
  protocol: Protocol | null,
  source: LoadedMapLayer,
  shouldContinue: () => boolean,
): Promise<LoadedMapSourceResult | null> {
  if (source.kind === "query_mvt") {
    if (map.getSource(source.mapSourceId)) {
      return {
        vectorLayers: [],
        interactiveLayerIds: syncExistingRenderedLayers(map, source),
      };
    }
    const vectorLayers = getVectorLayersForQuerySource(source);
    if (!shouldContinue()) {
      return null;
    }
    map.addSource(source.mapSourceId, queryVectorSourceSpecification(source));
    return {
      vectorLayers,
      interactiveLayerIds: vectorLayers.flatMap((layer) => addRenderedLayersForVectorLayer(map, source, layer)),
    };
  }

  const sourceAlreadyAdded = map.getSource(source.mapSourceId) !== undefined;
  const pmtiles = new PMTiles(source.pmtilesUrl);
  if (!sourceAlreadyAdded) {
    protocol?.add(pmtiles);
  }
  const metadata = (await pmtiles.getMetadata()) as PMTilesMetadata;
  if (!shouldContinue()) {
    return null;
  }
  const vectorLayers = getVectorLayersForSource(metadata, source);

  if (!sourceAlreadyAdded) {
    map.addSource(source.mapSourceId, {
      type: "vector",
      url: `pmtiles://${source.pmtilesUrl}`,
    });
  }

  return {
    vectorLayers,
    interactiveLayerIds: vectorLayers.flatMap((layer) => addRenderedLayersForVectorLayer(map, source, layer)),
  };
}

async function loadMapSourceForSync(
  map: maplibregl.Map,
  protocol: Protocol | null,
  source: LoadedMapLayer,
  shouldContinue: () => boolean,
): Promise<LoadedMapSourceResult | null> {
  try {
    return await loadMapSource(map, protocol, source, shouldContinue);
  } catch (error) {
    if (source.kind !== "query_mvt") throw error;
    throw new QueryLayerSyncError(
      source.queryId,
      error instanceof Error ? error.message : "Query map layer could not be loaded.",
    );
  }
}

function removeInactiveVectorLayers(
  vectorLayersBySource: VectorLayersBySource,
  activeLayerIds: ReadonlySet<string>,
): void {
  for (const loadedLayerId of Object.keys(vectorLayersBySource)) {
    if (!activeLayerIds.has(loadedLayerId)) delete vectorLayersBySource[loadedLayerId];
  }
}

export async function syncLoadedMapSources({
  map,
  protocol,
  sources,
  managedSourceIds,
  vectorLayersBySource,
  shouldContinue,
}: {
  map: maplibregl.Map;
  protocol: Protocol | null;
  sources: LoadedMapLayer[];
  managedSourceIds: Set<string>;
  vectorLayersBySource: VectorLayersBySource;
  shouldContinue: () => boolean;
}): Promise<MapSourceSyncResult | null> {
  const nextLayers: VectorLayerInfo[] = [];
  const nextInteractiveLayerIds: string[] = [];
  const activeSourceIds = new Set(sources.map((source) => source.mapSourceId));
  const activeLayerIds = new Set(sources.map((source) => source.id));

  for (const source of sources) {
    if (!shouldContinue()) return null;
    managedSourceIds.add(source.mapSourceId);
    const loadedSource = await loadMapSourceForSync(map, protocol, source, shouldContinue);
    if (!shouldContinue() || !loadedSource) return null;
    if (loadedSource.vectorLayers.length > 0) {
      vectorLayersBySource[source.id] = loadedSource.vectorLayers;
    }
    nextLayers.push(...(vectorLayersBySource[source.id] ?? loadedSource.vectorLayers));
    nextInteractiveLayerIds.push(...loadedSource.interactiveLayerIds);
  }

  if (!shouldContinue()) return null;
  removeInactiveMapSources(map, activeSourceIds, managedSourceIds);
  removeInactiveVectorLayers(vectorLayersBySource, activeLayerIds);
  syncRenderedLayerOrder(map, sources, vectorLayersBySource);

  return {
    layers: nextLayers,
    interactiveLayerIds: nextInteractiveLayerIds,
  };
}

function reportSourceSyncError(
  error: Error,
  sources: readonly LoadedMapLayer[],
  onQueryLayerError: ((error: { queryId: string; message: string }) => void) | undefined,
): void {
  const message = error.message || "Query map layer could not be loaded.";
  if (error instanceof QueryLayerSyncError) {
    onQueryLayerError?.({ queryId: error.queryId, message });
    return;
  }
  for (const source of sources) {
    if (source.kind === "query_mvt") onQueryLayerError?.({ queryId: source.queryId, message });
  }
}

export function runWhenMapStyleReady(map: maplibregl.Map, callback: () => void): void {
  if (mapsWithInitialStyle.has(map) || map.isStyleLoaded()) {
    mapsWithInitialStyle.add(map);
    callback();
    return;
  }
  map.once("style.load", () => {
    mapsWithInitialStyle.add(map);
    callback();
  });
}

export function useMultiLayerMapInitialization(
  mapContainerRef: React.RefObject<HTMLDivElement | null>,
  sources: LoadedMapLayer[],
  onLayersLoaded: (layers: VectorLayerInfo[]) => void,
  onHover: (info: HoverInfo | null) => void,
  onPinnedPopup?: (info: HoverInfo | null) => void,
  onFeatureSelection?: ((features: maplibregl.MapGeoJSONFeature[], mode: FeatureSelectionMode) => void) | undefined,
  isSelectionActive = false,
  basemapMode: BasemapMode = "street",
  pinnedPopupLngLat?: PopupLngLat | null,
  pinnedPopupElementRef?: React.RefObject<HTMLDivElement | null>,
  queryTokens: ReadonlyMap<string, string> = new Map(),
  onQueryLayerError?: ((error: { queryId: string; message: string }) => void) | undefined,
) {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const currentBasemapModeRef = useRef(basemapMode);
  const protocolRef = useRef<Protocol | null>(null);
  const interactiveLayerIds = useRef<string[]>([]);
  const onFeatureSelectionRef = useRef(onFeatureSelection);
  const onHoverRef = useRef(onHover);
  const onLayersLoadedRef = useRef(onLayersLoaded);
  const onPinnedPopupRef = useRef(onPinnedPopup);
  const pinnedPopupLngLatRef = useRef(pinnedPopupLngLat);
  const pinnedPopupElementRefRef = useRef(pinnedPopupElementRef);
  const queryTokensRef = useRef(queryTokens);
  const onQueryLayerErrorRef = useRef(onQueryLayerError);
  const isSelectionActiveRef = useRef(isSelectionActive);
  const boxSelectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const boxSelectionStartLngLatRef = useRef<SelectionLngLat | null>(null);
  const suppressNextClickSelectionRef = useRef(false);
  const vectorLayersBySource = useRef<VectorLayersBySource>({});
  const managedSourceIds = useRef<Set<string>>(new Set());
  const hoveredFeatureRef = useRef<{
    mapSourceId: string;
    sourceLayer: string;
    id: number | string;
  } | null>(null);

  currentBasemapModeRef.current = basemapMode;

  useEffect(() => {
    onFeatureSelectionRef.current = onFeatureSelection;
  }, [onFeatureSelection]);

  useEffect(() => {
    onHoverRef.current = onHover;
  }, [onHover]);

  useEffect(() => {
    onLayersLoadedRef.current = onLayersLoaded;
  }, [onLayersLoaded]);

  useEffect(() => {
    onPinnedPopupRef.current = onPinnedPopup;
  }, [onPinnedPopup]);

  useEffect(() => {
    pinnedPopupLngLatRef.current = pinnedPopupLngLat;
  }, [pinnedPopupLngLat]);

  useEffect(() => {
    pinnedPopupElementRefRef.current = pinnedPopupElementRef;
  }, [pinnedPopupElementRef]);

  useEffect(() => {
    queryTokensRef.current = queryTokens;
  }, [queryTokens]);

  useEffect(() => {
    onQueryLayerErrorRef.current = onQueryLayerError;
  }, [onQueryLayerError]);

  useEffect(() => {
    isSelectionActiveRef.current = isSelectionActive;
    const map = mapRef.current;
    if (map && boxSelectionStartRef.current === null) {
      setMapSelectionCursor(map, isSelectionActive);
    }
  }, [isSelectionActive]);

  const clearHoverFeature = useCallback(() => {
    if (!mapRef.current || !hoveredFeatureRef.current) return;
    mapRef.current.setFeatureState(
      {
        source: hoveredFeatureRef.current.mapSourceId,
        sourceLayer: hoveredFeatureRef.current.sourceLayer,
        id: hoveredFeatureRef.current.id,
      },
      { hover: false },
    );
    hoveredFeatureRef.current = null;
  }, []);

  const clearSelectionBox = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    boxSelectionStartRef.current = null;
    boxSelectionStartLngLatRef.current = null;
    setSelectionBoxFeature(map, null);
  }, []);

  const setHoverFeature = useCallback(
    (feature: maplibregl.MapGeoJSONFeature | null) => {
      if (!mapRef.current || !feature) return;
      const sourceLayer = sourceLayerForFeature(feature);
      const featureId = feature.id;
      if (!sourceLayer || featureId === undefined || featureId === null) return;
      const mapSourceId = mapSourceForFeature(feature);

      if (
        hoveredFeatureRef.current &&
        hoveredFeatureRef.current.mapSourceId === mapSourceId &&
        hoveredFeatureRef.current.sourceLayer === sourceLayer &&
        hoveredFeatureRef.current.id === featureId
      ) {
        return;
      }

      clearHoverFeature();
      mapRef.current.setFeatureState(
        {
          source: mapSourceId,
          sourceLayer,
          id: featureId,
        },
        { hover: true },
      );
      hoveredFeatureRef.current = { mapSourceId, sourceLayer, id: featureId };
    },
    [clearHoverFeature],
  );

  useEffect(() => {
    if (!mapContainerRef.current) return;

    protocolRef.current = new Protocol();
    maplibregl.addProtocol("pmtiles", protocolRef.current.tile);

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: OPENFREEMAP_BRIGHT_STYLE_URL,
      center: [-98.5795, 39.8283],
      zoom: 4,
      transformRequest: (url) => {
        const transformed = transformQueryTileRequest(url, queryTokensRef.current);
        if (!transformed) {
          return undefined;
        }
        if ("blocked" in transformed) {
          onQueryLayerErrorRef.current?.({
            queryId: transformed.queryId,
            message: "Query map layer is unavailable.",
          });
          return { url: "data:," };
        }
        return transformed;
      },
    });

    mapRef.current = map;
    let hasSyncedBasemapAfterStyleLoad = false;
    let hasAppliedFallbackBasemapStyle = false;
    const syncBasemapAfterStyleLoad = () => {
      if (hasSyncedBasemapAfterStyleLoad) {
        return;
      }
      hasSyncedBasemapAfterStyleLoad = true;
      mapsWithInitialStyle.add(map);
      syncBasemapVisibilityAfterStyleLoad(map, currentBasemapModeRef);
    };
    map.once("style.load", syncBasemapAfterStyleLoad);
    map.on("error", () => {
      if (hasSyncedBasemapAfterStyleLoad || hasAppliedFallbackBasemapStyle) {
        return;
      }
      hasAppliedFallbackBasemapStyle = true;
      map.setStyle(fallbackBasemapStyle(currentBasemapModeRef.current));
      map.once("style.load", syncBasemapAfterStyleLoad);
    });

    const updateCursorForCurrentSelectionState = () => {
      setMapSelectionCursor(map, isSelectionActiveRef.current || boxSelectionStartRef.current !== null);
    };
    const updatePinnedPopupPosition = () => {
      syncPinnedPopupPosition({
        map,
        lngLat: pinnedPopupLngLatRef.current,
        element: pinnedPopupElementRefRef.current?.current,
      });
    };

    map.on("mousemove", (event) => {
      if (!mapRef.current || interactiveLayerIds.current.length === 0) return;
      const features = map.queryRenderedFeatures(event.point, {
        layers: interactiveLayerIds.current,
      });

      if (!features || features.length === 0) {
        onHoverRef.current(null);
        return;
      }

      onHoverRef.current({
        x: event.point.x,
        y: event.point.y,
        features,
        layerLabel: layerLabelForFeature(features[0]),
        selectedIndex: 0,
        isPinned: false,
      });
    });

    map.on("click", (event) => {
      if (!mapRef.current || interactiveLayerIds.current.length === 0) return;
      if (suppressNextClickSelectionRef.current) {
        suppressNextClickSelectionRef.current = false;
        return;
      }
      const selectedFeatures = queryRenderedSelectionFeatures({
        map,
        point: event.point,
        interactiveLayerIds: interactiveLayerIds.current,
      });
      onFeatureSelectionRef.current?.(selectedFeatures, "replace");
      handleMapClick({
        map,
        point: event.point,
        lngLat: event.lngLat,
        interactiveLayerIds: interactiveLayerIds.current,
        onPinnedPopup: onPinnedPopupRef.current,
      });
    });

    map.on("mousedown", (event) => {
      if (!mapRef.current || interactiveLayerIds.current.length === 0) return;
      if (!isSelectionActiveRef.current) return;
      boxSelectionStartRef.current = { x: event.point.x, y: event.point.y };
      boxSelectionStartLngLatRef.current = { lng: event.lngLat.lng, lat: event.lngLat.lat };
      setSelectionBoxFeature(
        map,
        selectionBoxFeature(boxSelectionStartLngLatRef.current, boxSelectionStartLngLatRef.current),
      );
      setMapSelectionCursor(map, true);
      map.dragPan.disable();
      event.preventDefault();
    });

    map.on("mousemove", (event) => {
      if (!boxSelectionStartRef.current || !boxSelectionStartLngLatRef.current) return;
      setSelectionBoxFeature(
        map,
        selectionBoxFeature(boxSelectionStartLngLatRef.current, { lng: event.lngLat.lng, lat: event.lngLat.lat }),
      );
    });

    map.on("mouseup", (event) => {
      const start = boxSelectionStartRef.current;
      const startLngLat = boxSelectionStartLngLatRef.current;
      if (!start) return;
      boxSelectionStartRef.current = null;
      boxSelectionStartLngLatRef.current = null;
      if (startLngLat) {
        setSelectionBoxFeature(map, selectionBoxFeature(startLngLat, { lng: event.lngLat.lng, lat: event.lngLat.lat }));
      }
      map.dragPan.enable();
      updateCursorForCurrentSelectionState();
      suppressNextClickSelectionRef.current = true;
      window.setTimeout(() => {
        suppressNextClickSelectionRef.current = false;
      }, 0);
      const selectedFeatures = queryRenderedBoxFeatures({
        map,
        start,
        end: { x: event.point.x, y: event.point.y },
        interactiveLayerIds: interactiveLayerIds.current,
      });
      onFeatureSelectionRef.current?.(selectedFeatures, "replace");
    });

    map.on("mouseleave", () => {
      clearHoverFeature();
      onHoverRef.current(null);
    });

    map.on("move", updatePinnedPopupPosition);
    map.on("resize", updatePinnedPopupPosition);

    return () => {
      map.remove();
      mapRef.current = null;
      interactiveLayerIds.current = [];
      boxSelectionStartRef.current = null;
      boxSelectionStartLngLatRef.current = null;
      onLayersLoadedRef.current([]);
    };
  }, [mapContainerRef, clearHoverFeature]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    syncBasemapVisibility(map, basemapMode);
  }, [basemapMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;

    const loadSources = async () => {
      try {
        const result = await syncLoadedMapSources({
          map,
          protocol: protocolRef.current,
          sources,
          managedSourceIds: managedSourceIds.current,
          vectorLayersBySource: vectorLayersBySource.current,
          shouldContinue: () => !cancelled,
        });
        if (!result) return;
        interactiveLayerIds.current = result.interactiveLayerIds;
        onLayersLoadedRef.current(result.layers);
        map.resize();
      } catch (error) {
        if (cancelled) return;
        reportSourceSyncError(
          error instanceof Error ? error : new Error("Query map layer could not be loaded."),
          sources,
          onQueryLayerErrorRef.current,
        );
      }
    };

    runWhenMapStyleReady(map, () => {
      void loadSources();
    });
    return () => {
      cancelled = true;
    };
  }, [sources]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    syncPinnedPopupPosition({
      map,
      lngLat: pinnedPopupLngLat,
      element: pinnedPopupElementRef?.current,
    });
  }, [pinnedPopupLngLat, pinnedPopupElementRef]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return {
    mapRef,
    interactiveLayerIds,
    hoveredFeatureRef,
    setHoverFeature,
    clearHoverFeature,
    clearSelectionBox,
  };
}
