import { createFileRoute } from "@tanstack/react-router";
import {
  getBestSchemaSourceForVersion,
  getLatestSchemaVersion,
  getSchemaSummary,
  getSchemaVersionOptions,
  type SchemaSourceSelection,
} from "@/components/dataset/schemaSources";
import type { ColumnSchema, SpatialDatasetFileMetadata } from "@/lib/api-client";
import { getCollectionBySlug, getDatasetBySlug, getDatasetFileBySlug } from "@/lib/api-client";
import { collectionSelf, datasetSelf, fileSelf, requestOrigin, schemaSelf } from "@/lib/api-links";
import { jsonProblem } from "@/lib/api-problem";

const DEFAULT_COLUMN_LIMIT = 25;
const MAX_COLUMN_LIMIT = 50;

export type SchemaPaging = {
  offset: number;
  limit: number;
};

export type SchemaPagingParseResult = {
  paging: SchemaPaging | null;
  error?: Response | undefined;
};

function parseNonNegativeInteger(value: string, field: string): number | Response {
  if (!/^\d+$/.test(value)) {
    return jsonProblem(400, "Invalid schema column paging", `${field} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return jsonProblem(400, "Invalid schema column paging", `${field} must be a safe integer`);
  }
  return parsed;
}

export function parseSchemaPaging(searchParams: URLSearchParams): SchemaPagingParseResult {
  const offsetValue = searchParams.get("column_offset");
  const limitValue = searchParams.get("column_limit");
  if (offsetValue === null && limitValue === null) return { paging: null };

  const offsetResult = offsetValue === null ? 0 : parseNonNegativeInteger(offsetValue, "column_offset");
  if (offsetResult instanceof Response) return { paging: null, error: offsetResult };
  const limitResult = limitValue === null ? DEFAULT_COLUMN_LIMIT : parseNonNegativeInteger(limitValue, "column_limit");
  if (limitResult instanceof Response) return { paging: null, error: limitResult };
  if (limitResult < 1 || limitResult > MAX_COLUMN_LIMIT) {
    return {
      paging: null,
      error: jsonProblem(400, "Invalid schema column paging", `column_limit must be between 1 and ${MAX_COLUMN_LIMIT}`),
    };
  }
  return { paging: { offset: offsetResult, limit: limitResult } };
}

type SchemaPagingFields = {
  total_columns?: number;
  column_offset?: number;
  column_limit?: number;
  has_more?: boolean;
};

function schemaPagingFields(paging: SchemaPaging | null, totalColumns: number): SchemaPagingFields {
  if (!paging) return {};
  return {
    total_columns: totalColumns,
    column_offset: paging.offset,
    column_limit: paging.limit,
    has_more: paging.offset + paging.limit < totalColumns,
  };
}

function schemaColumns(metadata: SpatialDatasetFileMetadata | null, paging: SchemaPaging | null): ColumnSchema[] {
  const columns = metadata?.columns ?? [];
  return paging ? columns.slice(paging.offset, paging.offset + paging.limit) : columns;
}

function selectedSchema(
  selection: SchemaSourceSelection,
  selectedVersion: string | number | null,
  metadata: SpatialDatasetFileMetadata | null,
  paging: SchemaPaging | null,
) {
  const allColumns = metadata?.columns ?? [];
  return {
    version: selectedVersion,
    format_type: selection.formatType,
    format_name: selection.formatName,
    source_id: selection.source.id,
    storage_location: selection.source.storage_location ?? null,
    source: selection.source,
    source_metadata: metadata,
    summary: getSchemaSummary(metadata),
    columns: schemaColumns(metadata, paging),
    ...schemaPagingFields(paging, allColumns.length),
  };
}

export const Route = createFileRoute("/api/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug/schema")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const searchParams = new URL(request.url).searchParams;
        const pagingResult = parseSchemaPaging(searchParams);
        if (pagingResult.error) return pagingResult.error;
        const paging = pagingResult.paging;
        const collection = await getCollectionBySlug({
          data: { slug: params.collectionSlug },
        });
        if (!collection) {
          return jsonProblem(404, "Collection not found");
        }

        const dataset = await getDatasetBySlug({
          data: {
            collectionSlug: params.collectionSlug,
            datasetSlug: params.datasetSlug,
            includeUrls: false,
          },
        });
        if (!dataset) {
          return jsonProblem(404, "Dataset not found");
        }

        const result = await getDatasetFileBySlug({
          data: {
            collectionSlug: params.collectionSlug,
            datasetSlug: params.datasetSlug,
            fileSlug: params.fileSlug,
          },
        });
        if (!result) {
          return jsonProblem(404, "File not found");
        }

        const origin = requestOrigin(request);
        const cs = params.collectionSlug;
        const ds = params.datasetSlug;
        const fs = params.fileSlug;
        const requestedVersion = searchParams.get("version");
        const versionOptions = getSchemaVersionOptions(result.file.formats);
        const selectedVersion =
          requestedVersion && versionOptions.some((version) => String(version) === requestedVersion)
            ? requestedVersion
            : getLatestSchemaVersion(result.file.formats);
        const selectedSchemaSource = getBestSchemaSourceForVersion(result.file.formats, selectedVersion);
        const metadata = selectedSchemaSource?.source.source_metadata ?? null;
        const allColumns = metadata?.columns ?? [];
        const schema = selectedSchemaSource
          ? selectedSchema(selectedSchemaSource, selectedVersion, metadata, paging)
          : null;

        return Response.json({
          links: {
            self: schemaSelf(origin, cs, ds, fs, {
              version: selectedVersion,
              ...(paging ? { column_offset: paging.offset, column_limit: paging.limit } : {}),
            }),
            file: fileSelf(origin, cs, ds, fs),
            dataset: datasetSelf(origin, cs, ds),
            collection: collectionSelf(origin, cs),
          },
          collection,
          dataset: result.dataset,
          file: {
            id: result.file.id,
            dataset_id: result.file.dataset_id,
            slug: result.file.slug,
            name: result.file.name,
            description: result.file.description,
            layer_name: result.file.layer_name,
          },
          versions: versionOptions,
          selected_version: selectedVersion,
          schema,
          ...schemaPagingFields(paging, allColumns.length),
        });
      },
    },
  },
});
