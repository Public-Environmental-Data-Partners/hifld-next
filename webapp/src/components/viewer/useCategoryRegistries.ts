import { CATEGORY_CAP, type CategoryFieldType, type CategoryValue, normalizeCategory } from "@hifld/map-core";
import type maplibregl from "maplibre-gl";
import { type RefObject, useEffect, useState } from "react";
import { type LayerRegistries, updateCategoryRegistries } from "./layerColorStyle";
import type { LayerStylesById, VectorLayerInfo } from "./types";

function sampledCategories(
  features: ReturnType<maplibregl.Map["querySourceFeatures"]>,
  property: string,
  type: CategoryFieldType,
) {
  const values = new Set<CategoryValue>();
  for (const feature of features) {
    const value = feature.properties?.[property];
    if (typeof value !== "string" && typeof value !== "boolean" && typeof value !== "number") continue;
    const normalized = normalizeCategory(value, type);
    if (normalized !== undefined) values.add(normalized);
    // One more than the cap proves overflow without retaining every value.
    if (values.size > CATEGORY_CAP) break;
  }
  return [...values];
}

export function useCategoryRegistries(
  mapRef: RefObject<maplibregl.Map | null>,
  layers: VectorLayerInfo[],
  styles: LayerStylesById,
): LayerRegistries {
  const [registries, setRegistries] = useState<LayerRegistries>({});
  useEffect(() => {
    const map = mapRef.current;
    const sample = (layer: VectorLayerInfo, property: string): CategoryValue[] => {
      const sourceId = layer.mapSourceId ?? "pmtiles";
      if (!map?.getSource(sourceId)) return [];
      const features = map.querySourceFeatures(sourceId, { sourceLayer: layer.sourceLayerId ?? layer.id });
      const type = layer.scalarFields?.find((field) => field.name === property)?.type;
      if (!type) return [];
      return sampledCategories(features, property, type);
    };
    const refresh = () => setRegistries((previous) => updateCategoryRegistries(previous, layers, styles, sample));
    refresh();
    map?.on("idle", refresh);
    return () => {
      map?.off("idle", refresh);
    };
  }, [mapRef, layers, styles]);
  return registries;
}
