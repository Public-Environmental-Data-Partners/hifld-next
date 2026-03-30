import { useEffect } from "react";
import type maplibregl from "maplibre-gl";
import type { VectorLayerInfo, LayerStyle } from "./types";
import {
  parseBreaks,
  getColorRamp,
  buildColorExpression,
  invertHexColor,
  getSampledValues,
  applyScale,
  getValueRange,
  DEFAULT_STYLE,
} from "./utils";

export function useLayerStyling(
  mapRef: React.RefObject<maplibregl.Map | null>,
  vectorLayers: VectorLayerInfo[],
  layerStyles: Record<string, LayerStyle>,
  setLayerStyles: React.Dispatch<React.SetStateAction<Record<string, LayerStyle>>>
) {
  // Initialize default styles for new layers
  useEffect(() => {
    if (!mapRef.current || vectorLayers.length === 0) return;
    setLayerStyles((prev) => {
      const next = { ...prev };
      vectorLayers.forEach((layer) => {
        if (!next[layer.id]) {
          next[layer.id] = { ...DEFAULT_STYLE };
        }
      });
      return next;
    });
  }, [vectorLayers, mapRef, setLayerStyles]);

  // Apply styles to map layers
  useEffect(() => {
    if (!mapRef.current) return;

    vectorLayers.forEach((layer) => {
      const style = layerStyles[layer.id];
      if (!style) return;

      const breaks = parseBreaks(style.breaksText);
      const colors = getColorRamp(style.colorScheme, breaks.length + 1);
      const outlineColors = colors.map(invertHexColor);
      const colorExpression = buildColorExpression(
        style.colorProperty,
        breaks,
        colors
      );
      const outlineExpression = buildColorExpression(
        style.colorProperty,
        breaks,
        outlineColors
      );
      const hoverOpacity = Math.max(0.05, style.opacity * 0.35);
      const opacityExpression: maplibregl.Expression = [
        "case",
        ["boolean", ["feature-state", "hover"], false],
        hoverOpacity,
        style.opacity,
      ];

      const fillId = `pmtiles-${layer.id}-fill`;
      const lineId = `pmtiles-${layer.id}-line`;
      const circleId = `pmtiles-${layer.id}-circle`;

      if (mapRef.current.getLayer(fillId)) {
        mapRef.current.setPaintProperty(fillId, "fill-color", colorExpression);
        mapRef.current.setPaintProperty(fillId, "fill-opacity", opacityExpression);
        mapRef.current.setPaintProperty(
          fillId,
          "fill-outline-color",
          outlineExpression
        );
      }

      if (mapRef.current.getLayer(lineId)) {
        mapRef.current.setPaintProperty(lineId, "line-color", colorExpression);
        mapRef.current.setPaintProperty(lineId, "line-opacity", opacityExpression);
        const lineWidth =
          style.lineWidthProperty && mapRef.current
            ? (() => {
                const values = getSampledValues(
                  mapRef.current!,
                  layer.id,
                  style.lineWidthProperty
                )
                  .map((value) => applyScale(value, style.lineWidthScale))
                  .filter((value) => Number.isFinite(value));
                const { min, max } = getValueRange(values);
                if (min === max) return style.lineWidth;
                const inputExpr =
                  style.lineWidthScale === "sqrt"
                    ? ["sqrt", ["max", ["to-number", ["get", style.lineWidthProperty]], 0]]
                    : style.lineWidthScale === "log"
                    ? ["ln", ["max", ["to-number", ["get", style.lineWidthProperty]], 1e-6]]
                    : ["to-number", ["get", style.lineWidthProperty]];
                return [
                  "interpolate",
                  ["linear"],
                  inputExpr,
                  min,
                  Math.max(1, style.lineWidth / 2),
                  max,
                  Math.max(1, style.lineWidth * 2),
                ];
              })()
            : style.lineWidth;
        mapRef.current.setPaintProperty(lineId, "line-width", lineWidth);
      }

      if (mapRef.current.getLayer(circleId)) {
        mapRef.current.setPaintProperty(circleId, "circle-color", colorExpression);
        mapRef.current.setPaintProperty(circleId, "circle-opacity", opacityExpression);
        mapRef.current.setPaintProperty(
          circleId,
          "circle-stroke-color",
          outlineExpression
        );
        mapRef.current.setPaintProperty(circleId, "circle-stroke-width", 1);
        const radius =
          style.radiusProperty && mapRef.current
            ? (() => {
                const values = getSampledValues(
                  mapRef.current!,
                  layer.id,
                  style.radiusProperty
                )
                  .map((value) => applyScale(value, style.radiusScale))
                  .filter((value) => Number.isFinite(value));
                const { min, max } = getValueRange(values);
                if (min === max) return style.radius;
                const inputExpr =
                  style.radiusScale === "sqrt"
                    ? ["sqrt", ["max", ["to-number", ["get", style.radiusProperty]], 0]]
                    : style.radiusScale === "log"
                    ? ["ln", ["max", ["to-number", ["get", style.radiusProperty]], 1e-6]]
                    : ["to-number", ["get", style.radiusProperty]];
                return [
                  "interpolate",
                  ["linear"],
                  inputExpr,
                  min,
                  Math.max(2, style.radius / 2),
                  max,
                  Math.max(2, style.radius * 2),
                ];
              })()
            : style.radius;
        mapRef.current.setPaintProperty(circleId, "circle-radius", radius);
      }
    });
  }, [layerStyles, vectorLayers, mapRef]);
}

