import {
  type CategoryRegistry,
  type CategoryValue,
  categoricalStyle,
  chooseLayerPalette,
  extendCategoryRegistry,
  solidPaletteColor,
} from "@hifld/map-core";
import type { LayerStyle, LayerStylesById, VectorLayerInfo } from "./types";
import { buildColorExpression, DEFAULT_STYLE, getColorRamp, getLegendItems, parseBreaks } from "./utils";

export interface FieldRegistries {
  [fieldName: string]: CategoryRegistry | undefined;
}
export interface LayerRegistries {
  [layerId: string]: FieldRegistries | undefined;
}
const EMPTY_REGISTRY: CategoryRegistry = { values: [], overflow: false };

export function colorMode(layer: VectorLayerInfo, style: LayerStyle): "numeric" | "categorical" {
  return (
    style.colorMode ??
    (layer.numericFields.some((field) => field.name === style.colorProperty) ? "numeric" : "categorical")
  );
}

export function initializeLayerStyles(layers: VectorLayerInfo[], previous: LayerStylesById): LayerStylesById {
  const next: LayerStylesById = {};
  for (const layer of layers) if (previous[layer.id]) next[layer.id] = previous[layer.id];
  const used = Object.values(next).flatMap((style) => (style ? [style.colorScheme] : []));
  let changed = Object.keys(previous).length !== Object.keys(next).length;
  for (const layer of layers) {
    if (next[layer.id]) continue;
    const scheme = chooseLayerPalette(used);
    next[layer.id] = { ...DEFAULT_STYLE, colorScheme: scheme };
    used.push(scheme);
    changed = true;
  }
  return changed ? next : previous;
}

export function updateCategoryRegistries(
  previous: LayerRegistries,
  layers: VectorLayerInfo[],
  styles: LayerStylesById,
  sample: (layer: VectorLayerInfo, property: string) => CategoryValue[],
): LayerRegistries {
  const next: LayerRegistries = {};
  let changed = Object.keys(previous).some((id) => !layers.some((layer) => layer.id === id));
  for (const layer of layers) {
    const fields = previous[layer.id];
    if (fields) next[layer.id] = fields;
    const style = styles[layer.id];
    if (!style?.colorProperty || colorMode(layer, style) !== "categorical") continue;
    const field = layer.scalarFields?.find((entry) => entry.name === style.colorProperty);
    if (!field) continue;
    const before = fields?.[field.name];
    const seeded = extendCategoryRegistry(before ?? EMPTY_REGISTRY, field.values, field.type);
    const registry = extendCategoryRegistry(seeded, sample(layer, field.name), field.type);
    if (before === registry) continue;
    next[layer.id] = { ...fields, [field.name]: registry };
    changed = true;
  }
  return changed ? next : previous;
}

export function resolveLayerColor(layer: VectorLayerInfo, style: LayerStyle, registries?: FieldRegistries) {
  if (!style.colorProperty) {
    const color = solidPaletteColor(style.colorScheme);
    return { color, items: [{ label: "All values", color }], notes: [] as string[] };
  }
  if (colorMode(layer, style) === "categorical") {
    const field = layer.scalarFields?.find((entry) => entry.name === style.colorProperty);
    const registry =
      registries?.[style.colorProperty] ??
      extendCategoryRegistry(EMPTY_REGISTRY, field?.values ?? [], field?.type ?? "string");
    const resolved = categoricalStyle(style.colorProperty, registry, field?.type ?? "string", style.colorScheme);
    return {
      ...resolved,
      notes: [
        field?.values.length
          ? "Dictionary values supplemented by loaded features; not a complete inventory."
          : "Based on loaded features; not a complete inventory.",
        ...(registry.values.length ? [] : ["No category values available yet."]),
        ...resolved.notes,
      ],
    };
  }
  const breaks = style.breaksText.trim() ? parseBreaks(style.breaksText) : [];
  const colors = getColorRamp(style.colorScheme, breaks.length + 1);
  return {
    color: buildColorExpression(style.colorProperty, breaks, colors),
    items: getLegendItems(breaks, colors),
    notes: [] as string[],
  };
}
