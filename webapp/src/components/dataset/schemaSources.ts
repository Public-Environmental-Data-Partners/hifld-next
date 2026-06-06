import type { DatasetFormat, DatasetSource, FormatType, SpatialDatasetFileMetadata } from "@/lib/api-client";
import { compareVersionValues } from "./versionLabel";

export interface SchemaSourceSelection {
  source: DatasetSource;
  formatType: FormatType;
  formatName: string;
}

export interface SchemaSummary {
  columnCount: number;
  featureCount: number | null;
  geometryType: string | null;
  invalidGeometryCount: number | null;
  qualityCheckPassed: boolean | null;
  columnsHash: string | null;
}

function hasColumns(source: DatasetSource): boolean {
  return Boolean(source.source_metadata?.columns?.length);
}

function schemaSourceScore(formatEntry: DatasetFormat, source: DatasetSource): number {
  let score = 0;
  if (hasColumns(source)) score += 100;
  if (formatEntry.format.format_type === "geoparquet") score += 10;
  if (source.source_metadata?.feature_count != null) score += 1;
  return score;
}

function getSchemaCandidate(
  formatEntry: DatasetFormat,
  source: DatasetSource,
): { selection: SchemaSourceSelection; score: number } {
  return {
    selection: {
      source,
      formatType: formatEntry.format.format_type,
      formatName: formatEntry.format.name,
    },
    score: schemaSourceScore(formatEntry, source),
  };
}

function getSchemaCandidatesForVersion(
  formatEntries: DatasetFormat[] | undefined,
  version: string | number,
): Array<{ selection: SchemaSourceSelection; score: number }> {
  return (formatEntries ?? []).flatMap((formatEntry) =>
    (formatEntry.sources ?? [])
      .filter((source) => String(source.version ?? "1") === String(version) && hasColumns(source))
      .map((source) => getSchemaCandidate(formatEntry, source)),
  );
}

export function getBestSchemaSourceForVersion(
  formatEntries: DatasetFormat[] | undefined,
  version: string | number | null | undefined,
): SchemaSourceSelection | null {
  if (version == null) {
    return null;
  }

  return (
    getSchemaCandidatesForVersion(formatEntries, version).sort((left, right) => right.score - left.score)[0]
      ?.selection ?? null
  );
}

export function getSchemaVersionOptions(formatEntries: DatasetFormat[] | undefined): Array<string | number> {
  const versions = new Map<string, string | number>();
  for (const formatEntry of formatEntries ?? []) {
    for (const source of formatEntry.sources ?? []) {
      if (hasColumns(source)) {
        versions.set(String(source.version ?? "1"), source.version ?? "1");
      }
    }
  }

  return Array.from(versions.values()).sort(compareVersionValues);
}

export function getLatestSchemaVersion(formatEntries: DatasetFormat[] | undefined): string | number | null {
  return getSchemaVersionOptions(formatEntries)[0] ?? null;
}

export function hasSchemaMetadata(formatEntries: DatasetFormat[] | undefined): boolean {
  return getSchemaVersionOptions(formatEntries).length > 0;
}

export function getSchemaSummary(metadata: SpatialDatasetFileMetadata | null | undefined): SchemaSummary {
  return {
    columnCount: metadata?.columns?.length ?? 0,
    featureCount: metadata?.feature_count ?? null,
    geometryType: metadata?.geometry_type ?? null,
    invalidGeometryCount: metadata?.invalid_geometry_count ?? null,
    qualityCheckPassed: metadata?.quality_check_passed ?? null,
    columnsHash: metadata?.columns_hash ?? null,
  };
}
