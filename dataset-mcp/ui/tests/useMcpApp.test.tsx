import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JsonValue } from "../src/mcp/contracts";
import { useMcpApp } from "../src/mcp/useMcpApp";

const useApp = vi.hoisted(() => vi.fn());

vi.mock("@modelcontextprotocol/ext-apps/react", () => ({ useApp }));

const validResult = {
  columns: [{ name: "id", type: "BIGINT", nullable: false }],
  rows: [{ id: 1 }],
  offset: 0,
  limit: 100,
  has_more: false,
};

type FakeApp = {
  ontoolresult:
    | ((result: {
        content: [];
        structuredContent: Record<string, JsonValue>;
        isError?: boolean;
      }) => void)
    | null;
  onerror: ((event: { message: string }) => void) | null;
  onhostcontextchanged:
    | ((context: { theme?: string; styles?: Record<string, string> }) => void)
    | null;
  onteardown: (() => Promise<Record<string, never>>) | null;
  getHostCapabilities: () => { serverTools: Record<string, never> };
};

function fakeApp(): FakeApp {
  return {
    ontoolresult: null,
    onerror: null,
    onhostcontextchanged: null,
    onteardown: null,
    getHostCapabilities: () => ({ serverTools: {} }),
  };
}

describe("useMcpApp", () => {
  beforeEach(() => useApp.mockReset());

  it("clears stale results when a later tool result fails validation", () => {
    const app = fakeApp();
    useApp.mockReturnValue({ app, isConnected: true, error: null });
    const { result } = renderHook(() => useMcpApp());
    const options = useApp.mock.calls.find(
      (call) => call[0] !== undefined,
    )?.[0] as { onAppCreated: (created: FakeApp) => void } | undefined;
    if (!options) throw new Error("useApp options were not registered");
    act(() => options.onAppCreated(app));

    act(() => {
      app.ontoolresult?.({ content: [], structuredContent: validResult });
    });
    expect(result.current.result?.rows).toEqual([{ id: 1 }]);

    act(() => {
      app.ontoolresult?.({
        content: [],
        structuredContent: {
          error: { code: "query_execution_failed", message: "Query failed" },
        },
        isError: true,
      });
    });

    expect(result.current.result).toBeNull();
    expect(result.current.mapConfiguration).toBeNull();
    expect(result.current.error).toBe("Query failed");
  });
});
