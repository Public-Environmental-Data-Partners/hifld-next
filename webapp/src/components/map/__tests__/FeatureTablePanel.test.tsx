import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FeatureTablePanel, formatDiffCellDisplay } from "../FeatureTablePanel";
import type { SelectedFeatureProperties, SelectedMapFeature } from "../featureSelection";

const originalResizeObserver = globalThis.ResizeObserver;

beforeAll(() => {
  class TestResizeObserver implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = TestResizeObserver;
});

afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
});

function selectedFeature(
  version: string,
  properties: SelectedFeatureProperties,
  overrides: Partial<SelectedMapFeature> = {},
): SelectedMapFeature {
  return {
    id: `feature-${version}`,
    loadedLayerId: `layer-${version}`,
    layerName: `Hospitals / ${version}`,
    collectionSlug: "hifld",
    datasetSlug: "hospitals-3",
    fileSlug: "hospitals-3",
    version,
    sourceId: version === "v1.0.0" ? 15 : 17,
    sourceLayerId: "hospitals-3",
    featureId: `feature-${version}`,
    centroid: { lng: -77.0365, lat: 38.8977 },
    properties,
    ...overrides,
  };
}

describe("FeatureTablePanel", () => {
  it("renders selected feature rows and cap messaging", () => {
    render(
      <FeatureTablePanel
        features={[selectedFeature("v1.0.0", { OBJECTID: "1", NAME: "General Hospital" })]}
        wasSelectionCapped
        s2Level={16}
        onS2LevelChange={() => undefined}
        onClear={() => undefined}
      />,
    );

    expect(screen.getByText("1 selected features")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Selected features" })).not.toBeInTheDocument();
    expect(screen.getByText("General Hospital")).toBeInTheDocument();
    expect(screen.getByText("Selection is capped at 100 features per layer.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear selected features" })).toHaveClass("h-11", "w-11", "sm:size-9");
  });

  it("keeps selected feature controls and table scrolling constrained for narrow panels", () => {
    render(
      <FeatureTablePanel
        features={[selectedFeature("v1.0.0", { OBJECTID: "1", NAME: "General Hospital" })]}
        wasSelectionCapped={false}
        s2Level={16}
        onS2LevelChange={() => undefined}
        onClear={() => undefined}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Select layer" })).toHaveClass("h-11", "sm:h-8", "w-full");
    expect(screen.getByRole("combobox", { name: "Version" })).toHaveClass("h-11", "sm:h-8", "w-full");
    expect(screen.getByPlaceholderText("Search selected features...")).toHaveClass("h-11", "sm:h-8");
    expect(screen.getByTestId("selected-features-scroll")).toHaveClass(
      "overflow-x-auto",
      "sm:overflow-auto",
      "sm:overscroll-contain",
    );
  });

  it("scopes selected feature rows by layer and version selectors", () => {
    render(
      <FeatureTablePanel
        features={[
          selectedFeature("v1.0.0", { OBJECTID: "1", NAME: "Original Hospital" }),
          selectedFeature("v1.1.0", { OBJECTID: "1", NAME: "Updated Hospital" }),
        ]}
        wasSelectionCapped={false}
        s2Level={16}
        onS2LevelChange={() => undefined}
        onClear={() => undefined}
      />,
    );

    expect(screen.getByText("Original Hospital")).toBeInTheDocument();
    expect(screen.queryByText("Updated Hospital")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Layer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Version" })).not.toBeInTheDocument();
  });

  it("sorts selected feature rows by property columns", async () => {
    const user = userEvent.setup();
    render(
      <FeatureTablePanel
        features={[
          selectedFeature("v1.0.0", { OBJECTID: "2", NAME: "Beta Hospital", BEDS: "20" }, { id: "selected-beta" }),
          selectedFeature("v1.0.0", { OBJECTID: "1", NAME: "Alpha Hospital", BEDS: "10" }, { id: "selected-alpha" }),
        ]}
        wasSelectionCapped={false}
        s2Level={16}
        onS2LevelChange={() => undefined}
        onClear={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Sort by NAME" }));

    const rows = screen.getAllByTestId("selected-feature-row");
    expect(rows[0]).toHaveTextContent("Alpha Hospital");
    expect(rows[1]).toHaveTextContent("Beta Hospital");
  });

  it("highlights hovered selected feature rows and supports row click zoom callbacks", async () => {
    const user = userEvent.setup();
    const onFeatureClick = vi.fn();
    const feature = selectedFeature("v1.0.0", { OBJECTID: "1", NAME: "Alpha Hospital" }, { id: "selected-alpha" });
    render(
      <FeatureTablePanel
        features={[feature]}
        highlightedFeatureId="selected-alpha"
        onFeatureClick={onFeatureClick}
        wasSelectionCapped={false}
        s2Level={16}
        onS2LevelChange={() => undefined}
        onClear={() => undefined}
      />,
    );

    const row = screen.getByTestId("selected-feature-row");
    expect(row).toHaveClass("bg-accent/50");
    expect(row).not.toHaveAttribute("role", "button");

    await user.click(row);

    expect(onFeatureClick).toHaveBeenCalledTimes(1);
    expect(onFeatureClick).toHaveBeenLastCalledWith(feature);

    await user.click(screen.getByRole("button", { name: `Zoom to feature ${feature.featureId}` }));

    expect(onFeatureClick).toHaveBeenCalledTimes(2);
    expect(onFeatureClick).toHaveBeenLastCalledWith(feature);
  });

  it("hides source layer ids and feature counts from selector labels", () => {
    render(
      <FeatureTablePanel
        features={[
          selectedFeature("v1.0.0", { OBJECTID: "1", NAME: "Original Hospital" }, {
            sourceLayerId: "hospitals3chunk0fgb",
          }),
          selectedFeature("v1.1.0", { OBJECTID: "1", NAME: "Updated Hospital" }, {
            sourceLayerId: "hospitals3chunk0fgb",
          }),
        ]}
        wasSelectionCapped={false}
        s2Level={16}
        onS2LevelChange={() => undefined}
        onClear={() => undefined}
      />,
    );

    expect(screen.getByText("hospitals-3")).toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    expect(screen.queryByText("hospitals3chunk0fgb")).not.toBeInTheDocument();
    expect(screen.queryByText("v1.0.0 (1)")).not.toBeInTheDocument();
  });

  it("renders version diff rows for two versions of the same file", async () => {
    const user = userEvent.setup();
    render(
      <FeatureTablePanel
        features={[
          selectedFeature("v1.0.0", { OBJECTID: "1", BEDS: "10", CLOSED: "Y" }),
          selectedFeature("v1.1.0", { OBJECTID: "1", BEDS: "12", OPENED: "Y" }),
        ]}
        wasSelectionCapped={false}
        s2Level={16}
        onS2LevelChange={() => undefined}
        onClear={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Version diff" }));
    expect(screen.getByRole("button", { name: "Selected features" })).toHaveClass("min-h-11", "sm:min-h-8");
    expect(screen.getByRole("button", { name: "Version diff" })).toHaveClass("min-h-11", "sm:min-h-8");
    expect(screen.getByTestId("feature-diff-scroll")).toHaveClass("overflow-auto", "overscroll-contain");
    expect(screen.queryByText("1 changed")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Left version" })).toHaveValue("v1.0.0");
    expect(screen.getByRole("combobox", { name: "Right version" })).toHaveValue("v1.1.0");
    expect(screen.getByRole("button", { name: "Sort by status" })).toHaveTextContent("Match");
    expect(screen.queryByText("v1.0.0 table")).not.toBeInTheDocument();
    expect(screen.queryByText("v1.1.0 table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sort by OBJECTID" })).not.toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.queryByText("changed in next version")).not.toBeInTheDocument();
    expect(screen.getByText("from 10")).toBeInTheDocument();
    expect(screen.queryByLabelText("v1.0.0 BEDS changed")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("v1.0.0 CLOSED removed")).not.toBeInTheDocument();
    expect(screen.getByLabelText("v1.1.0 OPENED added")).toBeInTheDocument();
    expect(screen.getByLabelText("v1.1.0 BEDS changed")).toHaveClass("bg-amber-500/15");
    expect(screen.getByLabelText("v1.1.0 CLOSED removed")).toHaveClass("bg-rose-500/10");
    expect(screen.getByLabelText("v1.1.0 CLOSED removed")).toHaveTextContent("Removed");
    expect(screen.getByLabelText("v1.1.0 CLOSED removed")).toHaveTextContent("from Y");
    expect(screen.getByLabelText("v1.1.0 OPENED added")).toHaveTextContent("from not present");
  });

  it("highlights hovered diff rows and supports row click zoom callbacks", async () => {
    const user = userEvent.setup();
    const onFeatureClick = vi.fn();
    const leftFeature = selectedFeature("v1.0.0", { OBJECTID: "1", BEDS: "10" }, { id: "left-selected" });
    const rightFeature = selectedFeature("v1.1.0", { OBJECTID: "1", BEDS: "12" }, { id: "right-selected" });
    render(
      <FeatureTablePanel
        features={[leftFeature, rightFeature]}
        highlightedFeatureId="right-selected"
        onFeatureClick={onFeatureClick}
        wasSelectionCapped={false}
        s2Level={16}
        onS2LevelChange={() => undefined}
        onClear={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Version diff" }));
    const row = screen.getByTestId("feature-diff-row");
    expect(row).toHaveClass("bg-accent/50");
    expect(row).not.toHaveAttribute("role", "button");
    expect(row.querySelector("td")).toHaveClass("bg-accent/50");

    await user.click(row);

    expect(onFeatureClick).toHaveBeenCalledTimes(1);
    expect(onFeatureClick).toHaveBeenLastCalledWith(rightFeature);

    await user.click(screen.getByRole("button", { name: /Zoom to diff row/ }));

    expect(onFeatureClick).toHaveBeenCalledTimes(2);
    expect(onFeatureClick).toHaveBeenLastCalledWith(rightFeature);
  });

  it("falls back to the old diff feature when the new side lacks a centroid", async () => {
    const user = userEvent.setup();
    const onFeatureClick = vi.fn();
    const leftFeature = selectedFeature("v1.0.0", { OBJECTID: "1", BEDS: "10" }, { id: "left-selected" });
    const rightFeature = selectedFeature("v1.1.0", { OBJECTID: "1", BEDS: "12" }, {
      id: "right-selected",
      centroid: null,
    });
    render(
      <FeatureTablePanel
        features={[leftFeature, rightFeature]}
        onFeatureClick={onFeatureClick}
        wasSelectionCapped={false}
        s2Level={16}
        onS2LevelChange={() => undefined}
        onClear={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Version diff" }));
    await user.click(screen.getByTestId("feature-diff-row"));

    expect(onFeatureClick).toHaveBeenCalledWith(leftFeature);
  });

  it("defaults the diff grid to changed columns and can switch to all columns", async () => {
    const user = userEvent.setup();
    render(
      <FeatureTablePanel
        features={[
          selectedFeature("v1.0.0", { OBJECTID: "1", NAME: "General Hospital", BEDS: "10", STATE: "UT" }),
          selectedFeature("v1.1.0", { OBJECTID: "1", NAME: "General Hospital", BEDS: "12", STATE: "UT" }),
        ]}
        wasSelectionCapped={false}
        s2Level={16}
        onS2LevelChange={() => undefined}
        onClear={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Version diff" }));
    expect(screen.getByRole("combobox", { name: "Columns" })).toHaveTextContent("Changed columns");
    expect(screen.queryByRole("button", { name: "Sort by OBJECTID" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sort by STATE" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Columns" }), "all");

    expect(screen.getByRole("button", { name: "Sort by OBJECTID" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sort by STATE" })).toBeInTheDocument();
  });

  it("formats diff cells with one-sided changed, added, and removed explanations", () => {
    expect(
      formatDiffCellDisplay(
        { left: "10", right: "12", leftPresent: true, rightPresent: true, status: "changed" },
        "right",
      ),
    ).toMatchObject({ value: "12", detail: "from 10", tone: "changed" });
    expect(
      formatDiffCellDisplay(
        { left: "", right: "Y", leftPresent: false, rightPresent: true, status: "added" },
        "right",
      ),
    ).toMatchObject({ value: "Y", detail: "from not present", tone: "added" });
    expect(
      formatDiffCellDisplay(
        { left: "Y", right: "", leftPresent: true, rightPresent: false, status: "removed" },
        "right",
      ),
    ).toMatchObject({ value: "Removed", detail: "from Y", tone: "removed" });
    expect(
      formatDiffCellDisplay(
        { left: "Y", right: "", leftPresent: true, rightPresent: false, status: "removed" },
        "left",
      ),
    ).toMatchObject({ value: "Y", detail: undefined, tone: "neutral" });
  });

  it("hides the version diff button for selections that cannot be compared", () => {
    render(
      <FeatureTablePanel
        features={[selectedFeature("v1.0.0", { OBJECTID: "1", NAME: "General Hospital" })]}
        wasSelectionCapped={false}
        s2Level={16}
        onS2LevelChange={() => undefined}
        onClear={() => undefined}
      />,
    );

    expect(screen.queryByRole("button", { name: "Version diff" })).not.toBeInTheDocument();
  });

  it("uses selected left and right match keys to pair diff rows", async () => {
    const user = userEvent.setup();
    render(
      <FeatureTablePanel
        features={[
          selectedFeature("v1.0.0", { OBJECTID: "1", OLD_ID: "100", NAME: "Northside Hospital", BEDS: "10" }),
          selectedFeature("v1.1.0", { OBJECTID: "2", NEW_ID: "100", NAME: "Northside Hospital Campus", BEDS: "12" }),
        ]}
        wasSelectionCapped={false}
        s2Level={16}
        onS2LevelChange={() => undefined}
        onClear={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Version diff" }));
    expect(screen.getByText("left only")).toBeInTheDocument();
    expect(screen.getByText("right only")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Match row keys" }));
    expect(screen.getByText("v1.0.0 key")).toBeInTheDocument();
    expect(screen.getByText("v1.1.0 key")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Left match key 1" }), "OLD_ID");
    await user.selectOptions(screen.getByRole("combobox", { name: "Right match key 1" }), "NEW_ID");

    expect(screen.getByText("changed")).toBeInTheDocument();
    expect(screen.queryByText("left only")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Feature" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Match keys" })).toBeInTheDocument();
    expect(screen.getByText("OLD_ID -> NEW_ID")).toBeInTheDocument();
    expect(screen.getAllByText("100").length).toBeGreaterThan(0);
  });

  it("collapses match key picker when clicking outside it", async () => {
    const user = userEvent.setup();
    render(
      <FeatureTablePanel
        features={[
          selectedFeature("v1.0.0", { OBJECTID: "1", NAME: "Original Hospital" }),
          selectedFeature("v1.1.0", { OBJECTID: "1", NAME: "Updated Hospital" }),
        ]}
        wasSelectionCapped={false}
        s2Level={16}
        onS2LevelChange={() => undefined}
        onClear={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Version diff" }));
    await user.click(screen.getByRole("button", { name: "Match row keys" }));
    expect(screen.getByRole("combobox", { name: "Left match key 1" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Selected features" }));

    expect(screen.queryByRole("combobox", { name: "Left match key 1" })).not.toBeInTheDocument();
  });

  it("keeps geometry match selectors visible and constrained", async () => {
    const user = userEvent.setup();
    render(
      <FeatureTablePanel
        features={[
          selectedFeature("v1.0.0", { OBJECTID: "1", NAME: "Original Hospital" }),
          selectedFeature("v1.1.0", { OBJECTID: "1", NAME: "Updated Hospital" }),
        ]}
        wasSelectionCapped={false}
        s2Level={16}
        onS2LevelChange={() => undefined}
        onClear={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Version diff" }));
    await user.click(screen.getByRole("button", { name: "Match row keys" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Left match key 1" }), "__geometry__");
    await user.selectOptions(screen.getByRole("combobox", { name: "Right match key 1" }), "__geometry__");

    expect(screen.getByRole("button", { name: "Match row keys" })).toHaveTextContent("Match rows");
    expect(screen.getByText("Match rows by").parentElement).toHaveAttribute("data-slot", "popover-content");
    expect(screen.getByText("Match rows by").parentElement).toHaveAttribute("data-side", "bottom");
    expect(screen.getByText("Match rows by").parentElement).toHaveAttribute("data-align", "end");
    expect(screen.getByText("Match rows by").parentElement).toHaveClass("w-64");
    expect(screen.getByText("Match rows by").parentElement).not.toHaveClass("absolute");
    expect(screen.getByRole("combobox", { name: "Left match key 1" })).toHaveClass("w-full");
    expect(screen.getByRole("combobox", { name: "Right match key 1" })).toHaveClass("w-full");
    expect(screen.getByText("Geographic tolerance")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Tight (~100 m)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Normal (~500 m)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Loose (~2 km)" })).toBeInTheDocument();
    await user.hover(screen.getByLabelText("Explain geographic tolerance"));
    expect((await screen.findAllByText(/Uses S2 grid cells/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText("geographic")).not.toBeInTheDocument();
    expect(screen.queryByText("s2")).not.toBeInTheDocument();
  });

  it("allows selecting which version appears in each side-by-side table", async () => {
    const user = userEvent.setup();
    render(
      <FeatureTablePanel
        features={[
          selectedFeature("v1.0.0", { OBJECTID: "1", NAME: "Original Hospital" }),
          selectedFeature("v1.1.0", { OBJECTID: "1", NAME: "Updated Hospital" }),
        ]}
        wasSelectionCapped={false}
        s2Level={16}
        onS2LevelChange={() => undefined}
        onClear={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Version diff" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Left version" }), "v1.1.0");

    expect(screen.getByRole("combobox", { name: "Left version" })).toHaveValue("v1.1.0");
    expect(screen.getByRole("combobox", { name: "Right version" })).toHaveValue("v1.0.0");
  });

  it("sorts diff rows by property columns", async () => {
    const user = userEvent.setup();
    render(
      <FeatureTablePanel
        features={[
          selectedFeature("v1.0.0", { OBJECTID: "1", NAME: "Beta", BEDS: "10" }, { id: "left-beta" }),
          selectedFeature("v1.1.0", { OBJECTID: "1", NAME: "Beta", BEDS: "12" }, { id: "right-beta" }),
          selectedFeature("v1.0.0", { OBJECTID: "2", NAME: "Alpha", BEDS: "8" }, { id: "left-alpha" }),
          selectedFeature("v1.1.0", { OBJECTID: "2", NAME: "Alpha", BEDS: "8" }, { id: "right-alpha" }),
        ]}
        wasSelectionCapped={false}
        s2Level={16}
        onS2LevelChange={() => undefined}
        onClear={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Version diff" }));
    await user.click(screen.getAllByRole("button", { name: "Sort by BEDS" })[0]);

    const rows = screen.getAllByTestId("feature-diff-row");
    expect(rows[0]).toHaveTextContent("8");
    expect(rows[1]).toHaveTextContent("12");
  });

  it("sorts diff rows by all-column-only property columns", async () => {
    const user = userEvent.setup();
    render(
      <FeatureTablePanel
        features={[
          selectedFeature("v1.0.0", { OBJECTID: "1", NAME: "Beta", BEDS: "10", STATE: "WY" }, { id: "left-beta" }),
          selectedFeature("v1.1.0", { OBJECTID: "1", NAME: "Beta", BEDS: "12", STATE: "WY" }, { id: "right-beta" }),
          selectedFeature("v1.0.0", { OBJECTID: "2", NAME: "Alpha", BEDS: "8", STATE: "AL" }, { id: "left-alpha" }),
          selectedFeature("v1.1.0", { OBJECTID: "2", NAME: "Alpha", BEDS: "8", STATE: "AL" }, { id: "right-alpha" }),
        ]}
        wasSelectionCapped={false}
        s2Level={16}
        onS2LevelChange={() => undefined}
        onClear={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Version diff" }));
    expect(screen.queryByRole("button", { name: "Sort by STATE" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Columns" }), "all");
    await user.click(screen.getByRole("button", { name: "Sort by STATE" }));

    const rows = screen.getAllByTestId("feature-diff-row");
    expect(rows[0]).toHaveTextContent("AL");
    expect(rows[1]).toHaveTextContent("WY");
  });
});
