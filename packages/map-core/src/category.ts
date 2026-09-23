import {
  colorSchemes,
  getColorRamp,
  type ColorSchemeId,
  type LegendItem,
  type PaintValue,
  type StyleExpression,
} from "./style";

export type CategoryValue = string | number | boolean;
export type CategoryFieldType = "string" | "number" | "boolean";

export interface CategoryRegistry {
  values: CategoryValue[];
  overflow: boolean;
}

export interface CategoricalStyle {
  color: PaintValue;
  items: LegendItem[];
  notes: string[];
}

export const CATEGORY_CAP = 32;
export const NO_DATA_COLOR = "#d1d5db";
export const OTHER_VALUES_COLOR = "#6b7280";

const PALETTE_PREFERENCE: readonly ColorSchemeId[] = [
  "viridis",
  "plasma",
  "blues",
  "greens",
  "oranges",
  "purples",
  "rdyblu",
  "rdyg",
  "tableau10",
  "set3",
];

export function normalizeCategory(value: CategoryValue, type: CategoryFieldType): CategoryValue | undefined {
  if (type === "string") {
    const normalized = String(value);
    return normalized.length === 0 ? undefined : normalized;
  }
  if (type === "number") {
    if (typeof value === "string" && value.length === 0) return undefined;
    const normalized = typeof value === "number" ? value : Number(value);
    return Number.isFinite(normalized) ? normalized : undefined;
  }
  if (value === true || value === false) return value;
  const normalized = String(value).toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return undefined;
}

function categoryKey(value: CategoryValue): string {
  return `${typeof value}:${String(value)}`;
}

function compareCategories(left: CategoryValue, right: CategoryValue): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  const leftText = String(left);
  const rightText = String(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}

export function extendCategoryRegistry(
  previous: CategoryRegistry,
  values: readonly CategoryValue[],
  type: CategoryFieldType,
): CategoryRegistry {
  const known = new Set(previous.values.map(categoryKey));
  const unseen = new Map<string, CategoryValue>();
  for (const value of values) {
    const normalized = normalizeCategory(value, type);
    if (normalized === undefined) continue;
    const key = categoryKey(normalized);
    if (!known.has(key)) unseen.set(key, normalized);
  }
  if (unseen.size === 0) return previous;

  const sorted = [...unseen.values()].sort(compareCategories);
  const available = Math.max(0, CATEGORY_CAP - previous.values.length);
  const appended = sorted.slice(0, available);
  const overflow = previous.overflow || sorted.length > available;
  if (appended.length === 0 && overflow === previous.overflow) return previous;
  return { values: [...previous.values, ...appended], overflow };
}

function categoricalSwatches(schemeId: string): readonly string[] {
  const scheme = colorSchemes.find((candidate) => candidate.id === schemeId);
  return scheme?.categoricalSwatches ?? getColorRamp(scheme?.id ?? "viridis", 9);
}

function numericSentinel(values: readonly CategoryValue[]): number {
  const numbers = new Set(values.filter((value): value is number => typeof value === "number"));
  let sentinel = Number.MIN_SAFE_INTEGER;
  while (numbers.has(sentinel)) sentinel += 1;
  return sentinel;
}

function categoryInput(
  property: string,
  type: CategoryFieldType,
  values: readonly CategoryValue[],
): StyleExpression {
  const value: StyleExpression = ["get", property];
  if (type === "number") return ["to-string", ["to-number", value, numericSentinel(values)]];
  if (type === "boolean") return ["downcase", ["to-string", value]];
  return ["to-string", value];
}

function categoryLabel(value: CategoryValue): string {
  return String(value);
}

export function categoricalStyle(
  property: string,
  registry: CategoryRegistry,
  type: CategoryFieldType,
  scheme: string,
): CategoricalStyle {
  const swatches = categoricalSwatches(scheme);
  const match: Array<string | number | boolean | StyleExpression> = [
    "match",
    categoryInput(property, type, registry.values),
  ];
  const items: LegendItem[] = registry.values.map((value, index) => {
    const color = swatches[index % swatches.length] ?? OTHER_VALUES_COLOR;
    const label = categoryLabel(value);
    match.push(type === "string" ? value : label, color);
    return { label, color };
  });
  match.push(OTHER_VALUES_COLOR);

  const missing: StyleExpression = [
    "any",
    ["!", ["has", property]],
    ["==", ["get", property], null],
    ["==", ["to-string", ["get", property]], ""],
  ];
  const classified: string | StyleExpression = registry.values.length === 0 ? OTHER_VALUES_COLOR : match;
  const color: StyleExpression = ["case", missing, NO_DATA_COLOR, classified];
  items.push(
    { label: "Other values", color: OTHER_VALUES_COLOR },
    { label: "No data", color: NO_DATA_COLOR },
  );

  const notes: string[] = [];
  if (registry.overflow) {
    notes.push("Showing the first 32 categories; additional categories use Other values.");
  }
  if (registry.values.length > swatches.length) {
    notes.push("Palette colors are reused for some categories.");
  }
  return { color, items, notes };
}

export function chooseLayerPalette(used: readonly string[]): ColorSchemeId {
  const counts = new Map<ColorSchemeId, number>(PALETTE_PREFERENCE.map((scheme) => [scheme, 0]));
  for (const scheme of used) {
    if (!PALETTE_PREFERENCE.includes(scheme as ColorSchemeId)) continue;
    const id = scheme as ColorSchemeId;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let selected = PALETTE_PREFERENCE[0] ?? "viridis";
  for (const scheme of PALETTE_PREFERENCE) {
    if ((counts.get(scheme) ?? 0) < (counts.get(selected) ?? 0)) selected = scheme;
  }
  return selected;
}

export function solidPaletteColor(scheme: string): string {
  const selected = colorSchemes.find((candidate) => candidate.id === scheme) ?? colorSchemes[4];
  if (!selected) return "#21918c";
  if (selected.id === "rdyblu" || selected.id === "rdyg") return selected.interpolator(1);
  return selected.categoricalSwatches?.[0] ?? selected.interpolator(0.5);
}
