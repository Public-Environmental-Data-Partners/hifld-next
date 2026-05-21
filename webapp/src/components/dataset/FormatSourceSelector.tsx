import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DatasetWithUrls } from "@/lib/api-client";
import { compareVersionValues, formatVersionLabel, parseVersionValue } from "./versionLabel";

interface FormatSourceSelectorProps {
  formatType: string;
  formatEntry: NonNullable<DatasetWithUrls["formats"]>[0];
  selectedSource: { storageLocationId: number; version: string | number } | null;
  onSourceChange: (storageLocationId: number, version: string | number) => void;
}

type SourceType = NonNullable<DatasetWithUrls["formats"]>[0]["sources"][0];

interface LocationData {
  id: number;
  location: SourceType["storage_location"];
  versions: Array<{ version: string | number; source: SourceType }>;
}

function sourceLocations(sources: SourceType[]): LocationData[] {
  const locations = new Map<number, LocationData>();

  for (const source of sources) {
    const locId = source.storage_location?.id;
    if (!locId) continue;

    const version = source.version || 1;
    const existing = locations.get(locId);
    if (existing) {
      existing.versions.push({ version, source });
      existing.versions.sort((a, b) => compareVersionValues(a.version, b.version));
    } else {
      locations.set(locId, {
        id: locId,
        location: source.storage_location,
        versions: [{ version, source }],
      });
    }
  }

  return Array.from(locations.values());
}

export function FormatSourceSelector({
  formatType: _formatType,
  formatEntry,
  selectedSource,
  onSourceChange,
}: FormatSourceSelectorProps) {
  if (!formatEntry.sources || formatEntry.sources.length === 0) {
    return null;
  }

  const locations = sourceLocations(formatEntry.sources);

  if (locations.length === 0) {
    return null;
  }

  // Determine current location and version
  const currentLocationId = selectedSource?.storageLocationId || locations[0]?.id || 0;
  const currentLocation = locations.find((location) => location.id === currentLocationId) ?? locations[0];
  const availableVersions = currentLocation?.versions || [];

  // Always show selectors, even if there's only one option
  // This allows users to see what location and version they're viewing
  const defaultLocationId = currentLocationId;
  const defaultVersion = selectedSource?.version || availableVersions[0]?.version || 1;
  const locationLabel = currentLocation?.location?.name || `Location ${defaultLocationId}`;
  const truncateLabel = (value: string, maxLength = 15) =>
    value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
  const locationLabelShort = truncateLabel(locationLabel);
  const versionLabel = formatVersionLabel(defaultVersion);

  return (
    <div className="flex flex-col gap-2 mb-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 w-[60px]">Location:</span>
        <Select
          value={defaultLocationId.toString()}
          onValueChange={(value) => {
            const locId = parseInt(value, 10);
            const location = locations.find((entry) => entry.id === locId);
            const nextVersion = location?.versions[0]?.version;
            if (nextVersion !== undefined) {
              onSourceChange(locId, nextVersion);
            }
          }}
          disabled={locations.length === 1}
        >
          <SelectTrigger className="flex-1 min-w-0 max-w-full" title={locationLabel}>
            <SelectValue placeholder="Storage Location" className="truncate">
              {locationLabelShort}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {locations.map((locationData) => {
              const locId = locationData.id;
              return (
                <SelectItem key={locId} value={locId.toString()}>
                  {truncateLabel(locationData.location?.name || `Location ${locId}`)}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 w-[60px]">Version:</span>
        <Select
          value={defaultVersion.toString()}
          onValueChange={(value) => {
            const version = parseVersionValue(value);
            if (defaultLocationId) {
              onSourceChange(defaultLocationId, version);
            }
          }}
          disabled={availableVersions.length === 1}
        >
          <SelectTrigger className="flex-1 min-w-0 max-w-full" title={versionLabel}>
            <SelectValue placeholder="Version" className="truncate">
              {versionLabel}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {availableVersions.map((entry) => {
              const { version } = entry;
              return (
                <SelectItem key={String(version)} value={version.toString()}>
                  {formatVersionLabel(version)}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
