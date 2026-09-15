import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  getHostCapabilities: () => {
    serverTools: Record<string, never>;
    updateModelContext?: { text: Record<string, never> };
  };
  updateModelContext: ReturnType<typeof vi.fn>;
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
    updateModelContext: vi.fn().mockResolvedValue({}),
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

const pendingResult = {
  ...validResult,
  layers: [
    {
      layer_id: "preparing-0",
      layer_name: "Capitols",
      visible: true,
      preparation_status: "preparing",
    },
  ],
  map_spec: {
    ...validResult.map_spec,
    layers: [
      {
        layer_name: "Capitols",
        visible: true,
        source: {
          type: "query",
          inputs: [{ alias: "capitols", file_id: 1 }],
          sql: "SELECT geometry FROM capitols",
        },
      },
    ],
  },
};

describe("useMcpApp", () => {
  it("stops using an expired token while refresh runs and accepts its eventual replacement", async () => {
    vi.useFakeTimers();
    try {
      const app = fakeApp();
      app.callServerTool.mockResolvedValueOnce({
        content: [],
        structuredContent: {
          layer: {
            ...validLayer,
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          },
          worker_url: validResult.worker_url,
        },
      });
      let finish: ((value: FakeToolResult) => void) | undefined;
      app.callServerTool.mockImplementationOnce(
        () =>
          new Promise<FakeToolResult>((resolve) => {
            finish = resolve;
          }),
      );
      const { result, unmount } = connect(app);
      await act(async () =>
        app.ontoolresult?.({ content: [], structuredContent: pendingResult }),
      );
      await act(async () => vi.advanceTimersByTime(30_000));
      expect(result.current.queryTokens[queryId]).toBe("signed-capitols");
      await act(async () => vi.advanceTimersByTime(30_000));
      expect(result.current.queryTokens).toEqual({});
      expect(result.current.mapConfiguration?.layers[0]).toMatchObject({
        preparation_status: "preparing",
      });
      await act(async () =>
        finish?.({
          content: [],
          structuredContent: {
            layer: {
              ...validLayer,
              query_token: "replacement",
              expires_at: new Date(Date.now() + 60_000).toISOString(),
            },
            worker_url: validResult.worker_url,
          },
        }),
      );
      expect(result.current.queryTokens[queryId]).toBe("replacement");
      expect(result.current.mapConfiguration?.layers[0]).toMatchObject({
        query_id: queryId,
      });
      expect(app.callServerTool).toHaveBeenCalledTimes(2);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
  it("keeps a valid query after refresh failure and marks only that layer failed at expiry", async () => {
    vi.useFakeTimers();
    try {
      const app = fakeApp();
      app.callServerTool.mockResolvedValueOnce({
        content: [],
        structuredContent: {
          layer: {
            ...validLayer,
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          },
          worker_url: validResult.worker_url,
        },
      });
      app.callServerTool.mockRejectedValueOnce(new Error("Connection lost"));
      const { result, unmount } = connect(app);
      await act(async () =>
        app.ontoolresult?.({ content: [], structuredContent: pendingResult }),
      );
      await act(async () => vi.advanceTimersByTime(30_000));
      expect(result.current.mapConfiguration?.layers[0]).toMatchObject({
        query_id: queryId,
      });
      expect(result.current.queryTokens[queryId]).toBe("signed-capitols");
      expect(result.current.feedbackNotice).toMatch(
        /refresh.*existing.*expires/i,
      );
      await act(async () => vi.advanceTimersByTime(30_000));
      expect(result.current.mapConfiguration?.layers[0]).toMatchObject({
        preparation_status: "failed",
      });
      expect(result.current.queryTokens).toEqual({});
      expect(app.callServerTool).toHaveBeenCalledTimes(2);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
  it("refreshes each prepared query token and cancels pending preparation on teardown", async () => {
    vi.useFakeTimers();
    try {
      const app = fakeApp();
      app.callServerTool.mockResolvedValueOnce({
        content: [],
        structuredContent: {
          layer: {
            ...validLayer,
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          },
          worker_url: validResult.worker_url,
        },
      });
      let finish: ((value: FakeToolResult) => void) | undefined;
      app.callServerTool.mockImplementationOnce(
        () =>
          new Promise<FakeToolResult>((resolve) => {
            finish = resolve;
          }),
      );
      const { result, unmount } = connect(app);
      await act(async () =>
        app.ontoolresult?.({ content: [], structuredContent: pendingResult }),
      );
      expect(result.current.queryTokens[queryId]).toBe("signed-capitols");
      await act(async () => vi.advanceTimersByTime(30_000));
      expect(app.callServerTool).toHaveBeenCalledTimes(2);
      expect(app.callServerTool.mock.calls[1]?.[0].name).toBe(
        "prepare_map_layer",
      );
      const requestOptions = app.callServerTool.mock.calls[1]?.[1] as {
        signal: AbortSignal;
      };
      await act(async () => app.onteardown?.());
      expect(requestOptions.signal.aborted).toBe(true);
      await act(async () =>
        finish?.({
          content: [],
          structuredContent: {
            layer: validLayer,
            worker_url: validResult.worker_url,
          },
        }),
      );
      expect(result.current.mapConfiguration?.layers[0]).toMatchObject({
        query_id: queryId,
      });
      await act(async () => vi.advanceTimersByTime(120_000));
      expect(app.callServerTool).toHaveBeenCalledTimes(2);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a preparation response after a new map replaces it", async () => {
    const app = fakeApp();
    let finish: ((value: FakeToolResult) => void) | undefined;
    app.callServerTool.mockImplementation(
      () =>
        new Promise<FakeToolResult>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = connect(app);
    act(() =>
      app.ontoolresult?.({ content: [], structuredContent: pendingResult }),
    );
    act(() =>
      app.ontoolresult?.({ content: [], structuredContent: validResult }),
    );
    await act(async () =>
      finish?.({
        content: [],
        structuredContent: {
          error: { code: "query_execution_failed", message: "Late failure" },
        },
      }),
    );
    expect(result.current.mapConfiguration?.layers[0]).toMatchObject({
      query_id: queryId,
    });
    expect(result.current.error).toBeNull();
  });

  it("keeps the configured asset worker when query tiles use a different origin", async () => {
    const app = fakeApp();
    app.callServerTool.mockResolvedValue({
      content: [],
      structuredContent: {
        layer: validLayer,
        worker_url: "https://query-assets.example.test/worker.js",
      },
    });
    const { result } = connect(app);
    await act(async () =>
      app.ontoolresult?.({ content: [], structuredContent: pendingResult }),
    );
    expect(result.current.mapConfiguration?.layers[0]).toMatchObject({
      query_id: queryId,
    });
    expect(result.current.mapConfiguration?.worker_url).toBe(
      validResult.worker_url,
    );
  });
  it("keeps ready sources while query preparation independently succeeds or fails", async () => {
    const app = fakeApp();
    let finish: ((value: FakeToolResult) => void) | undefined;
    app.callServerTool.mockImplementation(
      ({
        arguments: args,
      }: {
        arguments: { layer: { layer_name: string } };
      }) =>
        args.layer.layer_name === "Slow"
          ? new Promise<FakeToolResult>((resolve) => {
              finish = resolve;
            })
          : Promise.resolve({
              content: [],
              structuredContent: {
                error: {
                  code: "query_execution_failed",
                  message: "Query failed",
                },
              },
            }),
    );
    const { result } = connect(app);
    const external = {
      layer_id: "external-0",
      layer_name: "Flood",
      visible: true,
      source: {
        type: "pmtiles",
        url: "https://tiles.example.com/flood.pmtiles",
      },
    };
    act(() =>
      app.ontoolresult?.({
        content: [],
        structuredContent: {
          ...validResult,
          layers: [
            external,
            ...["Slow", "Broken"].map((layer_name, index) => ({
              layer_id: `preparing-${index + 1}`,
              layer_name,
              visible: true,
              preparation_status: "preparing",
            })),
          ],
          map_spec: {
            ...validResult.map_spec,
            layers: [
              { layer_name: "Flood", visible: true, source: external.source },
              ...["Slow", "Broken"].map((layer_name) => ({
                layer_name,
                visible: true,
                source: {
                  type: "query",
                  inputs: [{ alias: "capitols", file_id: 1 }],
                  sql: "SELECT geometry FROM capitols",
                },
              })),
            ],
          },
        },
      }),
    );
    expect(result.current.mapConfiguration?.layers[0]).toEqual(external);
    await waitFor(() =>
      expect(result.current.mapConfiguration?.layers[2]).toMatchObject({
        preparation_status: "failed",
        preparation_error: "Query failed (query_execution_failed)",
      }),
    );
    expect(result.current.mapConfiguration?.layers[1]).toMatchObject({
      preparation_status: "preparing",
    });
    await act(async () =>
      finish?.({
        content: [],
        structuredContent: {
          layer: { ...validLayer, layer_name: "Slow" },
          worker_url: validResult.worker_url,
        },
      }),
    );
    expect(result.current.mapConfiguration?.layers[1]).toMatchObject({
      query_id: queryId,
    });
    expect(result.current.queryTokens).toEqual({
      [queryId]: "signed-capitols",
    });
    expect(result.current.error).toBeNull();
  });
  afterEach(cleanup);
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

  it("accepts an external-only map without scheduling a token refresh", () => {
    vi.useFakeTimers();
    try {
      const app = fakeApp();
      const { result, unmount } = connect(app);
      const source = {
        type: "pmtiles",
        url: "https://tiles.example.com/flood.pmtiles",
      };
      act(() =>
        app.ontoolresult?.({
          content: [],
          structuredContent: {
            ...validResult,
            layers: [
              {
                layer_id: "external-0",
                layer_name: "Flood",
                visible: true,
                source,
              },
            ],
            map_spec: {
              title: "Flood",
              basemap: "street",
              layers: [{ layer_name: "Flood", visible: true, source }],
            },
          },
        }),
      );
      expect(result.current.mapConfiguration?.layers[0]?.layer_name).toBe(
        "Flood",
      );
      expect(result.current.queryTokens).toEqual({});
      act(() => vi.advanceTimersByTime(60_000));
      expect(app.callServerTool).not.toHaveBeenCalled();
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a map layer missing its query token", () => {
    const app = fakeApp();
    app.getHostCapabilities = () => ({
      serverTools: {},
      updateModelContext: { text: {} },
    });
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
    expect(result.current.error).toContain("layers.0.query_token");
    expect(result.current.error).toContain("not a SQL execution error");
    expect(result.current.error).not.toContain("signed-capitols");
    expect(app.updateModelContext).toHaveBeenCalledWith({
      content: [
        { type: "text", text: expect.stringContaining("validation_failed") },
      ],
    });
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

  it("reports validation paths for malformed refreshed results without values", async () => {
    const app = fakeApp();
    app.callServerTool.mockResolvedValue({
      content: [],
      structuredContent: {
        ...validResult,
        layers: [{ ...validLayer, result_crs: { secret: "private-value" } }],
      },
    });
    const { result } = connect(app);
    act(() => {
      app.ontoolresult?.({
        content: [],
        structuredContent: {
          ...validResult,
          layers: [{ ...validLayer, expires_at: "2020-01-01T00:00:00.000Z" }],
        },
      });
    });
    await waitFor(() => {
      expect(result.current.error).toContain("layers.0.result_crs");
    });
    expect(result.current.error).not.toContain("private-value");
    expect(result.current.error).not.toContain("signed-capitols");
    expect(result.current.mapConfiguration).toBeNull();
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
