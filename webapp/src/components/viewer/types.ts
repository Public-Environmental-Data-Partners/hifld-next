import type maplibregl from "maplibre-gl";

export type VectorLayerInfo = {
  id: string;
  fields: string[];
};

export type LayerStyle = {
  colorProperty: string | null;
  colorScheme: string;
  breaksText: string;
  opacity: number;
  radius: number;
  lineWidth: number;
  radiusProperty: string | null;
  lineWidthProperty: string | null;
  radiusScale: "linear" | "sqrt" | "log";
  lineWidthScale: "linear" | "sqrt" | "log";
};

export type HoverInfo = {
  x: number;
  y: number;
  features: maplibregl.MapGeoJSONFeature[];
  selectedIndex: number;
};

export type ColorScheme = {
  id: string;
  label: string;
  interpolator: (t: number) => string;
};

