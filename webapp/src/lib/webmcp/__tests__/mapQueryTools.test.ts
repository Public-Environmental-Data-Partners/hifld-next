import { render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { QueryApiError } from "@/lib/query-api";
import { useMapWebMcpTools, type MapWebMcpState } from "../mapTools";
import { createModelContextFake, installModelContextFake } from "../modelContextFake";
import { executeQueryPageTool, executeQueryTool, useQueryWebMcpTools } from "../queryTools";

const token = "sentinel-private-query-token";
const queryId = "QwErTyUiOpAsDfGhJkLzXcVb";

const emptyState: MapWebMcpState = {
  layers: [],
  basemap: "street",
  selected_feature_count: 0,
};

const oneLayerState: MapWebMcpState = {
  layers: [{ id: "roads", label: "Roads", kind: "catalog_pmtiles", visible: true }],
  basemap: "street",
  selected_feature_count: 0,
};

const selectedState: MapWebMcpState = {
  ...oneLayerState,
  selected_feature_count: 1,
  selected_features: [
    {
      id: "query:q1:roads:7",
      loadedLayerId: "roads",
      sourceLayerId: "roads",
      featureId: "7",
      sourceKind: "query_mvt",
      queryId: "q1",
      properties: { name: "Hospital", rank: "1" },
    },
  ],
};

function MapToolHarness({ enabled = true, state = emptyState }: { enabled?: boolean; state?: MapWebMcpState }) {
  useMapWebMcpTools({
    enabled,
    commands: {
      addDatasetLayer: vi.fn(async () => ({ id: "roads", label: "Roads", kind: "catalog_pmtiles" as const, visible: true })),
      removeLayer: vi.fn(),
      setLayerVisibility: vi.fn(),
      setLayerStyle: vi.fn(),
      reorderLayers: vi.fn(),
      setCamera: vi.fn(async () => ({ center: [-77, 39] as const, zoom: 8, bearing: 0, pitch: 0 })),
      setBasemap: vi.fn(),
      clearSelection: vi.fn(),
    },
    resolveCatalogLayer: vi.fn(async () => ({ layerId: "roads", label: "Roads" })),
    getState: () => state,
  });
  return null;
}

function QueryToolHarness({ enabled, pageEnabled }: { enabled: boolean; pageEnabled: boolean }) {
  useQueryWebMcpTools({
    enabled,
    pageEnabled,
    executeQuery: vi.fn(async () => queryPage()),
    executePage: vi.fn(async () => queryPage()),
  });
  return null;
}

function queryPage() {
  return {
    query_id: queryId,
    columns: [{ name: "name", type: "VARCHAR", nullable: false }],
    rows: [{ name: "Hospital" }],
    offset: 0,
    limit: 100,
    returned_count: 1,
    has_more: false,
    warnings: [],
    elapsed_ms: 1,
    response_truncated: false,
    deterministic_order: true,
  };
}

describe("query WebMCP tools", () => {
  it("does not expose query tokens in execute results", async () => {
    const execute = vi.fn().mockResolvedValue({
      query_id: queryId,
      query_token: token,
      columns: [{ name: "name", type: "VARCHAR", nullable: false }],
      rows: [{ name: "Hospital" }],
      offset: 0,
      limit: 100,
      returned_count: 1,
      has_more: false,
      warnings: ["Result order is deterministic."],
      elapsed_ms: 1,
      bytes_read: 2,
      files_read: 1,
      response_truncated: false,
      deterministic_order: true,
    });

    const result = await executeQueryTool(
      {
        sources: [
          { alias: "hospitals", collection_id: 1, dataset_id: 2, file_id: 3, file_source_id: 4 },
        ],
        sql: "SELECT name FROM hospitals",
      },
      new AbortController().signal,
      execute,
    );

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain(token);
    if (result.ok) {
      expect(result.data).toMatchObject({
        warnings: ["Result order is deterministic."],
        map_available: false,
        map_added: false,
      });
    }
    expect(execute).toHaveBeenCalledWith(
      {
        sources: [{ alias: "hospitals", collection_id: 1, dataset_id: 2, file_id: 3, file_source_id: 4 }],
        sql: "SELECT name FROM hospitals",
      },
      { showOnMap: true },
      expect.any(AbortSignal),
    );
  });

  it("strips map presentation fields before executing and applies the requested label", async () => {
    const execute = vi.fn().mockResolvedValue(queryPage());

    await executeQueryTool(
      {
        sources: [{ alias: "hospitals", collection_id: 1, dataset_id: 2, file_id: 3, file_source_id: 4 }],
        sql: "SELECT name FROM hospitals",
        show_on_map: false,
        layer_label: "Critical facilities",
      },
      new AbortController().signal,
      execute,
    );

    expect(execute).toHaveBeenCalledWith(
      {
        sources: [{ alias: "hospitals", collection_id: 1, dataset_id: 2, file_id: 3, file_source_id: 4 }],
        sql: "SELECT name FROM hospitals",
      },
      { showOnMap: false, layerLabel: "Critical facilities" },
      expect.any(AbortSignal),
    );
  });

  it("keeps the page token entirely in the route callback", async () => {
    const page = vi.fn().mockResolvedValue({
      query_id: queryId,
      columns: [{ name: "name", type: "VARCHAR", nullable: false }],
      rows: [{ name: "Hospital" }],
      offset: 100,
      limit: 100,
      returned_count: 1,
      has_more: false,
      warnings: [],
      elapsed_ms: 1,
      bytes_read: 2,
      files_read: 1,
      response_truncated: false,
      deterministic_order: true,
    });

    const result = await executeQueryPageTool({ query_id: queryId, offset: 100 }, new AbortController().signal, page);

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(page).toHaveBeenCalledWith(queryId, { offset: 100, page_size: 100 }, expect.any(AbortSignal));
  });

  it("does not report catalog failures as query capacity", async () => {
    const execute = vi.fn().mockRejectedValue(
      new QueryApiError(503, "catalog_unavailable", "The catalog request could not be completed"),
    );

    const result = await executeQueryTool(
      {
        sources: [{ alias: "hospitals", collection_id: 1, dataset_id: 2, file_id: 3, file_source_id: 4 }],
        sql: "SELECT name FROM hospitals",
      },
      new AbortController().signal,
      execute,
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "upstream_unavailable",
        message: "The query service is temporarily unavailable.",
        retryable: true,
      },
    });
  });

  it("reports an unavailable worker as query capacity", async () => {
    const execute = vi.fn().mockRejectedValue(
      new QueryApiError(503, "worker_unavailable", "No query worker is available"),
    );

    const result = await executeQueryTool(
      {
        sources: [{ alias: "hospitals", collection_id: 1, dataset_id: 2, file_id: 3, file_source_id: 4 }],
        sql: "SELECT name FROM hospitals",
      },
      new AbortController().signal,
      execute,
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "query_capacity",
        message: "The query service is temporarily at capacity.",
        retryable: true,
      },
    });
  });
});

