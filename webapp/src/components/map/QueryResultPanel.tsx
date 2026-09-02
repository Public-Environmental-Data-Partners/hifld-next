import { SelectedFeaturesTable, type SelectedFeatureTableRow } from "@hifld/map-ui";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { QueryCell } from "@/lib/query-api";
import { MapDataTableColumnHeader } from "./MapDataTableColumnHeader";
import type { QueryResultState } from "./queryResults";

interface QueryResultPanelProps {
  result: QueryResultState;
  onLoadMore?: (() => void) | undefined;
  isLoadingMore?: boolean | undefined;
  panelModeControls?: ReactNode;
  onCollapse?: (() => void) | undefined;
}

export function QueryResultPanel({
  result,
  onLoadMore,
  isLoadingMore = false,
  panelModeControls,
  onCollapse,
}: QueryResultPanelProps) {
  const { page } = result;
  const rows = useMemo<SelectedFeatureTableRow[]>(
    () =>
      page.rows.map((row, index) => ({
        id: `${page.query_id}:${page.offset + index}`,
        properties: Object.fromEntries(page.columns.map((column) => [column.name, queryCellText(row[column.name])])),
      })),
    [page.columns, page.offset, page.query_id, page.rows],
  );
  const columns = useMemo(() => page.columns.map((column) => column.name), [page.columns]);

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t"
      aria-label="Query results"
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">Query results</h2>
          <p className="text-xs text-muted-foreground">
            {page.returned_count.toLocaleString()} rows returned in {Math.round(page.elapsed_ms).toLocaleString()} ms
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {panelModeControls}
          {page.has_more && onLoadMore && (
            <Button type="button" variant="outline" size="sm" disabled={isLoadingMore} onClick={onLoadMore}>
              {isLoadingMore ? "Loading…" : "Load more"}
            </Button>
          )}
          {onCollapse && (
            <Button type="button" variant="ghost" size="icon" onClick={onCollapse} aria-label="Collapse data table">
              <ChevronDown className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      {result.errorMessage && <p className="px-4 pb-3 text-sm text-destructive">{result.errorMessage}</p>}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <SelectedFeaturesTable
          features={rows}
          columns={columns}
          tableAriaLabel="Query results"
          searchAriaLabel="Search query results"
          searchPlaceholder="Search result rows..."
          toolbarClassName="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 sm:px-4"
          searchClassName="hifld-selected-features-search relative w-full min-w-0 sm:w-80 sm:flex-none"
          renderSearchInput={(control) => (
            <Input
              type="search"
              aria-label={control.ariaLabel}
              value={control.value}
              onChange={(event) => control.onChange(event.target.value)}
              placeholder={control.placeholder}
              className="h-11 pl-10 sm:h-8"
            />
          )}
          className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain"
          tableClassName="w-full min-w-[640px] text-sm"
          headerClassName="sticky top-0 z-10 bg-background"
          headerRowClassName="border-b text-left text-xs text-muted-foreground"
          headerCellClassName="px-3 py-2 font-medium"
          renderColumnHeader={(column, control) => <MapDataTableColumnHeader column={column} control={control} />}
          rowClassName={() => "border-b align-top transition-colors"}
          cellClassName={() => "max-w-56 break-words px-3 py-2"}
          emptyMessage="No query result rows match the search."
        />
      </div>
    </section>
  );
}

function queryCellText(value: QueryCell | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value) ?? "";
}
