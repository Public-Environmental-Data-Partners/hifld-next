import type { ColumnSchema, DatasetSource, SpatialDatasetFileMetadata } from "@/lib/api-client";
import type { WebMcpJsonValue } from "./result";

export const MAX_COMPARISON_COLUMNS = 25;
const MAX_METADATA_STRING_LENGTH = 240;

type MetadataKey =
  | "description"
  | "feature_count"
  | "bounds"
  | "geometry_type"
  | "size_bytes"
  | "quality_check_passed"
  | "invalid_geometry_count"
  | "columns_hash";

const METADATA_KEYS: MetadataKey[] = [
  "description",
  "feature_count",
  "bounds",
  "geometry_type",
  "size_bytes",
  "quality_check_passed",
  "invalid_geometry_count",
  "columns_hash",
];

export type ComparisonMetadataValue = string | number | boolean | (string | number)[] | null;

export interface ComparisonMetadataChange {
  [key: string]: WebMcpJsonValue;
  field: MetadataKey;
  left: ComparisonMetadataValue;
  right: ComparisonMetadataValue;
}

export interface FileVersionComparison {
  [key: string]: WebMcpJsonValue;
  left_version: string;
  right_version: string;
  changed_metadata: ComparisonMetadataChange[];
  added_columns: string[];
  removed_columns: string[];
  changed_columns: string[];
  truncated?: true;
}

function sourceVersion(source: DatasetSource): string {
  return String(source.version ?? source.source_metadata?.version ?? "1");
}

function metadataValue(value: SpatialDatasetFileMetadata[MetadataKey] | undefined): ComparisonMetadataValue {
  if (value == null) return null;
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.slice(0, MAX_METADATA_STRING_LENGTH);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return null;
}

function columns(source: DatasetSource): ColumnSchema[] {
  return source.source_metadata?.columns ?? [];
}

function sameValue(left: ComparisonMetadataValue, right: ComparisonMetadataValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function boundedColumns(values: string[]): { values: string[]; truncated: boolean } {
  return {
    values: values.slice(0, MAX_COMPARISON_COLUMNS),
    truncated: values.length > MAX_COMPARISON_COLUMNS,
  };
}

/**
 * Compare only published file metadata and column definitions.
 * Source locations and data rows are intentionally never part of the result.
 */
export function compareFileVersions(leftSource: DatasetSource, rightSource: DatasetSource): FileVersionComparison {
  const leftMetadata = leftSource.source_metadata;
  const rightMetadata = rightSource.source_metadata;
  const changedMetadata = METADATA_KEYS.flatMap((field) => {
    const left = metadataValue(leftMetadata?.[field]);
    const right = metadataValue(rightMetadata?.[field]);
    return sameValue(left, right) ? [] : [{ field, left, right }];
  });

  const leftColumns = new Map(columns(leftSource).map((column) => [column.name, column]));
  const rightColumns = new Map(columns(rightSource).map((column) => [column.name, column]));
  const names = [...new Set([...leftColumns.keys(), ...rightColumns.keys()])].sort((left, right) =>
    left.localeCompare(right),
  );
  const added = names.filter((name) => !leftColumns.has(name) && rightColumns.has(name));
  const removed = names.filter((name) => leftColumns.has(name) && !rightColumns.has(name));
  const changed = names.filter((name) => {
    const left = leftColumns.get(name);
    const right = rightColumns.get(name);
    return Boolean(left && right && left.type !== right.type);
  });
  const boundedAdded = boundedColumns(added);
  const boundedRemoved = boundedColumns(removed);
  const boundedChanged = boundedColumns(changed);

  return {
    left_version: sourceVersion(leftSource),
    right_version: sourceVersion(rightSource),
    changed_metadata: changedMetadata,
    added_columns: boundedAdded.values,
    removed_columns: boundedRemoved.values,
    changed_columns: boundedChanged.values,
    ...(boundedAdded.truncated || boundedRemoved.truncated || boundedChanged.truncated ? { truncated: true } : {}),
  };
}
