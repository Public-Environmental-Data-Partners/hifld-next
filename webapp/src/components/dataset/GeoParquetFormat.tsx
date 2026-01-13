import { FileJson } from "lucide-react";
import type { DatasetWithUrls } from "@/lib/api-client";
import { CopyButton } from "./CopyButton";
import { DownloadButton } from "./DownloadButton";
import { FormatSourceSelector } from "./FormatSourceSelector";

interface GeoParquetFormatProps {
  formatEntry: NonNullable<DatasetWithUrls["formats"]>[0];
  geoparquetUrl: string;
  selectedSource: { storageLocationId: number; version: number } | null;
  onSourceChange: (storageLocationId: number, version: number) => void;
}

export function GeoParquetFormat({
  formatEntry,
  geoparquetUrl,
  selectedSource,
  onSourceChange,
}: GeoParquetFormatProps) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-md border">
      <FileJson className="h-4 w-4 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium mb-1">GeoParquet</p>
        <FormatSourceSelector
          formatType="geoparquet"
          formatEntry={formatEntry}
          selectedSource={selectedSource}
          onSourceChange={onSourceChange}
        />
        <p className="text-xs text-muted-foreground break-all">
          {geoparquetUrl}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        <CopyButton value={geoparquetUrl} label="URL" />
        <DownloadButton url={geoparquetUrl} label="GeoParquet" />
      </div>
    </div>
  );
}

