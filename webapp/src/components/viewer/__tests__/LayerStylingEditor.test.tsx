import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LayerStylingEditor } from "../LayerStylingEditor";
import { DEFAULT_STYLE } from "../utils";

describe("categorical styling editor", () => {
  it("offers categorical fields and hides numerical breakpoints for categories", () => {
    const onStyleChange = vi.fn();
    render(<LayerStylingEditor activeLayer={{ id: "zones", fields: ["zone"], numericFields: [], scalarFields: [{ name: "zone", type: "string", values: ["AE"] }] }} activeStyle={{ ...DEFAULT_STYLE, colorProperty: "zone", colorMode: "categorical" }} activeBreaks={[]} activeColors={[]} colorSectionOpen setColorSectionOpen={vi.fn()} sizeSectionOpen={false} setSizeSectionOpen={vi.fn()} onStyleChange={onStyleChange} />);
    expect(screen.getByRole("combobox", { name: "Color by property" })).toHaveTextContent("zone");
    expect(screen.queryByText("No numeric fields are available for color styling.")).not.toBeInTheDocument();
    expect(screen.queryByText("Breakpoints")).not.toBeInTheDocument();
    expect(screen.getByText(/categories receive stable colors/i)).toBeInTheDocument();
  });

  it("allows numeric codes to switch to categorical mode", () => {
    const onStyleChange = vi.fn();
    render(<LayerStylingEditor activeLayer={{ id: "codes", fields: ["code"], numericFields: [{ name: "code" }] }} activeStyle={{ ...DEFAULT_STYLE, colorProperty: "code" }} activeBreaks={[]} activeColors={[]} colorSectionOpen setColorSectionOpen={vi.fn()} sizeSectionOpen={false} setSizeSectionOpen={vi.fn()} onStyleChange={onStyleChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Categorical" }));
    expect(onStyleChange).toHaveBeenCalledWith(expect.objectContaining({ colorMode: "categorical", breaksText: "" }));
  });
});
