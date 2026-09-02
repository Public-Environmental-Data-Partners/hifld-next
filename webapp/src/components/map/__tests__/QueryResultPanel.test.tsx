import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QueryResultPanel } from "../QueryResultPanel";
import type { QueryResultState } from "../queryResults";

const result: QueryResultState = {
  page: {
    query_id: "query_result_identifier_1234",
    columns: [
      { name: "NAME", type: "VARCHAR", nullable: false },
      { name: "COUNT", type: "BIGINT", nullable: false },
    ],
    rows: [
      { NAME: "Beta", COUNT: 10 },
      { NAME: "Alpha", COUNT: 2 },
    ],
    offset: 20,
    limit: 2,
    returned_count: 2,
    has_more: true,
    next_offset: 22,
    warnings: [],
    elapsed_ms: 18,
    bytes_read: 128,
    files_read: 1,
    response_truncated: false,
    deterministic_order: true,
  },
  sourceAliases: ["stations"],
  layerId: "query-layer",
  status: "ready",
  errorMessage: null,
};

describe("QueryResultPanel", () => {
  it("renders query rows through the shared selected-features table", () => {
    render(<QueryResultPanel result={result} />);

    expect(screen.getByRole("table", { name: "Query results" })).toHaveAttribute(
      "data-slot",
      "selected-features-table",
    );
    expect(screen.getByRole("searchbox", { name: "Search query results" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "NAME",
      "COUNT",
    ]);
    expect(screen.getByRole("button", { name: "Sort by COUNT" })).toHaveClass(
      "h-7",
      "max-w-full",
      "gap-1",
      "px-1",
      "text-xs",
    );
    expect(screen.getByRole("cell", { name: "Beta" })).toBeInTheDocument();
  });

  it("uses the shared numeric-aware sorting behavior", async () => {
    const user = userEvent.setup();
    render(<QueryResultPanel result={result} />);

    await user.click(screen.getByRole("button", { name: "Sort by COUNT" }));
    expect(screen.getAllByTestId("selected-feature-row").map((row) => row.textContent)).toEqual([
      "Alpha2",
      "Beta10",
    ]);
  });

  it("keeps query pagination controls", async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    render(<QueryResultPanel result={result} onLoadMore={onLoadMore} />);

    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("renders unified panel mode controls and collapses the panel", async () => {
    const user = userEvent.setup();
    const onCollapse = vi.fn();
    render(
      <QueryResultPanel
        result={result}
        panelModeControls={<button type="button">Selected features</button>}
        onCollapse={onCollapse}
      />,
    );

    expect(screen.getByRole("button", { name: "Selected features" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Collapse data table" }));
    expect(onCollapse).toHaveBeenCalledOnce();
  });
});
