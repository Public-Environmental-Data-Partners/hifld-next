import { quantize } from "d3-interpolate";
import {
  interpolateBlues,
  interpolateGreens,
  interpolateOranges,
  interpolatePurples,
  interpolateViridis,
  interpolatePlasma,
  interpolateRdYlBu,
  interpolateRdYlGn,
} from "d3-scale-chromatic";
import type maplibregl from "maplibre-gl";
import type { LayerStyle, ColorScheme } from "./types";

export const colorSchemes: ColorScheme[] = [
  { id: "blues", label: "Blues", interpolator: interpolateBlues },
  { id: "greens", label: "Greens", interpolator: interpolateGreens },
  { id: "oranges", label: "Oranges", interpolator: interpolateOranges },
  { id: "purples", label: "Purples", interpolator: interpolatePurples },
  { id: "viridis", label: "Viridis", interpolator: interpolateViridis },
  { id: "plasma", label: "Plasma", interpolator: interpolatePlasma },
  { id: "rdyblu", label: "RdYlBu", interpolator: interpolateRdYlBu },
  { id: "rdyg", label: "RdYlGn", interpolator: interpolateRdYlGn },
];

export const DEFAULT_STYLE: LayerStyle = {
  colorProperty: null,
  colorScheme: "viridis",
  breaksText: "",
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

export function computeQuantileBreaks(values: number[], count: number): number[] {
  if (count <= 0) {
    return [];
  }
  if (values.length === 0) {
    return Array.from({ length: count }, (_, index) => index);
  }

  const sorted = [...values].sort((a, b) => a - b);
  const unique: number[] = [];

  for (let i = 1; i <= count; i += 1) {
    const q = i / (count + 1);
    const index = Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)));
    const value = sorted[index];
    if (unique.length === 0 || unique[unique.length - 1] !== value) {
      unique.push(value);
    }
  }

  if (unique.length === count) {
    return unique;
  }

  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? min;
  if (min === max) {
    return Array.from({ length: count }, (_, index) => min + index + 1);
  }
  const step = (max - min) / (count + 1);
  return Array.from({ length: count }, (_, index) =>
    Number((min + step * (index + 1)).toFixed(6))
  );
}

export function getValueRange(values: number[]) {
  if (values.length === 0) {
    return { min: 0, max: 0 };
  }
  let min = values[0] ?? 0;
  let max = values[0] ?? 0;
  values.forEach((value) => {
    if (value < min) min = value;
    if (value > max) max = value;
  });
  return { min, max };
}

export function applyScale(value: number, scale: LayerStyle["radiusScale"]) {
  if (scale === "sqrt") {
    return Math.sqrt(Math.max(0, value));
  }
  if (scale === "log") {
    return Math.log(Math.max(1e-6, value));
  }
  return value;
}

export function getSampledValues(
  map: maplibregl.Map,
  layerId: string,
  property: string,
  limit = 5000
): number[] {
  const features = map.querySourceFeatures("pmtiles", {
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

export function getColorRamp(schemeId: string, count: number): string[] {
  const scheme = colorSchemes.find((entry) => entry.id === schemeId);
  const interpolator = scheme?.interpolator || interpolateViridis;
  const safeCount = Math.max(2, Math.min(9, count));
  return quantize(interpolator, safeCount);
}

export function buildColorExpression(
  property: string | null,
  breaks: number[],
  colors: string[]
): maplibregl.Expression {
  if (!property || breaks.length === 0) {
    return colors[0] || "#3b82f6";
  }

  const expression: maplibregl.Expression = [
    "step",
    ["to-number", ["get", property]],
    colors[0],
  ];

  breaks.forEach((value, index) => {
    expression.push(value, colors[index + 1] || colors[colors.length - 1]);
  });

  return expression;
}

export function invertHexColor(color: string) {
  const hex = color.replace("#", "");
  if (hex.length !== 6) return color;
  const r = 255 - parseInt(hex.slice(0, 2), 16);
  const g = 255 - parseInt(hex.slice(2, 4), 16);
  const b = 255 - parseInt(hex.slice(4, 6), 16);
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function getLegendItems(breaks: number[], colors: string[]) {
  if (breaks.length === 0) {
    return [{ label: "All values", color: colors[0] }];
  }

  return colors.map((color, index) => {
    if (index === 0) {
      return { label: `<= ${breaks[0]}`, color };
    }
    if (index === colors.length - 1) {
      return { label: `> ${breaks[breaks.length - 1]}`, color };
    }
    return {
      label: `${breaks[index - 1]} - ${breaks[index]}`,
      color,
    };
  });
}

