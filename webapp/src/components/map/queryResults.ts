import { isQueryMvtReservedProperty } from "@hifld/map-core";
import type { QueryColumn, QueryPage, QueryResult } from "@/lib/query-api";
import { buildQueryMvtLayer, type QueryMvtLayer } from "./multiLayerSources";

export type PublicQueryPage = Omit<QueryPage, "query_token">;

export interface QueryResultState {
  page: PublicQueryPage;
  sourceAliases: string[];
  layerId: string | null;
  status: "ready" | "error";
  errorMessage: string | null;
}

export function canSetQueryResultPage(page: Pick<PublicQueryPage, "has_more" | "offset">): boolean {
  return page.has_more || page.offset > 0;
}

export function publicQueryPage(page: QueryPage): PublicQueryPage {
  const { query_token: _queryToken, ...publicPage } = page;
  return publicPage;
}

export function appendQueryPage(current: PublicQueryPage, next: PublicQueryPage): PublicQueryPage {
  if (current.query_id !== next.query_id || next.offset < current.offset + current.rows.length) {
    return next;
  }
  return {
    ...next,
    offset: current.offset,
    rows: [...current.rows, ...next.rows],
    returned_count: current.returned_count + next.returned_count,
  };
}

function scalarFields(columns: readonly QueryColumn[], geometryColumn: string) {
  return columns
    .filter(
      (column) =>
        column.name !== geometryColumn &&
        column.type.toLowerCase() !== "geometry" &&
        !isQueryMvtReservedProperty(column.name),
    )
    .map((column) => ({ name: column.name, logicalType: column.type, nullable: column.nullable }));
}

export function queryLayerFromResult(result: QueryResult, sourceAliases: readonly string[] = []): QueryMvtLayer | null {
  const mapConfiguration = result.map_configuration;
  if (!mapConfiguration) return null;
  return buildQueryMvtLayer({
    queryId: result.query_id,
    label: `Query ${result.query_id.slice(0, 8)}`,
    sourceAliases,
    geometryColumn: mapConfiguration.geometry_column,
    tileTemplate: mapConfiguration.tile_url,
    sourceLayerId: mapConfiguration.source_layer,
    scalarFields: scalarFields(result.columns, mapConfiguration.geometry_column),
    bounds: mapConfiguration.initial_bounds,
    status: "ready",
  });
}

export function queryResultState(
  result: QueryResult,
  sourceAliases: readonly string[],
  layerId: string | null,
): QueryResultState {
  return {
    page: publicQueryPage(result),
    sourceAliases: [...sourceAliases],
    layerId,
    status: "ready",
    errorMessage: null,
  };
}
