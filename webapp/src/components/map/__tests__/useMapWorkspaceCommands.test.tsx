import { describe, expect, it, vi } from "vitest";
import { buildQueryMvtLayer } from "../multiLayerSources";
import { fitMapWhenReady, resolveCameraLayerBounds, waitForMapMovement } from "../useMapWorkspaceCommands";

vi.mock("maplibre-gl", () => ({
  default: {
    Map: vi.fn(),
    addProtocol: vi.fn(),
  },
}));

describe("useMapWorkspaceCommands", () => {
  it("fits known bounds once the style is ready even while map tiles are loading", () => {
    const map = {
      loaded: () => false,
      isStyleLoaded: () => true,
      once: vi.fn(),
      fitBounds: vi.fn(),
    };

    fitMapWhenReady(map, [-80, 37, -70, 44]);

    expect(map.fitBounds).toHaveBeenCalledWith([-80, 37, -70, 44], { padding: 48, duration: 0 });
    expect(map.once).not.toHaveBeenCalled();
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

  it("waits for map readiness before fitting initial or first-layer bounds", () => {
    let styleLoadListener: (() => void) | undefined;
    const map = {
      isStyleLoaded: () => false,
      once: (event: "style.load", listener: () => void) => {
        if (event === "style.load") styleLoadListener = listener;
      },
      fitBounds: vi.fn(),
    };

    fitMapWhenReady(map, [-78, 38, -76, 40]);
    expect(map.fitBounds).not.toHaveBeenCalled();
    styleLoadListener?.();
    expect(map.fitBounds).toHaveBeenCalledWith([-78, 38, -76, 40], { padding: 48, duration: 0 });
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
