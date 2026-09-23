import { describe, expect, it } from "vitest";
import { initializeLayerStyles, resolveLayerColor, updateCategoryRegistries } from "../layerColorStyle";
import type { VectorLayerInfo } from "../types";
import { DEFAULT_STYLE } from "../utils";

const layer: VectorLayerInfo = { id: "zones", fields: ["zone", "other"], numericFields: [], scalarFields: [
  { name: "zone", type: "string", values: ["AE", "X"] }, { name: "other", type: "string", values: [] },
] };
const style = { ...DEFAULT_STYLE, colorProperty: "zone", colorMode: "categorical" as const };

describe("layer color state", () => {
  it("allocates distinct palettes atomically and ignores removed styles", () => {
    const layers = [layer, { ...layer, id: "two" }, { ...layer, id: "hidden" }];
    const result = initializeLayerStyles(layers, { removed: DEFAULT_STYLE });
    expect(new Set(Object.values(result).map(value => value?.colorScheme)).size).toBe(3);
    expect(result.zones?.colorScheme).toBe("viridis");
    expect(result.removed).toBeUndefined();
    expect(initializeLayerStyles(layers, result)).toBe(result);
    const manual = { ...result, zones: { ...style, colorScheme: "set3" } };
    expect(initializeLayerStyles([...layers, { ...layer, id: "four" }], manual).zones).toBe(manual.zones);
  });

  it("retains slots across discovery and field switches and cleans removed layers", () => {
    const first = updateCategoryRegistries({}, [layer], { zones: style }, () => ["AE", "A"]);
    expect(first.zones?.zone?.values).toEqual(["AE", "X", "A"]);
    const next = updateCategoryRegistries(first, [layer], { zones: style }, () => ["B", "A"]);
    expect(next.zones?.zone?.values).toEqual(["AE", "X", "A", "B"]);
    expect(resolveLayerColor(layer, style, next.zones).items.slice(0,3)).toEqual(resolveLayerColor(layer, style, first.zones).items.slice(0,3));
    const other = updateCategoryRegistries(next, [layer], { zones: { ...style, colorProperty: "other" } }, () => ["new"]);
    expect(other.zones?.zone).toBe(next.zones?.zone);
    expect(updateCategoryRegistries(other, [layer], { zones: style }, () => ["B"])).toBe(other);
    expect(updateCategoryRegistries(other, [], {}, () => [])).toEqual({});
  });

  it("has a useful empty legend and states that loaded features are not a full inventory", () => {
    const result = resolveLayerColor(layer, { ...style, colorProperty: "other" }, {});
    expect(result.notes.join(" ")).toMatch(/loaded features/i);
    expect(result.notes.join(" ")).toMatch(/no.*values/i);
    expect(result.items.map(item => item.label)).toContain("No data");
  });
});
