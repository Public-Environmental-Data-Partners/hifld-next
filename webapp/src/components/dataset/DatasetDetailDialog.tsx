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
  featureCount: number | undefined;
}

export function DatasetDetailDialog({
  dataset,
  selectedSources,
  onSourceChange,
  pmtilesUrl,
  geoparquetUrl,
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

  return (
    <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
      <DialogHeader className="flex-shrink-0">
        <DialogTitle className="break-words">{dataset.name}</DialogTitle>
        {dataset.tags && Object.keys(dataset.tags).length > 0 && (
          <DialogDescription className="font-mono break-all text-xs">
            {Object.entries(dataset.tags)
              .map(([key, value]) => `${key}: ${value}`)
              .join(", ")}
          </DialogDescription>
        )}
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
              <p className="text-sm text-muted-foreground mb-1">Status</p>
              <Badge variant="default">ready</Badge>
            </div>
            {dataset.tags &&
              Object.entries(dataset.tags).map(([key, value]) => {
                const label = key
                  .split("_")
                  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                  .join(" ");

                return (
                  <div key={key}>
                    <p className="text-sm text-muted-foreground mb-1">
                      {label}
                    </p>
                    {Array.isArray(value) ? (
                      <div className="flex flex-wrap gap-1">
                        {value.map((v: string, idx: number) => (
                          <Badge key={idx} variant="outline">
                            {v}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="font-medium break-words">{String(value)}</p>
                    )}
                  </div>
                );
              })}
            {featureCount && (
              <div>
                <p className="text-sm text-muted-foreground mb-1">Features</p>
                <p className="font-medium">{featureCount.toLocaleString()}</p>
              </div>
            )}
          </div>

          {(pmtilesUrl || geoparquetUrl) && (
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
                        onSourceChange(
                          "geoparquet",
                          storageLocationId,
                          version
                        );
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
