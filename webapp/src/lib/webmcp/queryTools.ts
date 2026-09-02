import { useCallback } from "react";
import { z } from "zod";
import {
  QueryApiError,
  type QueryCell,
  type QueryPage,
  type QueryPageRequest,
  QueryPageRequestSchema,
  type QueryRequest,
  QueryRequestSchema,
} from "@/lib/query-api";
import { failure, success, type WebMcpJsonObject, type WebMcpResult } from "./result";
import { useWebMcpTool } from "./useWebMcpTool";

const queryPageInputSchema = QueryPageRequestSchema.extend({
  query_id: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/),
}).strict();
const runDatasetQueryInputSchema = QueryRequestSchema.extend({
  show_on_map: z.boolean().default(true),
  layer_label: z.string().trim().min(1).max(80).optional(),
}).strict();
const MAX_WARNING_COUNT = 10;
const MAX_WARNING_LENGTH = 160;

export type RunDatasetQueryInput = z.input<typeof runDatasetQueryInputSchema>;

export interface QueryMapPresentation {
  showOnMap: boolean;
  layerLabel?: string | undefined;
}

type ExecuteQuery = (
  input: QueryRequest,
  presentation: QueryMapPresentation,
  signal: AbortSignal,
) => Promise<PublicToolQueryPage>;
type ExecuteQueryPage = (queryId: string, input: QueryPageRequest, signal: AbortSignal) => Promise<PublicToolQueryPage>;

export interface PublicToolQueryPage {
  query_id: string;
  columns: ReadonlyArray<{ name: string; type: string; nullable: boolean }>;
  offset: number;
  limit: number;
  returned_count: number;
  has_more: boolean;
  next_offset?: number | undefined;
  warnings: readonly string[];
  elapsed_ms: number;
  response_truncated: boolean;
  map_configuration?: { geometry_column: string } | undefined;
  rows: QueryPage["rows"];
}

function previewCell(value: QueryCell): WebMcpJsonObject[keyof WebMcpJsonObject] {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (Array.isArray(value)) return "[array]";
  if ("$type" in value) return `[${value.$type}]`;
  return "[object]";
}

function previewRows(page: PublicToolQueryPage, maximum: number): WebMcpJsonObject[] {
  return page.rows.slice(0, maximum).map((row) => {
    const preview: WebMcpJsonObject = {};
    for (const column of page.columns) {
      preview[column.name] = previewCell(row[column.name] ?? null);
    }
    return preview;
  });
}

function boundedWarnings(warnings: readonly string[]): string[] {
  return warnings
    .slice(0, MAX_WARNING_COUNT)
    .map((warning) => Array.from(warning).slice(0, MAX_WARNING_LENGTH).join(""));
}

function runResult(page: PublicToolQueryPage, mapAdded: boolean): WebMcpJsonObject {
  const warnings = boundedWarnings(page.warnings);
  return {
    query_id: page.query_id,
    columns: page.columns.map((column) => ({ name: column.name, type: column.type, nullable: column.nullable })),
    offset: page.offset,
    limit: page.limit,
    returned_count: page.returned_count,
    has_more: page.has_more,
    ...(page.next_offset === undefined ? {} : { next_offset: page.next_offset }),
    warning_count: page.warnings.length,
    warnings,
    elapsed_ms: page.elapsed_ms,
    response_truncated: page.response_truncated,
    map_available: page.map_configuration !== undefined,
    map_added: mapAdded && page.map_configuration !== undefined,
    preview_rows: previewRows(page, 5),
  };
}

function pageResult(page: PublicToolQueryPage): WebMcpJsonObject {
  return {
    offset: page.offset,
    page_size: page.limit,
    returned_count: page.returned_count,
    has_more: page.has_more,
    preview_rows: previewRows(page, 2),
  };
}

function queryFailure(error: Error): WebMcpResult<WebMcpJsonObject> {
  if (error instanceof QueryApiError) {
    if (error.status === 400 || error.status === 401 || error.status === 403) {
      return failure("query_rejected", "The query request was rejected.");
    }
    if (error.status === 404) return failure("not_found", "The requested query was not found.");
    if (error.status === 429) return failure("rate_limited", "The query service is rate limited.");
    if (error.status === 503) return failure("query_capacity", "The query service is temporarily at capacity.");
  }
  return failure("upstream_unavailable", "The query service is temporarily unavailable.");
}

export async function executeQueryTool(
  input: RunDatasetQueryInput,
  signal: AbortSignal,
  execute: ExecuteQuery,
): Promise<WebMcpResult<WebMcpJsonObject>> {
  try {
    const { layer_label: layerLabel, show_on_map: requestedShowOnMap, ...request } = input;
    const showOnMap = requestedShowOnMap ?? true;
    const page = await execute(request, { showOnMap, ...(layerLabel === undefined ? {} : { layerLabel }) }, signal);
    return success("Query completed.", runResult(page, showOnMap));
  } catch (error) {
    if (signal.aborted) throw error;
    return error instanceof Error
      ? queryFailure(error)
      : failure("upstream_unavailable", "The query service is temporarily unavailable.");
  }
}

export async function executeQueryPageTool(
  input: z.infer<typeof queryPageInputSchema>,
  signal: AbortSignal,
  execute: ExecuteQueryPage,
): Promise<WebMcpResult<WebMcpJsonObject>> {
  try {
    const page = await execute(input.query_id, { offset: input.offset, page_size: input.page_size ?? 100 }, signal);
    return success("Query page loaded.", pageResult(page));
  } catch (error) {
    if (signal.aborted) throw error;
    return error instanceof Error
      ? queryFailure(error)
      : failure("upstream_unavailable", "The query service is temporarily unavailable.");
  }
}

export function useQueryWebMcpTools({
  enabled,
  pageEnabled,
  executeQuery,
  executePage,
}: {
  enabled: boolean;
  pageEnabled: boolean;
  executeQuery: ExecuteQuery;
  executePage: ExecuteQueryPage;
}): void {
  const executeQueryToolCallback = useCallback(
    (input: RunDatasetQueryInput, signal: AbortSignal) => executeQueryTool(input, signal, executeQuery),
    [executeQuery],
  );
  const executePageToolCallback = useCallback(
    (input: z.infer<typeof queryPageInputSchema>, signal: AbortSignal) =>
      executeQueryPageTool(input, signal, executePage),
    [executePage],
  );
  useWebMcpTool({
    name: "run_dataset_query",
    title: "Run dataset query",
    description:
      "Execute a bounded query against selected dataset sources. To map it, return a DuckDB GEOMETRY column, name it in geometry_column, and set result_crs to the CRS produced by the SQL; map tiles and framing reproject server-side.",
    schema: runDatasetQueryInputSchema,
    execute: executeQueryToolCallback,
    enabled,
    routeKind: "query",
    annotations: { readOnlyHint: false, untrustedContentHint: true },
  });
  useWebMcpTool({
    name: "set_result_page",
    title: "Set result page",
    description: "Load one bounded page from an existing query.",
    schema: queryPageInputSchema,
    execute: executePageToolCallback,
    enabled: enabled && pageEnabled,
    routeKind: "query",
    annotations: { readOnlyHint: false, untrustedContentHint: true },
  });
}
