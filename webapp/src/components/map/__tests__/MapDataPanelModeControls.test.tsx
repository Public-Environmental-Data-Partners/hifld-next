import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MapDataPanelModeControls } from "../MapDataPanelModeControls";

describe("MapDataPanelModeControls", () => {
  it("switches between query results and selected features", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    render(<MapDataPanelModeControls mode="query" onModeChange={onModeChange} />);

    expect(screen.getByRole("button", { name: "Query results" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Selected features" })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "Selected features" }));
    expect(onModeChange).toHaveBeenCalledWith("selected");
  });
});
