import {
  isQueryMvtReservedProperty,
  MAX_SELECTED_FEATURES,
  QUERY_MVT_CENTROID_LAT_PROPERTY,
  QUERY_MVT_CENTROID_LNG_PROPERTY,
  QUERY_MVT_FEATURE_KEY_PROPERTY,
} from "@hifld/map-core";
import type { Position } from "geojson";
import type { MapGeoJSONFeature } from "maplibre-gl";

export { MAX_SELECTED_FEATURES as MAX_HIGHLIGHTED_FEATURES };

export interface HighlightedQueryLayer {
  mapSourceId: string;
  queryId: string;
  layerName: string;
  sourceLayerId: string;
}

export interface HighlightedMapFeature {
  id: string;
  queryId: string;
  layerName: string;
  sourceLayerId: string;
  featureId: string;
  centroid: [number, number] | null;
  properties: Record<string, string>;
}

export interface MapHighlightSnapshotFeature {
  id: string;
  query_id: string;
  layer_name: string;
  source_layer_id: string;
  feature_id: string;
  centroid: [number, number] | null;
  properties: Record<string, string>;
}

export interface MapHighlightSnapshot {
  map_title: string;
  selected_feature_count: number;
  was_capped: boolean;
  selection_bounds: [number, number, number, number] | null;
  selected_features: MapHighlightSnapshotFeature[];
}

export interface HighlightedFeatureSelection {
  features: HighlightedMapFeature[];
  wasCapped: boolean;
}

const PRIVATE_PROPERTY_NAME = /(?:token|tile(?:_|-)?url|sql|geometry)/i;
const WKT_GEOMETRY =
  /^\s*(?:SRID=\d+;)?(?:POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)(?:\s+Z(?:M)?|\s+M)?\s*(?:\(|EMPTY\b)/i;
const GEOJSON_GEOMETRY =
  /^\s*\{(?=[\s\S]*"type"\s*:\s*"(?:Point|LineString|Polygon|MultiPoint|MultiLineString|MultiPolygon|GeometryCollection)")(?=[\s\S]*"(?:coordinates|geometries)"\s*:)[\s\S]*\}\s*$/;
const SQL_STATEMENT =
  /^\s*(?:SELECT|WITH|INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COPY|EXPLAIN)\b/i;
const MVT_TILE_URL =
  /^(?:https?:\/\/[^\s]*(?:\/tiles?\/|\.(?:mvt|pbf)(?:[?#]|$))|\/tiles?\/[^\s]*\.(?:mvt|pbf)(?:[?#]|$))/i;

type JsonCompatiblePropertyValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonCompatiblePropertyValue[]
  | { readonly [propertyName: string]: JsonCompatiblePropertyValue };

function stringifyPropertyValue(value: JsonCompatiblePropertyValue): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function containsSensitiveFeatureData(
  value: JsonCompatiblePropertyValue,
): boolean {
  return (
    typeof value === "string" &&
    (WKT_GEOMETRY.test(value) ||
      GEOJSON_GEOMETRY.test(value) ||
      SQL_STATEMENT.test(value) ||
      MVT_TILE_URL.test(value))
  );
}

function normalizeProperties(
  properties: MapGeoJSONFeature["properties"],
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (
      !isQueryMvtReservedProperty(key) &&
      !PRIVATE_PROPERTY_NAME.test(key) &&
      !containsSensitiveFeatureData(value)
    ) {
      normalized[key] = stringifyPropertyValue(value);
    }
  }
  return normalized;
}

function pointFromCoordinates(coordinates: Position): [number, number] | null {
  const [longitude, latitude] = coordinates;
  return typeof longitude === "number" && typeof latitude === "number"
    ? [longitude, latitude]
    : null;
}

function internalCentroid(
  properties: MapGeoJSONFeature["properties"],
): [number, number] | null {
  const longitude = properties[QUERY_MVT_CENTROID_LNG_PROPERTY];
  const latitude = properties[QUERY_MVT_CENTROID_LAT_PROPERTY];
  if (
    typeof longitude !== "number" ||
    typeof latitude !== "number" ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    return null;
  }
  return [longitude, latitude];
}

function internalFeatureKey(
  properties: MapGeoJSONFeature["properties"],
): string | null {
  const key = properties[QUERY_MVT_FEATURE_KEY_PROPERTY];
  return typeof key === "string" && key.length > 0 ? key : null;
}

function centroidForFeature(
  feature: MapGeoJSONFeature,
): [number, number] | null {
  return (
    internalCentroid(feature.properties) ??
    (feature.geometry.type === "Point"
      ? pointFromCoordinates(feature.geometry.coordinates)
      : null)
  );
}

function sourceLayerForFeature(
  feature: MapGeoJSONFeature,
  layer: HighlightedQueryLayer,
): string {
  return feature.sourceLayer ?? layer.sourceLayerId;
}

export function normalizeHighlightedFeatures({
  features,
  layers,
}: {
  features: readonly MapGeoJSONFeature[];
  layers: readonly HighlightedQueryLayer[];
}): HighlightedFeatureSelection {
  const layersByMapSourceId = new Map(
    layers.map((layer) => [layer.mapSourceId, layer]),
  );
  const selected: HighlightedMapFeature[] = [];
  const seen = new Set<string>();
  const countByQueryId = new Map<string, number>();
  let wasCapped = false;

  for (const feature of features) {
    const layer = layersByMapSourceId.get(feature.source);
    if (!layer) continue;
    if (feature.id === undefined || feature.id === null) continue;
    const featureId = internalFeatureKey(feature.properties);
    if (!featureId) continue;
    const sourceLayerId = sourceLayerForFeature(feature, layer);
    const id = `query:${layer.queryId}:${sourceLayerId}:${featureId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const currentCount = countByQueryId.get(layer.queryId) ?? 0;
    if (currentCount >= MAX_SELECTED_FEATURES) {
      wasCapped = true;
      continue;
    }
    countByQueryId.set(layer.queryId, currentCount + 1);
    selected.push({
      id,
      queryId: layer.queryId,
      layerName: layer.layerName,
      sourceLayerId,
      featureId,
      centroid: centroidForFeature(feature),
      properties: normalizeProperties(feature.properties),
    });
  }

  return { features: selected, wasCapped };
}

export function snapshotMapHighlights({
  mapTitle,
  features,
  wasCapped,
  selectionBounds,
}: {
  mapTitle: string;
  features: readonly HighlightedMapFeature[];
  wasCapped: boolean;
  selectionBounds: [number, number, number, number] | null;
}): MapHighlightSnapshot {
  return {
    map_title: mapTitle,
    selected_feature_count: features.length,
    was_capped: wasCapped,
    selection_bounds: selectionBounds,
    selected_features: features.map((feature) => ({
      id: feature.id,
      query_id: feature.queryId,
      layer_name: feature.layerName,
      source_layer_id: feature.sourceLayerId,
      feature_id: feature.featureId,
      centroid: feature.centroid,
      properties: feature.properties,
    })),
  };
}
