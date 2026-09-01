import type {
  ColorSchemeId,
  NumericScale as MapCoreNumericScale,
} from "@hifld/map-core";
import {
  applyScale,
  computeQuantileBreaks,
  getColorRamp,
  getValueRange,
} from "@hifld/map-core";
import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";
import type { MapLayerConfiguration } from "../mcp/contracts";

export type ColorPaintValue = string | ExpressionSpecification;
export type NumericPaintValue = number | ExpressionSpecification;
export type NumericScale = MapCoreNumericScale;

export interface LegendItem {
  color: string;
  label: string;
}

export type ColorScheme = ColorSchemeId;

export function colorRamp(scheme: ColorScheme, count: number): string[] {
  return getColorRamp(scheme, count);
}

export function isNumericColumn(logicalType: string): boolean {
  return /^(?:U?(?:TINY|SMALL|BIG|HUGE)?INT|FLOAT|DOUBLE|DECIMAL|REAL)/i.test(
    logicalType.trim(),
  );
}

function sampledValues(
  map: MapLibreMap,
  layer: MapLayerConfiguration,
  index: number,
  property: string,
): Array<string | number | boolean> {
  const features = map.querySourceFeatures(`hifld-query-${index}`, {
    sourceLayer: layer.source_layer,
  });
  const values: Array<string | number | boolean> = [];
  for (const feature of features) {
    const value = feature.properties?.[property];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      values.push(value);
    }
    if (values.length >= 5_000) break;
  }
  return values;
}

export function dataDrivenSize(
  map: MapLibreMap,
  layer: MapLayerConfiguration,
  index: number,
  property: string | null,
  scale: NumericScale,
  baseValue: number,
  minimumValue: number,
): NumericPaintValue {
  if (!property) return baseValue;
  const values = sampledValues(map, layer, index, property)
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .map((value) => applyScale(value, scale));
  if (values.length === 0) return baseValue;
  const { min: minimum, max: maximum } = getValueRange(values);
  if (minimum === maximum) return baseValue;
  const input: ExpressionSpecification =
    scale === "sqrt"
      ? ["sqrt", ["max", ["to-number", ["get", property]], 0]]
      : scale === "log"
        ? ["ln", ["max", ["to-number", ["get", property]], 1e-6]]
        : ["to-number", ["get", property]];
  return [
    "interpolate",
    ["linear"],
    input,
    minimum,
    Math.max(minimumValue, baseValue / 2),
    maximum,
    Math.max(minimumValue, baseValue * 2),
  ];
}

export interface DataDrivenColor {
  paint: ColorPaintValue;
  legendItems: LegendItem[];
}

export function dataDrivenColor(
  map: MapLibreMap,
  layer: MapLayerConfiguration,
  index: number,
  property: string | null,
  scheme: ColorScheme,
  configuredBreaks: number[] | undefined,
  solidColor: string,
): DataDrivenColor {
  if (!property) {
    return {
      paint: solidColor,
      legendItems: [{ color: solidColor, label: "All values" }],
    };
  }
  const column = layer.columns.find((candidate) => candidate.name === property);
  const values = sampledValues(map, layer, index, property);
  if (column && isNumericColumn(column.type)) {
    const numericValues = values.flatMap((value) => {
      const numeric = typeof value === "number" ? value : Number(value);
      return Number.isFinite(numeric) ? [numeric] : [];
    });
    const breaks = configuredBreaks?.length
      ? configuredBreaks
      : computeQuantileBreaks(numericValues, 5);
    if (breaks.length === 0) {
      return {
        paint: solidColor,
        legendItems: [{ color: solidColor, label: property }],
      };
    }
    const colors = getColorRamp(scheme, breaks.length + 1);
    const expression: ExpressionSpecification = [
      "step",
      ["to-number", ["get", property]],
      colors[0] ?? solidColor,
    ];
    breaks.forEach((value, breakIndex) => {
      expression.push(value, colors[breakIndex + 1] ?? solidColor);
    });
    return {
      paint: expression,
      legendItems: colors.map((color, colorIndex) => ({
        color,
        label:
          colorIndex === 0
            ? `≤ ${breaks[0]}`
            : colorIndex === colors.length - 1
              ? `> ${breaks[breaks.length - 1]}`
              : `${breaks[colorIndex - 1]} – ${breaks[colorIndex]}`,
      })),
    };
  }

  const categories = [...new Set(values.map(String))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 8);
  if (categories.length === 0) {
    return {
      paint: solidColor,
      legendItems: [{ color: solidColor, label: property }],
    };
  }
  const colors = getColorRamp(scheme, categories.length);
  const expression = [
    "match",
    ["to-string", ["get", property]],
    ...categories.flatMap((category, categoryIndex) => [
      category,
      colors[categoryIndex] ?? solidColor,
    ]),
    solidColor,
  ] as ExpressionSpecification;
  return {
    paint: expression,
    legendItems: categories.map((category, categoryIndex) => ({
      color: colors[categoryIndex] ?? solidColor,
      label: category,
    })),
  };
}
