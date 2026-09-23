import { act, renderHook } from "@testing-library/react";
import type maplibregl from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";
import { useCategoryRegistries } from "../useCategoryRegistries";
import { DEFAULT_STYLE } from "../utils";
import type { VectorLayerInfo } from "../types";

describe("category discovery lifecycle", () => {
  it("discovers on idle, preserves slots and state identity, and unsubscribes", () => {
    let idle: (() => void) | undefined;
    let values = ["AE", "A"];
    const map = {
      getSource: () => ({}),
      querySourceFeatures: vi.fn(() => values.map(zone => ({ properties: { zone } }))),
      on: vi.fn((_event, callback) => { idle = callback; }),
      off: vi.fn(),
    };
    const mapRef = { current: map as unknown as maplibregl.Map };
    const layer: VectorLayerInfo = { id: "zones", mapSourceId: "source-zones", sourceLayerId: "polygons", fields: ["zone"], numericFields: [], scalarFields: [{ name: "zone", type: "string", values: ["AE", "X"] }] };
    const styles = { zones: { ...DEFAULT_STYLE, colorProperty: "zone" } };
    const { result, unmount, rerender } = renderHook(({ layers }) => useCategoryRegistries(mapRef, layers, styles), { initialProps: { layers: [layer] } });
    expect(result.current.zones?.zone?.values).toEqual(["AE", "X", "A"]);
    expect(map.querySourceFeatures).toHaveBeenCalledWith("source-zones", { sourceLayer: "polygons" });
    values = ["B", "A"];
    act(() => idle?.());
    expect(result.current.zones?.zone?.values).toEqual(["AE", "X", "A", "B"]);
    const previous = result.current;
    act(() => idle?.());
    expect(result.current).toBe(previous);
    values = [...Array.from({ length: 5001 }, () => "AE"), "late category"];
    act(() => idle?.());
    expect(result.current.zones?.zone?.values).toContain("late category");
    rerender({ layers: [] });
    expect(result.current).toEqual({});
    unmount();
    expect(map.off).toHaveBeenCalledWith("idle", expect.any(Function));
  });
});
