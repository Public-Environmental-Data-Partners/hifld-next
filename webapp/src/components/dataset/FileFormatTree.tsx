import { useState } from "react";
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
                name="geojson.json"
                formatType="geoserver"
                formatEntry={geoserverFormat}
                selectedSources={selectedSources}
                onSourceChange={onSourceChange}
                isExpanded={expandedFormats.has("geoserver-geojson")}
                onToggle={() => toggleFormat("geoserver-geojson")}
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
                name="geopackage.gpkg"
                formatType="geoserver"
                formatEntry={geoserverFormat}
                selectedSources={selectedSources}
                onSourceChange={onSourceChange}
                isExpanded={expandedFormats.has("geoserver-gpkg")}
                onToggle={() => toggleFormat("geoserver-gpkg")}
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
                name="shapefile.zip"
                formatType="geoserver"
                formatEntry={geoserverFormat}
                selectedSources={selectedSources}
                onSourceChange={onSourceChange}
                isExpanded={expandedFormats.has("geoserver-shp")}
                onToggle={() => toggleFormat("geoserver-shp")}
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
                const globPattern = sourceWithGlob?.glob_pattern || null;
                
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
                      {globPattern ? (() => {
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
                      })() : (
                        <p className="text-xs text-muted-foreground">
                          No glob pattern available for the selected location and version
                        </p>
                      )}
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
                  const fileUrl = source.url;
                  const fileStorageUri = source.storage_uri;
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
            name="tiles.pmtiles"
            badge={pmtilesSizeBytes != null ? formatFileSize(pmtilesSizeBytes) : undefined}
            formatType="pmtiles"
            formatEntry={pmtilesFormat}
            selectedSources={selectedSources}
            onSourceChange={onSourceChange}
            isExpanded={expandedFormats.has("pmtiles")}
            onToggle={() => toggleFormat("pmtiles")}
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
  showSourceSelector = true
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
}

function SourceSelector({
  formatType,
  formatEntry,
  selectedSources,
  onSourceChange,
}: SourceSelectorProps) {
  const sources = formatEntry.sources || [];
  const selectedSource = selectedSources[formatType];

  // Get unique storage locations
  const locations = new Map<number, { id: number; name: string }>();
  sources.forEach((source) => {
    const locId = source.storage_location?.id;
    const locName = source.storage_location?.name;
    if (locId && locName && !locations.has(locId)) {
      locations.set(locId, { id: locId, name: locName });
    }
  });

  // Get unique versions (across all sources)
  const versions = new Set<string | number>();
  sources.forEach((source) => {
    const version = source.version || "1";
    versions.add(version);
  });

  const locationArray = Array.from(locations.values());
  const versionArray = Array.from(versions).sort((a, b) => {
    // Sort versions: try to parse as dates (YYYY-MM-DD) or numbers
    const aStr = String(a);
    const bStr = String(b);
    if (aStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return bStr.localeCompare(aStr); // Descending for dates
    }
    const aNum = Number(a);
    const bNum = Number(b);
    if (!isNaN(aNum) && !isNaN(bNum)) {
      return bNum - aNum; // Descending for numbers
    }
    return bStr.localeCompare(aStr); // Descending for strings
  });

  if (locationArray.length === 0) {
    return null;
  }

  const currentLocationId = selectedSource?.storageLocationId || locationArray[0]?.id;
  const currentVersion = selectedSource?.version || versionArray[0];

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
              // Keep current version when changing location
              onSourceChange(formatType, locId, currentVersion);
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
              // Parse version - could be a date string or number
              const version = value.match(/^\d{4}-\d{2}-\d{2}$/) ? value : Number(value);
              // Keep current location when changing version
              onSourceChange(formatType, currentLocationId, isNaN(version as number) ? value : version);
            }}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Select version..." />
            </SelectTrigger>
            <SelectContent>
              {versionArray.map((version) => (
                <SelectItem key={String(version)} value={String(version)} className="text-xs">
                  {String(version).match(/^\d{4}-\d{2}-\d{2}$/) ? version : `v${version}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : versionArray.length === 1 ? (
        <div className="text-xs text-muted-foreground">
          Version: {String(versionArray[0]).match(/^\d{4}-\d{2}-\d{2}$/) ? versionArray[0] : `v${versionArray[0]}`}
        </div>
      ) : null}
    </div>
  );
}

