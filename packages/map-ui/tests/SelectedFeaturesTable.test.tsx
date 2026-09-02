// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SelectedFeatureTableRow } from "../src";
import { SelectedFeaturesTable, selectedFeaturePropertyColumns } from "../src";

interface AppFeature extends SelectedFeatureTableRow {
	layer: string;
}

const features: AppFeature[] = [
	{ id: "b", layer: "south", properties: { name: "Bravo", zone: "2" } },
	{ id: "a", layer: "north", properties: { name: "Alpha", city: "Austin" } },
];

afterEach(() => cleanup());

describe("selectedFeaturePropertyColumns", () => {
	it("returns the sorted union of properties across features", () => {
		expect(selectedFeaturePropertyColumns(features)).toEqual([
			"city",
			"name",
			"zone",
		]);
	});

	it("uses supplied columns without changing their order", () => {
		expect(selectedFeaturePropertyColumns(features, ["zone", "name"])).toEqual([
			"zone",
			"name",
		]);
	});
});

describe("SelectedFeaturesTable", () => {
	it("renders no table when there are no features", () => {
		render(<SelectedFeaturesTable features={[]} />);
		expect(screen.queryByRole("table")).not.toBeInTheDocument();
	});

	it("renders semantic headers and cells, including missing values", () => {
		render(<SelectedFeaturesTable features={features} />);
		expect(
			screen.getByRole("table", { name: "Selected features" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("columnheader", { name: "name" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("columnheader", { name: "city" }),
		).toBeInTheDocument();
		expect(screen.getAllByRole("cell", { name: "Bravo" })).toHaveLength(1);
		expect(screen.getAllByRole("cell", { name: "" })).toHaveLength(2);
		expect(screen.getAllByTestId("selected-feature-row")[0]).toHaveAttribute(
			"data-slot",
			"row",
		);
		expect(
			document.querySelector('[data-slot="selected-features-scroll"]'),
		).toBeInTheDocument();
		expect(
			document.querySelector('[data-slot="trailing-header"]'),
		).not.toBeInTheDocument();
	});

	it("marks the highlighted row and activates clicks", () => {
		const onFeatureClick = vi.fn();
		render(
			<SelectedFeaturesTable
				features={features}
				highlightedFeatureId={"a" as string | null | undefined}
				isFeatureClickable={(feature) => feature.layer === "north"}
				onFeatureClick={onFeatureClick}
			/>,
		);
		const row = screen.getAllByTestId("selected-feature-row")[1];
		if (!row) throw new Error("Expected highlighted row");
		expect(row).toHaveAttribute("data-highlighted", "true");
		fireEvent.click(row);
		expect(onFeatureClick).toHaveBeenCalledWith(features[1]);
	});

	it("only activates rows allowed by isFeatureClickable and preserves generic callbacks", () => {
		const onFeatureClick = vi.fn<(feature: AppFeature) => void>();
		render(
			<SelectedFeaturesTable
				features={features}
				isFeatureClickable={(feature) => feature.id === "a"}
				onFeatureClick={onFeatureClick}
			/>,
		);
		const rows = screen.getAllByTestId("selected-feature-row");
		expect(rows[0]).not.toHaveAttribute("tabindex");
		expect(rows[1]).toHaveAttribute("tabindex", "0");
		const firstRow = rows[0];
		const secondRow = rows[1];
		if (!firstRow || !secondRow) throw new Error("Expected two feature rows");
		fireEvent.click(firstRow);
		expect(onFeatureClick).not.toHaveBeenCalled();
		fireEvent.click(secondRow);
		expect(onFeatureClick).toHaveBeenCalledWith(features[1]);
	});

	it("renders custom actions in a trailing column", () => {
		render(
			<SelectedFeaturesTable
				features={features}
				renderTrailingCell={(feature) => (
					<button type="button">Open {feature.id}</button>
				)}
				renderColumnHeader={(column) => <span>Column: {column}</span>}
				trailingHeader={<span>Tools</span>}
			/>,
		);
		expect(
			screen.getByRole("columnheader", { name: "Tools" }),
		).toBeInTheDocument();
		expect(screen.getByRole("columnheader", { name: "Tools" })).toHaveAttribute(
			"data-slot",
			"trailing-header",
		);
		expect(
			screen.getByRole("columnheader", { name: "Column: name" }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Open b" })).toBeInTheDocument();
		expect(screen.getByTestId("selected-features-actions-b")).toHaveAttribute(
			"data-slot",
			"trailing-cell",
		);
	});

	it("accepts declarative presentation classes for host adapters", () => {
		render(
			<SelectedFeaturesTable
				features={features}
				className="host-container"
				tableClassName="host-table"
				headerClassName="host-header"
				headerRowClassName="host-header-row"
				headerCellClassName="host-header-cell"
				bodyClassName="host-body"
				rowClassName={(feature) => `host-row-${feature.id}`}
				cellClassName={(feature, column) => `host-cell-${feature.id}-${column}`}
				renderTrailingCell={() => "Action"}
				trailingHeaderClassName="host-trailing-header"
				trailingCellClassName={(feature) => `host-trailing-${feature.id}`}
			/>,
		);

		expect(
			document.querySelector('[data-slot="selected-features-scroll"]'),
		).toHaveClass("host-container");
		expect(screen.getByRole("table")).toHaveClass("host-table");
		expect(document.querySelector('[data-slot="header"]')).toHaveClass(
			"host-header",
		);
		expect(document.querySelector('[data-slot="header-row"]')).toHaveClass(
			"host-header-row",
		);
		expect(document.querySelector('[data-slot="header-cell"]')).toHaveClass(
			"host-header-cell",
		);
		expect(document.querySelector('[data-slot="body"]')).toHaveClass(
			"host-body",
		);
		expect(screen.getAllByTestId("selected-feature-row")[0]).toHaveClass(
			"host-row-b",
		);
		expect(screen.getByRole("cell", { name: "Bravo" })).toHaveClass(
			"host-cell-b-name",
		);
		expect(screen.getByTestId("selected-features-actions-b")).toHaveClass(
			"host-trailing-b",
		);
		expect(document.querySelector('[data-slot="trailing-header"]')).toHaveClass(
			"host-trailing-header",
		);
	});

	it("searches visible properties and host-provided feature metadata", () => {
		render(
			<SelectedFeaturesTable
				features={features}
				getSearchText={(feature) => [feature.layer]}
			/>,
		);

		const search = screen.getByRole("searchbox", {
			name: "Search selected features",
		});
		fireEvent.change(search, { target: { value: "alpha" } });
		expect(screen.getAllByTestId("selected-feature-row")).toHaveLength(1);
		expect(screen.getByRole("cell", { name: "Alpha" })).toBeInTheDocument();

		fireEvent.change(search, { target: { value: "south" } });
		expect(screen.getAllByTestId("selected-feature-row")).toHaveLength(1);
		expect(screen.getByRole("cell", { name: "Bravo" })).toBeInTheDocument();

		fireEvent.change(search, { target: { value: "missing" } });
		expect(
			screen.queryByRole("table", { name: "Selected features" }),
		).not.toBeInTheDocument();
		expect(
			screen.getByText("No selected features match the search."),
		).toBeInTheDocument();
	});

	it("can omit search without leaving an empty toolbar", () => {
		render(<SelectedFeaturesTable features={features} showSearch={false} />);

		expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
		expect(
			document.querySelector('[data-slot="selected-features-toolbar"]'),
		).not.toBeInTheDocument();
		expect(
			screen.getByRole("table", { name: "Selected features" }),
		).toBeInTheDocument();
	});

	it("accepts host-specific accessible table and search labels", () => {
		render(
			<SelectedFeaturesTable
				features={features}
				tableAriaLabel="Query results"
				searchAriaLabel="Search query results"
				searchPlaceholder="Search result rows..."
			/>,
		);

		expect(
			screen.getByRole("table", { name: "Query results" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("searchbox", { name: "Search query results" }),
		).toHaveAttribute("placeholder", "Search result rows...");
	});

	it("sorts property columns in ascending and descending numeric-aware order", () => {
		const numericFeatures: AppFeature[] = [
			{ id: "ten", layer: "north", properties: { rank: "10" } },
			{ id: "two", layer: "south", properties: { rank: "2" } },
		];
		render(
			<SelectedFeaturesTable features={numericFeatures} columns={["rank"]} />,
		);

		fireEvent.click(screen.getByRole("button", { name: "Sort by rank" }));
		expect(
			screen
				.getAllByTestId("selected-feature-row")
				.map((row) => row.textContent),
		).toEqual(["2", "10"]);

		fireEvent.click(
			screen.getByRole("button", { name: "Sort by rank descending" }),
		);
		expect(
			screen
				.getAllByTestId("selected-feature-row")
				.map((row) => row.textContent),
		).toEqual(["10", "2"]);
	});
});
