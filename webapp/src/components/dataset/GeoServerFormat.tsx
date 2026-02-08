import { Database, Globe, Package, ExternalLink, FileJson } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DatasetWithUrls } from "@/lib/api-client";
import { CopyButton } from "./CopyButton";
import { DownloadButton } from "./DownloadButton";
import { FormatSourceSelector } from "./FormatSourceSelector";

interface GeoServerFormatProps {
  formatEntry: NonNullable<DatasetWithUrls["formats"]>[0];
  ogcFeaturesUrl: string | null;
  fullLayerName: string | null;
  geopackageUrl: string | null;
  geojsonUrl?: string | null;
  selectedSource: { storageLocationId: number; version: number } | null;
  onSourceChange: (storageLocationId: number, version: number) => void;
}

export function GeoServerFormat({
  formatEntry,
  ogcFeaturesUrl,
  fullLayerName,
  geopackageUrl,
  geojsonUrl,
  selectedSource,
  onSourceChange,
}: GeoServerFormatProps) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-md border">
      <Database className="h-4 w-4 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium mb-1">GeoServer</p>
        <FormatSourceSelector
          formatType="geoserver"
          formatEntry={formatEntry}
          selectedSource={selectedSource}
          onSourceChange={onSourceChange}
        />
        <p className="text-xs text-muted-foreground mt-2">
          Multiple OGC-compliant interfaces available
        </p>

        {/* OGC Features API */}
        <div className="mt-3 pl-3 border-l-2 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Globe className="h-3 w-3" />
                <p className="text-xs font-medium">OGC API - Features</p>
              </div>
              <p className="text-xs text-muted-foreground break-all pl-5">
                {ogcFeaturesUrl}
              </p>
              <p className="text-xs text-muted-foreground pl-5">
                Collection:{" "}
                <code className="bg-muted px-1 rounded text-[10px]">
                  {fullLayerName}
                </code>
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <CopyButton value={ogcFeaturesUrl || ""} label="URL" />
              <Button variant="ghost" size="sm" asChild>
                <a
                  href={ogcFeaturesUrl || ""}
                  target="_blank"
                  rel="noopener"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>

          {/* GeoJSON Download */}
          {geojsonUrl && (
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <FileJson className="h-3 w-3" />
                  <p className="text-xs font-medium">GeoJSON</p>
                </div>
                <p className="text-xs text-muted-foreground pl-5">
                  Download as GeoJSON format
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <DownloadButton url={geojsonUrl} label="GeoJSON" />
              </div>
            </div>
          )}

          {/* GeoPackage Export */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Package className="h-3 w-3" />
                <p className="text-xs font-medium">GeoPackage (.gpkg)</p>
              </div>
              <p className="text-xs text-muted-foreground pl-5">
                Download as GeoPackage format
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <DownloadButton url={geopackageUrl || ""} label="GeoPackage" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

