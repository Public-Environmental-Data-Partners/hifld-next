import type { DatasetFormat, DatasetSource } from "@/lib/api-client";
import { compareVersionValues } from "./versionLabel";

export interface CompareSearchState {
  format: string;
  location: number;
  v1: string;
  v2: string;
}

export function getLocationOptions(formatEntry?: DatasetFormat): Array<{ id: number; name: string }> {
  if (!formatEntry?.sources) {
    return [];
  }

  const locations = new Map<number, { id: number; name: string }>();
  formatEntry.sources.forEach((source) => {
    const locationId = source.storage_location?.id;
    const locationName = source.storage_location?.name;
    if (locationId && locationName && !locations.has(locationId)) {
      locations.set(locationId, { id: locationId, name: locationName });
    }
  });

  return Array.from(locations.values());
}

export function getVersionSourcesForLocation(
  formatEntry: DatasetFormat | undefined,
  locationId: number | null | undefined
): DatasetSource[] {
  if (!formatEntry?.sources || !locationId) {
    return [];
  }

  const byVersion = new Map<string, DatasetSource>();
  formatEntry.sources.forEach((source) => {
    if (source.storage_location?.id !== locationId) {
      return;
    }

    const versionKey = String(source.version ?? "1");
    if (!byVersion.has(versionKey)) {
      byVersion.set(versionKey, source);
    }
  });

  return Array.from(byVersion.values()).sort((left, right) =>
    compareVersionValues(left.version ?? "1", right.version ?? "1")
  );
}

export function getComparableLocations(
  formatEntry?: DatasetFormat
): Array<{ id: number; name: string }> {
  return getLocationOptions(formatEntry).filter(
    (location) => getVersionSourcesForLocation(formatEntry, location.id).length >= 2
  );
}

export function hasAnyComparableLocations(formatEntry?: DatasetFormat): boolean {
  return getComparableLocations(formatEntry).length > 0;
}

export function buildCompareSearchForLocation(
  formatEntry: DatasetFormat | undefined,
  locationId: number | null | undefined
): CompareSearchState | null {
  if (!formatEntry || !locationId) {
    return null;
  }

  const versionSources = getVersionSourcesForLocation(formatEntry, locationId);
  if (versionSources.length < 2) {
    return null;
  }

  return {
    format: formatEntry.format.format_type,
    location: locationId,
    v1: String(versionSources[0]?.version ?? ""),
    v2: String(versionSources[1]?.version ?? ""),
  };
}
