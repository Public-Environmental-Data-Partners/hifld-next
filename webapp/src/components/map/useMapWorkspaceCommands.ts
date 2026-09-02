import type maplibregl from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { LayerStyle, LayerStylesById, VectorLayerInfo } from "@/components/viewer/types";
import { syncBasemapVisibility } from "@/components/viewer/useMapInitialization";
import { DEFAULT_STYLE } from "@/components/viewer/utils";
import type { SelectedMapFeature } from "./featureSelection";
import {
  assertValidAddDatasetLayer,
  assertValidBasemap,
  assertValidCameraInput,
  assertValidLayerOrder,
  assertValidLayerRemoval,
  assertValidLayerStyleUpdate,
  assertValidLayerVisibility,
  type DatasetLayerInput,
  type LayerStyleUpdate,
  type MapCameraInput,
  type MapCameraState,
  type MapLayerSummary,
  type MapWorkspaceCommands,
} from "./mapWorkspaceCommands";
import type { LoadedMapLayer, MapBounds } from "./multiLayerSources";

export interface UseMapWorkspaceCommandsOptions {
  mapRef: React.RefObject<maplibregl.Map | null>;
  loadedLayers: LoadedMapLayer[];
  setLoadedLayers: React.Dispatch<React.SetStateAction<LoadedMapLayer[]>>;
  vectorLayers: VectorLayerInfo[];
  layerStyles: LayerStylesById;
  setLayerStyles: React.Dispatch<React.SetStateAction<LayerStylesById>>;
  selectedFeatures: SelectedMapFeature[];
  clearSelection: () => void;
  basemapMode: "street" | "satellite";
  setBasemapMode: (mode: "street" | "satellite") => void;
  resolveDatasetLayer: (input: DatasetLayerInput) => Promise<LoadedMapLayer | null>;
  onCatalogLayerAdded?: ((layer: Extract<LoadedMapLayer, { kind: "catalog_pmtiles" }>) => void) | undefined;
}

function summaries(layers: readonly LoadedMapLayer[]): MapLayerSummary[] {
  return layers.map((layer) => ({ id: layer.id, label: layer.label, kind: layer.kind, visible: layer.visible }));
}

function unionBounds(bounds: readonly (MapBounds | null)[]): MapBounds | null {
  const known = bounds.filter((bound): bound is MapBounds => bound !== null);
  if (known.length === 0) return null;
  return [
    Math.min(...known.map((bound) => bound[0])),
    Math.min(...known.map((bound) => bound[1])),
    Math.max(...known.map((bound) => bound[2])),
    Math.max(...known.map((bound) => bound[3])),
  ];
}

interface MapFitApi {
  loaded(): boolean;
  once(event: "load", listener: () => void): void;
  fitBounds(bounds: MapBounds, options: { padding: number; duration: number }): void;
}

export function fitMapWhenReady(map: MapFitApi, bounds: MapBounds): void {
  const applyFit = () => map.fitBounds(bounds, { padding: 48, duration: 0 });
  if (map.loaded()) {
    applyFit();
    return;
  }
  map.once("load", applyFit);
}

interface MapMovementApi {
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  getBearing(): number;
  getPitch(): number;
  isMoving(): boolean;
  once(event: "moveend" | "error", listener: () => void): void;
  off(event: "moveend" | "error", listener: () => void): void;
}

function cameraState(map: MapMovementApi): MapCameraState {
  const center = map.getCenter();
  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
}

export function waitForMapMovement(map: MapMovementApi): Promise<MapCameraState> {
  if (!map.isMoving()) {
    return Promise.resolve(cameraState(map));
  }
  return new Promise((resolve, reject) => {
    const onMoveEnd = () => {
      map.off("error", onError);
      resolve(cameraState(map));
    };
    const onError = () => {
      map.off("moveend", onMoveEnd);
      reject(new Error("Map movement failed."));
    };
    map.once("moveend", onMoveEnd);
    map.once("error", onError);
  });
}

function applyStyleUpdate(style: LayerStyle, update: LayerStyleUpdate): LayerStyle {
  return {
    ...style,
    ...(update.colorProperty === undefined ? {} : { colorProperty: update.colorProperty }),
    ...(update.colorScheme === undefined ? {} : { colorScheme: update.colorScheme }),
    ...(update.breaks === undefined ? {} : { breaksText: update.breaks.join(", ") }),
    ...(update.breakMode === undefined ? {} : { breakMode: update.breakMode }),
    ...(update.opacity === undefined ? {} : { opacity: update.opacity }),
    ...(update.radius === undefined ? {} : { radius: update.radius }),
    ...(update.lineWidth === undefined ? {} : { lineWidth: update.lineWidth }),
    ...(update.radiusProperty === undefined ? {} : { radiusProperty: update.radiusProperty }),
    ...(update.lineWidthProperty === undefined ? {} : { lineWidthProperty: update.lineWidthProperty }),
    ...(update.radiusScale === undefined ? {} : { radiusScale: update.radiusScale }),
    ...(update.lineWidthScale === undefined ? {} : { lineWidthScale: update.lineWidthScale }),
  };
}

