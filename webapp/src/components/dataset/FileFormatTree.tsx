import { ChevronDown, ChevronRight, File, FileJson, Folder, Map as MapIcon, Package } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DownloadAnalyticsContext } from "@/lib/analytics";
import type { DatasetFile, DatasetFormat, DatasetSource, FileLocation } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { CopyButton } from "./CopyButton";
import { getLocationOptions, getVersionSourcesForLocation } from "./compareSources";
import { DownloadButton } from "./DownloadButton";
import { buildGeoparquetSourceTree, formatGeoparquetGlobLabel, type GeoparquetTreeNode } from "./geoparquetTree";
import { MarkdownDescription } from "./MarkdownDescription";
import { type ParquetPreviewOption, parquetPreviewOptionFromSource } from "./parquetPreviewOptions";
import { buildSourceFileUrl, buildSourceStorageUri } from "./sourceUrls";
import { formatVersionLabel, parseVersionValue } from "./versionLabel";

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

interface SourceLifecycleDetail {
  label: string;
  value: string;
}

function formatSourceTimestamp(timestamp: string | undefined): string | null {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function sourceLifecycleDetails(source: DatasetSource | undefined): SourceLifecycleDetail[] {
  if (!source) return [];
  const details: SourceLifecycleDetail[] = [];
  const cataloged = formatSourceTimestamp(source.created_at);
  const sizeBytes = source.source_metadata?.size_bytes;

  if (cataloged) details.push({ label: "Cataloged", value: cataloged });
  if (typeof sizeBytes === "number" && sizeBytes > 0) {
    details.push({ label: "Size", value: formatFileSize(sizeBytes) });
  }

  return details;
}

function SourceLifecycleMetadata({ source }: { source: DatasetSource | undefined }) {
  const details = sourceLifecycleDetails(source);
  if (details.length === 0) return null;

  return (
    <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
      {details.map((detail) => (
        <p key={detail.label}>
          <span className="font-medium text-foreground">{detail.label}:</span> {detail.value}
        </p>
      ))}
    </div>
  );
}

interface SelectedFormatSource {
  storageLocationId: number;
  version: string | number;
}

interface SelectedFormatSources {
  [formatType: string]: SelectedFormatSource | undefined;
}

function isFileLocation(location: DatasetSource["location"]): location is FileLocation {
  return "path" in location;
}

function sourcePath(source: DatasetSource): string {
  return isFileLocation(source.location) ? source.location.path : "";
}

function selectedFormatSource(
  formatEntry: DatasetFormat,
  selectedSources: SelectedFormatSources,
  formatType: string,
): DatasetSource | undefined {
  const selectedLocationId = selectedSources[formatType]?.storageLocationId;
  const selectedVersion = selectedSources[formatType]?.version;
  return formatEntry.sources?.find(
    (source) =>
      source.storage_location?.id === selectedLocationId &&
      String(source.version || "1") === String(selectedVersion || "1"),
  );
}

function selectedFormatSources(
  formatEntry: DatasetFormat,
  selectedSources: SelectedFormatSources,
  formatType: string,
): DatasetSource[] {
  const selectedLocationId = selectedSources[formatType]?.storageLocationId;
  const selectedVersion = selectedSources[formatType]?.version;
  return (
    formatEntry.sources?.filter(
      (source) =>
        source.storage_location?.id === selectedLocationId &&
        String(source.version || "1") === String(selectedVersion || "1"),
    ) || []
  );
}

function formatEndpointConfig(storageUri: string): {
  hasEndpointUrl: boolean;
  s3Uri: string;
  host: string;
  port: string;
} {
  if (!storageUri.includes("?endpoint_url=")) {
    return { hasEndpointUrl: false, s3Uri: storageUri, host: "", port: "" };
  }

  const [uriPart, queryPart = ""] = storageUri.split("?");
  const params = new URLSearchParams(queryPart);
  const endpointUrl = params.get("endpoint_url") || "";

  try {
    const url = new URL(endpointUrl);
    return {
      hasEndpointUrl: true,
      s3Uri: uriPart || storageUri,
      host: url.hostname,
      port: url.port || (url.protocol === "https:" ? "443" : "80"),
    };
  } catch {
    const match = endpointUrl.match(/\/\/([^:]+)(?::(\d+))?/);
    return {
      hasEndpointUrl: true,
      s3Uri: uriPart || storageUri,
      host: match?.[1] ?? "",
      port: match?.[2] ?? "8333",
    };
  }
}

function countDisplaySources(formatType: string, sources: DatasetSource[]): number {
  if (formatType !== "geoparquet") {
    return sources.length;
  }

  const uniqueLocations = new Set<number>();
  for (const source of sources) {
    if (sourcePath(source).includes("*")) {
      continue;
    }
    const locId = source.storage_location?.id;
    if (locId) {
      uniqueLocations.add(locId);
    }
  }
  return uniqueLocations.size;
}

function downloadAnalyticsContext({
  collectionSlug,
  datasetSlug,
  fileSlug,
  format,
  source,
  sizeBytes,
  filename,
}: {
  collectionSlug?: string | undefined;
  datasetSlug?: string | undefined;
  fileSlug?: string | undefined;
  format: string;
  source?: DatasetSource | undefined;
  sizeBytes?: number | null | undefined;
  filename?: string | undefined;
}): Omit<Partial<DownloadAnalyticsContext>, "download_method"> {
  const context: Omit<Partial<DownloadAnalyticsContext>, "download_method"> = {
    format,
  };
  if (collectionSlug) context.collection_slug = collectionSlug;
  if (datasetSlug) context.dataset_slug = datasetSlug;
  if (fileSlug) context.file_slug = fileSlug;
  if (source) {
    context.source_id = source.id;
    if (source.storage_location?.id !== undefined) context.storage_location_id = source.storage_location.id;
    if (source.version !== undefined) context.version = source.version;
  }
  if (sizeBytes != null) context.expected_size_bytes = sizeBytes;
  if (filename) context.filename = filename;
  return context;
}

interface FileFormatTreeProps {
  file: DatasetFile;
  selectedSources: SelectedFormatSources;
  onSourceChange: (formatType: string, storageLocationId: number, version: string | number) => void;
  onViewParquet?: (option: ParquetPreviewOption) => void;
  pmtilesUrl: string | null;
  collectionId?: number;
  collectionSlug?: string;
  datasetSlug?: string;
  fileSlug?: string;
}

interface GeoparquetTreeNodesProps {
  nodes: GeoparquetTreeNode[];
  formatEntry: DatasetFormat;
  selectedSources: SelectedFormatSources;
  onSourceChange: (formatType: string, storageLocationId: number, version: string | number) => void;
  expandedFormats: Set<string>;
  toggleFormat: (formatType: string) => void;
  collectionSlug?: string | undefined;
  datasetSlug?: string | undefined;
  fileSlug?: string | undefined;
  onViewParquet?: ((option: ParquetPreviewOption) => void) | undefined;
}

type GeoparquetTreeNodeSharedProps = Omit<GeoparquetTreeNodesProps, "nodes">;

export function archiveDownloadSource(sources: DatasetSource[]): DatasetSource | undefined {
  return sources.find((source) => sourcePath(source).toLowerCase().endsWith(".zip"));
}

export function FileFormatTree({
  file,
  selectedSources,
  onSourceChange,
  onViewParquet,
  pmtilesUrl,
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

  const geoparquetFormat = file.formats?.find((f) => f.format.format_type === "geoparquet");
  const pmtilesFormat = file.formats?.find((f) => f.format.format_type === "pmtiles");
  const geopackageFormat = file.formats?.find((f) => f.format.format_type === "geopackage");
  const shapefileFormat = file.formats?.find((f) => f.format.format_type === "shapefile");
  const geojsonFormat = file.formats?.find((f) => f.format.format_type === "geojson");
  const fileGeodatabaseFormat = file.formats?.find((f) => f.format.format_type === "file_geodatabase");
  return (
    <div className="space-y-1 border rounded-md p-4">
      <h4 className="font-medium mb-3">Available Formats</h4>

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
                const allSources = selectedFormatSources(geoparquetFormat, selectedSources, "geoparquet");

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
                  const path = sourcePath(s);
                  return path.includes("*");
                })?.source_metadata?.size_bytes;
                const displaySize = globSourceSize || totalSizeBytes;

                return (
                  <FormatFileNode
                    icon={<FileJson className="h-4 w-4 text-green-600" />}
                    name={formatGeoparquetGlobLabel(globPattern)}
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
                        const { hasEndpointUrl, s3Uri, host, port } = formatEndpointConfig(globPattern);

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
                                <p className="text-xs text-muted-foreground mb-2">Then use this URI in your query:</p>
                                <code className="text-xs bg-muted px-2 py-1 rounded block break-all">{s3Uri}</code>
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
                            <SourceLifecycleMetadata source={sourceWithGlob ?? allSources[0]} />
                          </>
                        );
                      })()}
                    </div>
                  </FormatFileNode>
                );
              })()}

              {/* Individual parquet files */}
              {(() => {
                const allSources = selectedFormatSources(geoparquetFormat, selectedSources, "geoparquet");
                return (
                  <GeoparquetTreeNodes
                    nodes={buildGeoparquetSourceTree(allSources)}
                    formatEntry={geoparquetFormat}
                    selectedSources={selectedSources}
                    onSourceChange={onSourceChange}
                    expandedFormats={expandedFormats}
                    toggleFormat={toggleFormat}
                    collectionSlug={collectionSlug}
                    datasetSlug={datasetSlug}
                    fileSlug={fileSlug}
                    onViewParquet={onViewParquet}
                  />
                );
              })()}
            </div>
          </FormatFolderNode>
        </div>
      )}

      {/* PMTiles */}
      {pmtilesFormat &&
        (() => {
          const selectedPmtilesSource = selectedFormatSource(pmtilesFormat, selectedSources, "pmtiles");
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
            >
              {pmtilesUrl && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground break-all">{pmtilesUrl}</p>
                  <div className="flex items-center gap-2">
                    <CopyButton value={pmtilesUrl} label="Copy URL" />
                    <DownloadButton
                      url={pmtilesUrl}
                      label="Download"
                      analyticsContext={downloadAnalyticsContext({
                        collectionSlug,
                        datasetSlug,
                        fileSlug,
                        format: "pmtiles",
                        source: selectedPmtilesSource,
                        sizeBytes: pmtilesSizeBytes,
                      })}
                    />
                  </div>
                </div>
              )}
            </FormatFileNode>
          );
        })()}

      {/* GeoPackage */}
      {geopackageFormat &&
        (() => {
          const selectedGeopackageSource = selectedFormatSource(geopackageFormat, selectedSources, "geopackage");
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
            >
              {geopackageUrl && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground break-all">{geopackageUrl}</p>
                  <div className="flex items-center gap-2">
                    <CopyButton value={geopackageUrl} label="Copy URL" />
                    <DownloadButton
                      url={geopackageUrl}
                      label="Download"
                      sizeBytes={geopackageSizeBytes ?? undefined}
                      analyticsContext={downloadAnalyticsContext({
                        collectionSlug,
                        datasetSlug,
                        fileSlug,
                        format: "geopackage",
                        source: selectedGeopackageSource,
                        sizeBytes: geopackageSizeBytes,
                      })}
                    />
                  </div>
                </div>
              )}
            </FormatFileNode>
          );
        })()}

      {/* Shapefile */}
      {shapefileFormat && (
        <ArchiveFormatNode
          formatEntry={shapefileFormat}
          formatType="shapefile"
          name="shapefile"
          icon={<File className="h-4 w-4 text-amber-600" />}
          selectedSources={selectedSources}
          onSourceChange={onSourceChange}
          isExpanded={expandedFormats.has("shapefile")}
          onToggle={() => toggleFormat("shapefile")}
          collectionSlug={collectionSlug}
          datasetSlug={datasetSlug}
          fileSlug={fileSlug}
        />
      )}

      {/* GeoJSON */}
      {geojsonFormat &&
        (() => {
          const selectedGeojsonSource = selectedFormatSource(geojsonFormat, selectedSources, "geojson");
          const geojsonSizeBytes = selectedGeojsonSource?.source_metadata?.size_bytes;
          const geojsonUrl = selectedGeojsonSource ? buildSourceFileUrl(selectedGeojsonSource) : null;

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
            >
              {geojsonUrl && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground break-all">{geojsonUrl}</p>
                  <div className="flex items-center gap-2">
                    <CopyButton value={geojsonUrl} label="Copy URL" />
                    <DownloadButton
                      url={geojsonUrl}
                      label="Download"
                      analyticsContext={downloadAnalyticsContext({
                        collectionSlug,
                        datasetSlug,
                        fileSlug,
                        format: "geojson",
                        source: selectedGeojsonSource,
                        sizeBytes: geojsonSizeBytes,
                      })}
                    />
                  </div>
                </div>
              )}
            </FormatFileNode>
          );
        })()}

      {/* File Geodatabase */}
      {fileGeodatabaseFormat && (
        <ArchiveFormatNode
          formatEntry={fileGeodatabaseFormat}
          formatType="file_geodatabase"
          name="file geodatabase"
          icon={<Folder className="h-4 w-4 text-indigo-500" />}
          selectedSources={selectedSources}
          onSourceChange={onSourceChange}
          isExpanded={expandedFormats.has("file_geodatabase")}
          onToggle={() => toggleFormat("file_geodatabase")}
          collectionSlug={collectionSlug}
          datasetSlug={datasetSlug}
          fileSlug={fileSlug}
        />
      )}

      {(!file.formats || file.formats.length === 0) && (
        <p className="text-sm text-muted-foreground">No formats available for this file.</p>
      )}
    </div>
  );
}

