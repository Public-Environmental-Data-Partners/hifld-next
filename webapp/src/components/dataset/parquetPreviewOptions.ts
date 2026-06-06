import type { DatasetFormat, DatasetSource, FileLocation } from "@/lib/api-client";
import { buildSourceFileUrl } from "./sourceUrls";
import { compareVersionValues } from "./versionLabel";

export interface ParquetPreviewSelection {
  storageLocationId: number;
  version: string | number;
  sourceId: number;
}

export interface ParquetPreviewOption extends ParquetPreviewSelection {
  fileName: string;
  url: string;
  storageLocationName: string;
  path: string;
}

function isFileLocation(location: DatasetSource["location"]): location is FileLocation {
  return "path" in location;
}

function sourcePath(source: DatasetSource): string | null {
  return isFileLocation(source.location) ? source.location.path : null;
}

export function parquetPreviewOptionFromSource(source: DatasetSource): ParquetPreviewOption | null {
  const path = sourcePath(source);
  const url = buildSourceFileUrl(source);
  const storageLocationId = source.storage_location?.id;
  const storageLocationName = source.storage_location?.name;

  if (!path || !url || path.includes("*") || !path.toLowerCase().endsWith(".parquet")) {
    return null;
  }

  if (storageLocationId === undefined || storageLocationId === 0 || !storageLocationName) {
    return null;
  }

  return {
    storageLocationId,
    storageLocationName,
    version: source.version ?? "1",
    sourceId: source.id,
    url,
    path,
    fileName: path.split("/").pop() || "data.parquet",
  };
}

export function concreteParquetPreviewOptions(formatEntry: DatasetFormat | undefined): ParquetPreviewOption[] {
  return (formatEntry?.sources ?? [])
    .map(parquetPreviewOptionFromSource)
    .filter((option): option is ParquetPreviewOption => option !== null)
    .sort((left, right) => {
      const versionCompare = compareVersionValues(left.version, right.version);
      if (versionCompare !== 0) {
        return versionCompare;
      }
      const locationCompare = left.storageLocationName.localeCompare(right.storageLocationName);
      return locationCompare !== 0 ? locationCompare : left.fileName.localeCompare(right.fileName);
    });
}

export function parquetPreviewOptionsForSelection(
  formatEntry: DatasetFormat | undefined,
  selection: Pick<ParquetPreviewSelection, "storageLocationId" | "version">,
): ParquetPreviewOption[] {
  return concreteParquetPreviewOptions(formatEntry).filter(
    (option) =>
      option.storageLocationId === selection.storageLocationId && String(option.version) === String(selection.version),
  );
}

export function defaultParquetPreviewSelection(
  formatEntry: DatasetFormat | undefined,
  selectedSource: DatasetSource | null | undefined,
): ParquetPreviewSelection | null {
  const concreteOptions = concreteParquetPreviewOptions(formatEntry);
  const selectedOption = selectedSource
    ? concreteOptions.find((option) => option.sourceId === selectedSource.id)
    : undefined;
  const firstOption = selectedOption ?? concreteOptions[0];

  if (!firstOption) {
    return null;
  }

  return {
    storageLocationId: firstOption.storageLocationId,
    version: firstOption.version,
    sourceId: firstOption.sourceId,
  };
}
