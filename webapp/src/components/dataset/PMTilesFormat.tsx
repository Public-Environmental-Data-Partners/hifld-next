import { Map } from "lucide-react";
import type { DatasetWithUrls } from "@/lib/api-client";
import { CopyButton } from "./CopyButton";
import { DownloadButton } from "./DownloadButton";
import { FormatSourceSelector } from "./FormatSourceSelector";

interface PMTilesFormatProps {
  formatEntry: NonNullable<DatasetWithUrls["formats"]>[0];
  pmtilesUrl: string;
  selectedSource: { storageLocationId: number; version: number } | null;
  onSourceChange: (storageLocationId: number, version: number) => void;
}

export function PMTilesFormat({
  formatEntry,
  pmtilesUrl,
  selectedSource,
  onSourceChange,
}: PMTilesFormatProps) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-md border">
      <Map className="h-4 w-4 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium mb-1">PMTiles</p>
        <FormatSourceSelector
          formatType="pmtiles"
          formatEntry={formatEntry}
          selectedSource={selectedSource}
          onSourceChange={onSourceChange}
        />
        <p className="text-xs text-muted-foreground break-all">{pmtilesUrl}</p>
      </div>
      <div className="flex shrink-0 gap-1">
        <CopyButton value={pmtilesUrl} label="URL" />
        <DownloadButton url={pmtilesUrl} label="PMTiles" />
      </div>
    </div>
  );
}

