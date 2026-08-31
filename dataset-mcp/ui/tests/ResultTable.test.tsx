import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResultTable } from "../src/components/ResultTable";
import type { QueryResult } from "../src/mcp/contracts";

const page = (offset: number, id: string, hasMore = true): QueryResult => ({
  columns: [{ name: "id", type: "INTEGER", nullable: false }],
  rows: [{ id }],
  offset,
  limit: 100,
  has_more: hasMore,
  next_offset: hasMore ? offset + 100 : undefined,
  query_token: "signed",
});

describe("ResultTable paging", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });
  it("renders the initial page without fetching another page", () => {
    const app = { callServerTool: vi.fn() };
    render(<ResultTable result={page(0, "first")} app={app} />);

    expect(screen.getByText("first")).toBeInTheDocument();
    expect(app.callServerTool).not.toHaveBeenCalled();
  });

  it("fetches next_offset once and serves a revisited page from cache", async () => {
    const user = userEvent.setup();
    const callServerTool = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "not the page payload" }],
      structuredContent: page(100, "second", false),
    });
    const app = { callServerTool };
    render(<ResultTable result={page(0, "first")} app={app} />);

    await user.click(screen.getByRole("button", { name: /next page/i }));
    expect(await screen.findByText("second")).toBeInTheDocument();
    expect(callServerTool).toHaveBeenCalledTimes(1);
    expect(callServerTool).toHaveBeenCalledWith({
      name: "get_query_page",
      arguments: {
        query_token: "signed",
        offset: 100,
        page_size: 100,
      },
    });

    await user.click(screen.getByRole("button", { name: /previous page/i }));
    expect(screen.getByText("first")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /next page/i }));
    await waitFor(() => expect(callServerTool).toHaveBeenCalledTimes(1));
    expect(screen.getByText("second")).toBeInTheDocument();
  });

  it("rejects text content when structured page content is invalid", async () => {
    const user = userEvent.setup();
    const callServerTool = vi.fn().mockResolvedValue({
      content: [
        { type: "text", text: JSON.stringify(page(100, "second", false)) },
      ],
      structuredContent: null,
    });
    render(<ResultTable result={page(0, "first")} app={{ callServerTool }} />);

    await user.click(screen.getByRole("button", { name: /next page/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid page/i);
    expect(screen.queryByText("second")).not.toBeInTheDocument();
  });

  it("reports unavailable paging instead of silently doing nothing", async () => {
    const user = userEvent.setup();
    render(<ResultTable result={page(0, "first")} />);

    await user.click(screen.getByRole("button", { name: /next page/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      /cannot load another page/i,
    );
  });

  it("displays DuckDB tagged geometry, binary, and truncated summaries", () => {
    const result: QueryResult = {
      columns: [
        { name: "shape", type: "GEOMETRY", nullable: true },
        { name: "blob", type: "BLOB", nullable: true },
        { name: "note", type: "VARCHAR", nullable: true },
      ],
      rows: [
        {
          shape: { $type: "geometry", byte_length: 42 },
          blob: { $type: "binary", byte_length: 128 },
          note: { $type: "truncated", byte_length: 99 },
        },
      ],
      offset: 0,
      limit: 100,
      has_more: false,
    };
    render(<ResultTable result={result} />);

    expect(screen.getByText("Geometry")).toBeInTheDocument();
    expect(screen.getByText("Binary · 128 bytes")).toBeInTheDocument();
    expect(screen.getByText("Truncated · 99 bytes")).toBeInTheDocument();
  });
});
