import type maplibregl from "maplibre-gl";
import { useEffect } from "react";
import { colorMode, type FieldRegistries, initializeLayerStyles, resolveLayerColor } from "./layerColorStyle";
import type { LayerStyle, LayerStylesById, VectorLayerInfo } from "./types";
import { useCategoryRegistries } from "./useCategoryRegistries";
import {
  applyScale,
  buildColorExpression,
  getColorRamp,
  getSampledValues,
  getValueRange,
  invertHexColor,
  type PaintValue,
  parseBreaks,
  type StyleExpression,
} from "./utils";

function buildScaledExpression(
  map: maplibregl.Map,
  layerId: string,
  property: string | null,
  scale: LayerStyle["radiusScale"],
  baseValue: number,
  minimumValue: number,
  sourceId: string,
): PaintValue {
  if (!property) {
    return baseValue;
  }

  const values = getSampledValues(map, layerId, property, 5000, sourceId)
    .map((value) => applyScale(value, scale))
    .filter((value) => Number.isFinite(value));
  const { min, max } = getValueRange(values);
  if (min === max) {
    return baseValue;
  }

  const inputExpression: StyleExpression =
    scale === "sqrt"
      ? ["sqrt", ["max", ["to-number", ["get", property]], 0]]
      : scale === "log"
        ? ["ln", ["max", ["to-number", ["get", property]], 1e-6]]
        : ["to-number", ["get", property]];

  return [
    "interpolate",
    ["linear"],
    inputExpression,
    min,
    Math.max(minimumValue, baseValue / 2),
    max,
    Math.max(minimumValue, baseValue * 2),
  ];
}

function applyLayerStyle(map: maplibregl.Map, layer: VectorLayerInfo, style: LayerStyle, registries?: FieldRegistries) {
  const colorExpression = resolveLayerColor(layer, style, registries).color;
  const breaks = parseBreaks(style.breaksText);
  const outlineExpression =
    typeof colorExpression === "string"
      ? invertHexColor(colorExpression)
      : colorMode(layer, style) === "categorical"
        ? "#374151"
        : buildColorExpression(
            style.colorProperty,
            breaks,
            getColorRamp(style.colorScheme, breaks.length + 1).map(invertHexColor),
          );
  const hoverOpacity = Math.max(0.05, style.opacity * 0.35);
  const opacityExpression: StyleExpression = [
    "case",
    ["boolean", ["feature-state", "hover"], false],
    hoverOpacity,
    style.opacity,
  ];

  const sampleLayerId = layer.sourceLayerId ?? layer.id;
  const baseLayerId = layer.mapLayerBaseId ?? `pmtiles-${layer.id}`;
  const fillId = `${baseLayerId}-fill`;
  const lineId = `${baseLayerId}-line`;
  const circleId = `${baseLayerId}-circle`;

  if (map.getLayer(fillId)) {
    map.setPaintProperty(fillId, "fill-color", colorExpression);
    map.setPaintProperty(fillId, "fill-opacity", opacityExpression);
    map.setPaintProperty(fillId, "fill-outline-color", outlineExpression);
  }

  if (map.getLayer(lineId)) {
    const lineWidth = buildScaledExpression(
      map,
      sampleLayerId,
      style.lineWidthProperty,
      style.lineWidthScale,
      style.lineWidth,
      1,
      layer.mapSourceId ?? "pmtiles",
    );
    map.setPaintProperty(lineId, "line-color", colorExpression);
    map.setPaintProperty(lineId, "line-opacity", opacityExpression);
    map.setPaintProperty(lineId, "line-width", lineWidth);
  }

  if (map.getLayer(circleId)) {
    const radius = buildScaledExpression(
      map,
      sampleLayerId,
      style.radiusProperty,
      style.radiusScale,
      style.radius,
      2,
      layer.mapSourceId ?? "pmtiles",
    );
    map.setPaintProperty(circleId, "circle-color", colorExpression);
    map.setPaintProperty(circleId, "circle-opacity", opacityExpression);
    map.setPaintProperty(circleId, "circle-stroke-color", outlineExpression);
    map.setPaintProperty(circleId, "circle-stroke-width", 1);
    map.setPaintProperty(circleId, "circle-radius", radius);
  }
}

export function useLayerStyling(
  mapRef: React.RefObject<maplibregl.Map | null>,
  vectorLayers: VectorLayerInfo[],
  layerStyles: LayerStylesById,
  setLayerStyles: React.Dispatch<React.SetStateAction<LayerStylesById>>,
) {
  const registries = useCategoryRegistries(mapRef, vectorLayers, layerStyles);
  // Initialize default styles for new layers
  useEffect(() => {
    setLayerStyles((prev) => initializeLayerStyles(vectorLayers, prev));
  }, [vectorLayers, setLayerStyles]);

  // Apply styles to map layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const layer of vectorLayers) {
      const style = layerStyles[layer.id];
      if (style) {
        applyLayerStyle(map, layer, style, registries[layer.id]);
      }
    }
  }, [layerStyles, vectorLayers, mapRef, registries]);
  return registries;
}
