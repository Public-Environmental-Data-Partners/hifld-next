import { ArrowDown, ArrowUp, ChevronsUpDown, Search, X } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
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
  wasSelectionCapped: boolean;
  s2Level: number;
  onS2LevelChange: (level: number) => void;
  onClear: () => void;
}

type FeaturePanelTab = "selected" | "diff";
type DiffCellSide = "left" | "right";

const S2_LEVEL_OPTIONS = [
  { label: "Tight", value: 18 },
  { label: "Normal", value: 16 },
  { label: "Loose", value: 14 },
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
}: {
  features: SelectedMapFeature[];
  query: string;
  onQueryChange: (query: string) => void;
  selectedLayerKey: string;
  selectedVersion: string;
  onSelectedLayerKeyChange: (layerKey: string) => void;
  onSelectedVersionChange: (version: string) => void;
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
  const visibleFeatures = scopedFeatures.filter((feature) => featureMatchesQuery(feature, query));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
        <Select value={selectedGroup?.key ?? ""} onValueChange={onSelectedLayerKeyChange}>
          <SelectTrigger className="h-8 min-w-56 max-w-80">
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
          <SelectTrigger className="h-8 w-40">
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
        <div className="flex min-w-52 flex-1 items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search selected features..."
            className="h-8"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Feature</th>
              {propertyKeys.map((key) => (
                <th key={key} className="px-3 py-2 font-medium">
                  {key}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleFeatures.map((feature) => (
              <tr key={feature.id} className="border-b align-top">
                <td className="max-w-40 truncate px-3 py-2 font-mono text-xs">{feature.featureId}</td>
                {propertyKeys.map((key) => (
                  <td key={key} className="max-w-56 break-words px-3 py-2">
                    {feature.properties[key] ?? ""}
                  </td>
                ))}
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
  sort,
  onSortChange,
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
  sort: FeatureDiffSort | undefined;
  onSortChange: (sort: FeatureDiffSort) => void;
}) {
  const versions = comparableFeatureDiffVersions(features);
  const leftKeyOptions = featureDiffMatchKeyOptions(features, leftVersion);
  const rightKeyOptions = featureDiffMatchKeyOptions(features, rightVersion);
  const diff = buildFeatureDiff(features, { leftVersion, rightVersion, matchKeyPairs, s2Level, sort });
  const usesGeometry = matchKeyPairs.some(
    (pair) => pair.left === GEOMETRY_MATCH_COLUMN && pair.right === GEOMETRY_MATCH_COLUMN,
  );
  const visibleColumns = changedFeatureDiffColumns(diff);

  if (!diff.canCompare) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
        <div className="font-medium text-foreground">Version diff is not available for this selection.</div>
        <div>{diff.reason}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
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
        usesGeometry={usesGeometry}
        s2Level={s2Level}
        onS2LevelChange={onS2LevelChange}
      />
      <div className="min-h-0 flex-1 overflow-auto">
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
  usesGeometry: boolean;
  s2Level: number;
  onS2LevelChange: (level: number) => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select
          aria-label="Left version"
          value={leftVersion}
          onChange={(event) => onLeftVersionChange(event.target.value)}
          className="h-8 w-36 rounded-md border bg-background px-2 text-sm"
        >
          {versions.map((version) => (
            <option key={version} value={version}>
              {version}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground">to</span>
        <select
          aria-label="Right version"
          value={rightVersion}
          onChange={(event) => onRightVersionChange(event.target.value)}
          className="h-8 w-36 rounded-md border bg-background px-2 text-sm"
        >
          {versions.map((version) => (
            <option key={version} value={version}>
              {version}
            </option>
          ))}
        </select>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 text-xs text-muted-foreground lg:justify-end">
        <MatchKeyPicker
          leftOptions={leftKeyOptions}
          rightOptions={rightKeyOptions}
          pairs={matchKeyPairs}
          onChange={onMatchKeyPairsChange}
        />
        {usesGeometry && (
          <div className="flex shrink-0 items-center gap-2">
            S2 tolerance
            <Select value={String(s2Level)} onValueChange={(value) => onS2LevelChange(Number(value))}>
              <SelectTrigger className="h-8 w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {S2_LEVEL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
}: {
  diff: FeatureDiffResult;
  columns: FeatureDiffColumn[];
  matchKeyPairs: FeatureDiffMatchKeyPair[];
  sort: FeatureDiffSort | undefined;
  onSortChange: (sort: FeatureDiffSort) => void;
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
          <tr key={row.id} data-testid="feature-diff-row" className="border-b align-top">
            <td className="sticky left-0 bg-background px-3 py-2">
              <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
              <div className="mt-1 text-xs text-muted-foreground">{row.matchMethod}</div>
            </td>
            <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
              {Math.round(row.confidence * 100)}%
            </td>
            <td className="max-w-64 border-l px-3 py-2 text-xs">
              <MatchKeyValues row={row} matchKeyPairs={matchKeyPairs} />
            </td>
            {columns.map((column) => (
              <DiffCell
                key={`${row.id}-${column.key}`}
                version={diff.rightVersion ?? "Right"}
                column={column}
                cell={row.cells[column.key] ?? emptyDiffCell()}
                side="right"
              />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
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
    const { leftOptions, rightOptions, pairs, onChange } = this.props;
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
            className="flex min-h-8 w-36 cursor-pointer items-center justify-between gap-2 rounded-md border bg-background px-3 py-1.5 text-sm text-foreground shadow-xs outline-none transition-[color,box-shadow] hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span className="min-w-0 truncate">Match rows</span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" avoidCollisions={false} className="max-h-80 w-56 overflow-auto p-3" side="bottom">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Match rows by</div>
          <div className="space-y-2">
            {visiblePairs.map((pair, index) => (
              <div key={pair.id} className="grid grid-cols-1 items-center gap-2">
                <select
                  aria-label={`Left match key ${index + 1}`}
                  value={pair.left}
                  onChange={(event) => {
                    const nextPairs = visiblePairs.map((entry, entryIndex) =>
                      entryIndex === index ? nextPairForSide(entry, "left", event.target.value) : entry,
                    );
                    onChange(nextPairs);
                  }}
                  className="h-8 w-full min-w-0 truncate rounded-md border bg-background px-2 text-sm"
                >
                  {leftOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`Right match key ${index + 1}`}
                  value={pair.right}
                  onChange={(event) => {
                    const nextPairs = visiblePairs.map((entry, entryIndex) =>
                      entryIndex === index ? nextPairForSide(entry, "right", event.target.value) : entry,
                    );
                    onChange(nextPairs);
                  }}
                  className="h-8 w-full min-w-0 truncate rounded-md border bg-background px-2 text-sm"
                >
                  {rightOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
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
    const { features, wasSelectionCapped, s2Level, onS2LevelChange, onClear } = this.props;
    const { activeTab, query, selectedLayerKey, selectedVersion, leftVersion, rightVersion, matchKeyPairs, sort } =
      this.state;
    const canDiff = isComparableFeatureDiffSelection(features);

    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="text-sm font-semibold">{features.length} selected features</div>
            {wasSelectionCapped && <Badge variant="secondary">Selection is capped at 100 features.</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-md border p-0.5">
              <Button
                type="button"
                variant={activeTab === "selected" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => this.setState({ activeTab: "selected" })}
              >
                Selected features
              </Button>
              {canDiff && (
                <Button
                  type="button"
                  variant={activeTab === "diff" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => this.setState({ activeTab: "diff" })}
                >
                  Version diff
                </Button>
              )}
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={onClear} aria-label="Clear selected features">
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
              sort={sort}
              onSortChange={(nextSortValue) => this.setState({ sort: nextSortValue })}
            />
          )}
        </div>
      </div>
    );
  }
}
