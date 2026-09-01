import {
  isQueryMvtReservedProperty,
  MAX_SELECTED_FEATURES as mapCoreMaxSelectedFeatures,
  QUERY_MVT_CENTROID_LAT_PROPERTY,
  QUERY_MVT_CENTROID_LNG_PROPERTY,
  QUERY_MVT_FEATURE_KEY_PROPERTY,
} from "@hifld/map-core";
import type { Geometry, Position } from "geojson";
import type maplibregl from "maplibre-gl";
import type { LoadedMapLayer } from "./multiLayerSources";

export const MAX_SELECTED_FEATURES = mapCoreMaxSelectedFeatures;

export type FeatureSelectionMode = "replace" | "append";

export interface SelectedFeatureProperties {
  [propertyName: string]: string;
}

interface SelectedMapFeatureBase {
  id: string;
  loadedLayerId: string;
  layerName: string;
  sourceLayerId: string;
  featureId: string;
  centroid: { lng: number; lat: number } | null;
  properties: SelectedFeatureProperties;
}

export interface CatalogSelectedMapFeature extends SelectedMapFeatureBase {
  /** Omitted for legacy catalog selections created before the discriminant existed. */
  sourceKind?: "catalog_pmtiles" | undefined;
  collectionSlug: string;
  datasetSlug: string;
  fileSlug: string;
  version: string;
  sourceId?: number | undefined;
}

export interface QuerySelectedMapFeature extends SelectedMapFeatureBase {
  sourceKind: "query_mvt";
  queryId: string;
}

export type SelectedMapFeature = CatalogSelectedMapFeature | QuerySelectedMapFeature;

export function isCatalogSelectedMapFeature(feature: SelectedMapFeature): feature is CatalogSelectedMapFeature {
  return feature.sourceKind === undefined || feature.sourceKind === "catalog_pmtiles";
}

/** Version diff is intentionally limited to catalog selections. */
export function isComparableFeatureDiffSelection(features: SelectedMapFeature[]): boolean {
  if (features.length === 0 || features.some((feature) => !isCatalogSelectedMapFeature(feature))) {
    return false;
  }
  const catalogFeatures = features.filter(isCatalogSelectedMapFeature);
  const scopes = new Set(
    catalogFeatures.map((feature) => [feature.collectionSlug, feature.datasetSlug, feature.fileSlug].join(":")),
  );
  const versions = new Set(catalogFeatures.map((feature) => feature.version));
  return scopes.size === 1 && versions.size === 2;
}

export interface FeatureSelectionUpdate {
  rows: SelectedMapFeature[];
  wasCapped: boolean;
}

function sourceLayerForFeature(feature: maplibregl.MapGeoJSONFeature): string {
  if (feature.sourceLayer) {
    return feature.sourceLayer;
  }
  return "source-layer" in feature.layer && typeof feature.layer["source-layer"] === "string"
    ? feature.layer["source-layer"]
    : feature.layer.id;
}

function featureKey(feature: maplibregl.MapGeoJSONFeature, sourceLayerId: string): string {
  if (feature.id !== undefined && feature.id !== null) {
    return String(feature.id);
  }
  return JSON.stringify({
    sourceLayerId,
    properties: feature.properties ?? {},
    geometry: feature.geometry,
  });
}

function queryFeatureKey(feature: maplibregl.MapGeoJSONFeature): string | null {
  const value = feature.properties?.[QUERY_MVT_FEATURE_KEY_PROPERTY];
  if (typeof value !== "string") {
    return null;
  }
  const key = value.trim();
  return key.length > 0 ? key : null;
}

function stringifyPropertyValue(value: maplibregl.MapGeoJSONFeature["properties"][string]): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value);
}

function normalizeProperties(
  properties: maplibregl.MapGeoJSONFeature["properties"] | null | undefined,
  stripQueryMvtReservedProperties = false,
): SelectedFeatureProperties {
  const normalized: SelectedFeatureProperties = {};
  for (const [key, value] of Object.entries(properties ?? {})) {
    if (stripQueryMvtReservedProperties && isQueryMvtReservedProperty(key)) {
      continue;
    }
    normalized[key] = stringifyPropertyValue(value);
  }
  return normalized;
}

function pointFromCoordinates(coordinates: Position): { lng: number; lat: number } | null {
  const [lng, lat] = coordinates;
  if (typeof lng !== "number" || typeof lat !== "number") {
    return null;
  }
  return { lng, lat };
}

function collectCoordinates(coordinates: Position | Position[] | Position[][] | Position[][][], positions: Position[]) {
  if (!Array.isArray(coordinates)) {
    return;
  }
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    positions.push(coordinates as Position);
    return;
  }
  for (const entry of coordinates) {
    collectCoordinates(entry as Position | Position[] | Position[][] | Position[][][], positions);
  }
}

