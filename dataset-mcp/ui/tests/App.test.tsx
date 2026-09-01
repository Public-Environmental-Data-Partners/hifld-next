import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { MapConfiguration } from "../src/mcp/contracts";

const useMcpApp = vi.hoisted(() => vi.fn());
vi.mock("../src/mcp/useMcpApp", () => ({ useMcpApp }));
vi.mock("../src/components/MapView", () => ({
  MapView: () => <section aria-label="Dataset map">Map view</section>,
}));

const mapConfiguration: MapConfiguration = {
  title: "State capitols",
  basemap: "street",
  worker_url: "https://maps.example.test/assets/maplibre-gl-worker.mjs",
  layers: [
    {
      query_id: "capitolsquery123456789AB",
      query_token: "signed-capitols",
      layer_name: "Capitols",
      tile_url:
        "https://maps.example.test/tiles/capitolsquery123456789AB/{z}/{x}/{y}.mvt",
      source_layer: "hifld",
      geometry_column: "geometry",
      result_crs: "EPSG:4326",
      columns: [],
      visible: true,
    },
  ],
};

function state(
  overrides: {
    mapConfiguration?: MapConfiguration | null;
    queryTokens?: Record<string, string>;
    error?: string | null;
  } = {},
) {
  return {
    app: null,
    error: null,
    mapConfiguration: null,
    queryTokens: {},
    ...overrides,
  };
}

describe("Query map app", () => {
  beforeEach(() => useMcpApp.mockReset());
  afterEach(cleanup);

  it("renders the title above the map for a valid map result", () => {
    useMcpApp.mockReturnValue(
      state({
        mapConfiguration,
        queryTokens: { capitolsquery123456789AB: "signed-token" },
      }),
    );

    render(<App />);

    expect(screen.getByRole("region", { name: "Dataset map" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "State capitols" }),
    ).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("shows a quiet loading state before the host provides a map", () => {
    useMcpApp.mockReturnValue(state());

    render(<App />);

    expect(screen.getByRole("status")).toHaveTextContent(/waiting for map/i);
  });

  it("shows the host error instead of mounting a map", () => {
    useMcpApp.mockReturnValue(state({ error: "Query has no geometry" }));

    render(<App />);

    expect(screen.getByRole("alert")).toHaveTextContent(/no geometry/i);
    expect(
      screen.queryByRole("region", { name: "Dataset map" }),
    ).not.toBeInTheDocument();
  });
});
