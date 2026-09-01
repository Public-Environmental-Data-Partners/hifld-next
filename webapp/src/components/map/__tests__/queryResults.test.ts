import { describe, expect, it } from "vitest";
import { appendQueryPage, canSetQueryResultPage, publicQueryPage, queryLayerFromResult, queryResultState } from "../queryResults";

const token = "query-token-must-never-be-public";

describe("query result workspace state", () => {
  it("appends a subsequent page while retaining the accumulated rows", () => {
    const first = publicQueryPage({
      query_id: "QwErTyUiOpAsDfGhJkLzXcVb", query_token: token,
      columns: [{ name: "name", type: "VARCHAR", nullable: false }], rows: [{ name: "A" }],
      offset: 0, limit: 1, returned_count: 1, has_more: true, warnings: [], elapsed_ms: 1,
      bytes_read: 1, files_read: 1, response_truncated: false, deterministic_order: true,
    });
    const next = publicQueryPage({ ...first, query_token: "next", offset: 1, rows: [{ name: "B" }], returned_count: 1, has_more: false });
    expect(appendQueryPage(first, next)).toMatchObject({ offset: 0, rows: [{ name: "A" }, { name: "B" }], returned_count: 2 });
  });
  it("replaces accumulated rows when the next page is not contiguous", () => {
    const first = publicQueryPage({
      query_id: "QwErTyUiOpAsDfGhJkLzXcVb", query_token: token,
      columns: [{ name: "name", type: "VARCHAR", nullable: false }], rows: [{ name: "A" }],
      offset: 0, limit: 100, returned_count: 1, has_more: true, warnings: [], elapsed_ms: 1,
      bytes_read: 1, files_read: 1, response_truncated: false, deterministic_order: true,
    });
    const gapped = publicQueryPage({
      ...first, query_token: "next", offset: 500, rows: [{ name: "Page 500" }],
      returned_count: 1, has_more: false,
    });
    expect(appendQueryPage(first, gapped)).toEqual(gapped);
  });
  it("removes the private query token before retaining a page for UI rendering", () => {
    const page = publicQueryPage({
      query_id: "QwErTyUiOpAsDfGhJkLzXcVb",
      query_token: token,
      columns: [{ name: "name", type: "VARCHAR", nullable: false }],
      rows: [{ name: "Hospital" }],
      offset: 0,
      limit: 100,
      returned_count: 1,
      has_more: false,
      warnings: [],
      elapsed_ms: 12,
      bytes_read: 42,
      files_read: 1,
      response_truncated: false,
      deterministic_order: true,
    });

    expect(JSON.stringify(page)).not.toContain(token);
    expect(page.query_id).toBe("QwErTyUiOpAsDfGhJkLzXcVb");
  });

  it("creates an MVT query layer without carrying a token", () => {
    const layer = queryLayerFromResult({
      query_id: "QwErTyUiOpAsDfGhJkLzXcVb",
      query_token: token,
      columns: [
        { name: "name", type: "VARCHAR", nullable: false },
        { name: "__hifld_feature_key", type: "VARCHAR", nullable: false },
        { name: "__hifld_centroid_lng", type: "DOUBLE", nullable: true },
        { name: "geom", type: "GEOMETRY", nullable: true },
      ],
      rows: [],
      offset: 0,
      limit: 100,
      returned_count: 0,
      has_more: false,
      warnings: [],
      elapsed_ms: 12,
      bytes_read: 42,
      files_read: 1,
      response_truncated: false,
      deterministic_order: true,
      map_configuration: {
        tile_url: "https://example.test/api/queries/QwErTyUiOpAsDfGhJkLzXcVb/tiles/{z}/{x}/{y}.mvt",
        worker_url: "https://example.test/assets/maplibre-gl-worker.mjs",
        source_layer: "hifld",
        geometry_column: "geom",
        result_crs: "EPSG:4326",
      },
    });

    expect(layer?.kind).toBe("query_mvt");
    expect(JSON.stringify(layer)).not.toContain(token);
    expect(layer?.scalarFields).toEqual([{ name: "name", logicalType: "VARCHAR", nullable: false }]);
  });

  it("keeps result-page navigation available after moving beyond the first page", () => {
    expect(canSetQueryResultPage({ has_more: false, offset: 0 })).toBe(false);
    expect(canSetQueryResultPage({ has_more: true, offset: 0 })).toBe(true);
    expect(canSetQueryResultPage({ has_more: false, offset: 100 })).toBe(true);
  });

  it("does not claim a query layer when presentation leaves the result off the map", () => {
    const state = queryResultState(
      {
        query_id: "QwErTyUiOpAsDfGhJkLzXcVb",
        query_token: token,
        columns: [{ name: "geom", type: "GEOMETRY", nullable: true }],
        rows: [],
        offset: 0,
        limit: 100,
        returned_count: 0,
        has_more: false,
        warnings: [],
        elapsed_ms: 12,
        bytes_read: 42,
        files_read: 1,
        response_truncated: false,
        deterministic_order: true,
        map_configuration: {
          tile_url: "https://example.test/api/queries/QwErTyUiOpAsDfGhJkLzXcVb/tiles/{z}/{x}/{y}.mvt",
          worker_url: "https://example.test/assets/maplibre-gl-worker.mjs",
          source_layer: "hifld",
          geometry_column: "geom",
          result_crs: "EPSG:4326",
        },
      },
      ["hospitals"],
      null,
    );

    expect(state.layerId).toBeNull();
  });
});
