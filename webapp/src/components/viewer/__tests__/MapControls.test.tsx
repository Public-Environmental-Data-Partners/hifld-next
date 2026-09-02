import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MapControls } from "../MapControls";

describe("MapControls", () => {
  it("keeps the current region-highlight controls", async () => {
    const user = userEvent.setup();
    const onToggleSelection = vi.fn();
    const onClearSelection = vi.fn();

    render(
      <MapControls
        mapRef={{ current: null }}
        isSelectionActive={false}
        onToggleSelection={onToggleSelection}
        onClearSelection={onClearSelection}
      />,
    );

    expect(screen.getByRole("button", { name: "Highlight a region" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear highlighted region" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Highlight a region" }));
    await user.click(screen.getByRole("button", { name: "Clear highlighted region" }));

    expect(onToggleSelection).toHaveBeenCalledOnce();
    expect(onClearSelection).toHaveBeenCalledOnce();
  });

  it("uses the active label when region highlighting is enabled", () => {
    render(
      <MapControls
        mapRef={{ current: null }}
        isSelectionActive
        onToggleSelection={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Turn off highlight region" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Highlight a region" })).not.toBeInTheDocument();
  });

  it("keeps the basemap labels and icons paired with the current mode", () => {
    const { rerender } = render(
      <MapControls mapRef={{ current: null }} basemapMode="street" onToggleBasemap={vi.fn()} />,
    );

    const streetButton = screen.getByRole("button", { name: "Switch to satellite imagery" });
    expect(streetButton.querySelector("svg.lucide-satellite")).toBeInTheDocument();

    rerender(<MapControls mapRef={{ current: null }} basemapMode="satellite" onToggleBasemap={vi.fn()} />);

    const satelliteButton = screen.getByRole("button", { name: "Switch to street map" });
    expect(satelliteButton.querySelector("svg.lucide-map")).toBeInTheDocument();
  });
});
