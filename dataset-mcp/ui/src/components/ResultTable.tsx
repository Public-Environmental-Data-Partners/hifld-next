import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type JsonValue,
  type QueryPage,
  QueryPageSchema,
  type QueryResult,
} from "../mcp/contracts";

type ResultTableProps = {
  result: QueryResult | null;
  app?: Pick<McpApp, "callServerTool"> | null;
};
type Cell = QueryPage["rows"][number][string];
type PageCache = Map<number, QueryPage>;
type Sort = { id: string; desc: boolean };

function cellAt(row: QueryPage["rows"][number], name: string): Cell {
  return row[name] ?? null;
}

function displayCell(value: Cell): string {
  if (value === null) return "—";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  if (Array.isArray(value)) return JSON.stringify(value);
  if ("$type" in value && value.$type === "geometry")
    return `Geometry${value.geometry_type ? ` · ${value.geometry_type}` : ""}`;
  if ("$type" in value && value.$type === "binary")
    return `Binary · ${String(value.byte_length ?? 0).toLocaleString()} bytes`;
  if ("$type" in value && value.$type === "truncated")
    return `Truncated · ${String(value.byte_length ?? 0).toLocaleString()} bytes`;
  return JSON.stringify(value);
}

function isInspectable(value: Cell): boolean {
  return value !== null && typeof value === "object";
}

function parsePage(
  response: Awaited<ReturnType<McpApp["callServerTool"]>>,
): QueryPage {
  const structured = QueryPageSchema.safeParse(response.structuredContent);
  if (structured.success) return structured.data;

  const text = response.content.find((item) => item.type === "text");
  if (text?.type !== "text")
    throw new Error("The host returned an empty page.");
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(text.text) as JsonValue;
  } catch {
    throw new Error("The host returned an invalid page.");
  }
  return QueryPageSchema.parse(parsed);
}