function centroidForGeometry(geometry: maplibregl.MapGeoJSONFeature["geometry"]): { lng: number; lat: number } | null {
  if (!geometry) {
    return null;
  }
  if (geometry.type === "Point") {
    return pointFromCoordinates(geometry.coordinates);
  }
  const positions: Position[] = [];
  const collectGeometryPositions = (entry: Geometry) => {
    if (entry.type === "GeometryCollection") {
      for (const child of entry.geometries) {
        collectGeometryPositions(child);
      }
      return;
    }
    collectCoordinates(entry.coordinates, positions);
  };
  collectGeometryPositions(geometry);
  if (positions.length === 0) {
    return null;
  }
  let lngTotal = 0;
  let latTotal = 0;
  let count = 0;
  for (const position of positions) {
    const point = pointFromCoordinates(position);
    if (!point) continue;
    lngTotal += point.lng;
    latTotal += point.lat;
    count += 1;
  }
  return count > 0 ? { lng: lngTotal / count, lat: latTotal / count } : null;
}

function queryCentroidForFeature(feature: maplibregl.MapGeoJSONFeature): { lng: number; lat: number } | null {
  const longitude = feature.properties?.[QUERY_MVT_CENTROID_LNG_PROPERTY];
  const latitude = feature.properties?.[QUERY_MVT_CENTROID_LAT_PROPERTY];
  if (
    typeof longitude === "number" &&
    typeof latitude === "number" &&
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -90 &&
    latitude <= 90
  ) {
    return { lng: longitude, lat: latitude };
  }
  return feature.geometry.type === "Point" ? centroidForGeometry(feature.geometry) : null;
}

export function normalizeSelectedFeatures({
  features,
  loadedLayers,
}: {
  features: maplibregl.MapGeoJSONFeature[];
  loadedLayers: LoadedMapLayer[];
}): SelectedMapFeature[] {
  const layersByMapSourceId = new Map(loadedLayers.map((layer) => [layer.mapSourceId, layer]));
  const selected: SelectedMapFeature[] = [];

  for (const feature of features) {
    const source = typeof feature.source === "string" ? feature.source : "";
    const loadedLayer = layersByMapSourceId.get(source);
    if (!loadedLayer) {
      continue;
    }
    const sourceLayerId = sourceLayerForFeature(feature);
    const isQueryMvt = loadedLayer.kind === "query_mvt";
    const featureId = isQueryMvt ? queryFeatureKey(feature) : featureKey(feature, sourceLayerId);
    if (featureId === null) {
      continue;
    }
    const common = {
      id:
        loadedLayer.kind === "query_mvt"
          ? `query:${loadedLayer.queryId}:${sourceLayerId}:${featureId}`
          : `${loadedLayer.id}:${sourceLayerId}:${featureId}`,
      loadedLayerId: loadedLayer.id,
      layerName: loadedLayer.name,
      sourceLayerId,
      featureId,
      centroid: isQueryMvt ? queryCentroidForFeature(feature) : centroidForGeometry(feature.geometry),
      properties: normalizeProperties(feature.properties, isQueryMvt),
    };
    if (isQueryMvt) {
      // Query results deliberately do not masquerade as catalog datasets.
      selected.push({
        ...common,
        sourceKind: "query_mvt",
        queryId: loadedLayer.queryId,
      });
      continue;
    }
    selected.push({
      ...common,
      collectionSlug: loadedLayer.descriptor.collectionSlug,
      datasetSlug: loadedLayer.descriptor.datasetSlug,
      fileSlug: loadedLayer.descriptor.fileSlug,
      version: String(loadedLayer.descriptor.version),
      sourceId: loadedLayer.descriptor.sourceId,
    });
  }

  return selected;
}

export function updateSelectedFeatures({
  current,
  incoming,
  mode,
}: {
  current: SelectedMapFeature[];
  incoming: SelectedMapFeature[];
  mode: FeatureSelectionMode;
}): FeatureSelectionUpdate {
  const candidates = mode === "replace" ? incoming : [...current, ...incoming];
  const rows: SelectedMapFeature[] = [];
  const seen = new Set<string>();
  const countByLoadedLayer = new Map<string, number>();
  let wasCapped = false;

  for (const candidate of candidates) {
    if (seen.has(candidate.id)) {
      continue;
    }
    seen.add(candidate.id);
    const layerCount = countByLoadedLayer.get(candidate.loadedLayerId) ?? 0;
    if (layerCount >= MAX_SELECTED_FEATURES) {
      wasCapped = true;
      continue;
    }
    countByLoadedLayer.set(candidate.loadedLayerId, layerCount + 1);
    rows.push(candidate);
  }

  return {
    rows,
    wasCapped,
  };
}