function GeoparquetTreeNodes({
  nodes,
  formatEntry,
  selectedSources,
  onSourceChange,
  expandedFormats,
  toggleFormat,
  collectionSlug,
  datasetSlug,
  fileSlug,
  onViewParquet,
}: GeoparquetTreeNodesProps) {
  return (
    <>
      {nodes.map((node) =>
        node.type === "folder" ? (
          <GeoparquetFolderNode
            key={node.path}
            node={node}
            formatEntry={formatEntry}
            selectedSources={selectedSources}
            onSourceChange={onSourceChange}
            expandedFormats={expandedFormats}
            toggleFormat={toggleFormat}
            collectionSlug={collectionSlug}
            datasetSlug={datasetSlug}
            fileSlug={fileSlug}
            onViewParquet={onViewParquet}
          />
        ) : (
          <GeoparquetLeafNode
            key={node.path}
            node={node}
            formatEntry={formatEntry}
            selectedSources={selectedSources}
            onSourceChange={onSourceChange}
            expandedFormats={expandedFormats}
            toggleFormat={toggleFormat}
            collectionSlug={collectionSlug}
            datasetSlug={datasetSlug}
            fileSlug={fileSlug}
            onViewParquet={onViewParquet}
          />
        ),
      )}
    </>
  );
}

