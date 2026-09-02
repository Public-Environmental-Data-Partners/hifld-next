import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JsonValue } from "../src/mcp/contracts";
import { useMcpApp } from "../src/mcp/useMcpApp";

const useApp = vi.hoisted(() => vi.fn());
const useHostStyles = vi.hoisted(() => vi.fn());

vi.mock("@modelcontextprotocol/ext-apps/react", () => ({
  useApp,
  useHostStyles,
}));

const queryId = "capitolsquery123456789AB";
const validLayer = {
  query_id: queryId,
  layer_name: "Capitols",
  tile_url: `https://maps.example.test/tiles/${queryId}/{z}/{x}/{y}.mvt`,
  source_layer: "hifld",
  geometry_column: "geometry",
  result_crs: "EPSG:4326",
  columns: [
    { name: "geometry", type: "GEOMETRY", nullable: false },
    { name: "name", type: "VARCHAR", nullable: true },
  ],
  query_token: "signed-capitols",
  expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  visible: true,
};
const validResult = {
  title: "State capitols",
  basemap: "street",
  worker_url: "https://maps.example.test/assets/maplibre-gl-worker.mjs",
  layers: [validLayer],
  map_spec: {
    title: "State capitols",
    basemap: "street",
    layers: [
      {
        layer_name: "Capitols",
        sources: [{ alias: "capitols", file_id: 1 }],
        sql: "SELECT geometry, name FROM capitols",
        visible: true,
      },
    ],
  },
};

type FakeToolResult = {
  content: [];
  structuredContent: Record<string, JsonValue>;
  _meta?: Record<string, JsonValue>;
  isError?: boolean;
};

type FakeApp = {
  ontoolresult: ((result: FakeToolResult) => void) | null;
  onerror: ((event: { message: string }) => void) | null;
  onteardown: (() => Promise<Record<string, never>>) | null;
  getHostContext: () => undefined;
  getHostCapabilities: () => { serverTools: Record<string, never> };
  callServerTool: ReturnType<typeof vi.fn>;
};

function fakeApp(): FakeApp {
  return {
    ontoolresult: null,
    onerror: null,
    onteardown: null,
    getHostContext: () => undefined,
    getHostCapabilities: () => ({ serverTools: {} }),
    callServerTool: vi.fn(),
  };
}

function connect(app: FakeApp) {
  useApp.mockReturnValue({ app, isConnected: true, error: null });
  const hook = renderHook(() => useMcpApp());
  const options = useApp.mock.calls[0]?.[0] as {
    onAppCreated: (created: FakeApp) => void;
  };
  act(() => options.onAppCreated(app));
  return hook;
}

describe("useMcpApp", () => {
  beforeEach(() => {
    useApp.mockReset();
    useHostStyles.mockReset();
  });

  it("exposes validated layers and their query tokens without result metadata", () => {
    const app = fakeApp();
    const { result } = connect(app);

    act(() => {
      app.ontoolresult?.({
        content: [],
        structuredContent: validResult,
      });
    });

    expect(result.current.mapConfiguration?.layers[0]?.layer_name).toBe(
      "Capitols",
    );
    expect(result.current.queryTokens).toEqual({
      [queryId]: "signed-capitols",
    });
    expect(useHostStyles).toHaveBeenCalled();
  });

  it("rejects a map layer missing its query token", () => {
    const app = fakeApp();
    const { result } = connect(app);
    const { query_token: omittedToken, ...layerWithoutToken } = validLayer;
    expect(omittedToken).toBe("signed-capitols");

    act(() => {
      app.ontoolresult?.({
        content: [],
        structuredContent: {
          ...validResult,
          layers: [layerWithoutToken],
        },
      });
    });

    expect(result.current.mapConfiguration).toBeNull();
    expect(result.current.queryTokens).toEqual({});
    expect(result.current.error).toMatch(/invalid map result/i);
  });

  it("clears a stale map when a later tool result is an error", () => {
    const app = fakeApp();
    const { result } = connect(app);
    act(() => {
      app.ontoolresult?.({
        content: [],
        structuredContent: validResult,
      });
      app.ontoolresult?.({
        content: [],
        structuredContent: {
          error: { code: "query_execution_failed", message: "Query failed" },
        },
        isError: true,
      });
    });

    expect(result.current.mapConfiguration).toBeNull();
    expect(result.current.queryTokens).toEqual({});
    expect(result.current.error).toBe("Query failed");
  });

  it("refreshes an expired saved map from its durable definition", async () => {
    const app = fakeApp();
    const refreshedId = "refreshedquery123456789AB";
    app.callServerTool.mockResolvedValue({
      content: [],
      structuredContent: {
        ...validResult,
        layers: [
          {
            ...validLayer,
            query_id: refreshedId,
            query_token: "signed-refreshed",
            tile_url: `https://maps.example.test/tiles/${refreshedId}/{z}/{x}/{y}.mvt`,
            expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          },
        ],
      },
    });
    const { result } = connect(app);

    act(() => {
      app.ontoolresult?.({
        content: [],
        structuredContent: {
          ...validResult,
          layers: [
            {
              ...validLayer,
              expires_at: "2020-01-01T00:00:00.000Z",
            },
          ],
        },
      });
    });

    await waitFor(() => {
      expect(app.callServerTool).toHaveBeenCalledWith({
        name: "refresh_query_map",
        arguments: { map_spec: validResult.map_spec },
      });
    });
    await waitFor(() => {
      expect(result.current.queryTokens).toEqual({
        [refreshedId]: "signed-refreshed",
      });
    });
  });

  it("awaits the registered resource teardown handler", async () => {
    const app = fakeApp();
    const { result } = connect(app);
    const teardown = vi.fn().mockResolvedValue(undefined);

    act(() => {
      result.current.registerTeardownHandler(teardown);
    });
    await act(async () => {
      await app.onteardown?.();
    });

    expect(teardown).toHaveBeenCalledOnce();
  });
});
