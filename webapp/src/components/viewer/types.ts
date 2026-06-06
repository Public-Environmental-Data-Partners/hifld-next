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
