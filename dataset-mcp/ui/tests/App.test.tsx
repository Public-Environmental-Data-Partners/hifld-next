import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { QueryResult } from "../src/mcp/contracts";

const useMcpApp = vi.hoisted(() => vi.fn());
vi.mock("../src/mcp/useMcpApp", () => ({ useMcpApp }));
vi.mock("../src/components/MapView", () => ({
  MapView: () => <section aria-label="Dataset map">Map view</section>,
}));

const result: QueryResult = {
  columns: [{ name: "id", type: "INTEGER", nullable: false }],
  rows: [{ id: 1 }],
  offset: 0,
  limit: 100,
  has_more: false,
  query_token: "token",
};

function state(
  overrides: {
    result?: QueryResult | null;
    staticMode?: boolean;
    connected?: boolean;
    mapConfiguration?: { geometryType?: string };
  } = {},
) {
  return {
    app: null,
    connected: false,
    error: null,
    result: null,
    staticMode: true,
    canCallServerTools: false,
    getQueryPage: vi.fn(),
    ...overrides,
  };
}

describe("Dataset explorer shell", () => {
  beforeEach(() => useMcpApp.mockReset());
  afterEach(cleanup);
  it("renders a static host message while disconnected", () => {
    useMcpApp.mockReturnValue(state());
    render(<App />);
    expect(
      screen.getByRole("heading", { name: /dataset explorer/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("status")[0]).toHaveTextContent(
      /waiting for the MCP host/i,
    );
  });

  it("dispatches the validated initial page directly to the table", () => {
    useMcpApp.mockReturnValue(
      state({ result, staticMode: false, connected: true }),
    );
    render(<App />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("exposes the map tab only when map configuration is present", async () => {
    useMcpApp.mockReturnValue(
      state({
        result,
        staticMode: false,
        connected: true,
        mapConfiguration: { geometryType: "Point" },
      }),
    );
    render(<App />);
    await userEvent.setup().click(screen.getByRole("tab", { name: "Map" }));
    expect(
      screen.getByRole("region", { name: "Dataset map" }),
    ).toBeInTheDocument();
  });

  it("exposes the map tab when geometry type is omitted", () => {
    useMcpApp.mockReturnValue(
      state({
        result,
        staticMode: false,
        connected: true,
        mapConfiguration: {},
      }),
    );
    render(<App />);
    expect(screen.getByRole("tab", { name: "Map" })).toBeInTheDocument();
  });

  it("keeps absent map configuration out of the tab list", () => {
    useMcpApp.mockReturnValue(state({ result, staticMode: false }));
    render(<App />);
    expect(screen.queryByRole("tab", { name: "Map" })).not.toBeInTheDocument();
  });

  it("keeps ambiguous map configuration out of the tab list", () => {
    useMcpApp.mockReturnValue(
      state({
        result,
        staticMode: false,
        mapConfiguration: { geometryType: "Bogus" },
      }),
    );
    render(<App />);
    expect(screen.queryByRole("tab", { name: "Map" })).not.toBeInTheDocument();
  });
});
