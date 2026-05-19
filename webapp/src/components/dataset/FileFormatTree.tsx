import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Folder,
  File,
  ChevronRight,
  ChevronDown,
  Globe,
  Package,
  FileJson,
  Map as MapIcon,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DatasetFile } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "./CopyButton";
import { DownloadButton } from "./DownloadButton";
import { ShapefileZipDownloadButton } from "./ShapefileZipDownloadButton";
import { buildSourceFileUrl, buildSourceStorageUri } from "./sourceUrls";
import { formatVersionLabel, parseVersionValue } from "./versionLabel";
import {
  buildCompareSearchForLocation,
  getLocationOptions,
  getVersionSourcesForLocation,
} from "./compareSources";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || bytes === 0) return "Unknown size";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`;
}

interface FileFormatTreeProps {
  file: DatasetFile;
  selectedSources: Record<string, { storageLocationId: number; version: string | number }>;
  onSourceChange: (formatType: string, storageLocationId: number, version: string | number) => void;
  onViewParquet?: (url: string, fileName: string) => void;
  ogcFeaturesUrl: string | null;
  fullLayerName: string | null;
  geopackageUrl: string | null;
  geojsonUrl: string | null;
  shapefileUrl: string | null;
  geoserverExportsEnabled: boolean;
  pmtilesUrl: string | null;
  collectionId?: number;
  collectionSlug?: string;
  datasetSlug?: string;
  fileSlug?: string;
}

export function FileFormatTree({
  file,
  selectedSources,
  onSourceChange,
  onViewParquet,
  ogcFeaturesUrl,
  fullLayerName,
  geopackageUrl,
  geojsonUrl,
  shapefileUrl,
  geoserverExportsEnabled,
  pmtilesUrl,
  collectionId,
  collectionSlug,
  datasetSlug,
  fileSlug,
}: FileFormatTreeProps) {
  const [expandedFormats, setExpandedFormats] = useState<Set<string>>(new Set());

  const toggleFormat = (formatType: string) => {
    setExpandedFormats((prev) => {
      const next = new Set(prev);
      if (next.has(formatType)) {
        next.delete(formatType);
      } else {
        next.add(formatType);
      }
      return next;
    });
  };

  const geoserverFormat = file.formats?.find((f) => f.format.format_type === "geoserver");
  const geoparquetFormat = file.formats?.find((f) => f.format.format_type === "geoparquet");
  const pmtilesFormat = file.formats?.find((f) => f.format.format_type === "pmtiles");
  const geopackageFormat = file.formats?.find((f) => f.format.format_type === "geopackage");
  const shapefileFormat = file.formats?.find((f) => f.format.format_type === "shapefile");
  const geojsonFormat = file.formats?.find((f) => f.format.format_type === "geojson");
  const fileGeodatabaseFormat = file.formats?.find((f) => f.format.format_type === "file_geodatabase");

  return (
    <div className="space-y-1 border rounded-md p-4">
      <h4 className="font-medium mb-3">Available Formats</h4>

      {/* GeoServer formats */}
      {geoserverFormat && (
        <div className="space-y-1">
          {geoserverExportsEnabled && (
            <>
              {/* GeoJSON */}
              <FormatFileNode
                icon={<FileJson className="h-4 w-4 text-orange-500" />}
                name="geojson"
                formatType="geoserver"
                formatEntry={geoserverFormat}
                selectedSources={selectedSources}
                onSourceChange={onSourceChange}
                isExpanded={expandedFormats.has("geoserver-geojson")}
                onToggle={() => toggleFormat("geoserver-geojson")}
                collectionSlug={collectionSlug}
                datasetSlug={datasetSlug}
                fileSlug={fileSlug}
              >
                {geojsonUrl && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Download as GeoJSON format from GeoServer
                    </p>
                    <div className="flex items-center gap-2">
                      <DownloadButton url={geojsonUrl} label="Download" />
                    </div>
                  </div>
                )}
              </FormatFileNode>

              {/* GeoPackage */}
              <FormatFileNode
                icon={<Package className="h-4 w-4 text-purple-500" />}
                name="geopackage"
                formatType="geoserver"
                formatEntry={geoserverFormat}
                selectedSources={selectedSources}
                onSourceChange={onSourceChange}
                isExpanded={expandedFormats.has("geoserver-gpkg")}
                onToggle={() => toggleFormat("geoserver-gpkg")}
                collectionSlug={collectionSlug}
                datasetSlug={datasetSlug}
                fileSlug={fileSlug}
              >
                {geopackageUrl && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Download as GeoPackage format from GeoServer
                    </p>
                    <div className="flex items-center gap-2">
                      <DownloadButton url={geopackageUrl} label="Download" />
                    </div>
                  </div>
                )}
              </FormatFileNode>

              {/* Shapefile */}
              <FormatFileNode
                icon={<File className="h-4 w-4 text-amber-600" />}
                name="shapefile"
                formatType="geoserver"
                formatEntry={geoserverFormat}
                selectedSources={selectedSources}
                onSourceChange={onSourceChange}
                isExpanded={expandedFormats.has("geoserver-shp")}
                onToggle={() => toggleFormat("geoserver-shp")}
                collectionSlug={collectionSlug}
                datasetSlug={datasetSlug}
                fileSlug={fileSlug}
              >
                {shapefileUrl && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Download as Shapefile (zip) from GeoServer
                    </p>
                    <div className="flex items-center gap-2">
                      <DownloadButton url={shapefileUrl} label="Download" />
                    </div>
                  </div>
                )}
              </FormatFileNode>
            </>
          )}

          {/* OGC Features API */}
          <FormatFileNode
            icon={<Globe className="h-4 w-4 text-blue-500" />}
            name="OGC API - Features"
            badge="endpoint"
            formatType="geoserver"
            formatEntry={geoserverFormat}
            selectedSources={selectedSources}
            onSourceChange={onSourceChange}
            isExpanded={expandedFormats.has("geoserver-ogc")}
            onToggle={() => toggleFormat("geoserver-ogc")}
            collectionSlug={collectionSlug}
            datasetSlug={datasetSlug}
            fileSlug={fileSlug}
          >
            {ogcFeaturesUrl && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground break-all">
                  {ogcFeaturesUrl}
                </p>
                <p className="text-xs text-muted-foreground">
                  Collection:{" "}
                  <code className="bg-muted px-1 rounded text-[10px]">
                    {fullLayerName}
                  </code>
                </p>
                {!geoserverExportsEnabled && (
                  <p className="text-xs text-muted-foreground">
                    Dataset is large; only OGC Features API is offered for this source.
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <CopyButton value={ogcFeaturesUrl} label="Copy URL" />
                  <Button variant="ghost" size="sm" asChild>
                    <a href={ogcFeaturesUrl} target="_blank" rel="noopener">
                      <ExternalLink className="h-4 w-4 mr-1" />
                      Open
                    </a>
                  </Button>
                </div>
              </div>
            )}
          </FormatFileNode>
        </div>
      )}

      {/* GeoParquet - as a folder with multiple files */}
      {geoparquetFormat && (
        <div className="space-y-1">
          <FormatFolderNode
            icon={<Folder className="h-4 w-4 text-yellow-600" />}
            name="geoparquet"
            formatType="geoparquet"
            formatEntry={geoparquetFormat}
            selectedSources={selectedSources}
            onSourceChange={onSourceChange}
            isExpanded={expandedFormats.has("geoparquet-folder")}
            onToggle={() => toggleFormat("geoparquet-folder")}
            collectionSlug={collectionSlug}
            datasetSlug={datasetSlug}
            fileSlug={fileSlug}
          >
            <div className="pl-6 space-y-1 mt-1">
              {/* Glob pattern */}
              {(() => {
                const selectedLocationId = selectedSources["geoparquet"]?.storageLocationId;
                const selectedVersion = selectedSources["geoparquet"]?.version;
                
                // Get all sources for the selected location and version
                const allSources = geoparquetFormat.sources?.filter((source) => {
                  return (
                    source.storage_location?.id === selectedLocationId &&
                    String(source.version || "1") === String(selectedVersion || "1")
                  );
                }) || [];

                // Get glob pattern from API (it's added to each source in the group)
                const sourceWithGlob = allSources.find((s) => s.glob_pattern);
                const globPattern =
                  sourceWithGlob?.glob_pattern ||
                  (allSources[0]
                    ? buildSourceStorageUri(allSources[0], {
                        globExtension: "parquet",
                      })
                    : null);
                if (!globPattern) {
                  return null;
                }
                
                // Calculate total size from all sources (for glob pattern, use the first source's total size)
                const totalSizeBytes = allSources.reduce((sum, source) => {
                  const size = source.source_metadata?.size_bytes;
                  return sum + (typeof size === "number" ? size : 0);
                }, 0);
                // If we have individual files, sum their sizes; otherwise use the glob pattern source's size
                const globSourceSize = allSources.find((s) => {
                  const path = (s.location as any)?.path;
                  return path && path.includes("*");
                })?.source_metadata?.size_bytes;
                const displaySize = globSourceSize || totalSizeBytes;

                return (
                  <FormatFileNode
                    icon={<FileJson className="h-4 w-4 text-green-600" />}
                    name="*.parquet (glob)"
                    badge={displaySize > 0 ? formatFileSize(displaySize) : "pattern"}
                    formatType="geoparquet"
                    formatEntry={geoparquetFormat}
                    selectedSources={selectedSources}
                    onSourceChange={onSourceChange}
                    isExpanded={expandedFormats.has("geoparquet-glob")}
                    onToggle={() => toggleFormat("geoparquet-glob")}
                    showSourceSelector={false}
                  >
                    <div className="space-y-2">
                      {(() => {
                        // Check if this is SeaweedFS (has endpoint_url parameter)
                        const hasEndpointUrl = globPattern.includes("?endpoint_url=");
                        let s3Uri = globPattern;
                        let endpointUrl = "";
                        let host = "";
                        let port = "";
                        
                        if (hasEndpointUrl) {
                          // Extract endpoint URL and clean S3 URI
                          const [uriPart, queryPart] = globPattern.split("?");
                          s3Uri = uriPart;
                          const params = new URLSearchParams(queryPart);
                          endpointUrl = params.get("endpoint_url") || "";
                          
                          // Parse endpoint URL to extract host and port
                          try {
                            const url = new URL(endpointUrl);
                            host = url.hostname;
                            port = url.port || (url.protocol === "https:" ? "443" : "80");
                          } catch {
                            // If parsing fails, try to extract from endpoint_url string
                            const match = endpointUrl.match(/\/\/([^:]+)(?::(\d+))?/);
                            if (match) {
                              host = match[1];
                              port = match[2] || "8333";
                            }
                          }
                        }
                        
                        return (
                          <>
                            {hasEndpointUrl ? (
                              <>
                                <p className="text-xs text-muted-foreground mb-2">
                                  For DuckDB, configure the S3 endpoint first:
                                </p>
                                <div className="space-y-1 mb-2">
                                  <code className="text-xs bg-muted px-2 py-1 rounded block">
                                    SET s3_endpoint='{host}:{port}';
                                  </code>
                                  <code className="text-xs bg-muted px-2 py-1 rounded block">
                                    SET s3_use_ssl=false;
                                  </code>
                                  <code className="text-xs bg-muted px-2 py-1 rounded block">
                                    SET s3_url_style='path';
                                  </code>
                                </div>
                                <p className="text-xs text-muted-foreground mb-2">
                                  Then use this URI in your query:
                                </p>
                                <code className="text-xs bg-muted px-2 py-1 rounded block break-all">
                                  {s3Uri}
                                </code>
                                <div className="flex items-center gap-2 mt-2">
                                  <CopyButton 
                                    value={`SET s3_endpoint='${host}:${port}';\nSET s3_use_ssl=false;\nSET s3_url_style='path';\n\nSELECT * FROM '${s3Uri}';`} 
                                    label="Copy DuckDB Config" 
                                  />
                                  <CopyButton value={s3Uri} label="Copy URI" />
                                </div>
                              </>
                            ) : (
                              <>
                                <p className="text-xs text-muted-foreground">
                                  Use this URI in DuckDB or other tools that support glob patterns
                                </p>
                                <code className="text-xs bg-muted px-2 py-1 rounded block break-all">
                                  {globPattern}
                                </code>
                                <div className="flex items-center gap-2 mt-2">
                                  <CopyButton value={globPattern} label="Copy URI" />
                                </div>
                              </>
                            )}
                            {displaySize > 0 && (
                              <p className="text-xs text-muted-foreground">
                                Total size: {formatFileSize(displaySize)}
                              </p>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </FormatFileNode>
                );
              })()}

              {/* Individual parquet files */}
              {(() => {
                const selectedLocationId = selectedSources["geoparquet"]?.storageLocationId;
                const selectedVersion = selectedSources["geoparquet"]?.version;
                
                // Get all sources for the selected location and version
                const allSources = geoparquetFormat.sources?.filter((source) => {
                  return (
                    source.storage_location?.id === selectedLocationId &&
                    String(source.version || "1") === String(selectedVersion || "1")
                  );
                }) || [];

                // Group by file path to show individual files
                // Filter out glob patterns (paths containing "*") - those are shown separately
                const filesByPath = new Map<string, typeof allSources[0]>();
                allSources.forEach((source) => {
                  const path = (source.location as any)?.path;
                  // Only include individual files, not glob patterns
                  if (path && !path.includes("*") && !filesByPath.has(path)) {
                    filesByPath.set(path, source);
                  }
                });

                return Array.from(filesByPath.entries()).map(([path, source], index) => {
                  const fileName = path.split("/").pop() || `file-${index + 1}.parquet`;
                  const fileUrl = buildSourceFileUrl(source);
                  const fileStorageUri = buildSourceStorageUri(source);
                  const fileSizeBytes = source.source_metadata?.size_bytes;

                  return (
                    <FormatFileNode
                      key={`${path}-${index}`}
                      icon={<File className="h-4 w-4 text-green-600" />}
                      name={fileName}
                      badge={fileSizeBytes != null ? formatFileSize(fileSizeBytes) : undefined}
                      formatType="geoparquet"
                      formatEntry={geoparquetFormat}
                      selectedSources={selectedSources}
                      onSourceChange={onSourceChange}
                      isExpanded={expandedFormats.has(`geoparquet-file-${index}`)}
                      onToggle={() => toggleFormat(`geoparquet-file-${index}`)}
                      showSourceSelector={false}
                    >
                      <div className="space-y-2">
                        {fileSizeBytes != null && (
                          <p className="text-xs text-muted-foreground">
                            Size: {formatFileSize(fileSizeBytes)}
                          </p>
                        )}
                        {fileStorageUri && (() => {
                          // Check if this is SeaweedFS (has endpoint_url parameter)
                          const hasEndpointUrl = fileStorageUri.includes("?endpoint_url=");
                          let s3Uri = fileStorageUri;
                          let endpointUrl = "";
                          let host = "";
                          let port = "";
                          
                          if (hasEndpointUrl) {
                            // Extract endpoint URL and clean S3 URI
                            const [uriPart, queryPart] = fileStorageUri.split("?");
                            s3Uri = uriPart;
                            const params = new URLSearchParams(queryPart);
                            endpointUrl = params.get("endpoint_url") || "";
                            
                            // Parse endpoint URL to extract host and port
                            try {
                              const url = new URL(endpointUrl);
                              host = url.hostname;
                              port = url.port || (url.protocol === "https:" ? "443" : "80");
                            } catch {
                              // If parsing fails, try to extract from endpoint_url string
                              const match = endpointUrl.match(/\/\/([^:]+)(?::(\d+))?/);
                              if (match) {
                                host = match[1];
                                port = match[2] || "8333";
                              }
                            }
                          }
                          
                          return (
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Storage URI:</p>
                              {hasEndpointUrl ? (
                                <>
                                  <p className="text-xs text-muted-foreground mb-2">
                                    For DuckDB, configure the S3 endpoint first:
                                  </p>
                                  <div className="space-y-1 mb-2">
                                    <code className="text-xs bg-muted px-2 py-1 rounded block">
                                      SET s3_endpoint='{host}:{port}';
                                    </code>
                                    <code className="text-xs bg-muted px-2 py-1 rounded block">
                                      SET s3_use_ssl=false;
                                    </code>
                                    <code className="text-xs bg-muted px-2 py-1 rounded block">
                                      SET s3_url_style='path';
                                    </code>
                                  </div>
                                  <p className="text-xs text-muted-foreground mb-1">
                                    Then use this URI in your query:
                                  </p>
                                  <code className="text-xs bg-muted px-2 py-1 rounded block break-all">
                                    {s3Uri}
                                  </code>
                                  <div className="flex items-center gap-2 mt-1">
                                    <CopyButton 
                                      value={`SET s3_endpoint='${host}:${port}';\nSET s3_use_ssl=false;\nSET s3_url_style='path';\n\nSELECT * FROM '${s3Uri}';`} 
                                      label="Copy DuckDB Config" 
                                    />
                                    <CopyButton value={s3Uri} label="Copy URI" />
                                  </div>
                                </>
                              ) : (
                                <>
                                  <code className="text-xs bg-muted px-2 py-1 rounded block break-all">
                                    {fileStorageUri}
                                  </code>
                                  <div className="flex items-center gap-2 mt-1">
                                    <CopyButton value={fileStorageUri} label="Copy URI" />
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })()}
                        {fileUrl && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Download URL:</p>
                            <p className="text-xs text-muted-foreground break-all mb-1">
                              {fileUrl}
                            </p>
                            <div className="flex items-center gap-2">
                              <DownloadButton url={fileUrl} label="Download" />
                              {onViewParquet && (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onViewParquet(fileUrl, fileName);
                                  }}
                                >
                                  View Data
                                </Button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </FormatFileNode>
                  );
                });
              })()}
            </div>
          </FormatFolderNode>
        </div>
      )}

      {/* PMTiles */}
      {pmtilesFormat && (() => {
        const selectedLocationId = selectedSources["pmtiles"]?.storageLocationId;
        const selectedVersion = selectedSources["pmtiles"]?.version;
        
        const selectedPmtilesSource = pmtilesFormat.sources?.find((source) => {
          return (
            source.storage_location?.id === selectedLocationId &&
            String(source.version || "1") === String(selectedVersion || "1")
          );
        });
        
        const pmtilesSizeBytes = selectedPmtilesSource?.source_metadata?.size_bytes;
        
        return (
          <FormatFileNode
            icon={<MapIcon className="h-4 w-4 text-pink-500" />}
            name="tiles"
            badge={pmtilesSizeBytes != null ? formatFileSize(pmtilesSizeBytes) : undefined}
            formatType="pmtiles"
            formatEntry={pmtilesFormat}
            selectedSources={selectedSources}
            onSourceChange={onSourceChange}
            isExpanded={expandedFormats.has("pmtiles")}
            onToggle={() => toggleFormat("pmtiles")}
            collectionSlug={collectionSlug}
            datasetSlug={datasetSlug}
            fileSlug={fileSlug}
          >
            {pmtilesUrl && (
              <div className="space-y-2">
                {pmtilesSizeBytes != null && (
                  <p className="text-xs text-muted-foreground">
                    Size: {formatFileSize(pmtilesSizeBytes)}
                  </p>
                )}
                <p className="text-xs text-muted-foreground break-all">
                  {pmtilesUrl}
                </p>
                <div className="flex items-center gap-2">
                  <CopyButton value={pmtilesUrl} label="Copy URL" />
                  <DownloadButton url={pmtilesUrl} label="Download" />
                </div>
              </div>
            )}
          </FormatFileNode>
        );
      })()}

      {/* GeoPackage */}
      {geopackageFormat && (() => {
        const selectedLocationId = selectedSources["geopackage"]?.storageLocationId;
        const selectedVersion = selectedSources["geopackage"]?.version;
        
        const selectedGeopackageSource = geopackageFormat.sources?.find((source) => {
          return (
            source.storage_location?.id === selectedLocationId &&
            String(source.version || "1") === String(selectedVersion || "1")
          );
        });
        
        const geopackageSizeBytes = selectedGeopackageSource?.source_metadata?.size_bytes;
        const geopackageUrl = selectedGeopackageSource ? buildSourceFileUrl(selectedGeopackageSource) : null;
        
        return (
          <FormatFileNode
            icon={<Package className="h-4 w-4 text-purple-500" />}
            name="geopackage"
            badge={geopackageSizeBytes != null ? formatFileSize(geopackageSizeBytes) : undefined}
            formatType="geopackage"
            formatEntry={geopackageFormat}
            selectedSources={selectedSources}
            onSourceChange={onSourceChange}
            isExpanded={expandedFormats.has("geopackage")}
            onToggle={() => toggleFormat("geopackage")}
            collectionSlug={collectionSlug}
            datasetSlug={datasetSlug}
            fileSlug={fileSlug}
          >
            {geopackageUrl && (
              <div className="space-y-2">
                {geopackageSizeBytes != null && (
                  <p className="text-xs text-muted-foreground">
                    Size: {formatFileSize(geopackageSizeBytes)}
                  </p>
                )}
                <p className="text-xs text-muted-foreground break-all">
                  {geopackageUrl}
                </p>
                <div className="flex items-center gap-2">
                  <CopyButton value={geopackageUrl} label="Copy URL" />
                  <DownloadButton url={geopackageUrl} label="Download" sizeBytes={geopackageSizeBytes ?? undefined} />
                </div>
              </div>
            )}
          </FormatFileNode>
        );
      })()}

      {/* Shapefile */}
      {shapefileFormat && (() => {
        const selectedLocationId = selectedSources["shapefile"]?.storageLocationId;
        const selectedVersion = selectedSources["shapefile"]?.version;
        
        // Find all sources matching the selected location and version
        // This includes both the original glob pattern source and expanded individual file sources
        const matchingSources = shapefileFormat.sources?.filter((source) => {
          return (
            source.storage_location?.id === selectedLocationId &&
            String(source.version || "1") === String(selectedVersion || "1")
          );
        }) || [];
        
        // Check if any source has a glob pattern (either in glob_pattern field or in path)
        const hasGlobPattern = matchingSources.some((source) => {
          return (
            source.glob_pattern ||
            (source.location && 
             typeof source.location === 'object' && 
             'path' in source.location &&
             typeof source.location.path === 'string' &&
             source.location.path.includes('*'))
          );
        });
        
        // Find the original source (with glob_pattern or glob in path) for metadata
        const originalSource = matchingSources.find((source) => 
          source.glob_pattern || 
          (source.location && 
           typeof source.location === 'object' && 
           'path' in source.location &&
           typeof source.location.path === 'string' &&
           source.location.path.includes('*'))
        );
        const shapefileSizeBytes = originalSource?.source_metadata?.size_bytes;
        
        // Get sources with URLs (expanded sources from glob pattern)
        // Filter out sources that have glob patterns in their URL/path (those are the original glob sources)
        const sourcesWithUrls = matchingSources.filter((source) => {
          const sourceUrl = buildSourceFileUrl(source);
          if (!sourceUrl) return false;
          // Exclude sources where the URL itself contains a glob pattern
          return !sourceUrl.includes('*');
        });
        
        // Check if we have expanded sources (multiple URLs from glob pattern)
        // If we have a glob pattern source, we should use client-side zip creation
        // Otherwise, fall back to single URL download
        const hasExpandedSources = hasGlobPattern && sourcesWithUrls.length > 0;
        
        const zipFilename = datasetSlug && fileSlug 
          ? `${datasetSlug}_${fileSlug}_shapefile.zip`
          : "shapefile.zip";
        
        return (
          <FormatFileNode
            icon={<File className="h-4 w-4 text-amber-600" />}
            name="shapefile"
            badge={shapefileSizeBytes != null ? formatFileSize(shapefileSizeBytes) : undefined}
            formatType="shapefile"
            formatEntry={shapefileFormat}
            selectedSources={selectedSources}
            onSourceChange={onSourceChange}
            isExpanded={expandedFormats.has("shapefile")}
            onToggle={() => toggleFormat("shapefile")}
            collectionSlug={collectionSlug}
            datasetSlug={datasetSlug}
            fileSlug={fileSlug}
          >
            {hasExpandedSources ? (
              // We have expanded sources - use client-side zip creation
              <div className="space-y-2">
                {shapefileSizeBytes != null && (
                  <p className="text-xs text-muted-foreground">
                    Size: {formatFileSize(shapefileSizeBytes)} (zip contains all shapefile components)
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Download all shapefile components (.shp, .shx, .dbf, .prj, etc.) as a zip file
                  {sourcesWithUrls.length > 0 && ` (${sourcesWithUrls.length} files)`}
                </p>
                <div className="flex items-center gap-2">
                  <ShapefileZipDownloadButton
                    sources={sourcesWithUrls.map((source) => ({
                      ...source,
                      url: buildSourceFileUrl(source) ?? undefined,
                    }))}
                    filename={zipFilename}
                    label="Download Zip"
                  />
                </div>
              </div>
            ) : hasGlobPattern && originalSource?.id && collectionSlug && datasetSlug && fileSlug ? (
              // We have a glob pattern but no expanded sources yet - fall back to server-side zip
              <div className="space-y-2">
                {shapefileSizeBytes != null && (
                  <p className="text-xs text-muted-foreground">
                    Size: {formatFileSize(shapefileSizeBytes)} (zip contains all shapefile components)
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Download all shapefile components (.shp, .shx, .dbf, .prj, etc.) as a zip file
                </p>
                <div className="flex items-center gap-2">
                  <DownloadButton 
                    url={`/api/collections/${collectionSlug}/datasets/${datasetSlug}/files/${fileSlug}/sources/${originalSource.id}/download-zip`}
                    label="Download Zip"
                    filename={zipFilename}
                  />
                </div>
              </div>
            ) : sourcesWithUrls.length === 1 && buildSourceFileUrl(sourcesWithUrls[0]) ? (
              // Fallback: single URL (no glob pattern)
              (() => {
                const sourceUrl = buildSourceFileUrl(sourcesWithUrls[0]);
                if (!sourceUrl) return null;

                return (
                  <div className="space-y-2">
                    {shapefileSizeBytes != null && (
                      <p className="text-xs text-muted-foreground">
                        Size: {formatFileSize(shapefileSizeBytes)}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground break-all">
                      {sourceUrl}
                    </p>
                    <div className="flex items-center gap-2">
                      <CopyButton value={sourceUrl} label="Copy URL" />
                      <DownloadButton url={sourceUrl} label="Download" />
                    </div>
                  </div>
                );
              })()
            ) : null}
          </FormatFileNode>
        );
      })()}

      {/* GeoJSON */}
      {geojsonFormat && (() => {
        const selectedLocationId = selectedSources["geojson"]?.storageLocationId;
        const selectedVersion = selectedSources["geojson"]?.version;
        
        const selectedGeojsonSource = geojsonFormat.sources?.find((source) => {
          return (
            source.storage_location?.id === selectedLocationId &&
            String(source.version || "1") === String(selectedVersion || "1")
          );
        });
        
        const geojsonSizeBytes = selectedGeojsonSource?.source_metadata?.size_bytes;
        const geojsonUrl = selectedGeojsonSource
          ? buildSourceFileUrl(selectedGeojsonSource)
          : null;
        
        return (
          <FormatFileNode
            icon={<FileJson className="h-4 w-4 text-orange-500" />}
            name="geojson"
            badge={geojsonSizeBytes != null ? formatFileSize(geojsonSizeBytes) : undefined}
            formatType="geojson"
            formatEntry={geojsonFormat}
            selectedSources={selectedSources}
            onSourceChange={onSourceChange}
            isExpanded={expandedFormats.has("geojson")}
            onToggle={() => toggleFormat("geojson")}
            collectionSlug={collectionSlug}
            datasetSlug={datasetSlug}
            fileSlug={fileSlug}
          >
            {geojsonUrl && (
              <div className="space-y-2">
                {geojsonSizeBytes != null && (
                  <p className="text-xs text-muted-foreground">
                    Size: {formatFileSize(geojsonSizeBytes)}
                  </p>
                )}
                <p className="text-xs text-muted-foreground break-all">
                  {geojsonUrl}
                </p>
                <div className="flex items-center gap-2">
                  <CopyButton value={geojsonUrl} label="Copy URL" />
                  <DownloadButton url={geojsonUrl} label="Download" />
                </div>
              </div>
            )}
          </FormatFileNode>
        );
      })()}

      {/* File Geodatabase */}
      {fileGeodatabaseFormat && (() => {
        const selectedLocationId = selectedSources["file_geodatabase"]?.storageLocationId;
        const selectedVersion = selectedSources["file_geodatabase"]?.version;
        
        const selectedFileGeodatabaseSource = fileGeodatabaseFormat.sources?.find((source) => {
          return (
            source.storage_location?.id === selectedLocationId &&
            String(source.version || "1") === String(selectedVersion || "1")
          );
        });
        
        const fileGeodatabaseSizeBytes = selectedFileGeodatabaseSource?.source_metadata?.size_bytes;
        const fileGeodatabaseUrl = selectedFileGeodatabaseSource
          ? buildSourceFileUrl(selectedFileGeodatabaseSource)
          : null;
        
        return (
          <FormatFileNode
            icon={<Folder className="h-4 w-4 text-indigo-500" />}
            name="file geodatabase"
            badge={fileGeodatabaseSizeBytes != null ? formatFileSize(fileGeodatabaseSizeBytes) : undefined}
            formatType="file_geodatabase"
            formatEntry={fileGeodatabaseFormat}
            selectedSources={selectedSources}
            onSourceChange={onSourceChange}
            isExpanded={expandedFormats.has("file_geodatabase")}
            onToggle={() => toggleFormat("file_geodatabase")}
            collectionSlug={collectionSlug}
            datasetSlug={datasetSlug}
            fileSlug={fileSlug}
          >
            {fileGeodatabaseUrl && (
              <div className="space-y-2">
                {fileGeodatabaseSizeBytes != null && (
                  <p className="text-xs text-muted-foreground">
                    Size: {formatFileSize(fileGeodatabaseSizeBytes)}
                  </p>
                )}
                <p className="text-xs text-muted-foreground break-all">
                  {fileGeodatabaseUrl}
                </p>
                <div className="flex items-center gap-2">
                  <CopyButton value={fileGeodatabaseUrl} label="Copy URL" />
                  <DownloadButton url={fileGeodatabaseUrl} label="Download" />
                </div>
              </div>
            )}
          </FormatFileNode>
        );
      })()}

      {(!file.formats || file.formats.length === 0) && (
        <p className="text-sm text-muted-foreground">
          No formats available for this file.
        </p>
      )}
    </div>
  );
}

interface FormatFileNodeProps {
  icon: React.ReactNode;
  name: string;
  badge?: string;
  formatType: string;
  formatEntry: NonNullable<DatasetFile["formats"]>[0];
  selectedSources: Record<string, { storageLocationId: number; version: string | number }>;
  onSourceChange: (formatType: string, storageLocationId: number, version: string | number) => void;
  isExpanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
  showSourceSelector?: boolean; // Whether to show location/version selector
  collectionSlug?: string;
  datasetSlug?: string;
  fileSlug?: string;
}

function FormatFileNode({
  icon,
  name,
  badge,
  formatType,
  formatEntry,
  selectedSources,
  onSourceChange,
  isExpanded,
  onToggle,
  children,
  showSourceSelector = true,
  collectionSlug,
  datasetSlug,
  fileSlug,
}: FormatFileNodeProps) {
  const hasChildren = !!children;
  const sources = formatEntry.sources || [];

  return (
    <div>
      <div
        className={cn(
          "select-none flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors",
          isExpanded && hasChildren && "bg-muted/30"
        )}
        onClick={onToggle}
      >
        {hasChildren ? (
          isExpanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          )
        ) : (
          <div className="w-3" />
        )}
        {icon}
        <span className="flex-1 min-w-0 text-sm font-mono truncate">{name}</span>
        {badge && (
          <Badge variant="outline" className="text-[10px] h-4 px-1">
            {badge}
          </Badge>
        )}
      </div>

      {isExpanded && hasChildren && (
        <div className="ml-5 pl-4 mt-2 mb-2 border-l-2 border-muted select-text">
          {/* Version/Location Selector - only show if showSourceSelector is true */}
          {showSourceSelector && sources.length > 0 && (
            <div className="mb-3">
              <SourceSelector
                formatType={formatType}
                formatEntry={formatEntry}
                selectedSources={selectedSources}
                onSourceChange={onSourceChange}
                collectionSlug={collectionSlug}
                datasetSlug={datasetSlug}
                fileSlug={fileSlug}
              />
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

interface FormatFolderNodeProps {
  icon: React.ReactNode;
  name: string;
  formatType: string;
  formatEntry: NonNullable<DatasetFile["formats"]>[0];
  selectedSources: Record<string, { storageLocationId: number; version: string | number }>;
  onSourceChange: (formatType: string, storageLocationId: number, version: string | number) => void;
  isExpanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
  collectionSlug?: string;
  datasetSlug?: string;
  fileSlug?: string;
}

function FormatFolderNode({
  icon,
  name,
  formatType,
  formatEntry,
  selectedSources,
  onSourceChange,
  isExpanded,
  onToggle,
  children,
  collectionSlug,
  datasetSlug,
  fileSlug,
}: FormatFolderNodeProps) {
  const sources = formatEntry.sources || [];
  
  // For geoparquet, count only unique storage locations (excluding glob pattern sources)
  // The glob pattern is just a representation of individual files, not a separate source
  let sourceCount = sources.length;
  if (formatType === "geoparquet") {
    // Count unique storage locations, excluding glob pattern sources
    const uniqueLocations = new Set<number>();
    sources.forEach((source) => {
      const path = (source.location as any)?.path || "";
      // Only count sources that are NOT glob patterns
      if (!path.includes("*")) {
        const locId = source.storage_location?.id;
        if (locId) {
          uniqueLocations.add(locId);
        }
      }
    });
    sourceCount = uniqueLocations.size;
  }

  return (
    <div>
      <div
        className={cn(
          "select-none flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors",
          isExpanded && "bg-muted/30"
        )}
        onClick={onToggle}
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
        )}
        {icon}
        <span className="flex-1 min-w-0 text-sm font-mono font-medium truncate">{name}</span>
        {sourceCount > 0 && (
          <Badge variant="secondary" className="text-[10px] h-4 px-1">
            {sourceCount} source{sourceCount !== 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      {isExpanded && (
        <div className="ml-5 mt-2 mb-2 select-text">
          {/* Version/Location Selector */}
          {sources.length > 0 && (
            <div className="mb-3 pl-4 border-l-2 border-muted">
              <SourceSelector
                formatType={formatType}
                formatEntry={formatEntry}
                selectedSources={selectedSources}
                onSourceChange={onSourceChange}
                collectionSlug={collectionSlug}
                datasetSlug={datasetSlug}
                fileSlug={fileSlug}
              />
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

interface SourceSelectorProps {
  formatType: string;
  formatEntry: NonNullable<DatasetFile["formats"]>[0];
  selectedSources: Record<string, { storageLocationId: number; version: string | number }>;
  onSourceChange: (formatType: string, storageLocationId: number, version: string | number) => void;
  collectionSlug?: string;
  datasetSlug?: string;
  fileSlug?: string;
}

function SourceSelector({
  formatType,
  formatEntry,
  selectedSources,
  onSourceChange,
  collectionSlug,
  datasetSlug,
  fileSlug,
}: SourceSelectorProps) {
  const selectedSource = selectedSources[formatType];
  const locationArray = getLocationOptions(formatEntry);

  if (locationArray.length === 0) {
    return null;
  }

  const currentLocationId = selectedSource?.storageLocationId || locationArray[0]?.id;
  const versionSources = getVersionSourcesForLocation(formatEntry, currentLocationId);
  const versionArray = versionSources.map((source) => source.version || "1");
  const currentVersion =
    selectedSource?.version && versionArray.some((version) => String(version) === String(selectedSource.version))
      ? selectedSource.version
      : versionArray[0];
  const compareSearch = buildCompareSearchForLocation(formatEntry, currentLocationId);

  return (
    <div className="space-y-2">
      {/* Location selector */}
      {locationArray.length > 1 ? (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Location:</label>
          <Select
            value={String(currentLocationId)}
            onValueChange={(value) => {
              const locId = Number(value);
            const nextVersion = getVersionSourcesForLocation(formatEntry, locId)[0]?.version ?? "1";
            onSourceChange(formatType, locId, nextVersion);
            }}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Select location..." />
            </SelectTrigger>
            <SelectContent>
              {locationArray.map((loc) => (
                <SelectItem key={loc.id} value={String(loc.id)} className="text-xs">
                  {loc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : locationArray.length === 1 ? (
        <div className="text-xs text-muted-foreground">
          Location: {locationArray[0].name}
        </div>
      ) : null}

      {/* Version selector */}
      {versionArray.length > 1 ? (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Version:</label>
          <Select
            value={String(currentVersion)}
            onValueChange={(value) => {
              // Keep current location when changing version
              onSourceChange(formatType, currentLocationId, parseVersionValue(value));
            }}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Select version..." />
            </SelectTrigger>
            <SelectContent>
              {versionArray.map((version) => (
                <SelectItem key={String(version)} value={String(version)} className="text-xs">
                  {formatVersionLabel(version)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : versionArray.length === 1 ? (
        <div className="text-xs text-muted-foreground">
          Version: {formatVersionLabel(versionArray[0])}
        </div>
      ) : null}

      {compareSearch && collectionSlug && datasetSlug && fileSlug ? (
        <Button variant="outline" size="sm" asChild className="w-full sm:w-auto font-mono">
          <Link
            to="/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug/compare"
            params={{
              collectionSlug,
              datasetSlug,
              fileSlug,
            }}
            search={compareSearch}
          >
            Compare Versions
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
