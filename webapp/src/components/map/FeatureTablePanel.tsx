import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  ExternalLink,
  Info,
  MessageSquareWarning,
  MoreHorizontal,
  Search,
  X,
} from "lucide-react";
import * as React from "react";
import { DataQualityFeedbackDialog } from "@/components/dataset/DataQualityFeedbackDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { googleMapsSearchUrl } from "@/lib/externalMaps";
import { cn } from "@/lib/utils";
import {
  buildFeatureDiff,
  changedFeatureDiffColumns,
  comparableFeatureDiffVersions,
  defaultFeatureDiffMatchKeyPairs,
  type FeatureDiffCell,
  type FeatureDiffCellStatus,
  type FeatureDiffColumn,
  type FeatureDiffMatchKeyPair,
  type FeatureDiffResult,
  type FeatureDiffRow,
  type FeatureDiffSort,
  type FeatureDiffStatus,
  featureDiffMatchKeyOptions,
  GEOMETRY_MATCH_COLUMN,
  isComparableFeatureDiffSelection,
} from "./featureDiff";
import type { SelectedMapFeature } from "./featureSelection";

interface FeatureTablePanelProps {
  features: SelectedMapFeature[];
  highlightedFeatureId?: string | null | undefined;
  wasSelectionCapped: boolean;
  s2Level: number;
  onS2LevelChange: (level: number) => void;
  onFeatureClick?: ((feature: SelectedMapFeature) => void) | undefined;
  onClear: () => void;
}

type FeaturePanelTab = "selected" | "diff";
type DiffCellSide = "left" | "right";
type DiffColumnMode = "changed" | "all";

const S2_LEVEL_OPTIONS = [
  { label: "Tight (~100 m)", value: 18 },
  { label: "Normal (~500 m)", value: 16 },
  { label: "Loose (~2 km)", value: 14 },
];

function sortedPropertyKeys(features: SelectedMapFeature[]): string[] {
  return [...new Set(features.flatMap((feature) => Object.keys(feature.properties)))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 10);
}

