import { act, renderHook } from "@testing-library/react";
import type maplibregl from "maplibre-gl";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LayerStylesById } from "../../viewer/types";
import { DEFAULT_STYLE } from "../../viewer/utils";
import { buildQueryMvtLayer } from "../multiLayerSources";
import { resolveCameraLayerBounds, useMapWorkspaceCommands, waitForMapMovement } from "../useMapWorkspaceCommands";

vi.mock("maplibre-gl", () => ({
  default: {
    Map: vi.fn(),
    addProtocol: vi.fn(),
  },
}));

describe("useMapWorkspaceCommands", () => {
  it("preserves manual breaks on a palette-only update to an implicit numeric style", () => {
    const { result } = renderHook(() => {
      const [styles, setStyles] = useState<LayerStylesById>({
        stations: { ...DEFAULT_STYLE, colorProperty: "count", breaksText: "10, 20", breakMode: "manual" },
      });
      const commands = useMapWorkspaceCommands({
        mapRef: { current: null }, loadedLayers: [], setLoadedLayers: vi.fn(),
        vectorLayers: [{ id: "stations", fields: ["count"], numericFields: [{ name: "count", type: "Number" }] }],
        layerStyles: styles, setLayerStyles: setStyles,
        selectedFeatures: [], clearSelection: vi.fn(), basemapMode: "street", setBasemapMode: vi.fn(),
        resolveDatasetLayer: async () => null,
      });
      return { styles, commands };
    });
    act(() => result.current.commands.setLayerStyle("stations", { colorScheme: "plasma" }));
    expect(result.current.styles.stations?.breaksText).toBe("10, 20");
    expect(result.current.styles.stations?.breakMode).toBe("manual");
  });
  it.each([false, true])("preserves the camera with preloaded layers: %s", async (preloaded) => {
    const layer = buildQueryMvtLayer({
      queryId: "query_12345678901234567890",
      label: "Worldwide stations",
      sourceAliases: ["stations"],
      geometryColumn: "geometry",
      tileTemplate: "https://example.test/tiles/{z}/{x}/{y}.mvt",
      bounds: [-180, -80, 180, 80],
    });
    const map = {
      isStyleLoaded: () => true,
      fitBounds: vi.fn(),
      easeTo: vi.fn(),
      once: vi.fn(),
      getCenter: () => ({ lng: -77, lat: 39 }),
      getZoom: () => 8,
      getBearing: () => 0,
      getPitch: () => 0,
      isMoving: () => false,
    };
    const mapRef = { current: map as unknown as maplibregl.Map };
    const { result } = renderHook(() => {
      const [loadedLayers, setLoadedLayers] = useState(preloaded ? [layer] : []);
      return useMapWorkspaceCommands({
        mapRef, loadedLayers, setLoadedLayers,
        vectorLayers: [], layerStyles: {}, setLayerStyles: vi.fn(),
        selectedFeatures: [], clearSelection: vi.fn(),
        basemapMode: "street", setBasemapMode: vi.fn(),
        resolveDatasetLayer: async () => layer,
      });
    });
    if (!preloaded) {
      await act(async () => {
        await result.current.addDatasetLayer({ layerId: layer.id, label: layer.label, kind: layer.kind });
      });
    }
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.easeTo).not.toHaveBeenCalled();
    expect(map.once).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.setCamera({ target: { layerIds: [layer.id] } });
    });
    expect(map.fitBounds).toHaveBeenCalledWith(layer.bounds, { padding: 48 });
  });


  it("resolves missing query bounds before framing a layer target", async () => {
    const layer = buildQueryMvtLayer({
      queryId: "query_12345678901234567890",
      label: "Bay Area stations",
      sourceAliases: ["stations"],
      geometryColumn: "geometry",
      tileTemplate: "https://example.test/tiles/{z}/{x}/{y}.mvt",
    });
    const resolveLayerBounds = vi.fn().mockResolvedValue([-122.6, 37.1, -121.7, 38.0] as const);

    await expect(resolveCameraLayerBounds([layer], [layer.id], resolveLayerBounds)).resolves.toEqual([
      -122.6, 37.1, -121.7, 38.0,
    ]);
    expect(resolveLayerBounds).toHaveBeenCalledWith(layer);
  });


  it("resolves movement commands from moveend or a stable map error", async () => {
    let moveEndListener: (() => void) | undefined;
    let errorListener: (() => void) | undefined;
    const map = {
      getCenter: () => ({ lng: -77, lat: 39 }),
      getZoom: () => 8,
      getBearing: () => 0,
      getPitch: () => 0,
      isMoving: () => true,
      once: (event: "moveend" | "error", listener: () => void) => {
        if (event === "moveend") moveEndListener = listener;
        if (event === "error") errorListener = listener;
      },
      off: () => undefined,
    };

    const settled = waitForMapMovement(map);
    moveEndListener?.();
    await expect(settled).resolves.toEqual({ center: [-77, 39], zoom: 8, bearing: 0, pitch: 0 });
    expect(errorListener).toBeDefined();
  });

  it("rejects movement when the map reports a stable error", async () => {
    let errorListener: (() => void) | undefined;
    const map = {
      getCenter: () => ({ lng: -77, lat: 39 }),
      getZoom: () => 8,
      getBearing: () => 0,
      getPitch: () => 0,
      isMoving: () => true,
      once: (event: "moveend" | "error", listener: () => void) => {
        if (event === "error") errorListener = listener;
      },
      off: () => undefined,
    };

    const settled = waitForMapMovement(map);
    errorListener?.();
    await expect(settled).rejects.toThrow("Map movement failed.");
  });
});