export function ResultTable({ result, app }: ResultTableProps) {
  const [pages, setPages] = useState<PageCache>(
    () => new Map(result ? [[result.offset, result]] : []),
  );
  const [offset, setOffset] = useState(result?.offset ?? 0);
  const [pageSize, setPageSize] = useState(
    Math.min(result?.limit ?? 100, 1000),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sorting, setSorting] = useState<Sort | null>(null);
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [inspect, setInspect] = useState<{ name: string; value: Cell } | null>(
    null,
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (result) {
      setPages(new Map([[result.offset, result]]));
      setOffset(result.offset);
      setPageSize(Math.min(result.limit, 1000));
      setError(null);
    }
  }, [result]);

  const current = pages.get(offset) ?? null;
  const columns = current?.columns ?? [];
  const visibleColumns = columns.filter(
    (column) => visibility[column.name] !== false,
  );
  const tableRows = useMemo(() => {
    const rows = current?.rows ?? [];
    if (!sorting) return rows;
    return [...rows].sort((left, right) => {
      const a = displayCell(cellAt(left, sorting.id));
      const b = displayCell(cellAt(right, sorting.id));
      return (a < b ? -1 : a > b ? 1 : 0) * (sorting.desc ? -1 : 1);
    });
  }, [current, sorting]);
  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 42,
    overscan: 8,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const shownRows =
    virtualItems.length > 0
      ? virtualItems
      : tableRows.map((_, index: number) => ({
          index,
          start: index * 42,
          size: 42,
          end: (index + 1) * 42,
          key: index,
        }));

  async function go(nextOffset: number): Promise<void> {
    if (pages.has(nextOffset)) {
      setOffset(nextOffset);
      return;
    }
    if (!app || !current?.query_token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await app.callServerTool({
        name: "get_query_page",
        arguments: {
          query_token: current.query_token,
          offset: nextOffset,
          page_size: pageSize,
        },
      });
      const next = parsePage(response);
      setPages((existing) => new Map(existing).set(next.offset, next));
      setOffset(next.offset);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to load that page.",
      );
    } finally {
      setLoading(false);
    }
  }

  if (!result)
    return (
      <section aria-label="Results">
        <p>Run a query to see results.</p>
      </section>
    );
  if (loading && !current)
    return (
      <section aria-label="Results">
        <p role="status">Loading results…</p>
      </section>
    );
  if (!current)
    return (
      <section aria-label="Results">
        <p role="alert">No results available.</p>
      </section>
    );

  const canNext = current.has_more && current.next_offset !== undefined;
  return (
    <section aria-label="Query results" className="result-table-panel">
      <div className="result-table-toolbar">
        <span>
          {current.rows.length === 0
            ? "No rows"
            : `${current.rows.length.toLocaleString()} rows on this page`}
        </span>
        <label>
          Page size{" "}
          <select
            value={pageSize}
            onChange={(event) =>
              setPageSize(Math.min(Number(event.target.value), 1000))
            }
          >
            <option value="100">100</option>
            <option value="250">250</option>
            <option value="500">500</option>
            <option value="1000">1000</option>
          </select>
        </label>
        <details>
          <summary>Columns</summary>
          <div>
            {columns.map((column) => (
              <label key={column.name}>
                <input
                  type="checkbox"
                  checked={visibility[column.name] !== false}
                  onChange={() =>
                    setVisibility((old) => ({
                      ...old,
                      [column.name]: old[column.name] === false,
                    }))
                  }
                />{" "}
                {column.name}
              </label>
            ))}
          </div>
        </details>
      </div>
      {current.warnings?.map((warning) => (
        <p className="result-warning" key={warning}>
          {warning}
        </p>
      ))}
      {current.deterministic_order === false ? (
        <p className="result-warning">
          Order is not deterministic; page boundaries may shift.
        </p>
      ) : null}
      {current.response_truncated ? (
        <p className="result-warning">
          The response was truncated by the host.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="result-error">
          {error}
        </p>
      ) : null}
      <p className="result-table-note">
        Sorting applies to this page only. Total row count is not inferred.
      </p>
      <section
        className="result-table-scroll"
        ref={scrollRef}
        aria-label="Scrollable result rows"
      >
        <table>
          <thead>
            <tr>
              {visibleColumns.map((column) => (
                <th key={column.name}>
                  <button
                    type="button"
                    onClick={() =>
                      setSorting((old) =>
                        old?.id === column.name
                          ? { id: column.name, desc: !old.desc }
                          : { id: column.name, desc: false },
                      )
                    }
                  >
                    {column.name}
                    {sorting?.id === column.name
                      ? sorting.desc
                        ? " ↓"
                        : " ↑"
                      : ""}
                  </button>
                  <span aria-hidden="true" className="column-resizer" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: "relative",
            }}
          >
            {shownRows.map((virtualRow) => {
              const row = tableRows[virtualRow.index];
              return row ? (
                <tr
                  key={virtualRow.key}
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                    position: "absolute",
                    insetInline: 0,
                  }}
                >
                  {visibleColumns.map((column) => {
                    const value = cellAt(row, column.name);
                    return (
                      <td key={column.name}>
                        {isInspectable(value) ? (
                          <button
                            type="button"
                            className="cell-inspect"
                            onClick={() =>
                              setInspect({ name: column.name, value })
                            }
                          >
                            {displayCell(value)}
                          </button>
                        ) : (
                          displayCell(value)
                        )}
                      </td>
                    );
                  })}
                </tr>
              ) : null;
            })}
          </tbody>
        </table>
      </section>
      <nav aria-label="Result pages" className="result-paging">
        <button
          type="button"
          aria-label="Previous page"
          disabled={offset === 0 || loading}
          onClick={() => go(Math.max(0, offset - pageSize))}
        >
          Previous
        </button>
        <span>Offset {offset}</span>
        <button
          type="button"
          aria-label="Next page"
          disabled={!canNext || loading}
          onClick={() => go(current.next_offset ?? offset)}
        >
          Next
        </button>
      </nav>
      {inspect ? (
        <div role="dialog" aria-label={`Inspect ${inspect.name}`}>
          <h3>{inspect.name}</h3>
          <pre>{JSON.stringify(inspect.value, null, 2)}</pre>
          <button type="button" onClick={() => setInspect(null)}>
            Close
          </button>
        </div>
      ) : null}
    </section>
  );
}
