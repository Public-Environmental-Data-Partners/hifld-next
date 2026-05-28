import { ParquetViewerPanel } from "@/components/dataset/ParquetViewerPanel";
import type { ParquetPreviewOption, ParquetPreviewSelection } from "@/components/dataset/parquetPreviewOptions";
import { ResizablePanel } from "@/components/ui/resizable";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { compareVersionValues, formatVersionLabel } from "./versionLabel";

interface ParquetPreviewDrawerProps {
  options: ParquetPreviewOption[];
  selection: ParquetPreviewSelection | null;
  viewer: {
    url: string;
    fileName: string;
  };
  onSelectOption: (option: ParquetPreviewOption) => void;
  onClose: () => void;
}

function uniqueLocationOptions(options: ParquetPreviewOption[]): Array<{ id: number; name: string }> {
  const locations = new Map<number, { id: number; name: string }>();
  for (const option of options) {
    if (!locations.has(option.storageLocationId)) {
      locations.set(option.storageLocationId, {
        id: option.storageLocationId,
        name: option.storageLocationName,
      });
    }
  }
  return Array.from(locations.values());
}

function uniqueVersionOptions(options: ParquetPreviewOption[], storageLocationId: number): Array<string | number> {
  const versions = new Map<string, string | number>();
  for (const option of options) {
    if (option.storageLocationId !== storageLocationId) {
      continue;
    }
    versions.set(String(option.version), option.version);
  }
  return Array.from(versions.values()).sort(compareVersionValues);
}

export function findSelectedParquetOption(
  options: ParquetPreviewOption[],
  selection: ParquetPreviewSelection | null,
): ParquetPreviewOption | undefined {
  if (!selection) {
    return options[0];
  }

  return (
    options.find((option) => option.sourceId === selection.sourceId) ??
    options.find(
      (option) =>
        option.storageLocationId === selection.storageLocationId &&
        String(option.version) === String(selection.version),
    ) ??
    options[0]
  );
}

function ParquetPickerRow({
  options,
  selection,
  onSelectOption,
}: {
  options: ParquetPreviewOption[];
  selection: ParquetPreviewSelection | null;
  onSelectOption: (option: ParquetPreviewOption) => void;
}) {
  const selectedOption = findSelectedParquetOption(options, selection);
  const locations = uniqueLocationOptions(options);
  const currentLocationId = selectedOption?.storageLocationId ?? locations[0]?.id;
  const versions = currentLocationId ? uniqueVersionOptions(options, currentLocationId) : [];
  const currentVersion = selectedOption?.version ?? versions[0];
  const fileOptions = options.filter(
    (option) => option.storageLocationId === currentLocationId && String(option.version) === String(currentVersion),
  );
  const currentSourceId = selectedOption?.sourceId ?? fileOptions[0]?.sourceId;

  const selectFirstFile = (storageLocationId: number, version: string | number) => {
    const nextOption = options.find(
      (option) => option.storageLocationId === storageLocationId && String(option.version) === String(version),
    );
    if (nextOption) {
      onSelectOption(nextOption);
    }
  };

  return (
    <div className="shrink-0 border-b px-4 py-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,16rem)_10rem_minmax(0,1fr)] md:items-start">
        <div className="min-w-0 space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="parquet-location">
            Location
          </label>
          <Select
            value={currentLocationId ? String(currentLocationId) : ""}
            onValueChange={(value) => {
              const storageLocationId = Number(value);
              const nextVersion = uniqueVersionOptions(options, storageLocationId)[0];
              if (nextVersion !== undefined) {
                selectFirstFile(storageLocationId, nextVersion);
              }
            }}
          >
            <SelectTrigger id="parquet-location" className="h-8">
              <SelectValue placeholder="Select location" />
            </SelectTrigger>
            <SelectContent>
              {locations.map((location) => (
                <SelectItem key={location.id} value={String(location.id)}>
                  {location.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-0 space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="parquet-version">
            Version
          </label>
          <Select
            value={currentVersion !== undefined ? String(currentVersion) : ""}
            onValueChange={(value) => {
              if (currentLocationId) {
                selectFirstFile(currentLocationId, value);
              }
            }}
          >
            <SelectTrigger id="parquet-version" className="h-8">
              <SelectValue placeholder="Select version" />
            </SelectTrigger>
            <SelectContent>
              {versions.map((version) => (
                <SelectItem key={String(version)} value={String(version)}>
                  {formatVersionLabel(version)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="col-span-2 min-w-0 space-y-1 md:col-span-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="parquet-file">
            Parquet file
          </label>
          <Select
            value={currentSourceId ? String(currentSourceId) : ""}
            onValueChange={(value) => {
              const nextOption = options.find((option) => option.sourceId === Number(value));
              if (nextOption) {
                onSelectOption(nextOption);
              }
            }}
          >
            <SelectTrigger id="parquet-file" className="h-8">
              <SelectValue placeholder="Select parquet file" />
            </SelectTrigger>
            <SelectContent>
              {fileOptions.map((option) => (
                <SelectItem key={option.sourceId} value={String(option.sourceId)}>
                  {option.fileName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {selectedOption && (
        <p className="mt-2 hidden truncate text-xs text-muted-foreground md:block">{selectedOption.path}</p>
      )}
    </div>
  );
}

export function ParquetPreviewDrawer({
  options,
  selection,
  viewer,
  onSelectOption,
  onClose,
}: ParquetPreviewDrawerProps) {
  return (
    <ResizablePanel
      defaultSize="55%"
      minSize="35%"
      maxSize="75%"
      className="min-h-[240px] overflow-y-auto flex flex-col"
    >
      {options.length > 0 && (
        <ParquetPickerRow options={options} selection={selection} onSelectOption={onSelectOption} />
      )}
      <div className="min-h-[260px] flex-1 overflow-hidden">
        <ParquetViewerPanel url={viewer.url} fileName={viewer.fileName} onClose={onClose} />
      </div>
    </ResizablePanel>
  );
}
