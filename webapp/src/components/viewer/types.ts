import type maplibregl from "maplibre-gl";

export type LayerStylesById = {
  [layerId: string]: LayerStyle | undefined;
};

export type PopupPropertyEntry = [key: string, value: string];

export type VectorLayerInfo = {
  id: string;
  sourceLayerId?: string | undefined;
  loadedLayerId?: string | undefined;
  mapSourceId?: string | undefined;
  mapLayerBaseId?: string | undefined;
  fields: string[];
  numericFields: NumericFieldSummary[];
  geometryType?: string | undefined;
};

export type NumericFieldSummary = {
  name: string;
  min?: number | undefined;
  max?: number | undefined;
};

export type LayerStyle = {
  colorProperty: string | null;
  colorScheme: string;
  breaksText: string;
  breakMode: "auto" | "manual";
  opacity: number;
  radius: number;
  lineWidth: number;
  radiusProperty: string | null;
  lineWidthProperty: string | null;
  radiusScale: "linear" | "sqrt" | "log";
  lineWidthScale: "linear" | "sqrt" | "log";
};

/** The agent-facing style vocabulary; arbitrary MapLibre expressions are not part of it. */
export type LayerStyleUpdate = {
  colorProperty?: string | null | undefined;
  colorScheme?: string | undefined;
  breaks?: readonly number[] | undefined;
  breakMode?: LayerStyle["breakMode"] | undefined;
  opacity?: number | undefined;
  radius?: number | undefined;
  lineWidth?: number | undefined;
  radiusProperty?: string | null | undefined;
  lineWidthProperty?: string | null | undefined;
  radiusScale?: LayerStyle["radiusScale"] | undefined;
  lineWidthScale?: LayerStyle["lineWidthScale"] | undefined;
};

export type HoverInfo = {
  x: number;
  y: number;
  features: maplibregl.MapGeoJSONFeature[];
  layerLabel?: string | undefined;
  selectedIndex: number;
  isPinned?: boolean;
  lngLat?: { lng: number; lat: number }; // Geographic coordinates for pinned popups
};

export type ColorScheme = {
  id: string;
  label: string;
  interpolator: (t: number) => string;
};
