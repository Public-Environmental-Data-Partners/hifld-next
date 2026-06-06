import type { DatasetFormat, DatasetSource } from "@/lib/api-client";
import { compareVersionValues } from "./versionLabel";

export { compareVersionValues } from "./versionLabel";

export function getLocationOptions(formatEntry?: DatasetFormat): Array<{ id: number; name: string }> {
  if (!formatEntry?.sources) {
    return [];
  }

  const locations = new Map<number, { id: number; name: string }>();
  for (const source of formatEntry.sources) {
    const locationId = source.storage_location?.id;
    const locationName = source.storage_location?.name;
    if (locationId && locationName && !locations.has(locationId)) {
      locations.set(locationId, { id: locationId, name: locationName });
    }
  }

  return Array.from(locations.values());
}

export function getVersionSourcesForLocation(
  formatEntry: DatasetFormat | undefined,
  locationId: number | null | undefined,
): DatasetSource[] {
  if (!formatEntry?.sources || !locationId) {
    return [];
  }

  const byVersion = new Map<string, DatasetSource>();
  for (const source of formatEntry.sources) {
    if (source.storage_location?.id !== locationId) {
      continue;
    }

    const versionKey = String(source.version ?? "1");
    if (!byVersion.has(versionKey)) {
      byVersion.set(versionKey, source);
    }
  }

  return Array.from(byVersion.values()).sort((left, right) =>
    compareVersionValues(left.version ?? "1", right.version ?? "1"),
  );
}

export function getComparableLocations(formatEntry?: DatasetFormat): Array<{ id: number; name: string }> {
  return getLocationOptions(formatEntry).filter(
    (location) => getVersionSourcesForLocation(formatEntry, location.id).length >= 2,
  );
}

export function hasAnyComparableLocations(formatEntry?: DatasetFormat): boolean {
  return getComparableLocations(formatEntry).length > 0;
}

function sourceScore(formatEntry: DatasetFormat, source: DatasetSource): number {
  let score = 0;
  if (formatEntry.format.format_type === "geoparquet") {
    score += 100;
  }
  if (source.source_metadata?.columns?.length) {
    score += 10;
  }
  if (source.source_metadata) {
    score += 1;
  }
  return score;
}

export function getComparableVersionSources(formatEntries: DatasetFormat[] | undefined): DatasetSource[] {
  const byVersion = new Map<string, { source: DatasetSource; score: number }>();

  for (const formatEntry of formatEntries ?? []) {
    for (const source of formatEntry.sources ?? []) {
      const versionKey = String(source.version ?? "1");
      const candidate = { source, score: sourceScore(formatEntry, source) };
      const existing = byVersion.get(versionKey);
      if (!existing || candidate.score > existing.score) {
        byVersion.set(versionKey, candidate);
      }
    }
  }

  return Array.from(byVersion.values())
    .map((entry) => entry.source)
    .sort((left, right) => compareVersionValues(left.version ?? "1", right.version ?? "1"));
}

export function hasComparableVersions(formatEntries: DatasetFormat[] | undefined): boolean {
  return getComparableVersionSources(formatEntries).length >= 2;
}

export function getDefaultCompareVersionPair(versionSources: DatasetSource[]): {
  left: DatasetSource | undefined;
  right: DatasetSource | undefined;
} {
  if (versionSources.length === 0) {
    return { left: undefined, right: undefined };
  }

  return {
    left: versionSources.at(-1),
    right: versionSources[0],
  };
}
