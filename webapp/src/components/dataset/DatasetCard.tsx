import { useState, useEffect } from "react";
import { Map, FileJson, Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import {
  getOgcFeaturesUrl,
  getFullLayerName,
  getGeoPackageUrl,
  type DatasetWithUrls,
} from "@/lib/api-client";
import { DatasetDetailDialog } from "./DatasetDetailDialog";

interface DatasetCardProps {
  dataset: DatasetWithUrls;
}

export function DatasetCard({ dataset }: DatasetCardProps) {
  // State to track selected storage location and version for each format
  // Key: format_type, Value: { storageLocationId: number, version: number }
  const [selectedSources, setSelectedSources] = useState<
    Record<string, { storageLocationId: number; version: number }>
  >({});

  // Initialize selected sources with the latest version for each format
  useEffect(() => {
    const initial: Record<
      string,
      { storageLocationId: number; version: number }
    > = {};
    dataset.formats?.forEach((formatEntry) => {
      const formatType = formatEntry.format.format_type;
      if (formatEntry.sources && formatEntry.sources.length > 0) {
        // Find the latest version for each storage location, then pick the first one
        type SourceType = NonNullable<
          DatasetWithUrls["formats"]
        >[0]["sources"][0];
        type SourceEntry = { source: SourceType; version: number };
        const sourcesByLocation: Record<number, SourceEntry> = {};
        formatEntry.sources.forEach((source: SourceType) => {
          const locId = source.storage_location?.id;
          const version = source.version || 1;
          if (locId) {
            const existing = sourcesByLocation[locId];
            if (!existing || version > existing.version) {
              sourcesByLocation[locId] = { source, version };
            }
          }
        });
        // Use the first storage location's latest version
        const firstEntry = Object.values(sourcesByLocation)[0] as
          | SourceEntry
          | undefined;
        if (firstEntry && firstEntry.source.storage_location?.id) {
          initial[formatType] = {
            storageLocationId: firstEntry.source.storage_location.id,
            version: firstEntry.version,
          };
        }
      }
    });
    setSelectedSources(initial);
  }, [dataset]);

  // Helper to get selected source for a format
  const getSelectedSource = (
    formatType: string
  ): NonNullable<DatasetWithUrls["formats"]>[0]["sources"][0] | null => {
    const selection = selectedSources[formatType];
    if (!selection) return null;

    const formatEntry = dataset.formats?.find(
      (f) => f.format.format_type === formatType
    );
    if (!formatEntry || !formatEntry.sources) return null;

    return (
      formatEntry.sources.find(
        (s) =>
          s.storage_location?.id === selection.storageLocationId &&
          (s.version || 1) === selection.version
      ) || null
    );
  };

  // Helper to get URL from a source
  const getUrlFromSource = (
    source: NonNullable<DatasetWithUrls["formats"]>[0]["sources"][0] | null
  ): string | null => {
    return source?.url || null;
  };

  // Get selected sources for each format
  const geoparquetSource = getSelectedSource("geoparquet");
  const pmtilesSource = getSelectedSource("pmtiles");
  const geoserverSource = getSelectedSource("geoserver");
  const geoserverStorageLocation = geoserverSource?.storage_location;

  // Extract URLs from selected sources
  const geoparquetUrl = getUrlFromSource(geoparquetSource);
  const pmtilesUrl = getUrlFromSource(pmtilesSource);

  // URLs for the selected GeoServer source
  const ogcFeaturesUrl =
    geoserverSource && geoserverStorageLocation
      ? getOgcFeaturesUrl(geoserverSource, geoserverStorageLocation)
      : null;
  const fullLayerName = geoserverSource
    ? getFullLayerName(geoserverSource)
    : null;
  const geopackageUrl =
    geoserverSource && geoserverStorageLocation
      ? getGeoPackageUrl(geoserverSource, geoserverStorageLocation)
      : null;

  // Extract metadata from selected source
  const featureCount = geoparquetSource?.source_metadata?.feature_count;

  const cleanDescription = dataset.description
    ?.replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Card className="cursor-pointer hover:bg-muted/50 transition-colors h-full">
          <CardHeader className="pb-3 min-w-0">
            <CardTitle className="text-base break-words break-all hyphens-auto leading-snug mb-2">
              {dataset.name}
            </CardTitle>
            <div className="flex items-start gap-2 flex-wrap min-w-0 overflow-visible">
              {dataset.tags &&
                Object.entries(dataset.tags).map(([key, value]) => {
                  if (Array.isArray(value)) {
                    return value.map((v: string, idx: number) => (
                      <Badge
                        key={`${key}-${idx}`}
                        variant="outline"
                        className="whitespace-normal break-words break-all hyphens-auto min-w-0 max-w-full overflow-visible leading-tight rounded-md"
                      >
                        {v}
                      </Badge>
                    ));
                  } else if (typeof value === "string") {
                    return (
                      <Badge
                        key={key}
                        variant="outline"
                        className="whitespace-normal break-words break-all hyphens-auto min-w-0 max-w-full overflow-visible leading-tight rounded-md"
                      >
                        {value}
                      </Badge>
                    );
                  }
                  return null;
                })}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
              {cleanDescription || "No description available."}
            </p>
            <div className="flex flex-wrap gap-1">
              {pmtilesUrl && (
                <Badge variant="secondary" className="text-xs">
                  <Map className="h-3 w-3 mr-1" />
                  PMTiles
                </Badge>
              )}
              {geoparquetUrl && (
                <Badge variant="secondary" className="text-xs">
                  <FileJson className="h-3 w-3 mr-1" />
                  GeoParquet
                </Badge>
              )}
              {geoserverSource && (
                <Badge variant="secondary" className="text-xs">
                  <Database className="h-3 w-3 mr-1" />
                  GeoServer
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </DialogTrigger>

      <DatasetDetailDialog
        dataset={dataset}
        selectedSources={selectedSources}
        onSourceChange={(formatType, storageLocationId, version) => {
          setSelectedSources((prev) => ({
            ...prev,
            [formatType]: { storageLocationId, version },
          }));
        }}
        pmtilesUrl={pmtilesUrl}
        geoparquetUrl={geoparquetUrl}
        ogcFeaturesUrl={ogcFeaturesUrl}
        fullLayerName={fullLayerName}
        geopackageUrl={geopackageUrl}
        featureCount={featureCount}
      />
    </Dialog>
  );
}