function applyCameraBoundsTarget(map: maplibregl.Map, input: MapCameraInput, bounds: MapBounds): void {
  map.fitBounds(bounds, {
    padding: input.padding ?? 48,
    ...(input.bearing === undefined ? {} : { bearing: input.bearing }),
    ...(input.pitch === undefined ? {} : { pitch: input.pitch }),
  });
}

function applyCameraCenterTarget(
  map: maplibregl.Map,
  input: MapCameraInput,
  center: [number, number],
  targetZoom: number | undefined,
): void {
  const zoom = input.zoom ?? targetZoom;
  map.easeTo({
    center,
    ...(zoom === undefined ? {} : { zoom }),
    ...(input.bearing === undefined ? {} : { bearing: input.bearing }),
    ...(input.pitch === undefined ? {} : { pitch: input.pitch }),
  });
}

function applyCameraLayerTarget(
  map: maplibregl.Map,
  input: MapCameraInput,
  layerIds: readonly string[],
  layers: readonly LoadedMapLayer[],
): void {
  const bounds = unionBounds(layers.filter((layer) => layerIds.includes(layer.id)).map((layer) => layer.bounds));
  if (!bounds) throw new Error("Requested layers have no known bounds.");
  applyCameraBoundsTarget(map, input, bounds);
}

function applyCameraFeatureTarget(
  map: maplibregl.Map,
  input: MapCameraInput,
  featureId: string,
  selectedFeatures: readonly SelectedMapFeature[],
): void {
  const feature = selectedFeatures.find((candidate) => candidate.id === featureId);
  if (!feature?.centroid) throw new Error("Requested feature has no known location.");
  applyCameraCenterTarget(map, input, [feature.centroid.lng, feature.centroid.lat], Math.max(map.getZoom(), 14));
}

function applyCameraTarget(
  map: maplibregl.Map,
  input: MapCameraInput,
  layers: readonly LoadedMapLayer[],
  selectedFeatures: readonly SelectedMapFeature[],
): void {
  const target = input.target ?? input;
  if (target.bounds) {
    applyCameraBoundsTarget(map, input, target.bounds);
  } else if (target.center) {
    applyCameraCenterTarget(map, input, target.center, target.zoom);
  } else if (target.layerIds) {
    applyCameraLayerTarget(map, input, target.layerIds, layers);
  } else if (target.featureId) {
    applyCameraFeatureTarget(map, input, target.featureId, selectedFeatures);
  }
}

function applyCameraOrientation(map: maplibregl.Map, input: MapCameraInput): void {
  if (input.bearing !== undefined && input.pitch !== undefined) {
    map.easeTo({ bearing: input.bearing, pitch: input.pitch });
  } else if (input.bearing !== undefined) {
    map.easeTo({ bearing: input.bearing });
  } else if (input.pitch !== undefined) {
    map.easeTo({ pitch: input.pitch });
  }
}

