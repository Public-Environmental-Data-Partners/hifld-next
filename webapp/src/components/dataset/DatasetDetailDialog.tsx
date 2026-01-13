import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DatasetWithUrls } from "@/lib/api-client";
import { PMTilesFormat } from "./PMTilesFormat";
import { GeoParquetFormat } from "./GeoParquetFormat";
import { GeoServerFormat } from "./GeoServerFormat";

interface DatasetDetailDialogProps {
  dataset: DatasetWithUrls;
  selectedSources: Record<
    string,
    { storageLocationId: number; version: number }
  >;
  onSourceChange: (
    formatType: string,
    storageLocationId: number,
    version: number
  ) => void;
  pmtilesUrl: string | null;
  geoparquetUrl: string | null;
  ogcFeaturesUrl: string | null;
  fullLayerName: string | null;
  geopackageUrl: string | null;
  featureCount: number | undefined;
}

export function DatasetDetailDialog({
  dataset,
  selectedSources,
  onSourceChange,
  pmtilesUrl,
  geoparquetUrl,
  ogcFeaturesUrl,
  fullLayerName,
  geopackageUrl,
  featureCount,
}: DatasetDetailDialogProps) {
  const cleanDescription = dataset.description
    ?.replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();

  const pmtilesFormat = dataset.formats?.find(
    (f) => f.format.format_type === "pmtiles"
  );
  const geoparquetFormat = dataset.formats?.find(
    (f) => f.format.format_type === "geoparquet"
  );
  const geoserverFormat = dataset.formats?.find(
    (f) => f.format.format_type === "geoserver"
  );

  return (
    <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
      <DialogHeader className="flex-shrink-0">
        <DialogTitle className="break-words">{dataset.alias}</DialogTitle>
        <DialogDescription className="font-mono break-all text-xs">
          {dataset.name}
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="space-y-6 pr-4">
          <div>
            <h4 className="font-medium mb-2">Description</h4>
            <p className="text-sm text-muted-foreground break-words">
              {cleanDescription || "No description available."}
            </p>
          </div>

          <Separator />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Type</p>
              <p className="font-medium break-words">{dataset.type}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Status</p>
              <Badge variant="default">ready</Badge>
            </div>
            {featureCount && (
              <div>
                <p className="text-sm text-muted-foreground mb-1">Features</p>
                <p className="font-medium">{featureCount.toLocaleString()}</p>
              </div>
            )}
            {fullLayerName && (
              <div>
                <p className="text-sm text-muted-foreground mb-1">Layer</p>
                <p className="font-mono text-sm break-all">{fullLayerName}</p>
              </div>
            )}
          </div>

          {(pmtilesUrl || geoparquetUrl || geoserverFormat) && (
            <>
              <Separator />
              <div>
                <h4 className="font-medium mb-4">Connection URLs</h4>
                <div className="space-y-3">
                  {pmtilesFormat && pmtilesUrl && (
                    <PMTilesFormat
                      formatEntry={pmtilesFormat}
                      pmtilesUrl={pmtilesUrl}
                      selectedSource={selectedSources["pmtiles"] || null}
                      onSourceChange={(storageLocationId, version) => {
                        onSourceChange("pmtiles", storageLocationId, version);
                      }}
                    />
                  )}
                  {geoparquetFormat && geoparquetUrl && (
                    <GeoParquetFormat
                      formatEntry={geoparquetFormat}
                      geoparquetUrl={geoparquetUrl}
                      selectedSource={selectedSources["geoparquet"] || null}
                      onSourceChange={(storageLocationId, version) => {
                        onSourceChange("geoparquet", storageLocationId, version);
                      }}
                    />
                  )}
                  {geoserverFormat && ogcFeaturesUrl && (
                    <GeoServerFormat
                      formatEntry={geoserverFormat}
                      ogcFeaturesUrl={ogcFeaturesUrl}
                      fullLayerName={fullLayerName}
                      geopackageUrl={geopackageUrl}
                      selectedSource={selectedSources["geoserver"] || null}
                      onSourceChange={(storageLocationId, version) => {
                        onSourceChange("geoserver", storageLocationId, version);
                      }}
                    />
                  )}
                </div>
              </div>
            </>
          )}

          <Separator />

          <div className="text-xs text-muted-foreground space-y-1">
            <p>Created: {new Date(dataset.created_at).toLocaleString()}</p>
            <p>Updated: {new Date(dataset.updated_at).toLocaleString()}</p>
          </div>
        </div>
      </div>
    </DialogContent>
  );
}