function featureMatchesQuery(feature: SelectedMapFeature, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  const haystack = [
    feature.layerName,
    feature.version,
    feature.sourceLayerId,
    feature.featureId,
    ...Object.entries(feature.properties).flat(),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(normalizedQuery);
}

interface FeatureGroupOption {
  key: string;
  label: string;
  versions: string[];
  countByVersion: Map<string, number>;
}

function layerKeyForFeature(feature: SelectedMapFeature): string {
  return [feature.collectionSlug, feature.datasetSlug, feature.fileSlug, feature.sourceLayerId].join(":");
}

function layerLabelForFeature(feature: SelectedMapFeature): string {
  if (feature.datasetSlug === feature.fileSlug) {
    return feature.datasetSlug;
  }
  return `${feature.datasetSlug} / ${feature.fileSlug}`;
}

function buildFeatureGroupOptions(features: SelectedMapFeature[]): FeatureGroupOption[] {
  const groups = new Map<string, FeatureGroupOption>();

  for (const feature of features) {
    const key = layerKeyForFeature(feature);
    const existing = groups.get(key);
    if (existing) {
      existing.countByVersion.set(feature.version, (existing.countByVersion.get(feature.version) ?? 0) + 1);
      continue;
    }

    groups.set(key, {
      key,
      label: layerLabelForFeature(feature),
      versions: [],
      countByVersion: new Map([[feature.version, 1]]),
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      versions: [...group.countByVersion.keys()].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function selectedFeatureSubset({
  features,
  selectedLayerKey,
  selectedVersion,
}: {
  features: SelectedMapFeature[];
  selectedLayerKey: string;
  selectedVersion: string;
}): SelectedMapFeature[] {
  return features.filter(
    (feature) => layerKeyForFeature(feature) === selectedLayerKey && feature.version === selectedVersion,
  );
}

function selectedFeatureSortValue(feature: SelectedMapFeature, column: string): string {
  if (column === "feature") {
    return feature.featureId;
  }
  return feature.properties[column] ?? "";
}

function sortSelectedFeatures(features: SelectedMapFeature[], sort: FeatureDiffSort | undefined): SelectedMapFeature[] {
  if (!sort) {
    return features;
  }
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...features].sort(
    (left, right) =>
      selectedFeatureSortValue(left, sort.column).localeCompare(
        selectedFeatureSortValue(right, sort.column),
        undefined,
        {
          numeric: true,
          sensitivity: "base",
        },
      ) * direction,
  );
}

function statusVariant(status: FeatureDiffStatus): "default" | "secondary" | "outline" | "destructive" {
  if (status === "changed" || status === "possible match") return "default";
  if (status === "left only" || status === "right only") return "secondary";
  return "outline";
}

function emptyDiffCell(): FeatureDiffCell {
  return { left: "", right: "", leftPresent: false, rightPresent: false, status: "unchanged" };
}

function SelectedFeaturesTable({
  features,
  query,
  onQueryChange,
  selectedLayerKey,
  selectedVersion,
  onSelectedLayerKeyChange,
  onSelectedVersionChange,
  sort,
  onSortChange,
  highlightedFeatureId,
  onFeatureClick,
}: {
  features: SelectedMapFeature[];
  query: string;
  onQueryChange: (query: string) => void;
  selectedLayerKey: string;
  selectedVersion: string;
  onSelectedLayerKeyChange: (layerKey: string) => void;
  onSelectedVersionChange: (version: string) => void;
  sort: FeatureDiffSort | undefined;
  onSortChange: (sort: FeatureDiffSort) => void;
  highlightedFeatureId?: string | null | undefined;
  onFeatureClick?: ((feature: SelectedMapFeature) => void) | undefined;
}) {
  const groups = buildFeatureGroupOptions(features);
  const selectedGroup = groups.find((group) => group.key === selectedLayerKey) ?? groups[0];
  const versionOptions = selectedGroup?.versions ?? [];
  const activeVersion = versionOptions.includes(selectedVersion) ? selectedVersion : versionOptions[0];
  const scopedFeatures =
    selectedGroup && activeVersion
      ? selectedFeatureSubset({ features, selectedLayerKey: selectedGroup.key, selectedVersion: activeVersion })
      : [];
  const propertyKeys = sortedPropertyKeys(scopedFeatures);
  const visibleFeatures = sortSelectedFeatures(
    scopedFeatures.filter((feature) => featureMatchesQuery(feature, query)),
    sort,
  );
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto overscroll-contain sm:overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 sm:px-4">
        <Select value={selectedGroup?.key ?? ""} onValueChange={onSelectedLayerKeyChange}>
          <SelectTrigger aria-label="Select layer" className="h-11 w-full min-w-0 sm:h-8 sm:w-56 sm:max-w-80">
            <SelectValue placeholder="Select layer" />
          </SelectTrigger>
          <SelectContent>
            {groups.map((group) => (
              <SelectItem key={group.key} value={group.key}>
                {group.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={activeVersion ?? ""} onValueChange={onSelectedVersionChange}>
          <SelectTrigger aria-label="Version" className="h-11 w-full min-w-0 sm:h-8 sm:w-40">
            <SelectValue placeholder="Version" />
          </SelectTrigger>
          <SelectContent>
            {versionOptions.map((version) => (
              <SelectItem key={version} value={version}>
                {version}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative w-full min-w-0 flex-1 sm:min-w-52">
          <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search selected features..."
            className="h-11 pl-10 sm:h-8"
          />
        </div>
      </div>
      <div
        data-testid="selected-features-scroll"
        className="min-w-0 shrink-0 overflow-x-auto sm:min-h-0 sm:flex-1 sm:overflow-auto sm:overscroll-contain"
      >
        <table className="w-full min-w-[640px] text-sm">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b text-left text-xs text-muted-foreground">
              {propertyKeys.map((key) => (
                <th key={key} className="px-3 py-2 font-medium">
                  <SelectedFeatureColumnHeader column={key} label={key} sort={sort} onSortChange={onSortChange} />
                </th>
              ))}
              <th className="sticky right-0 w-12 bg-background px-2 py-2 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleFeatures.map((feature) => (
              <tr
                key={feature.id}
                data-testid="selected-feature-row"
                className={cn(
                  "group border-b align-top transition-colors",
                  feature.id === highlightedFeatureId ? "bg-accent/50" : undefined,
                  feature.centroid && onFeatureClick ? "cursor-pointer hover:bg-accent/30" : undefined,
                )}
                onClick={() => {
                  if (feature.centroid) {
                    onFeatureClick?.(feature);
                  }
                }}
              >
                {propertyKeys.map((key) => (
                  <td key={key} className="max-w-56 break-words px-3 py-2">
                    {feature.properties[key] ?? ""}
                  </td>
                ))}
                <td
                  className={cn(
                    "sticky right-0 w-12 px-2 py-2 text-right",
                    feature.id === highlightedFeatureId ? "bg-accent/50" : "bg-background",
                    feature.centroid && onFeatureClick ? "group-hover:bg-accent/30" : undefined,
                  )}
                >
                  {feature.centroid && onFeatureClick ? (
                    <span className="sr-only">Click row to zoom to feature {feature.featureId}</span>
                  ) : null}
                  <SelectedFeatureActions feature={feature} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visibleFeatures.length === 0 && (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            No selected features match the search.
          </div>
        )}
      </div>
    </div>
  );
}

function SelectedFeatureActions({ feature }: { feature: SelectedMapFeature }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0 text-muted-foreground hover:text-foreground sm:h-7 sm:w-7"
          aria-label={`Actions for feature ${feature.featureId}`}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-1" side="bottom" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-col gap-1">
          {feature.centroid ? (
            <Button variant="ghost" size="sm" asChild className="justify-start">
              <a href={googleMapsSearchUrl(feature.centroid)} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Google Maps
              </a>
            </Button>
          ) : null}
          <DataQualityFeedbackDialog
            context={{
              collectionSlug: feature.collectionSlug,
              datasetSlug: feature.datasetSlug,
              fileSlug: feature.fileSlug,
              version: feature.version,
              sourceId: feature.sourceId,
              feature,
            }}
            trigger={
              <Button type="button" variant="ghost" size="sm" className="justify-start">
                <MessageSquareWarning className="mr-2 h-4 w-4" />
                Report issue
              </Button>
            }
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SelectedFeatureColumnHeader({
  column,
  label,
  sort,
  onSortChange,
}: {
  column: string;
  label: string;
  sort: FeatureDiffSort | undefined;
  onSortChange: (sort: FeatureDiffSort) => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 max-w-full gap-1 px-1 text-xs"
      aria-label={`Sort by ${label}`}
      onClick={() => onSortChange(nextSort(sort, column))}
    >
      <span className="truncate">{label}</span>
      <SortIcon sort={sort} column={column} />
    </Button>
  );
}

function DiffTable({
  features,
  s2Level,
  onS2LevelChange,
  leftVersion,
  rightVersion,
  onLeftVersionChange,
  onRightVersionChange,
  matchKeyPairs,
  onMatchKeyPairsChange,
  columnMode,
  onColumnModeChange,
  sort,
  onSortChange,
  highlightedFeatureId,
  onFeatureClick,
}: {
  features: SelectedMapFeature[];
  s2Level: number;
  onS2LevelChange: (level: number) => void;
  leftVersion: string;
  rightVersion: string;
  onLeftVersionChange: (version: string) => void;
  onRightVersionChange: (version: string) => void;
  matchKeyPairs: FeatureDiffMatchKeyPair[];
  onMatchKeyPairsChange: (pairs: FeatureDiffMatchKeyPair[]) => void;
  columnMode: DiffColumnMode;
  onColumnModeChange: (mode: DiffColumnMode) => void;
  sort: FeatureDiffSort | undefined;
  onSortChange: (sort: FeatureDiffSort) => void;
  highlightedFeatureId?: string | null | undefined;
  onFeatureClick?: ((feature: SelectedMapFeature) => void) | undefined;
}) {
  const versions = comparableFeatureDiffVersions(features);
  const leftKeyOptions = featureDiffMatchKeyOptions(features, leftVersion);
  const rightKeyOptions = featureDiffMatchKeyOptions(features, rightVersion);
  const diff = buildFeatureDiff(features, { leftVersion, rightVersion, matchKeyPairs, s2Level, sort });
  const usesGeometry = matchKeyPairs.some(
    (pair) => pair.left === GEOMETRY_MATCH_COLUMN && pair.right === GEOMETRY_MATCH_COLUMN,
  );
  const changedColumns = changedFeatureDiffColumns(diff);
  const visibleColumns = columnMode === "changed" ? changedColumns : diff.columns;

  if (!diff.canCompare) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
        <div className="font-medium text-foreground">Version diff is not available for this selection.</div>
        <div>{diff.reason}</div>
      </div>
    );
  }

  return (
    <div
      data-testid="feature-diff-panel"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto overscroll-contain sm:overflow-hidden"
    >
      <DiffToolbar
        versions={versions}
        leftVersion={leftVersion}
        rightVersion={rightVersion}
        onLeftVersionChange={onLeftVersionChange}
        onRightVersionChange={onRightVersionChange}
        leftKeyOptions={leftKeyOptions}
        rightKeyOptions={rightKeyOptions}
        matchKeyPairs={matchKeyPairs}
        onMatchKeyPairsChange={onMatchKeyPairsChange}
        columnMode={columnMode}
        onColumnModeChange={onColumnModeChange}
        usesGeometry={usesGeometry}
        s2Level={s2Level}
        onS2LevelChange={onS2LevelChange}
      />
      <div
        data-testid="feature-diff-scroll"
        className="min-w-0 shrink-0 overflow-x-auto sm:min-h-0 sm:flex-1 sm:overflow-auto sm:overscroll-contain"
      >
        {visibleColumns.length === 0 ? (
          <div className="flex h-24 items-center justify-center border-b text-sm text-muted-foreground">
            No changed columns in this selection.
          </div>
        ) : (
          <ChangedColumnsDiffGrid
            diff={diff}
            columns={visibleColumns}
            matchKeyPairs={matchKeyPairs}
            sort={sort}
            onSortChange={onSortChange}
            highlightedFeatureId={highlightedFeatureId}
            onFeatureClick={onFeatureClick}
          />
        )}
      </div>
    </div>
  );
}

function nextSort(current: FeatureDiffSort | undefined, column: string): FeatureDiffSort {
  if (current?.column !== column) {
    return { column, direction: "asc" };
  }
  return {
    column,
    direction: current.direction === "asc" ? "desc" : "asc",
  };
}

function DiffToolbar({
  versions,
  leftVersion,
  rightVersion,
  onLeftVersionChange,
  onRightVersionChange,
  leftKeyOptions,
  rightKeyOptions,
  matchKeyPairs,
  onMatchKeyPairsChange,
  columnMode,
  onColumnModeChange,
  usesGeometry,
  s2Level,
  onS2LevelChange,
}: {
  versions: string[];
  leftVersion: string;
  rightVersion: string;
  onLeftVersionChange: (version: string) => void;
  onRightVersionChange: (version: string) => void;
  leftKeyOptions: FeatureDiffColumn[];
  rightKeyOptions: FeatureDiffColumn[];
  matchKeyPairs: FeatureDiffMatchKeyPair[];
  onMatchKeyPairsChange: (pairs: FeatureDiffMatchKeyPair[]) => void;
  columnMode: DiffColumnMode;
  onColumnModeChange: (mode: DiffColumnMode) => void;
  usesGeometry: boolean;
  s2Level: number;
  onS2LevelChange: (level: number) => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-stretch justify-between gap-3 border-b px-3 py-2 sm:items-center sm:px-4">
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2 text-xs sm:w-auto">
        <select
          aria-label="Left version"
          value={leftVersion}
          onChange={(event) => onLeftVersionChange(event.target.value)}
          className="h-11 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm sm:h-8 sm:w-36 sm:flex-none"
        >
          {versions.map((version) => (
            <option key={version} value={version}>
              {version}
            </option>
          ))}
        </select>
        <span className="shrink-0 text-muted-foreground">to</span>
        <select
          aria-label="Right version"
          value={rightVersion}
          onChange={(event) => onRightVersionChange(event.target.value)}
          className="h-11 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm sm:h-8 sm:w-36 sm:flex-none"
        >
          {versions.map((version) => (
            <option key={version} value={version}>
              {version}
            </option>
          ))}
        </select>
      </div>
      <div className="flex w-full min-w-0 flex-wrap items-stretch justify-start gap-2 text-xs text-muted-foreground lg:w-auto lg:items-center lg:justify-end">
        <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto sm:flex-row sm:items-center sm:gap-2">
          Columns
          <select
            aria-label="Columns"
            value={columnMode}
            onChange={(event) => onColumnModeChange(event.target.value as DiffColumnMode)}
            className="h-11 w-full min-w-0 rounded-md border bg-background px-2 text-sm text-foreground sm:h-8 sm:w-40"
          >
            <option value="changed">Changed columns</option>
            <option value="all">All columns</option>
          </select>
        </div>
        <MatchKeyPicker
          leftOptions={leftKeyOptions}
          rightOptions={rightKeyOptions}
          leftVersion={leftVersion}
          rightVersion={rightVersion}
          pairs={matchKeyPairs}
          onChange={onMatchKeyPairsChange}
        />
        {usesGeometry && (
          <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto sm:flex-row sm:items-center sm:gap-2">
            <span className="flex items-center gap-1">
              Geographic tolerance
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="Explain geographic tolerance"
                      className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-5 sm:w-5"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-72">
                    Uses S2 grid cells around each selected feature centroid. Tighter tolerance uses smaller cells;
                    loose tolerance accepts larger nearby areas.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
            <select
              aria-label="Geographic tolerance"
              value={String(s2Level)}
              onChange={(event) => onS2LevelChange(Number(event.target.value))}
              className="h-11 w-full min-w-0 rounded-md border bg-background px-2 text-sm text-foreground sm:h-8 sm:w-40"
            >
              {S2_LEVEL_OPTIONS.map((option) => (
                <option key={option.value} value={String(option.value)}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

function ChangedColumnsDiffGrid({
  diff,
  columns,
  matchKeyPairs,
  sort,
  onSortChange,
  highlightedFeatureId,
  onFeatureClick,
}: {
  diff: FeatureDiffResult;
  columns: FeatureDiffColumn[];
  matchKeyPairs: FeatureDiffMatchKeyPair[];
  sort: FeatureDiffSort | undefined;
  onSortChange: (sort: FeatureDiffSort) => void;
  highlightedFeatureId?: string | null | undefined;
  onFeatureClick?: ((feature: SelectedMapFeature) => void) | undefined;
}) {
  return (
    <table className="w-full min-w-[760px] text-sm">
      <thead className="sticky top-0 z-10 bg-background">
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th className="sticky left-0 z-20 bg-background px-3 py-2 font-medium">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-1 text-xs"
              aria-label="Sort by status"
              onClick={() => onSortChange(nextSort(sort, "status"))}
            >
              Match
              <SortIcon sort={sort} column="status" />
            </Button>
          </th>
          <th className="px-3 py-2 font-medium">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-1 text-xs"
              aria-label="Sort by confidence"
              onClick={() => onSortChange(nextSort(sort, "confidence"))}
            >
              Confidence
              <SortIcon sort={sort} column="confidence" />
            </Button>
          </th>
          <th className="px-3 py-2 font-medium">Match keys</th>
          {columns.map((column) => (
            <DiffColumnHeader key={column.key} column={column} sort={sort} onSortChange={onSortChange} />
          ))}
        </tr>
      </thead>
      <tbody>
        {diff.rows.map((row) => (
          <DiffGridRow
            key={row.id}
            row={row}
            columns={columns}
            rightVersion={diff.rightVersion ?? "Right"}
            matchKeyPairs={matchKeyPairs}
            highlightedFeatureId={highlightedFeatureId}
            onFeatureClick={onFeatureClick}
          />
        ))}
      </tbody>
    </table>
  );
}

function DiffGridRow({
  row,
  columns,
  rightVersion,
  matchKeyPairs,
  highlightedFeatureId,
  onFeatureClick,
}: {
  row: FeatureDiffRow;
  columns: FeatureDiffColumn[];
  rightVersion: string;
  matchKeyPairs: FeatureDiffMatchKeyPair[];
  highlightedFeatureId?: string | null | undefined;
  onFeatureClick?: ((feature: SelectedMapFeature) => void) | undefined;
}) {
  const targetFeature = zoomTargetForDiffRow(row);
  const isClickable = Boolean(targetFeature?.centroid && onFeatureClick);
  const isHighlighted = row.left?.id === highlightedFeatureId || row.right?.id === highlightedFeatureId;

  const zoomToTarget = () => {
    if (targetFeature?.centroid) {
      onFeatureClick?.(targetFeature);
    }
  };

  return (
    <tr
      data-testid="feature-diff-row"
      className={cn(
        "border-b align-top transition-colors",
        isHighlighted ? "bg-accent/50" : undefined,
        isClickable ? "cursor-pointer hover:bg-accent/30" : undefined,
      )}
      onClick={zoomToTarget}
    >
      <td className={cn("sticky left-0 px-3 py-2", isHighlighted ? "bg-accent/50" : "bg-background")}>
        <span className="flex items-center gap-2">
          {isClickable ? <span className="sr-only">Click row to zoom to diff row {row.id}</span> : null}
          <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{Math.round(row.confidence * 100)}%</td>
      <td className="max-w-64 border-l px-3 py-2 text-xs">
        <MatchKeyValues row={row} matchKeyPairs={matchKeyPairs} />
      </td>
      {columns.map((column) => (
        <DiffCell
          key={`${row.id}-${column.key}`}
          version={rightVersion}
          column={column}
          cell={row.cells[column.key] ?? emptyDiffCell()}
          side="right"
        />
      ))}
    </tr>
  );
}

function zoomTargetForDiffRow(row: FeatureDiffRow): SelectedMapFeature | null {
  if (row.right?.centroid) {
    return row.right;
  }
  if (row.left?.centroid) {
    return row.left;
  }
  return row.right ?? row.left;
}

function matchKeyLabel(pair: FeatureDiffMatchKeyPair): string {
  if (pair.left === GEOMETRY_MATCH_COLUMN && pair.right === GEOMETRY_MATCH_COLUMN) {
    return "Geometry";
  }
  if (pair.left === pair.right) {
    return pair.left;
  }
  return `${pair.left} -> ${pair.right}`;
}

function featureMatchKeyValue(feature: SelectedMapFeature | null, key: string): string {
  if (!feature) {
    return "Not present";
  }
  if (key === GEOMETRY_MATCH_COLUMN) {
    return feature.centroid ? `${feature.centroid.lat.toFixed(5)}, ${feature.centroid.lng.toFixed(5)}` : "No geometry";
  }
  if (!Object.hasOwn(feature.properties, key)) {
    return "Not present";
  }
  return feature.properties[key] ?? "";
}

function MatchKeyValues({ row, matchKeyPairs }: { row: FeatureDiffRow; matchKeyPairs: FeatureDiffMatchKeyPair[] }) {
  return (
    <div className="min-w-0 space-y-2">
      {matchKeyPairs.map((pair) => {
        const leftValue = featureMatchKeyValue(row.left, pair.left);
        const rightValue = featureMatchKeyValue(row.right, pair.right);
        const primaryValue = row.right ? rightValue : leftValue;
        const shouldShowFromValue = row.left && row.right && leftValue !== rightValue;

        return (
          <div key={pair.id} className="min-w-0">
            <div className="truncate text-muted-foreground">{matchKeyLabel(pair)}</div>
            <div className="break-words font-medium">{primaryValue}</div>
            {shouldShowFromValue && <div className="break-words text-muted-foreground">from {leftValue}</div>}
          </div>
        );
      })}
    </div>
  );
}

function DiffColumnHeader({
  column,
  sort,
  onSortChange,
}: {
  column: FeatureDiffColumn;
  sort: FeatureDiffSort | undefined;
  onSortChange: (sort: FeatureDiffSort) => void;
}) {
  return (
    <th className="min-w-56 px-3 py-2 font-medium">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 max-w-full gap-1 px-1 text-xs"
        aria-label={`Sort by ${column.label}`}
        onClick={() => onSortChange(nextSort(sort, column.key))}
      >
        <span className="truncate">{column.label}</span>
        <SortIcon sort={sort} column={column.key} />
      </Button>
    </th>
  );
}

function SortIcon({ sort, column }: { sort: FeatureDiffSort | undefined; column: string }) {
  if (sort?.column !== column) {
    return <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />;
  }
  return sort.direction === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />;
}

type DiffCellTone = "neutral" | "added" | "removed" | "changed";

export interface DiffCellDisplay {
  value: string;
  detail: string | undefined;
  tone: DiffCellTone;
  isPlaceholder: boolean;
}

function diffCellClassName(tone: DiffCellTone): string {
  if (tone === "added") {
    return "border-l-2 border-l-emerald-500 bg-emerald-500/10 text-emerald-950";
  }
  if (tone === "removed") {
    return "border-l-2 border-l-rose-500 bg-rose-500/10 text-rose-950";
  }
  if (tone === "changed") {
    return "border-l-2 border-l-amber-500 bg-amber-500/15 text-amber-950";
  }
  return "";
}

function cellStatusLabel(status: FeatureDiffCellStatus): string {
  if (status === "added") return "added";
  if (status === "removed") return "removed";
  if (status === "changed") return "changed";
  return "unchanged";
}

export function formatDiffCellDisplay(cell: FeatureDiffCell, side: DiffCellSide): DiffCellDisplay {
  if (side === "left") {
    if (!cell.leftPresent) {
      return { value: "Not present", detail: undefined, tone: "neutral", isPlaceholder: true };
    }
    return { value: cell.left, detail: undefined, tone: "neutral", isPlaceholder: false };
  }

  if (cell.status === "removed") {
    return { value: "Removed", detail: `from ${cell.left}`, tone: "removed", isPlaceholder: false };
  }
  if (!cell.rightPresent) {
    return { value: "Not present", detail: undefined, tone: "neutral", isPlaceholder: true };
  }
  if (cell.status === "added") {
    return { value: cell.right, detail: "from not present", tone: "added", isPlaceholder: false };
  }
  if (cell.status === "changed") {
    return { value: cell.right, detail: `from ${cell.left}`, tone: "changed", isPlaceholder: false };
  }
  return { value: cell.right, detail: undefined, tone: "neutral", isPlaceholder: false };
}

function DiffCell({
  version,
  column,
  cell,
  side,
}: {
  version: string;
  column: FeatureDiffColumn;
  cell: FeatureDiffCell;
  side: DiffCellSide;
}) {
  const display = formatDiffCellDisplay(cell, side);
  return (
    <td
      aria-label={`${version} ${column.label} ${cellStatusLabel(cell.status)}`}
      className={cn("min-h-12 border-l px-3 py-2", diffCellClassName(display.tone))}
    >
      <DiffCellValue display={display} />
    </td>
  );
}

function DiffCellValue({ display }: { display: DiffCellDisplay }) {
  if (display.detail) {
    return (
      <span className="flex min-w-0 flex-col gap-1">
        <span className="break-words font-medium">{display.value}</span>
        <span className="break-words text-xs text-muted-foreground">{display.detail}</span>
      </span>
    );
  }
  return (
    <span className={cn("break-words", display.isPlaceholder ? "text-muted-foreground" : undefined)}>
      {display.value}
    </span>
  );
}

function pairId(left: string, right: string): string {
  return `${left}:${right}`;
}

function nextPairForSide(
  pair: FeatureDiffMatchKeyPair,
  side: "left" | "right",
  value: string,
): FeatureDiffMatchKeyPair {
  const next = side === "left" ? { ...pair, left: value } : { ...pair, right: value };
  return { ...next, id: pairId(next.left, next.right) };
}

function addableMatchKeyPair({
  leftOptions,
  rightOptions,
  pairs,
}: {
  leftOptions: { key: string; label: string }[];
  rightOptions: { key: string; label: string }[];
  pairs: FeatureDiffMatchKeyPair[];
}): FeatureDiffMatchKeyPair | null {
  const existingIds = new Set(pairs.map((pair) => pair.id));
  for (const leftOption of leftOptions) {
    for (const rightOption of rightOptions) {
      const id = pairId(leftOption.key, rightOption.key);
      if (!existingIds.has(id)) {
        return { id, left: leftOption.key, right: rightOption.key };
      }
    }
  }
  return null;
}

interface MatchKeyPickerProps {
  leftOptions: { key: string; label: string }[];
  rightOptions: { key: string; label: string }[];
  leftVersion: string;
  rightVersion: string;
  pairs: FeatureDiffMatchKeyPair[];
  onChange: (pairs: FeatureDiffMatchKeyPair[]) => void;
}

interface MatchKeyPickerState {
  isOpen: boolean;
}

class MatchKeyPicker extends React.Component<MatchKeyPickerProps, MatchKeyPickerState> {
  override state: MatchKeyPickerState = {
    isOpen: false,
  };

  override render() {
    const { leftOptions, rightOptions, leftVersion, rightVersion, pairs, onChange } = this.props;
    const fallbackLeft = leftOptions[0]?.key ?? "";
    const fallbackRight = rightOptions[0]?.key ?? "";
    const visiblePairs =
      pairs.length > 0 ? pairs : fallbackLeft && fallbackRight ? [matchKeyPair(fallbackLeft, fallbackRight)] : [];
    const nextAddablePair = addableMatchKeyPair({ leftOptions, rightOptions, pairs: visiblePairs });

    return (
      <Popover open={this.state.isOpen} onOpenChange={(isOpen) => this.setState({ isOpen })}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Match row keys"
            className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-md border bg-background px-3 py-1.5 text-sm text-foreground shadow-xs outline-none transition-[color,box-shadow] hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-8 sm:w-36"
          >
            <span className="min-w-0 truncate">Match rows</span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          collisionPadding={12}
          className="max-h-[min(20rem,var(--radix-popover-content-available-height))] w-64 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain p-3"
          side="bottom"
        >
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Match rows by</div>
          <div className="space-y-2">
            {visiblePairs.map((pair, index) => (
              <div key={pair.id} className="grid grid-cols-1 items-center gap-2">
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">{leftVersion} key</div>
                  <select
                    aria-label={`Left match key ${index + 1}`}
                    value={pair.left}
                    onChange={(event) => {
                      const nextPairs = visiblePairs.map((entry, entryIndex) =>
                        entryIndex === index ? nextPairForSide(entry, "left", event.target.value) : entry,
                      );
                      onChange(nextPairs);
                    }}
                    className="h-11 w-full min-w-0 truncate rounded-md border bg-background px-2 text-sm sm:h-8"
                  >
                    {leftOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">{rightVersion} key</div>
                  <select
                    aria-label={`Right match key ${index + 1}`}
                    value={pair.right}
                    onChange={(event) => {
                      const nextPairs = visiblePairs.map((entry, entryIndex) =>
                        entryIndex === index ? nextPairForSide(entry, "right", event.target.value) : entry,
                      );
                      onChange(nextPairs);
                    }}
                    className="h-11 w-full min-w-0 truncate rounded-md border bg-background px-2 text-sm sm:h-8"
                  >
                    {rightOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={visiblePairs.length === 1}
                  onClick={() => onChange(visiblePairs.filter((_, entryIndex) => entryIndex !== index))}
                  className="justify-self-start"
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!nextAddablePair}
              onClick={() => {
                if (nextAddablePair) {
                  onChange([...visiblePairs, nextAddablePair]);
                }
              }}
            >
              Add key
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    );
  }
}

function matchKeyPair(left: string, right: string): FeatureDiffMatchKeyPair {
  return { id: pairId(left, right), left, right };
}

interface FeatureTablePanelState {
  activeTab: FeaturePanelTab;
  query: string;
  selectedLayerKey: string;
  selectedVersion: string;
  leftVersion: string;
  rightVersion: string;
  matchKeyPairs: FeatureDiffMatchKeyPair[];
  selectedSort: FeatureDiffSort | undefined;
  diffColumnMode: DiffColumnMode;
  sort: FeatureDiffSort | undefined;
}

export class FeatureTablePanel extends React.Component<FeatureTablePanelProps, FeatureTablePanelState> {
  override state: FeatureTablePanelState = {
    activeTab: "selected",
    query: "",
    selectedLayerKey: "",
    selectedVersion: "",
    leftVersion: "",
    rightVersion: "",
    matchKeyPairs: [],
    selectedSort: undefined,
    diffColumnMode: "changed",
    sort: undefined,
  };

  override componentDidMount() {
    this.syncSelectionScope();
  }

  override componentDidUpdate(prevProps: FeatureTablePanelProps) {
    if (prevProps.features !== this.props.features) {
      this.syncSelectionScope();
    }
  }

  private syncSelectionScope() {
    const groups = buildFeatureGroupOptions(this.props.features);
    const canDiff = isComparableFeatureDiffSelection(this.props.features);
    const currentGroup = groups.find((group) => group.key === this.state.selectedLayerKey);
    const nextGroup = currentGroup ?? groups[0];
    const nextVersion =
      nextGroup?.versions.find((version) => version === this.state.selectedVersion) ?? nextGroup?.versions[0] ?? "";
    const nextLayerKey = nextGroup?.key ?? "";
    const versions = comparableFeatureDiffVersions(this.props.features);
    const currentLeftVersion = versions.includes(this.state.leftVersion) ? this.state.leftVersion : (versions[0] ?? "");
    const currentRightVersion =
      versions.includes(this.state.rightVersion) && this.state.rightVersion !== currentLeftVersion
        ? this.state.rightVersion
        : (versions.find((version) => version !== currentLeftVersion) ?? "");
    const leftKeys = new Set(
      featureDiffMatchKeyOptions(this.props.features, currentLeftVersion).map((option) => option.key),
    );
    const rightKeys = new Set(
      featureDiffMatchKeyOptions(this.props.features, currentRightVersion).map((option) => option.key),
    );
    const currentMatchKeyPairs = this.state.matchKeyPairs.filter(
      (pair) => leftKeys.has(pair.left) && rightKeys.has(pair.right),
    );
    const nextMatchKeyPairs =
      currentMatchKeyPairs.length > 0
        ? currentMatchKeyPairs
        : defaultFeatureDiffMatchKeyPairs(this.props.features, currentLeftVersion, currentRightVersion);
    const nextActiveTab = canDiff ? this.state.activeTab : "selected";

    if (
      nextLayerKey !== this.state.selectedLayerKey ||
      nextVersion !== this.state.selectedVersion ||
      currentLeftVersion !== this.state.leftVersion ||
      currentRightVersion !== this.state.rightVersion ||
      nextActiveTab !== this.state.activeTab ||
      nextMatchKeyPairs.map((pair) => pair.id).join("\0") !== this.state.matchKeyPairs.map((pair) => pair.id).join("\0")
    ) {
      this.setState({
        activeTab: nextActiveTab,
        selectedLayerKey: nextLayerKey,
        selectedVersion: nextVersion,
        leftVersion: currentLeftVersion,
        rightVersion: currentRightVersion,
        matchKeyPairs: nextMatchKeyPairs,
      });
    }
  }

  override render() {
    const { features, highlightedFeatureId, wasSelectionCapped, s2Level, onS2LevelChange, onFeatureClick, onClear } =
      this.props;
    const {
      activeTab,
      query,
      selectedLayerKey,
      selectedVersion,
      leftVersion,
      rightVersion,
      matchKeyPairs,
      selectedSort,
      diffColumnMode,
      sort,
    } = this.state;
    const canDiff = isComparableFeatureDiffSelection(features);

    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-3 py-2 sm:px-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="text-sm font-semibold">{features.length} selected features</div>
            {wasSelectionCapped && <Badge variant="secondary">Selection is capped at 100 features per layer.</Badge>}
          </div>
          <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:w-auto">
            {canDiff && (
              <div className="flex w-full min-w-0 rounded-md border p-0.5 sm:w-auto">
                <Button
                  type="button"
                  variant={activeTab === "selected" ? "secondary" : "ghost"}
                  size="sm"
                  className="min-h-11 flex-1 sm:min-h-8 sm:flex-none"
                  onClick={() => this.setState({ activeTab: "selected" })}
                >
                  Selected features
                </Button>
                <Button
                  type="button"
                  variant={activeTab === "diff" ? "secondary" : "ghost"}
                  size="sm"
                  className="min-h-11 flex-1 sm:min-h-8 sm:flex-none"
                  onClick={() => this.setState({ activeTab: "diff" })}
                >
                  Version diff
                </Button>
              </div>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-11 w-11 sm:size-9"
              onClick={onClear}
              aria-label="Clear selected features"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <Separator className="shrink-0" />
        <div className="min-h-0 flex-1 overflow-hidden">
          {activeTab === "selected" || !canDiff ? (
            <SelectedFeaturesTable
              features={features}
              query={query}
              onQueryChange={(nextQuery) => this.setState({ query: nextQuery })}
              selectedLayerKey={selectedLayerKey}
              selectedVersion={selectedVersion}
              onSelectedLayerKeyChange={(nextLayerKey) => {
                const nextGroup = buildFeatureGroupOptions(features).find((group) => group.key === nextLayerKey);
                this.setState({
                  selectedLayerKey: nextLayerKey,
                  selectedVersion: nextGroup?.versions[0] ?? "",
                });
              }}
              onSelectedVersionChange={(nextVersion) => this.setState({ selectedVersion: nextVersion })}
              sort={selectedSort}
              onSortChange={(nextSortValue) => this.setState({ selectedSort: nextSortValue })}
              highlightedFeatureId={highlightedFeatureId}
              onFeatureClick={onFeatureClick}
            />
          ) : (
            <DiffTable
              features={features}
              s2Level={s2Level}
              onS2LevelChange={onS2LevelChange}
              leftVersion={leftVersion}
              rightVersion={rightVersion}
              onLeftVersionChange={(nextVersionValue) => {
                const nextRightVersion = nextVersionValue === rightVersion ? leftVersion : rightVersion;
                this.setState({
                  leftVersion: nextVersionValue,
                  rightVersion: nextRightVersion,
                  matchKeyPairs: defaultFeatureDiffMatchKeyPairs(features, nextVersionValue, nextRightVersion),
                });
              }}
              onRightVersionChange={(nextVersionValue) => {
                const nextLeftVersion = nextVersionValue === leftVersion ? rightVersion : leftVersion;
                this.setState({
                  leftVersion: nextLeftVersion,
                  rightVersion: nextVersionValue,
                  matchKeyPairs: defaultFeatureDiffMatchKeyPairs(features, nextLeftVersion, nextVersionValue),
                });
              }}
              matchKeyPairs={matchKeyPairs}
              onMatchKeyPairsChange={(nextPairs) => this.setState({ matchKeyPairs: nextPairs })}
              columnMode={diffColumnMode}
              onColumnModeChange={(nextColumnMode) => this.setState({ diffColumnMode: nextColumnMode })}
              sort={sort}
              onSortChange={(nextSortValue) => this.setState({ sort: nextSortValue })}
              highlightedFeatureId={highlightedFeatureId}
              onFeatureClick={onFeatureClick}
            />
          )}
        </div>
      </div>
    );
  }
}
