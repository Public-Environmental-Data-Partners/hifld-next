import type maplibregl from "maplibre-gl";
import type { ColorScheme, LayerStyle } from "./types";

export type StyleExpression = readonly (string | number | boolean | StyleExpression)[];
export type PaintValue = string | number | StyleExpression;

function interpolateRgb(start: string, end: string, t: number): string {
  const startHex = start.replace("#", "");
  const endHex = end.replace("#", "");
  const channels = [0, 2, 4].map((offset) => {
    const from = Number.parseInt(startHex.slice(offset, offset + 2), 16);
    const to = Number.parseInt(endHex.slice(offset, offset + 2), 16);
    return Math.round(from + (to - from) * t)
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

function ramp(stops: string[]): (t: number) => string {
  return (t) => {
    const bounded = Math.max(0, Math.min(1, t));
    const segmentCount = stops.length - 1;
    const rawIndex = bounded * segmentCount;
    const index = Math.min(segmentCount - 1, Math.floor(rawIndex));
    const start = stops[index] ?? stops[0] ?? "#000000";
    const end = stops[index + 1] ?? stops[stops.length - 1] ?? start;
    return interpolateRgb(start, end, rawIndex - index);
  };
}

export const colorSchemes: ColorScheme[] = [
  { id: "blues", label: "Blues", interpolator: ramp(["#f7fbff", "#6baed6", "#08306b"]) },
  { id: "greens", label: "Greens", interpolator: ramp(["#f7fcf5", "#74c476", "#00441b"]) },
  { id: "oranges", label: "Oranges", interpolator: ramp(["#fff5eb", "#fd8d3c", "#7f2704"]) },
  { id: "purples", label: "Purples", interpolator: ramp(["#fcfbfd", "#9e9ac8", "#3f007d"]) },
  { id: "viridis", label: "Viridis", interpolator: ramp(["#440154", "#21918c", "#fde725"]) },
  { id: "plasma", label: "Plasma", interpolator: ramp(["#0d0887", "#cc4778", "#f0f921"]) },
  { id: "rdyblu", label: "RdYlBu", interpolator: ramp(["#a50026", "#ffffbf", "#313695"]) },
  { id: "rdyg", label: "RdYlGn", interpolator: ramp(["#a50026", "#ffffbf", "#006837"]) },
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
    const previous = unique[unique.length - 1];
    if (value !== undefined && (unique.length === 0 || previous !== value)) {
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
  return Array.from({ length: count }, (_, index) => Number((min + step * (index + 1)).toFixed(6)));
}

export function getValueRange(values: number[]) {
  if (values.length === 0) {
    return { min: 0, max: 0 };
  }
  let min = values[0] ?? 0;
  let max = values[0] ?? 0;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
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

export function getSampledValues(map: maplibregl.Map, layerId: string, property: string, limit = 5000): number[] {
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
  const interpolator = scheme?.interpolator ?? colorSchemes[4]?.interpolator ?? ramp(["#440154", "#21918c", "#fde725"]);
  const safeCount = Math.max(2, Math.min(9, count));
  return Array.from({ length: safeCount }, (_, index) => {
    const denominator = Math.max(1, safeCount - 1);
    return interpolator(index / denominator);
  });
}

export function buildColorExpression(property: string | null, breaks: number[], colors: string[]): PaintValue {
  if (!property || breaks.length === 0) {
    return colors[0] ?? "#C5E8FF";
  }

  const expression: Array<string | number | StyleExpression> = [
    "step",
    ["to-number", ["get", property]],
    colors[0] ?? "#C5E8FF",
  ];

  for (const [index, value] of breaks.entries()) {
    expression.push(value, colors[index + 1] ?? colors[colors.length - 1] ?? "#C5E8FF");
  }

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
    return [{ label: "All values", color: colors[0] ?? "#C5E8FF" }];
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
