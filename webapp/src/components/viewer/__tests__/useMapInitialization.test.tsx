import { describe, expect, it, vi } from "vitest";
import {
  getVectorLayers,
  handleMapClick,
  removeInactiveMapSources,
  syncExistingRenderedLayers,
} from "../useMapInitialization";

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

  it("hides existing rendered layers with map layout visibility", () => {
    const map = {
      getStyle: vi.fn(() => ({
        layers: [
          { id: "source-layer-fill", type: "fill", source: "source-layer" },
          { id: "source-layer-line", type: "line", source: "source-layer" },
          { id: "osm-base", type: "raster", source: "osm-tiles" },
        ],
      })),
      setPaintProperty: vi.fn(),
      setLayoutProperty: vi.fn(),
    };

    const interactiveLayerIds = syncExistingRenderedLayers(map, {
      id: "layer",
      name: "Layer",
      descriptor: {
        collectionSlug: "hifld",
        datasetSlug: "dataset",
        fileSlug: "file",
        formatType: "pmtiles",
        storageLocationId: 1,
        version: "v1.0.0",
        sourceId: 1,
      },
      pmtilesUrl: "https://example.test/layer.pmtiles",
      mapSourceId: "source-layer",
      visible: false,
      opacity: 0.82,
    });

    expect(interactiveLayerIds).toEqual([]);
    expect(map.setLayoutProperty).toHaveBeenCalledWith("source-layer-fill", "visibility", "none");
    expect(map.setLayoutProperty).toHaveBeenCalledWith("source-layer-line", "visibility", "none");
    expect(map.setLayoutProperty).not.toHaveBeenCalledWith("osm-base", "visibility", "none");
  });

  it("removes inactive managed rendered layers and sources without touching active or base sources", () => {
    const managedSourceIds = new Set(["source-active", "source-stale"]);
    const map = {
      getLayer: vi.fn((layerId: string) => layerId !== "missing-layer"),
      getSource: vi.fn((sourceId: string) => (sourceId === "source-stale" || sourceId === "source-active" ? {} : undefined)),
      getStyle: vi.fn(() => ({
        sources: {
          "osm-tiles": { type: "raster" },
          "source-active": { type: "vector" },
          "source-stale": { type: "vector" },
          "external-source": { type: "vector" },
        },
        layers: [
          { id: "osm-base", type: "raster", source: "osm-tiles" },
          { id: "active-fill", type: "fill", source: "source-active" },
          { id: "stale-fill", type: "fill", source: "source-stale" },
          { id: "stale-line", type: "line", source: "source-stale" },
          { id: "external-fill", type: "fill", source: "external-source" },
        ],
      })),
      removeLayer: vi.fn(),
      removeSource: vi.fn(),
    };

    removeInactiveMapSources(map, new Set(["source-active"]), managedSourceIds);

    expect(map.removeLayer).toHaveBeenCalledWith("stale-fill");
    expect(map.removeLayer).toHaveBeenCalledWith("stale-line");
    expect(map.removeLayer).not.toHaveBeenCalledWith("active-fill");
    expect(map.removeLayer).not.toHaveBeenCalledWith("osm-base");
    expect(map.removeLayer).not.toHaveBeenCalledWith("external-fill");
    expect(map.removeSource).toHaveBeenCalledWith("source-stale");
    expect(map.removeSource).not.toHaveBeenCalledWith("source-active");
    expect(map.removeSource).not.toHaveBeenCalledWith("osm-tiles");
    expect(map.removeSource).not.toHaveBeenCalledWith("external-source");
    expect(managedSourceIds).toEqual(new Set(["source-active"]));
  });
});
