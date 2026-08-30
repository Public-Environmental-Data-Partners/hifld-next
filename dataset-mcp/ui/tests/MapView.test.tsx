import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  MapView,
  type MapViewProps,
  mapTileRequest,
  normalizeMapConfiguration,
} from "../src/components/MapView";

afterEach(cleanup);

const baseProps: MapViewProps = {
  configuration: {
    tileUrl: "https://maps.example/tiles/{z}/{x}/{y}.mvt",
    workerUrl: "https://maps.example/assets/maplibre-gl.worker.js",
    geometryType: "Point",
    bounds: [-80, 35, -75, 40],
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
          tileUrl: "/tiles/{z}/{x}/{y}.mvt",
          geometryType: "Point",
        }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/map configuration/i);
  });

  it("resolves relative asset paths only against an explicit server origin", () => {
    expect(
      normalizeMapConfiguration({
        tileUrl: "/tiles/{z}/{x}/{y}.mvt",
        tileOrigin: "https://maps.example",
        workerUrl: "/assets/maplibre-gl.worker.js",
        geometryType: "Point",
      }),
    ).toMatchObject({
      tileUrl: "https://maps.example/tiles/{z}/{x}/{y}.mvt",
      workerUrl: "https://maps.example/assets/maplibre-gl.worker.js",
    });
  });

  it("uses the MVT encoder's default source layer", () => {
    expect(
      normalizeMapConfiguration({
        tileUrl: "https://maps.example/tiles/{z}/{x}/{y}.mvt",
        workerUrl: "https://maps.example/assets/maplibre-gl.worker.js",
        geometryType: "Point",
      })?.sourceLayer,
    ).toBe("hifld");
  });

  it("accepts a map configuration without a geometry type", () => {
    expect(
      normalizeMapConfiguration({
        tileUrl: "https://maps.example/tiles/{z}/{x}/{y}.mvt",
        workerUrl: "https://maps.example/assets/maplibre-gl-worker.mjs",
      }),
    ).toMatchObject({
      tileUrl: "https://maps.example/tiles/{z}/{x}/{y}.mvt",
      sourceLayer: "hifld",
    });
  });

  it("renders a bounded text alternative and clear configuration errors", () => {
    render(<MapView {...baseProps} configuration={null} />);
    expect(screen.getByRole("status")).toHaveTextContent(/map configuration/i);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("pauses rendering while the document is hidden", async () => {
    render(<MapView {...baseProps} />);
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() =>
      expect(screen.getAllByRole("status").length).toBeGreaterThan(0),
    );
  });
});
