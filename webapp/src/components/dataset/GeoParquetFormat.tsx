import { FileJson, Download } from "lucide-react";
import type { DatasetWithUrls } from "@/lib/api-client";
import { CopyButton } from "./CopyButton";
import { DownloadButton } from "./DownloadButton";
import { FormatSourceSelector } from "./FormatSourceSelector";

interface GeoParquetFormatProps {
  formatEntry: NonNullable<DatasetWithUrls["formats"]>[0];
  geoparquetUrl: string;
  storageUri?: string;
  selectedSource: { storageLocationId: number; version: number } | null;
  onSourceChange: (storageLocationId: number, version: number) => void;
}

export function GeoParquetFormat({
  formatEntry,
  geoparquetUrl,
  storageUri,
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
        
        {/* Download */}
        {geoparquetUrl && (
          <div className="mt-3 pl-3 border-l-2 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Download className="h-3 w-3" />
                  <p className="text-xs font-medium">Download</p>
                </div>
                <p className="text-xs text-muted-foreground break-all pl-5">
                  {geoparquetUrl}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <DownloadButton url={geoparquetUrl} label="GeoParquet" />
              </div>
            </div>
          </div>
        )}

        {/* Glob Pattern URI */}
        {storageUri && (
          <div className="mt-3 pl-3 border-l-2 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <FileJson className="h-3 w-3" />
                  <p className="text-xs font-medium">Glob Pattern URI</p>
                </div>
                <code className="text-xs bg-muted px-2 py-1 rounded block break-all pl-5">
                  {storageUri}
                </code>
                <p className="text-xs text-muted-foreground pl-5 mt-1">
                  Use this URI in DuckDB or other tools that support glob patterns
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <CopyButton value={storageUri} label="Copy" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

