// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapControls, MapLegend, SelectedFeaturesSummary } from "../src";

afterEach(() => cleanup());

describe("MapControls", () => {
  it("renders the common controls and only renders optional controls when supplied", () => {
    const onToggleSelection = vi.fn();
    const onToggleBasemap = vi.fn();
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();

    render(
      <MapControls
        basemapMode="street"
        isSelectionActive={false}
        onToggleSelection={onToggleSelection}
        onToggleBasemap={onToggleBasemap}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Highlight a region" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch to satellite imagery" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));

    expect(onToggleSelection).toHaveBeenCalledOnce();
    expect(onToggleBasemap).toHaveBeenCalledOnce();
    expect(onZoomIn).toHaveBeenCalledOnce();
    expect(onZoomOut).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Full screen" })).not.toBeInTheDocument();
  });

  it("keeps settings, clear selection, and fullscreen as optional controls", () => {
    render(
      <MapControls
        basemapMode="satellite"
        isSelectionActive
        onToggleSelection={vi.fn()}
        onToggleBasemap={vi.fn()}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onToggleSettings={vi.fn()}
        isSettingsCollapsed
        onClearSelection={vi.fn()}
        onFullscreen={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Show map settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn off highlight region" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Clear highlighted region" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch to street map" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Full screen" })).toBeInTheDocument();
  });
});

describe("MapLegend", () => {
  it("renders visible layers with an eye button", () => {
    const onLayerVisibilityChange = vi.fn();
    const { container } = render(
      <MapLegend
        title="BEDS"
        visible
        onToggle={vi.fn()}
        onLayerVisibilityChange={onLayerVisibilityChange}
        groups={[
          {
            id: "hospitals",
            title: "Hospitals",
            field: "BEDS",
            items: [{ label: "> 10", color: "#fde725" }],
            layerVisible: true,
          },
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: "BEDS" })).toBeInTheDocument();
    expect(screen.getByText("Color by BEDS")).toBeInTheDocument();
    const visibilityButton = screen.getByRole("button", {
      name: "Hide Hospitals",
    });
    const layerTitle = screen.getByText("Hospitals");
    const layerRow = layerTitle.closest(
      '[data-slot="map-legend-layer-toggle"]',
    );
    expect(layerRow?.firstElementChild).toBe(layerTitle);
    expect(layerRow?.lastElementChild).toBe(visibilityButton);
    expect(visibilityButton).toHaveClass("ml-auto");
    expect(visibilityButton).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector(".lucide-eye")).toBeInTheDocument();
    fireEvent.click(visibilityButton);
    expect(onLayerVisibilityChange).toHaveBeenCalledWith("hospitals", false);
  });

  it("renders hidden layers with an eye-off button", () => {
    const onLayerVisibilityChange = vi.fn();
    const { container } = render(
      <MapLegend
        visible
        onToggle={vi.fn()}
        onLayerVisibilityChange={onLayerVisibilityChange}
        groups={[
          {
            id: "hospitals",
            title: "Hospitals",
            items: [{ label: "All values", color: "#fde725" }],
            layerVisible: false,
          },
        ]}
      />,
    );

    const visibilityButton = screen.getByRole("button", {
      name: "Show Hospitals",
    });
    expect(visibilityButton).toHaveAttribute("aria-pressed", "false");
    expect(container.querySelector(".lucide-eye-off")).toBeInTheDocument();
    fireEvent.click(visibilityButton);
    expect(onLayerVisibilityChange).toHaveBeenCalledWith("hospitals", true);
  });

  it("uses the shared collapsed toggle label", () => {
    render(<MapLegend groups={[]} visible={false} onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Show color key" })).toBeInTheDocument();
  });
});

describe("SelectedFeaturesSummary", () => {
  it("renders optional context and cap messaging with a clear action", () => {
    const onClear = vi.fn();
    render(
      <SelectedFeaturesSummary
        countLabel="1 feature highlighted"
        capMessage="Limited to 100 features per layer"
        contextNote="The MCP client does not support adding selected features to chat context."
        onClear={onClear}
      />,
    );

    expect(screen.getByText("1 feature highlighted").parentElement).toHaveTextContent("1 feature highlighted*");
    expect(screen.getByText("Limited to 100 features per layer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear selected features" }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
