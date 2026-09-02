import { describe, expect, it, vi } from "vitest";
import { fitMapWhenReady, waitForMapMovement } from "../useMapWorkspaceCommands";

vi.mock("maplibre-gl", () => ({
  default: {
    Map: vi.fn(),
    addProtocol: vi.fn(),
  },
}));

describe("useMapWorkspaceCommands", () => {
  it("waits for map readiness before fitting initial or first-layer bounds", () => {
    let loadListener: (() => void) | undefined;
    const map = {
      loaded: () => false,
      once: (event: "load", listener: () => void) => {
        if (event === "load") loadListener = listener;
      },
      fitBounds: vi.fn(),
    };

    fitMapWhenReady(map, [-78, 38, -76, 40]);
    expect(map.fitBounds).not.toHaveBeenCalled();
    loadListener?.();
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
