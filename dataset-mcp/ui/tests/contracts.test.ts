import { describe, expect, it } from "vitest";
import { ErrorResultSchema, MapResultSchema } from "../src/mcp/contracts";

const roadsId = "roadsquery1234567890ABCD";
const bridgesId = "bridgesquery123456789AB";

const mapResult = {
  title: "Transportation comparison",
  basemap: "street",
  worker_url: "https://maps.example.test/assets/maplibre-gl-worker.mjs",
  layers: [
    {
      query_id: roadsId,
      layer_name: "Roads",
      tile_url: `https://maps.example.test/tiles/${roadsId}/{z}/{x}/{y}.mvt`,
      source_layer: "hifld",
      geometry_column: "geometry",
      result_crs: "EPSG:4326",
      query_token: "signed-roads",
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      initial_bounds: [-80, 35, -75, 40],
      columns: [
        { name: "geometry", type: "GEOMETRY", nullable: false },
        { name: "traffic", type: "INTEGER", nullable: true },
      ],
      style: {
        color: "#2166ac",
        opacity: 0.7,
        color_property: "traffic",
        color_scheme: "viridis",
        breaks: [100, 500],
        point_radius_property: "traffic",
        point_radius_scale: "sqrt",
        line_width_property: "traffic",
        line_width_scale: "log",
      },
      visible: true,
    },
    {
      query_id: bridgesId,
      layer_name: "Bridges",
      tile_url: `https://maps.example.test/tiles/${bridgesId}/{z}/{x}/{y}.mvt`,
      source_layer: "hifld",
      geometry_column: "geometry",
      result_crs: "EPSG:4326",
      query_token: "signed-bridges",
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      columns: [
        { name: "geometry", type: "GEOMETRY", nullable: false },
        { name: "kind", type: "VARCHAR", nullable: true },
      ],
      visible: false,
    },
  ],
  map_spec: {
    title: "Transportation comparison",
    basemap: "street",
    layers: [
      {
        layer_name: "Roads",
        sources: [{ alias: "roads", file_id: 1 }],
        sql: "SELECT geometry, traffic FROM roads",
        color: "#2166ac",
        color_property: "traffic",
        visible: true,
      },
      {
        layer_name: "Bridges",
        sources: [{ alias: "bridges", file_id: 2 }],
        sql: "SELECT geometry, kind FROM bridges",
        visible: false,
      },
    ],
  },
};

describe("MCP multi-layer map contracts", () => {
  it("accepts named query layers with self-contained query tokens", () => {
    const result = MapResultSchema.parse(mapResult);

    expect(result.layers.map((layer) => layer.layer_name)).toEqual([
      "Roads",
      "Bridges",
    ]);
    expect(result.layers.map((layer) => layer.query_token)).toEqual([
      "signed-roads",
      "signed-bridges",
    ]);
  });

  it("rejects a layer without its query token", () => {
    expect(
      MapResultSchema.safeParse({
        ...mapResult,
        layers: [{ ...mapResult.layers[0], query_token: undefined }],
      }).success,
    ).toBe(false);
  });

  it("requires token expiry metadata and a replayable map definition", () => {
    expect(
      MapResultSchema.safeParse({ ...mapResult, map_spec: undefined }).success,
    ).toBe(false);
    expect(
      MapResultSchema.safeParse({
        ...mapResult,
        layers: [{ ...mapResult.layers[0], expires_at: undefined }],
      }).success,
    ).toBe(false);
  });

  it("requires human-readable map and layer names", () => {
    expect(
      MapResultSchema.safeParse({ ...mapResult, title: " " }).success,
    ).toBe(false);
    expect(
      MapResultSchema.safeParse({
        ...mapResult,
        layers: [{ ...mapResult.layers[0], layer_name: " " }],
      }).success,
    ).toBe(false);
  });

  it("rejects raw basemap URLs and unbounded style fields", () => {
    expect(
      MapResultSchema.safeParse({ ...mapResult, basemap: "bright" }).success,
    ).toBe(false);
    expect(
      MapResultSchema.safeParse({
        ...mapResult,
        layers: [
          { ...mapResult.layers[0], style: { expression: ["get", "secret"] } },
        ],
      }).success,
    ).toBe(false);
  });

  it("normalizes stable errors", () => {
    expect(
      ErrorResultSchema.parse({
        error: { code: "map_not_supported", message: "No map" },
      }).error.code,
    ).toBe("map_not_supported");
  });
});