function GeoparquetFolderNode({ node, ...props }: { node: GeoparquetTreeNode } & GeoparquetTreeNodeSharedProps) {
  const expansionKey = `geoparquet-folder-${node.path}`;
  return (
    <FormatFileNode
      icon={<Folder className="h-4 w-4 text-yellow-600" />}
      name={node.name}
      badge={`${node.children.length} item${node.children.length === 1 ? "" : "s"}`}
      formatType="geoparquet"
      formatEntry={props.formatEntry}
      selectedSources={props.selectedSources}
      onSourceChange={props.onSourceChange}
      isExpanded={props.expandedFormats.has(expansionKey)}
      onToggle={() => props.toggleFormat(expansionKey)}
      showSourceSelector={false}
    >
      <div className="space-y-1">
        <GeoparquetTreeNodes nodes={node.children} {...props} />
      </div>
    </FormatFileNode>
  );
}

function GeoparquetLeafNode({ node, ...props }: { node: GeoparquetTreeNode } & GeoparquetTreeNodeSharedProps) {
  const source = node.source;
  if (!source) {
    return null;
  }

  const fileSizeBytes = source.source_metadata?.size_bytes;
  return (
    <FormatFileNode
      icon={<File className="h-4 w-4 text-green-600" />}
      name={node.name}
      badge={fileSizeBytes != null ? formatFileSize(fileSizeBytes) : undefined}
      formatType="geoparquet"
      formatEntry={props.formatEntry}
      selectedSources={props.selectedSources}
      onSourceChange={props.onSourceChange}
      isExpanded={props.expandedFormats.has(`geoparquet-file-${node.path}`)}
      onToggle={() => props.toggleFormat(`geoparquet-file-${node.path}`)}
      showSourceSelector={false}
    >
      <GeoparquetFileDetails
        source={source}
        fileName={node.name}
        collectionSlug={props.collectionSlug}
        datasetSlug={props.datasetSlug}
        fileSlug={props.fileSlug}
        onViewParquet={props.onViewParquet}
      />
    </FormatFileNode>
  );
}