describe("map WebMCP tools", () => {
  it("registers only map-mounted global tools when the map is empty", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    const { unmount } = render(createElement(MapToolHarness, { state: emptyState }));

    await waitFor(() => {
      expect(fake.toolNames()).toEqual([
        "get_map_state",
        "add_dataset_layer",
        "set_map_camera",
        "set_basemap",
      ]);
    });

    unmount();
    expect(fake.toolNames()).toEqual([]);
  });

  it("registers layer mutations for one layer and uses stable map layer fields", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    const { unmount } = render(createElement(MapToolHarness, { state: oneLayerState }));

    await waitFor(() => {
      expect(fake.toolNames()).toEqual([
        "get_map_state",
        "add_dataset_layer",
        "remove_map_layer",
        "set_layer_visibility",
        "set_map_camera",
        "set_basemap",
      ]);
    });
    await expect(fake.execute("set_layer_visibility", { map_layer_id: "roads", visible: false })).resolves.toMatchObject({
      ok: true,
      data: { map_layer_id: "roads", visible: false },
    });
    await expect(fake.execute("set_layer_visibility", { layer_id: "roads", visible: false })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    unmount();
  });

  it("registers selection tools only while a selection exists", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    const { unmount } = render(createElement(MapToolHarness, { state: selectedState }));

    await waitFor(() => {
      expect(fake.toolNames()).toEqual([
        "get_map_state",
        "add_dataset_layer",
        "remove_map_layer",
        "set_layer_visibility",
        "set_map_camera",
        "set_basemap",
        "get_map_selection",
        "clear_map_selection",
      ]);
    });
    unmount();
  });

  it("registers ordering only when two layers are loaded", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    const state: MapWebMcpState = {
      ...oneLayerState,
      layers: [
        ...oneLayerState.layers,
        { id: "parks", label: "Parks", kind: "catalog_pmtiles", visible: true },
      ],
    };
    render(createElement(MapToolHarness, { state }));
    await waitFor(() => expect(fake.toolNames()).toContain("reorder_map_layers"));
    await expect(fake.execute("reorder_map_layers", { map_layer_ids: ["parks", "roads"] })).resolves.toMatchObject({ ok: true });
  });

  it("delegates catalog identities without accepting an agent-supplied map layer id", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    const addDatasetLayer = vi.fn(async () => ({ id: "generated", label: "Roads", kind: "catalog_pmtiles" as const, visible: true }));
    const resolveCatalogLayer = vi.fn(async () => ({ layerId: "generated", label: "Roads" }));
    let stateSnapshot: MapWebMcpState = {
      ...emptyState,
      layers: [
        {
          id: "query:stations",
          label: "Alternative fueling stations",
          kind: "query_mvt",
          visible: true,
          status: "ready",
          query_id: "stations",
        },
      ],
    };
    function AddHarness() {
      useMapWebMcpTools({
        enabled: true,
        commands: {
          addDatasetLayer,
          removeLayer: vi.fn(),
          setLayerVisibility: vi.fn(),
          setLayerStyle: vi.fn(),
          reorderLayers: vi.fn(),
          setCamera: vi.fn(async () => ({ center: [-77, 39] as const, zoom: 8, bearing: 0, pitch: 0 })),
          setBasemap: vi.fn(),
          clearSelection: vi.fn(),
        },
        resolveCatalogLayer,
        getState: () => stateSnapshot,
      });
      return null;
    }
    const { rerender } = render(createElement(AddHarness));
    await waitFor(() => expect(fake.toolNames()).toContain("add_dataset_layer"));
    await expect(
      fake.execute("add_dataset_layer", {
        collection_id: 1,
        dataset_id: 2,
        file_id: 3,
        file_source_id: 4,
        label: "Roads",
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(resolveCatalogLayer).toHaveBeenCalledWith({
      collection_id: 1,
      dataset_id: 2,
      file_id: 3,
      file_source_id: 4,
      label: "Roads",
    });
    expect(addDatasetLayer).toHaveBeenCalledWith({ layerId: "generated", label: "Roads" });
    await expect(fake.execute("get_map_state", {})).resolves.toMatchObject({
      ok: true,
      data: {
        layers: [
          { map_layer_id: "query:stations", kind: "query_mvt" },
          { map_layer_id: "generated", kind: "catalog_pmtiles" },
        ],
      },
    });
    stateSnapshot = {
      ...stateSnapshot,
      layers: [
        ...stateSnapshot.layers,
        { id: "generated", label: "Roads", kind: "catalog_pmtiles", visible: true },
      ],
    };
    rerender(createElement(AddHarness));
    await waitFor(() => expect(fake.toolNames()).toContain("reorder_map_layers"));
    stateSnapshot = { ...stateSnapshot, layers: stateSnapshot.layers.filter((layer) => layer.id !== "generated") };
    rerender(createElement(AddHarness));
    await waitFor(async () => {
      await expect(fake.execute("get_map_state", {})).resolves.toMatchObject({
        ok: true,
        data: { layers: [{ map_layer_id: "query:stations" }] },
      });
    });
    await expect(
      fake.execute("add_dataset_layer", {
        collection_id: 1,
        dataset_id: 2,
        file_id: 3,
        file_source_id: 4,
        map_layer_id: "generated",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_request" } });
  });

  it("returns nested styles and bounded normalized selection properties without secrets", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    const state: MapWebMcpState = {
      ...selectedState,
      camera: { center: [-77, 39], zoom: 8, bearing: 0, pitch: 0 },
      layers: [
        {
          id: "roads",
          label: "Roads",
          kind: "query_mvt",
          visible: true,
          status: "ready",
          query_id: "q1",
          style_layers: [
            {
              style_layer_id: "roads-fill",
              source_layer_id: "roads",
              fields: ["name", "rank"],
              numeric_fields: [{ name: "rank", min: 1, max: 4 }],
              style: { color_property: "rank", color_scheme: "viridis", opacity: 0.8 },
            },
          ],
        },
      ],
      current_result: { query_id: "q1", offset: 0, limit: 100, returned_count: 1, has_more: false, map_layer_id: "roads" },
    };
    render(createElement(MapToolHarness, { state }));
    await waitFor(() => expect(fake.toolNames()).toContain("get_map_selection"));
    expect(fake.toolNames()).toContain("set_layer_style");
    const mapState = await fake.execute("get_map_state", {});
    expect(mapState).toMatchObject({
      ok: true,
      data: {
        camera: { zoom: 8 },
        layers: [{ map_layer_id: "roads", status: "ready", style_layers: [{ style_layer_id: "roads-fill" }] }],
        current_result: { query_id: "q1", map_layer_id: "roads" },
      },
    });
    expect(JSON.stringify(mapState)).not.toContain("tileTemplate");
    const selection = await fake.execute("get_map_selection", { offset: 0, limit: 1 });
    expect(selection).toMatchObject({
      ok: true,
      data: { offset: 0, limit: 1, returned_count: 1, features: [{ map_layer_id: "roads", properties: { name: "Hospital" } }] },
    });
    expect(JSON.stringify(selection)).not.toContain("geometry");
  });
});

describe("query WebMCP registration", () => {
  it("uses approved names and only offers paging for a current pageable query", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    const { rerender, unmount } = render(createElement(QueryToolHarness, { enabled: true, pageEnabled: false }));
    await waitFor(() => expect(fake.toolNames()).toEqual(["run_dataset_query"]));

    rerender(createElement(QueryToolHarness, { enabled: true, pageEnabled: true }));
    await waitFor(() => expect(fake.toolNames()).toEqual(["run_dataset_query", "set_result_page"]));
    expect(fake.getTool("run_dataset_query").annotations).toMatchObject({ readOnlyHint: false });
    expect(fake.getTool("set_result_page").annotations).toMatchObject({ readOnlyHint: false });
    unmount();
    expect(fake.toolNames()).toEqual([]);
  });
});
