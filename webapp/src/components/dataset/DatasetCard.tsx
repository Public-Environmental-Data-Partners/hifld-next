import { Map, FileJson, Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@tanstack/react-router";
import type { DatasetWithUrls } from "@/lib/api-client";

interface DatasetCardProps {
  dataset: DatasetWithUrls;
  collectionSlug: string;
}

export function DatasetCard({ dataset, collectionSlug }: DatasetCardProps) {
  // Check which formats are available
  // Note: formats may not be present if includeUrls=false (to avoid N+1 query performance issues)
  // Format badges will be shown on the detail page instead
  const hasPmtiles = dataset.formats?.some(
    (f) => f.format.format_type === "pmtiles"
  );
  const hasGeoparquet = dataset.formats?.some(
    (f) => f.format.format_type === "geoparquet"
  );
  const hasGeoserver = dataset.formats?.some(
    (f) => f.format.format_type === "geoserver"
  );
  
  // If formats aren't loaded, don't show format badges (they'll be on detail page)
  const showFormatBadges = dataset.formats && dataset.formats.length > 0;

  const cleanDescription = dataset.description
    ?.replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
  
  const tagBadges = dataset.tags
    ? Object.entries(dataset.tags).flatMap(([key, value]) => {
        const values = Array.isArray(value) ? value : [value];
        return values
          .map((v) => String(v))
          .filter((v) => {
            const normalizedKey = key.toLowerCase();
            const normalizedValue = v.trim().toLowerCase();
            const normalizedSlug = dataset.slug.trim().toLowerCase();
            const isLongText = v.length > 120 || v.split(/\s+/).length > 20;
            const isNarrativeKey =
              normalizedKey.includes("description") ||
              normalizedKey.includes("reasoning") ||
              normalizedKey.includes("summary");
            // Keep metadata badges, but skip slug-like tags.
            return (
              !normalizedKey.includes("slug") &&
              normalizedKey !== "inventory_name" &&
              normalizedValue !== normalizedSlug &&
              !isLongText &&
              !isNarrativeKey
            );
          })
          .map((v) => ({ key, value: v }));
      })
    : [];

  return (
    <Link
      to="/collections/$collectionSlug/datasets/$datasetSlug"
      params={{
        collectionSlug,
        datasetSlug: dataset.slug,
      }}
    >
      <Card className="cursor-pointer hover:bg-muted/50 transition-colors h-full gap-3">
        <CardHeader className="pb-1 min-w-0">
          <CardTitle className="text-base font-mono break-words break-all hyphens-auto leading-snug mb-2">
            {dataset.name}
          </CardTitle>
          <p className="font-mono text-xs text-muted-foreground mb-2">
            {dataset.slug}
          </p>
          {tagBadges.length > 0 && (
            <div className="flex items-start gap-2 flex-wrap min-w-0 overflow-visible">
              {tagBadges.map((tag, idx) => (
                <Badge
                  key={`${tag.key}-${idx}`}
                  variant="outline"
                  className="font-mono whitespace-normal break-words break-all hyphens-auto min-w-0 max-w-full overflow-visible leading-tight rounded-md"
                >
                  {tag.value}
                </Badge>
              ))}
            </div>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
            {cleanDescription || "No description available."}
          </p>
          {showFormatBadges && (
            <div className="flex flex-wrap gap-1">
              {hasPmtiles && (
                <Badge variant="secondary" className="font-mono text-xs">
                  <Map className="h-3 w-3 mr-1" />
                  PMTiles
                </Badge>
              )}
              {hasGeoparquet && (
                <Badge variant="secondary" className="font-mono text-xs">
                  <FileJson className="h-3 w-3 mr-1" />
                  GeoParquet
                </Badge>
              )}
              {hasGeoserver && (
                <Badge variant="secondary" className="font-mono text-xs">
                  <Database className="h-3 w-3 mr-1" />
                  GeoServer
                </Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