export function useMapWorkspaceCommands({
  mapRef,
  loadedLayers,
  setLoadedLayers,
  vectorLayers,
  setLayerStyles,
  selectedFeatures,
  clearSelection,
  setBasemapMode,
  resolveDatasetLayer,
  onCatalogLayerAdded,
}: UseMapWorkspaceCommandsOptions): MapWorkspaceCommands {
  const loadedLayersRef = useRef(loadedLayers);
  const vectorLayersRef = useRef(vectorLayers);
  const selectedFeaturesRef = useRef(selectedFeatures);
  const initialFitAttemptedRef = useRef(false);
  const firstLayerFitScheduledRef = useRef(false);
  const pendingLayerIdsRef = useRef<Set<string>>(new Set());
  loadedLayersRef.current = loadedLayers;
  vectorLayersRef.current = vectorLayers;
  selectedFeaturesRef.current = selectedFeatures;

  const fitKnownLayerUnion = useCallback(
    (layers: readonly LoadedMapLayer[]): void => {
      const map = mapRef.current;
      const bounds = unionBounds(layers.map((layer) => layer.bounds));
      if (!map || !bounds) return;
      fitMapWhenReady(map, bounds);
    },
    [mapRef],
  );

  useEffect(() => {
    if (initialFitAttemptedRef.current || loadedLayers.length === 0) return;
    const map = mapRef.current;
    if (!map) return;
    initialFitAttemptedRef.current = true;
    fitKnownLayerUnion(loadedLayers);
  }, [fitKnownLayerUnion, loadedLayers, mapRef]);

  const addDatasetLayer = useCallback(
    async (input: DatasetLayerInput): Promise<MapLayerSummary> => {
      const current = loadedLayersRef.current;
      assertValidAddDatasetLayer(input, summaries(current));
      if (pendingLayerIdsRef.current.has(input.layerId)) {
        throw new Error(`layer ${input.layerId} is already being added`);
      }
      pendingLayerIdsRef.current.add(input.layerId);
      try {
        const resolved = await resolveDatasetLayer(input);
        if (!resolved || resolved.id !== input.layerId) {
          throw new Error("The requested map layer could not be resolved.");
        }
        assertValidAddDatasetLayer(
          { layerId: resolved.id, label: resolved.label, kind: resolved.kind },
          summaries(loadedLayersRef.current),
        );
        const wasEmpty = loadedLayersRef.current.length === 0;
        setLoadedLayers((previous) =>
          previous.some((layer) => layer.id === resolved.id) ? previous : [...previous, resolved],
        );
        if (resolved.kind === "catalog_pmtiles") onCatalogLayerAdded?.(resolved);
        if (wasEmpty && !firstLayerFitScheduledRef.current) {
          firstLayerFitScheduledRef.current = true;
          fitKnownLayerUnion([resolved]);
        }
        return { id: resolved.id, label: resolved.label, kind: resolved.kind, visible: resolved.visible };
      } finally {
        pendingLayerIdsRef.current.delete(input.layerId);
      }
    },
    [fitKnownLayerUnion, onCatalogLayerAdded, resolveDatasetLayer, setLoadedLayers],
  );

  const removeLayer = useCallback(
    (layerId: string): void => {
      assertValidLayerRemoval(layerId, summaries(loadedLayersRef.current));
      setLoadedLayers((previous) => previous.filter((layer) => layer.id !== layerId));
      setLayerStyles((previous) => {
        const next = { ...previous };
        for (const layer of vectorLayersRef.current) {
          if (layer.loadedLayerId === layerId) delete next[layer.id];
        }
        return next;
      });
    },
    [setLayerStyles, setLoadedLayers],
  );

  const setLayerVisibility = useCallback(
    (layerId: string, visible: boolean): void => {
      assertValidLayerVisibility(layerId, visible, summaries(loadedLayersRef.current));
      setLoadedLayers((previous) => previous.map((layer) => (layer.id === layerId ? { ...layer, visible } : layer)));
    },
    [setLoadedLayers],
  );

  const setLayerStyle = useCallback(
    (styleLayerId: string, update: LayerStyleUpdate): void => {
      const target = vectorLayersRef.current.find((layer) => layer.id === styleLayerId);
      if (!target) throw new Error(`style layer ${styleLayerId} does not exist`);
      assertValidLayerStyleUpdate(target, update);
      setLayerStyles((previous) => ({
        ...previous,
        [styleLayerId]: applyStyleUpdate(previous[styleLayerId] ?? { ...DEFAULT_STYLE }, update),
      }));
    },
    [setLayerStyles],
  );

  const reorderLayers = useCallback(
    (layerIds: string[]): void => {
      const current = loadedLayersRef.current;
      assertValidLayerOrder(layerIds, summaries(current));
      const byId = new Map(current.map((layer) => [layer.id, layer]));
      setLoadedLayers(
        layerIds.flatMap((id) => {
          const layer = byId.get(id);
          return layer ? [layer] : [];
        }),
      );
    },
    [setLoadedLayers],
  );

  const setCamera = useCallback(
    async (input: MapCameraInput): Promise<MapCameraState> => {
      assertValidCameraInput(input);
      const map = mapRef.current;
      if (!map) throw new Error("Map is not ready.");
      applyCameraTarget(map, input, loadedLayersRef.current, selectedFeaturesRef.current);
      const target = input.target ?? input;
      if (!target.center && !target.featureId && !target.bounds && !target.layerIds) {
        applyCameraOrientation(map, input);
      }
      return waitForMapMovement(map);
    },
    [mapRef],
  );

  const setBasemap = useCallback(
    (mode: "street" | "satellite"): void => {
      assertValidBasemap(mode);
      setBasemapMode(mode);
      const map = mapRef.current;
      if (map) syncBasemapVisibility(map, mode);
    },
    [mapRef, setBasemapMode],
  );

  const clearMapSelection = useCallback((): void => {
    clearSelection();
  }, [clearSelection]);

  return useMemo(
    () => ({
      addDatasetLayer,
      removeLayer,
      setLayerVisibility,
      setLayerStyle,
      reorderLayers,
      setCamera,
      setBasemap,
      clearSelection: clearMapSelection,
    }),
    [
      addDatasetLayer,
      clearMapSelection,
      removeLayer,
      reorderLayers,
      setBasemap,
      setCamera,
      setLayerStyle,
      setLayerVisibility,
    ],
  );
}
