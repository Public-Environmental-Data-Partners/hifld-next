import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { MapOptions } from "maplibre-gl";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MapView,
  type MapViewProps,
  mapTileRequest,
  normalizeMapConfiguration,
} from "../src/components/MapView";

const mapConstructor = vi.hoisted(() => vi.fn());

vi.mock("maplibre-gl", () => ({
  Map: class MapMock {
    constructor(options: MapOptions) {
      mapConstructor(options);
    }
    once(_event: string, listener: () => void) {
      listener();
      return this;
    }
    on() {
      return this;
    }
    fitBounds() {
      return this;
    }
    remove() {}
    stop() {}
    triggerRepaint() {}
    queryRenderedFeatures() {
      return [];
    }
  },
  setWorkerUrl: vi.fn(),
}));

afterEach(() => {
  cleanup();
  mapConstructor.mockClear();
});

const baseProps: MapViewProps = {
  configuration: {
    tile_url: "https://maps.example/tiles/{z}/{x}/{y}.mvt",
    worker_url: "https://maps.example/assets/maplibre-gl-worker.mjs",
    source_layer: "hifld",
    geometry_column: "geometry",
    result_crs: "EPSG:4326",
    initial_bounds: [-80, 35, -75, 40],
  },
  queryToken: "signed-query-token",
  app: null,
};

describe("MapView", () => {
  it("adds the query token only to tile requests", () => {
    const request = mapTileRequest(
      "https://maps.example/tiles/2/1/3.mvt",
      "token",
    );
    expect(request).toEqual({
      url: "https://maps.example/tiles/2/1/3.mvt",
      headers: { "X-HIFLD-Query-Token": "token" },
    });
    expect(mapTileRequest("https://maps.example/style.json", "token")).toEqual({
      url: "https://maps.example/style.json",
    });
  });

  it("requires an absolute tile URL from map configuration", () => {
    render(
      <MapView
        {...baseProps}
        configuration={{
          tile_url: "/tiles/{z}/{x}/{y}.mvt",
          worker_url: "https://maps.example/assets/maplibre-gl-worker.mjs",
          source_layer: "hifld",
          geometry_column: "geometry",
          result_crs: "EPSG:4326",
        }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/map configuration/i);
  });

  it("rejects relative asset paths instead of resolving a secondary contract", () => {
    expect(
      normalizeMapConfiguration({
        tile_url: "/tiles/{z}/{x}/{y}.mvt",
        worker_url: "/assets/maplibre-gl-worker.mjs",
        source_layer: "hifld",
        geometry_column: "geometry",
        result_crs: "EPSG:4326",
      }),
    ).toBeNull();
  });

  it("accepts a map configuration without a geometry type", () => {
    expect(
      normalizeMapConfiguration({
        tile_url: "https://maps.example/tiles/{z}/{x}/{y}.mvt",
        worker_url: "https://maps.example/assets/maplibre-gl-worker.mjs",
        source_layer: "hifld",
        geometry_column: "geometry",
        result_crs: "EPSG:4326",
      }),
    ).toMatchObject({
      tile_url: "https://maps.example/tiles/{z}/{x}/{y}.mvt",
      source_layer: "hifld",
    });
  });

  it("uses dataset bounds before MapLibre requests its first tile", () => {
    render(<MapView {...baseProps} />);

    const options = mapConstructor.mock.calls[0]?.[0];
    expect(options).toMatchObject({
      bounds: [-80, 35, -75, 40],
      fitBoundsOptions: { padding: 24 },
    });
    expect(options).not.toHaveProperty("center");
    expect(options).not.toHaveProperty("zoom");
  });

  it("does not render an alternate feature-data path", () => {
    render(<MapView {...baseProps} />);

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/compatibility mode/i)).not.toBeInTheDocument();
  });

  it("renders clear configuration errors", () => {
    render(<MapView {...baseProps} configuration={null} />);
    expect(screen.getByRole("status")).toHaveTextContent(/map configuration/i);
  });

  it("pauses rendering while the document is hidden", async () => {
    render(<MapView {...baseProps} />);
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() =>
      expect(screen.getAllByRole("status").length).toBeGreaterThan(0),
    );
  });
});
