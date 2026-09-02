import HighTable, { arrayDataFrame } from "hightable";
import { useMemo } from "react";
import "hightable/src/HighTable.css";
import type { QueryResultState } from "./queryResults";

interface QueryResultPanelProps {
  result: QueryResultState;
  onLoadMore?: (() => void) | undefined;
  isLoadingMore?: boolean | undefined;
}

export function QueryResultPanel({ result, onLoadMore, isLoadingMore = false }: QueryResultPanelProps) {
  const { page } = result;
  const dataFrame = useMemo(
    () =>
      arrayDataFrame(page.rows, undefined, {
        columnDescriptors: page.columns.map((column) => ({ name: column.name, sortable: true })),
      }),
    [page.columns, page.rows],
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col border-t" aria-label="Query results">
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">Query results</h2>
          <p className="text-xs text-muted-foreground">
            {page.returned_count.toLocaleString()} rows returned in {Math.round(page.elapsed_ms).toLocaleString()} ms
          </p>
        </div>
        {page.has_more && onLoadMore && (
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            disabled={isLoadingMore}
            onClick={onLoadMore}
          >
            {isLoadingMore ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
      {result.errorMessage && <p className="px-4 pb-3 text-sm text-destructive">{result.errorMessage}</p>}
      <div className="min-h-48 flex-1 overflow-auto">
        <HighTable data={dataFrame} cacheKey={`query:${page.query_id}:${page.offset}`} className="h-full hightable" />
      </div>
    </section>
  );
}