function GeoparquetFileDetails({
  source,
  fileName,
  collectionSlug,
  datasetSlug,
  fileSlug,
  onViewParquet,
}: {
  source: DatasetSource;
  fileName: string;
  collectionSlug?: string | undefined;
  datasetSlug?: string | undefined;
  fileSlug?: string | undefined;
  onViewParquet?: ((option: ParquetPreviewOption) => void) | undefined;
}) {
  const fileUrl = buildSourceFileUrl(source);
  const fileStorageUri = buildSourceStorageUri(source);
  const previewOption = parquetPreviewOptionFromSource(source);
  const fileSizeBytes = source.source_metadata?.size_bytes;

  return (
    <div className="space-y-2">
      <SourceLifecycleMetadata source={source} />
      {fileStorageUri && <StorageUriDetails storageUri={fileStorageUri} />}
      {fileUrl && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Download URL:</p>
          <p className="text-xs text-muted-foreground break-all mb-1">{fileUrl}</p>
          <div className="flex items-center gap-2">
            <DownloadButton
              url={fileUrl}
              label="Download"
              analyticsContext={downloadAnalyticsContext({
                collectionSlug,
                datasetSlug,
                fileSlug,
                format: "geoparquet",
                source,
                sizeBytes: fileSizeBytes,
                filename: fileName,
              })}
            />
            {onViewParquet && previewOption && (
              <Button
                size="sm"
                variant="secondary"
                onClick={(event) => {
                  event.stopPropagation();
                  onViewParquet(previewOption);
                }}
              >
                View Data
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StorageUriDetails({ storageUri }: { storageUri: string }) {
  const { hasEndpointUrl, s3Uri, host, port } = formatEndpointConfig(storageUri);

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">Storage URI:</p>
      {hasEndpointUrl ? (
        <>
          <p className="text-xs text-muted-foreground mb-2">For DuckDB, configure the S3 endpoint first:</p>
          <div className="space-y-1 mb-2">
            <code className="text-xs bg-muted px-2 py-1 rounded block">
              SET s3_endpoint='{host}:{port}';
            </code>
            <code className="text-xs bg-muted px-2 py-1 rounded block">SET s3_use_ssl=false;</code>
            <code className="text-xs bg-muted px-2 py-1 rounded block">SET s3_url_style='path';</code>
          </div>
          <p className="text-xs text-muted-foreground mb-1">Then use this URI in your query:</p>
          <code className="text-xs bg-muted px-2 py-1 rounded block break-all">{s3Uri}</code>
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
          <code className="text-xs bg-muted px-2 py-1 rounded block break-all">{storageUri}</code>
          <div className="flex items-center gap-2 mt-1">
            <CopyButton value={storageUri} label="Copy URI" />
          </div>
        </>
      )}
    </div>
  );
}

export function ArchiveFormatNode({
  formatEntry,
  formatType,
  name,
  icon,
  selectedSources,
  onSourceChange,
  isExpanded,
  onToggle,
  collectionSlug,
  datasetSlug,
  fileSlug,
}: {
  formatEntry: DatasetFormat;
  formatType: "shapefile" | "file_geodatabase";
  name: string;
  icon: React.ReactNode;
  selectedSources: SelectedFormatSources;
  onSourceChange: (formatType: string, storageLocationId: number, version: string | number) => void;
  isExpanded: boolean;
  onToggle: () => void;
  collectionSlug?: string | undefined;
  datasetSlug?: string | undefined;
  fileSlug?: string | undefined;
}) {
  const source = archiveDownloadSource(selectedFormatSources(formatEntry, selectedSources, formatType));
  const sizeBytes = source?.source_metadata?.size_bytes;
  const filename = `${datasetSlug ?? "dataset"}_${fileSlug ?? "file"}_${formatType}.zip`;
  const downloadUrl = source ? buildSourceFileUrl(source) : null;

  return (
    <FormatFileNode
      icon={icon}
      name={name}
      badge={sizeBytes != null ? formatFileSize(sizeBytes) : undefined}
      formatType={formatType}
      formatEntry={formatEntry}
      selectedSources={selectedSources}
      onSourceChange={onSourceChange}
      isExpanded={isExpanded}
      onToggle={onToggle}
    >
      {downloadUrl && source && (
        <div className="space-y-2">
          {sizeBytes != null && (
            <p className="text-xs text-muted-foreground">Compressed size: {formatFileSize(sizeBytes)}</p>
          )}
          <p className="text-xs text-muted-foreground break-all">{downloadUrl}</p>
          <CopyButton value={downloadUrl} label="Copy URL" />
          <DownloadButton
            url={downloadUrl}
            label="Download ZIP"
            filename={filename}
            sizeBytes={sizeBytes ?? undefined}
            analyticsContext={downloadAnalyticsContext({
              collectionSlug,
              datasetSlug,
              fileSlug,
              format: formatType,
              source,
              sizeBytes,
              filename,
            })}
          />
        </div>
      )}
    </FormatFileNode>
  );
}

interface FormatFileNodeProps {
  icon: React.ReactNode;
  name: string;
  badge?: string | undefined;
  formatType: string;
  formatEntry: NonNullable<DatasetFile["formats"]>[0];
  selectedSources: SelectedFormatSources;
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
  showSourceSelector = true,
}: FormatFileNodeProps) {
  const hasChildren = !!children;
  const sources = formatEntry.sources || [];

  return (
    <div>
      <button
        type="button"
        className={cn(
          "select-none flex w-full items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors text-left",
          isExpanded && hasChildren && "bg-muted/30",
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
      </button>

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
  selectedSources: SelectedFormatSources;
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
  const sourceCount = countDisplaySources(formatType, sources);

  return (
    <div>
      <button
        type="button"
        className={cn(
          "select-none flex w-full items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors text-left",
          isExpanded && "bg-muted/30",
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
      </button>

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
  selectedSources: SelectedFormatSources;
  onSourceChange: (formatType: string, storageLocationId: number, version: string | number) => void;
}

function SourceSelector({ formatType, formatEntry, selectedSources, onSourceChange }: SourceSelectorProps) {
  const selectedSource = selectedSources[formatType];
  const locationArray = getLocationOptions(formatEntry);

  if (locationArray.length === 0) {
    return null;
  }

  const firstLocation = locationArray[0];
  if (!firstLocation) {
    return null;
  }

  const currentLocationId = selectedSource?.storageLocationId || firstLocation.id;
  const versionSources = getVersionSourcesForLocation(formatEntry, currentLocationId);
  const versionArray = versionSources.map((source) => source.version || "1");
  const firstVersion = versionArray[0] ?? "1";
  const currentVersion =
    selectedSource?.version && versionArray.some((version) => String(version) === String(selectedSource.version))
      ? selectedSource.version
      : firstVersion;
  const currentSource = versionSources.find((source) => String(source.version ?? "1") === String(currentVersion));
  const versionDescription = currentSource?.source_metadata?.description?.trim();

  return (
    <div className="space-y-2">
      {/* Location selector */}
      {locationArray.length > 1 ? (
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Location:</span>
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
        <div className="text-xs text-muted-foreground">Location: {firstLocation.name}</div>
      ) : null}

      {/* Version selector */}
      {versionArray.length > 1 ? (
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Version:</span>
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
        <div className="text-xs text-muted-foreground">Version: {formatVersionLabel(firstVersion)}</div>
      ) : null}

      {versionDescription ? (
        <div className="border-l-2 bg-muted/20 px-3 py-2 text-xs">
          <p className="font-medium text-foreground">Version note</p>
          <MarkdownDescription markdown={versionDescription} className="mt-1" />
        </div>
      ) : null}
      <SourceLifecycleMetadata source={currentSource} />
    </div>
  );
}
