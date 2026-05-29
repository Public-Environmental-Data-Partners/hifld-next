import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MapLegend } from "../MapLegend";

describe("MapLegend", () => {
  it("uses the styled field as the legend heading", () => {
    render(
      <MapLegend
        title="BEDS"
        groups={[
          {
            id: "hospitals-v1",
            title: "Hospitals / v1.1.0",
            field: "BEDS",
            items: [
              { label: "<= 10", color: "#440154" },
              { label: "> 10", color: "#fde725" },
            ],
          },
        ]}
        visible
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "BEDS" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Legend" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide BEDS" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.getByText("Hospitals / v1.1.0")).toBeInTheDocument();
    expect(screen.getByText("Color by BEDS")).toBeInTheDocument();
  });

  it("renders multiple styled layer groups in one map overlay", () => {
    render(
      <MapLegend
        title="Layer colors"
        groups={[
          {
            id: "hospitals-v1",
            title: "Hospitals / v1.1.0",
            field: "BEDS",
            items: [{ label: "> 10", color: "#fde725" }],
          },
          {
            id: "schools-v1",
            title: "Schools / v1.0.0",
            field: "ENROLLMENT",
            items: [{ label: "> 500", color: "#21918c" }],
          },
        ]}
        visible
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Layer colors" })).toBeInTheDocument();
    expect(screen.getByText("Hospitals / v1.1.0")).toBeInTheDocument();
    expect(screen.getByText("Color by BEDS")).toBeInTheDocument();
    expect(screen.getByText("Schools / v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("Color by ENROLLMENT")).toBeInTheDocument();
  });

  it("keeps the legend items in a constrained scroll region", () => {
    render(
      <MapLegend
        title="BEDS"
        groups={[
          {
            id: "hospitals-v1",
            title: "Hospitals / v1.1.0",
            field: "BEDS",
            items: Array.from({ length: 12 }, (_, index) => ({
              label: `${index * 10} - ${(index + 1) * 10}`,
              color: "#440154",
            })),
          },
        ]}
        visible
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByTestId("map-legend-scroll")).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");
  });

  it("renders a solid-color layer group without calling it a generic legend", () => {
    render(
      <MapLegend
        title="Layer colors"
        groups={[
          {
            id: "hospitals-v1",
            title: "Hospitals / v1.1.0",
            items: [{ label: "All values", color: "#440154" }],
          },
        ]}
        visible
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Layer colors" })).toBeInTheDocument();
    expect(screen.getByText("Solid color")).toBeInTheDocument();
    expect(screen.getByText("All values")).toBeInTheDocument();
  });
});
