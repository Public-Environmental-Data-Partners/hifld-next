import type { DatasetWithUrls } from "@/lib/api-client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface FormatSourceSelectorProps {
  formatType: string;
  formatEntry: NonNullable<DatasetWithUrls["formats"]>[0];
  selectedSource: { storageLocationId: number; version: number } | null;
  onSourceChange: (storageLocationId: number, version: number) => void;
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

  type SourceType = NonNullable<DatasetWithUrls["formats"]>[0]["sources"][0];

  // Group sources by storage location
  type LocationData = {
    location: SourceType["storage_location"];
    versions: Array<{ version: number; source: SourceType }>;
  };
  const sourcesByLocation: Record<number, LocationData> = {};

  formatEntry.sources.forEach((source) => {
    const locId = source.storage_location?.id;
    if (!locId) return;

    const version = source.version || 1;
    if (!sourcesByLocation[locId]) {
      sourcesByLocation[locId] = {
        location: source.storage_location,
        versions: [],
      };
    }
    const locationData = sourcesByLocation[locId];
    if (locationData) {
      locationData.versions.push({ version, source });
      // Sort versions descending
      locationData.versions.sort(
        (a: { version: number }, b: { version: number }) =>
          b.version - a.version
      );
    }
  });

  const locations = Object.entries(sourcesByLocation) as Array<
    [string, LocationData]
  >;

  if (locations.length === 0) {
    return null;
  }

  // Determine current location and version
  const currentLocationId =
    selectedSource?.storageLocationId || parseInt(locations[0]?.[0] || "0", 10);
  const currentLocation: LocationData | null =
    sourcesByLocation[currentLocationId] || locations[0]?.[1] || null;
  const availableVersions = currentLocation?.versions || [];

  // Always show selectors, even if there's only one option
  // This allows users to see what location and version they're viewing
  const defaultLocationId = currentLocationId;
  const defaultVersion =
    selectedSource?.version || availableVersions[0]?.version || 1;

  return (
    <div className="flex flex-col gap-2 mb-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 w-[60px]">
          Location:
        </span>
        <Select
          value={defaultLocationId.toString()}
          onValueChange={(value) => {
            const locId = parseInt(value, 10);
            const location = sourcesByLocation[locId];
            if (location && location.versions.length > 0) {
              onSourceChange(locId, location.versions[0].version);
            }
          }}
          disabled={locations.length === 1}
        >
          <SelectTrigger className="flex-1 max-w-full">
            <SelectValue placeholder="Storage Location" />
          </SelectTrigger>
          <SelectContent>
            {locations.map((entry: [string, LocationData]) => {
              const [locIdStr, locationData] = entry;
              const locId = parseInt(locIdStr, 10);
              return (
                <SelectItem key={locId} value={locId.toString()}>
                  {locationData.location?.name || `Location ${locId}`}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 w-[60px]">
          Version:
        </span>
        <Select
          value={defaultVersion.toString()}
          onValueChange={(value) => {
            const version = parseInt(value, 10);
            if (defaultLocationId) {
              onSourceChange(defaultLocationId, version);
            }
          }}
          disabled={availableVersions.length === 1}
        >
          <SelectTrigger className="flex-1 max-w-full">
            <SelectValue placeholder="Version" />
          </SelectTrigger>
          <SelectContent>
            {availableVersions.map((entry: { version: number }) => {
              const { version } = entry;
              return (
                <SelectItem key={version} value={version.toString()}>
                  v{version}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

