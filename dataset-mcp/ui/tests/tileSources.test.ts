import { describe, expect, it } from "vitest";
import {
  resolveTileSource,
  validatePublicTileUrl,
} from "../src/components/tileSources";
import { type JsonValue, MapResultSchema } from "../src/mcp/contracts";

describe("explicit tile sources", () => {
  it.each<Record<string, JsonValue>>([
    { minzoom: 12, maxzoom: 3 },
    { bounds: [10, 20, -10, 30] },
    { tiles: ["https://tiles.example.com/static.pbf"] },
  ])("rejects invalid TileJSON ranges/templates %j", async (invalid) => {
    await expect(
      resolveTileSource(
        {
          type: "tilejson",
          url: "https://tiles.example.com/tiles.json",
          source_layer: "flood",
        },
        async () => ({
          tiles: ["https://tiles.example.com/{z}/{x}/{y}.pbf"],
          ...invalid,
        }),
      ),
    ).rejects.toThrow();
  });
  it("accepts an external-only map without query credentials or SQL", () => {
    const source = {
      type: "pmtiles",
      url: "https://tiles.example.com/flood.pmtiles",
    };
    expect(
      MapResultSchema.safeParse({
        title: "Flood",
        basemap: "street",
        worker_url: "https://maps.example.com/worker.js",
        layers: [
          {
            layer_id: "external-0",
            layer_name: "Flood",
            source,
            visible: true,
          },
        ],
        map_spec: {
          title: "Flood",
          basemap: "street",
          layers: [{ layer_name: "Flood", source, visible: true }],
        },
      }).success,
    ).toBe(true);
  });

  it.each([
    "http://example.com/a",
    "https://localhost/a",
    "https://127.0.0.1/a",
    "https://10.0.0.1/a",
    "https://user:pass@example.com/a",
    "https://example.com/a#fragment",
  ])("rejects unsafe URL %s", (url) => {
    expect(() => validatePublicTileUrl(url)).toThrow();
  });

  it("uses XYZ templates without fetching metadata", async () => {
    const resolved = await resolveTileSource({
      type: "vector_tiles",
      tiles: ["https://tiles.example.com/{z}/{x}/{y}.pbf"],
      source_layer: "flood",
      maxzoom: 12,
    });
    expect(resolved.source).toEqual({
      type: "vector",
      tiles: ["https://tiles.example.com/{z}/{x}/{y}.pbf"],
      minzoom: 0,
      maxzoom: 12,
    });
    expect(resolved.sourceLayer).toBe("flood");
  });

  it("infers a single TileJSON layer and keeps its zoom limits", async () => {
    const resolved = await resolveTileSource(
      { type: "tilejson", url: "https://tiles.example.com/tiles.json" },
      async () => ({
        tiles: ["https://tiles.example.com/{z}/{x}/{y}.pbf"],
        maxzoom: 11,
        vector_layers: [{ id: "flood", fields: { depth: "Number" } }],
      }),
    );
    expect(resolved.sourceLayer).toBe("flood");
    expect(resolved.source.maxzoom).toBe(11);
    expect(resolved.columns).toEqual([
      { name: "depth", type: "DOUBLE", nullable: true },
    ]);
  });

  it("requires source_layer for ambiguous TileJSON", async () => {
    await expect(
      resolveTileSource(
        { type: "tilejson", url: "https://tiles.example.com/tiles.json" },
        async () => ({
          tiles: ["https://tiles.example.com/{z}/{x}/{y}.pbf"],
          vector_layers: [{ id: "a" }, { id: "b" }],
        }),
      ),
    ).rejects.toThrow(/source_layer.*a.*b/);
  });

  it("validates nested TileJSON tile URLs", async () => {
    await expect(
      resolveTileSource(
        {
          type: "tilejson",
          url: "https://tiles.example.com/tiles.json",
          source_layer: "flood",
        },
        async () => ({ tiles: ["https://127.0.0.1/{z}/{x}/{y}.pbf"] }),
      ),
    ).rejects.toThrow(/public HTTPS/);
  });
});
