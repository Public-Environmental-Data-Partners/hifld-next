import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useState } from "react";

export interface SelectedFeatureTableRow {
	id: string;
	properties: Readonly<Record<string, string>>;
}

export type SelectedFeature = SelectedFeatureTableRow;

export interface SelectedFeaturesSort {
	column: string;
	direction: "asc" | "desc";
}

export interface SelectedFeaturesSortControl {
	sort: SelectedFeaturesSort | undefined;
	ariaLabel: string;
	onSort: () => void;
}

export interface SelectedFeaturesSearchControl {
	value: string;
	ariaLabel: string;
	placeholder: string;
	onChange: (value: string) => void;
}

export interface SelectedFeaturesTableProps<
	Feature extends SelectedFeatureTableRow,
> {
	features: readonly Feature[];
	columns?: readonly string[];
	tableAriaLabel?: string | undefined;
	searchAriaLabel?: string | undefined;
	searchPlaceholder?: string | undefined;
	highlightedFeatureId?: string | null | undefined;
	className?: string | undefined;
	tableClassName?: string | undefined;
	headerClassName?: string | undefined;
	headerRowClassName?: string | undefined;
	headerCellClassName?: string | undefined;
	bodyClassName?: string | undefined;
	rowClassName?: ((feature: Feature) => string | undefined) | undefined;
	cellClassName?:
		| ((feature: Feature, column: string) => string | undefined)
		| undefined;
	trailingHeaderClassName?: string | undefined;
	trailingCellClassName?:
		| ((feature: Feature) => string | undefined)
		| undefined;
	toolbarLeading?: ReactNode;
	showSearch?: boolean | undefined;
	toolbarClassName?: string | undefined;
	searchClassName?: string | undefined;
	searchInputClassName?: string | undefined;
	emptyClassName?: string | undefined;
	emptyMessage?: ReactNode;
	getSearchText?: ((feature: Feature) => readonly string[]) | undefined;
	isFeatureClickable?: (feature: Feature) => boolean;
	onFeatureClick?: (feature: Feature) => void;
	renderSearchInput?:
		| ((control: SelectedFeaturesSearchControl) => ReactNode)
		| undefined;
	renderColumnHeader?: (
		column: string,
		control: SelectedFeaturesSortControl,
	) => ReactNode;
	renderTrailingCell?: (feature: Feature) => ReactNode;
	trailingHeader?: ReactNode;
}

export function selectedFeaturePropertyColumns<
	Feature extends SelectedFeatureTableRow,
>(features: readonly Feature[], columns?: readonly string[]): string[] {
	if (columns !== undefined) {
		return [...columns];
	}

	const propertyNames = new Set<string>();
	for (const feature of features) {
		for (const propertyName of Object.keys(feature.properties)) {
			propertyNames.add(propertyName);
		}
	}
	return [...propertyNames].sort((left, right) => left.localeCompare(right));
}

