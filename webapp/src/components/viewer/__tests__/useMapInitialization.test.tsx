import { describe, expect, it, vi } from "vitest";
import { getVectorLayers, handleMapClick } from "../useMapInitialization";

vi.mock("maplibre-gl", () => ({
  default: {
    Map: vi.fn(),
    addProtocol: vi.fn(),
  },
}));

function mockMapWithFeatures(features: unknown[]) {
  return {
    queryRenderedFeatures: vi.fn(() => features),
  };
}

describe("useMapInitialization helpers", () => {
  it("extracts vector layer metadata", () => {
    expect(
      getVectorLayers({
        vector_layers: [
          { id: "test-layer", fields: { name: "String", id: "Number" } },
          { fields: { ignored: "String" } },
        ],
      }),
    ).toEqual([{ id: "test-layer", fields: ["name", "id"] }]);
  });

  it("pins a popup when clicking a rendered feature", () => {
    const onPinnedPopup = vi.fn();
    const features = [
      {
        type: "Feature",
        properties: { name: "Test" },
        layer: { id: "test-layer" },
      },
    ];
    const map = mockMapWithFeatures(features);

    handleMapClick({
      map,
      point: { x: 100, y: 200 },
      lngLat: { lng: 0, lat: 1 },
      interactiveLayerIds: ["test-layer"],
      onPinnedPopup,
    });

    expect(map.queryRenderedFeatures).toHaveBeenCalledWith({ x: 100, y: 200 }, { layers: ["test-layer"] });
    expect(onPinnedPopup).toHaveBeenCalledWith({
      x: 100,
      y: 200,
      features,
      selectedIndex: 0,
      isPinned: true,
      lngLat: { lng: 0, lat: 1 },
    });
  });

  it("clears pinned popup when clicking empty map space", () => {
    const onPinnedPopup = vi.fn();
    const map = mockMapWithFeatures([]);

    handleMapClick({
      map,
      point: { x: 100, y: 200 },
      lngLat: { lng: 0, lat: 1 },
      interactiveLayerIds: ["test-layer"],
      onPinnedPopup,
    });

    expect(onPinnedPopup).toHaveBeenCalledWith(null);
  });

  it("does nothing when no pinned callback is provided", () => {
    const map = mockMapWithFeatures([{ type: "Feature" }]);

    handleMapClick({
      map,
      point: { x: 100, y: 200 },
      lngLat: { lng: 0, lat: 1 },
      interactiveLayerIds: ["test-layer"],
      onPinnedPopup: undefined,
    });

    expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
  });
});
