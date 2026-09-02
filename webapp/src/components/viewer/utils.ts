import {
  applyScale as mapCoreApplyScale,
  buildColorExpression as mapCoreBuildColorExpression,
  colorSchemes as mapCoreColorSchemes,
  computeQuantileBreaks as mapCoreComputeQuantileBreaks,
  getColorRamp as mapCoreGetColorRamp,
  getLegendItems as mapCoreGetLegendItems,
  getValueRange as mapCoreGetValueRange,
} from "@hifld/map-core";

export type { PaintValue, StyleExpression } from "@hifld/map-core";

import type maplibregl from "maplibre-gl";
import type { ColorScheme, LayerStyle, NumericFieldSummary } from "./types";

export const colorSchemes: ColorScheme[] = mapCoreColorSchemes;
export const computeQuantileBreaks = mapCoreComputeQuantileBreaks;
export const getValueRange = mapCoreGetValueRange;
export const applyScale = mapCoreApplyScale;
export const getColorRamp = mapCoreGetColorRamp;
// The shared implementation retains the colors[0] ?? "#C5E8FF" default fill fallback.
export const buildColorExpression = mapCoreBuildColorExpression;
export const getLegendItems = mapCoreGetLegendItems;

export const DEFAULT_STYLE: LayerStyle = {
  colorProperty: null,
  colorScheme: "viridis",
  breaksText: "",
  breakMode: "auto",
  opacity: 0.7,
  radius: 4,
  lineWidth: 2,
  radiusProperty: null,
  lineWidthProperty: null,
  radiusScale: "linear",
  lineWidthScale: "linear",
};

export const DEFAULT_BREAK_COUNT = 6;

export function parseBreaks(input: string): number[] {
  return input
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => !Number.isNaN(value))
    .sort((a, b) => a - b);
}

export function computeEqualIntervalBreaks(min: number, max: number, count: number): number[] {
  if (count <= 0 || !Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return [];
  }
  const step = (max - min) / (count + 1);
  return Array.from({ length: count }, (_, index) => Number((min + step * (index + 1)).toFixed(6)));
}

export function automaticBreaksForNumericField({
  field,
  sampledValues,
  count,
}: {
  field: NumericFieldSummary | undefined;
  sampledValues: number[];
  count: number;
}): number[] {
  const finiteSampledValues = sampledValues.filter((value) => Number.isFinite(value));
  if (finiteSampledValues.length > 0) {
    return computeQuantileBreaks(finiteSampledValues, count);
  }
  return computeQuantileBreaks(
    field?.min !== undefined && field.max !== undefined ? [field.min, field.max] : [],
    count,
  );
}

export function getSampledValues(
  map: maplibregl.Map,
  layerId: string,
  property: string,
  limit = 5000,
  sourceId = "pmtiles",
): number[] {
  const features = map.querySourceFeatures(sourceId, {
    sourceLayer: layerId,
  });
  const values: number[] = [];

  for (const feature of features) {
    if (values.length >= limit) break;
    const raw = feature.properties?.[property];
    const value = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isNaN(value)) {
      values.push(value);
    }
  }

  return values;
}

export function invertHexColor(color: string) {
  const hex = color.replace("#", "");
  if (hex.length !== 6) return color;
  const r = 255 - parseInt(hex.slice(0, 2), 16);
  const g = 255 - parseInt(hex.slice(2, 4), 16);
  const b = 255 - parseInt(hex.slice(4, 6), 16);
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