export function SelectedFeaturesTable<Feature extends SelectedFeatureTableRow>({
	features,
	columns,
	tableAriaLabel = "Selected features",
	searchAriaLabel = "Search selected features",
	searchPlaceholder = "Search selected features...",
	highlightedFeatureId,
	className,
	tableClassName,
	headerClassName,
	headerRowClassName,
	headerCellClassName,
	bodyClassName,
	rowClassName,
	cellClassName,
	trailingHeaderClassName,
	trailingCellClassName,
	toolbarLeading,
	showSearch = true,
	toolbarClassName,
	searchClassName,
	searchInputClassName,
	emptyClassName,
	emptyMessage = "No selected features match the search.",
	getSearchText,
	isFeatureClickable,
	onFeatureClick,
	renderSearchInput,
	renderColumnHeader,
	renderTrailingCell,
	trailingHeader,
}: SelectedFeaturesTableProps<Feature>): ReactNode {
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<SelectedFeaturesSort>();
	const propertyColumns = selectedFeaturePropertyColumns(features, columns);
	const hasTrailingCell = renderTrailingCell !== undefined;
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const filteredFeatures = normalizedQuery
		? features.filter((feature) => {
				const searchableValues = [
					...Object.entries(feature.properties).flat(),
					...(getSearchText?.(feature) ?? []),
				];
				return searchableValues.some((value) =>
					value.toLocaleLowerCase().includes(normalizedQuery),
				);
			})
		: [...features];
	const visibleFeatures = sort
		? [...filteredFeatures].sort((left, right) => {
				const direction = sort.direction === "asc" ? 1 : -1;
				return (
					(left.properties[sort.column] ?? "").localeCompare(
						right.properties[sort.column] ?? "",
						undefined,
						{
							numeric: true,
							sensitivity: "base",
						},
					) * direction
				);
			})
		: filteredFeatures;

	if (features.length === 0) return null;

	const nextSort = (column: string): SelectedFeaturesSort => ({
		column,
		direction:
			sort?.column === column && sort.direction === "asc" ? "desc" : "asc",
	});
	const sortLabel = (column: string): string => {
		if (sort?.column !== column) return `Sort by ${column}`;
		return `Sort by ${column} ${sort.direction === "asc" ? "descending" : "ascending"}`;
	};
	const defaultSearchInput = (
		control: SelectedFeaturesSearchControl,
	): ReactNode => (
		<input
			type="search"
			aria-label={control.ariaLabel}
			className={searchInputClassName ?? "hifld-selected-features-search-input"}
			placeholder={control.placeholder}
			value={control.value}
			onChange={(event) => control.onChange(event.target.value)}
		/>
	);

	return (
		<>
			{toolbarLeading !== undefined || showSearch ? (
				<div
					className={toolbarClassName ?? "hifld-selected-features-toolbar"}
					data-slot="selected-features-toolbar"
				>
					{toolbarLeading}
					{showSearch ? (
						<div
							className={searchClassName ?? "hifld-selected-features-search"}
							data-slot="selected-features-search"
						>
							<Search aria-hidden="true" />
							{(renderSearchInput ?? defaultSearchInput)({
								value: query,
								ariaLabel: searchAriaLabel,
								placeholder: searchPlaceholder,
								onChange: setQuery,
							})}
						</div>
					) : null}
				</div>
			) : null}
			<div
				className={className ?? "hifld-selected-features-table"}
				data-slot="selected-features-scroll"
				data-testid="selected-features-scroll"
			>
				{visibleFeatures.length > 0 ? (
					<table
						aria-label={tableAriaLabel}
						className={tableClassName}
						data-slot="selected-features-table"
					>
						<thead className={headerClassName} data-slot="header">
							<tr className={headerRowClassName} data-slot="header-row">
								{propertyColumns.map((column) => {
									const control: SelectedFeaturesSortControl = {
										sort,
										ariaLabel: sortLabel(column),
										onSort: () => setSort(nextSort(column)),
									};
									return (
										<th
											aria-sort={
												sort?.column === column
													? sort.direction === "asc"
														? "ascending"
														: "descending"
													: "none"
											}
											className={headerCellClassName}
											data-slot="header-cell"
											key={column}
											scope="col"
										>
											{renderColumnHeader?.(column, control) ?? (
												<button
													type="button"
													className="hifld-selected-features-sort-button"
													aria-label={control.ariaLabel}
													onClick={control.onSort}
												>
													<span>{column}</span>
													{sort?.column !== column ? (
														<ChevronsUpDown aria-hidden="true" />
													) : sort.direction === "asc" ? (
														<ArrowUp aria-hidden="true" />
													) : (
														<ArrowDown aria-hidden="true" />
													)}
												</button>
											)}
										</th>
									);
								})}
								{hasTrailingCell ? (
									<th
										className={trailingHeaderClassName}
										data-slot="trailing-header"
										scope="col"
									>
										{trailingHeader ?? "Actions"}
									</th>
								) : null}
							</tr>
						</thead>
						<tbody className={bodyClassName} data-slot="body">
							{visibleFeatures.map((feature) => {
								const isHighlighted = feature.id === highlightedFeatureId;
								const isClickable =
									onFeatureClick !== undefined &&
									(isFeatureClickable?.(feature) ?? true);
								return (
									<tr
										data-highlighted={isHighlighted ? "true" : undefined}
										data-slot="row"
										data-testid="selected-feature-row"
										data-clickable={isClickable ? "true" : undefined}
										className={rowClassName?.(feature)}
										key={feature.id}
										onClick={
											isClickable ? () => onFeatureClick(feature) : undefined
										}
										onKeyDown={
											!isClickable
												? undefined
												: (event: KeyboardEvent<HTMLTableRowElement>) => {
														if (event.key === "Enter" || event.key === " ") {
															event.preventDefault();
															onFeatureClick(feature);
														}
													}
										}
										tabIndex={isClickable ? 0 : undefined}
									>
										{propertyColumns.map((column) => (
											<td
												className={cellClassName?.(feature, column)}
												data-slot="cell"
												key={column}
											>
												{feature.properties[column] ?? ""}
											</td>
										))}
										{renderTrailingCell !== undefined ? (
											<td
												data-slot="trailing-cell"
												data-testid={`selected-features-actions-${feature.id}`}
												className={trailingCellClassName?.(feature)}
											>
												{renderTrailingCell(feature)}
											</td>
										) : null}
									</tr>
								);
							})}
						</tbody>
					</table>
				) : (
					<div className={emptyClassName ?? "hifld-selected-features-empty"}>
						{emptyMessage}
					</div>
				)}
			</div>
		</>
	);
}
