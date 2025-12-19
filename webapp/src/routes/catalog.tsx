import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  Search,
  Database,
  ExternalLink,
  Copy,
  Check,
  FileJson,
  Map,
  Globe,
  Loader2,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { getDatasets, getDatasetStats } from "@/lib/datasets";
import type { Dataset } from "@/db/schema";

// Client-side URL generators for direct GeoServer access
const GEOSERVER_BASE_URL = "http://localhost:8080/geoserver";

function getWfsUrl(workspace: string, layerName: string): string {
  // Dataset-specific WFS virtual service
  return `${GEOSERVER_BASE_URL}/${workspace}/${layerName}/wfs`;
}

function getWmsUrl(workspace: string, layerName: string): string {
  // Dataset-specific WMS virtual service
  return `${GEOSERVER_BASE_URL}/${workspace}/${layerName}/wms`;
}

function getFullLayerName(workspace: string, layerName: string): string {
  return `${workspace}:${layerName}`;
}

const fetchDatasets = createServerFn({ method: "GET" }).handler(async () => {
  return getDatasets(undefined);
});

const searchDatasets = createServerFn({ method: "POST" })
  .inputValidator((input: unknown): string => {
    if (typeof input === "string") {
      return input.trim();
    }
    return "";
  })
  .handler(async ({ data }) => {
    return getDatasets(data || undefined);
  });

const fetchStats = createServerFn({ method: "GET" }).handler(async () => {
  return getDatasetStats();
});

export const Route = createFileRoute("/catalog")({
  component: CatalogPage,
  loader: async () => {
    const [datasets, stats] = await Promise.all([
      fetchDatasets(),
      fetchStats(),
    ]);
    return {
      datasets: datasets || [],
      stats: stats || {
        total: 0,
        ready: 0,
        pending: 0,
        processing: 0,
        error: 0,
      },
    };
  },
});

const statusVariants: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  ready: "default",
  pending: "secondary",
  processing: "outline",
  error: "destructive",
};

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" onClick={copy}>
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copied ? "Copied!" : `Copy ${label}`}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function DatasetCard({ dataset }: { dataset: Dataset }) {
  const statusVariant = statusVariants[dataset.status] || "secondary";

  const cleanDescription = dataset.description
    ?.replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();

  // Generate GeoServer URLs if workspace and layer are available
  const wfsUrl =
    dataset.geoserverWorkspace && dataset.geoserverLayer
      ? getWfsUrl(dataset.geoserverWorkspace, dataset.geoserverLayer)
      : null;
  const wmsUrl =
    dataset.geoserverWorkspace && dataset.geoserverLayer
      ? getWmsUrl(dataset.geoserverWorkspace, dataset.geoserverLayer)
      : null;
  const fullLayerName =
    dataset.geoserverWorkspace && dataset.geoserverLayer
      ? getFullLayerName(dataset.geoserverWorkspace, dataset.geoserverLayer)
      : null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Card className="cursor-pointer hover:bg-muted/50 transition-colors h-full">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant={statusVariant}>{dataset.status}</Badge>
              <Badge variant="outline">{dataset.type}</Badge>
            </div>
            <CardTitle className="text-base">{dataset.alias}</CardTitle>
            <CardDescription className="font-mono text-xs">
              {dataset.name}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
              {cleanDescription || "No description available."}
            </p>
            <div className="flex flex-wrap gap-1">
              {dataset.pmtilesUrl && (
                <Badge variant="secondary" className="text-xs">
                  <Map className="h-3 w-3 mr-1" />
                  PMTiles
                </Badge>
              )}
              {dataset.geoparquetUrl && (
                <Badge variant="secondary" className="text-xs">
                  <FileJson className="h-3 w-3 mr-1" />
                  GeoParquet
                </Badge>
              )}
              {dataset.geoserverWorkspace && dataset.geoserverLayer && (
                <>
                  <Badge variant="secondary" className="text-xs">
                    <Globe className="h-3 w-3 mr-1" />
                    WFS
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    <Map className="h-3 w-3 mr-1" />
                    WMS
                  </Badge>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </DialogTrigger>

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
                <Badge variant={statusVariant}>{dataset.status}</Badge>
              </div>
              {dataset.featureCount && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Features</p>
                  <p className="font-medium">
                    {dataset.featureCount.toLocaleString()}
                  </p>
                </div>
              )}
              {dataset.geoserverLayer && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Layer</p>
                  <p className="font-mono text-sm break-all">
                    {dataset.geoserverWorkspace}:{dataset.geoserverLayer}
                  </p>
                </div>
              )}
            </div>

            {(dataset.pmtilesUrl ||
              dataset.geoparquetUrl ||
              wfsUrl ||
              wmsUrl) && (
              <>
                <Separator />
                <div>
                  <h4 className="font-medium mb-4">Connection URLs</h4>
                  <div className="space-y-3">
                    {dataset.pmtilesUrl && (
                      <div className="flex items-start gap-2 p-3 rounded-md border">
                        <Map className="h-4 w-4 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium mb-1">PMTiles</p>
                          <p className="text-xs text-muted-foreground break-all">
                            {dataset.pmtilesUrl}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <CopyButton value={dataset.pmtilesUrl} label="URL" />
                          <Button variant="ghost" size="sm" asChild>
                            <a
                              href={dataset.pmtilesUrl}
                              target="_blank"
                              rel="noopener"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                        </div>
                      </div>
                    )}
                    {dataset.geoparquetUrl && (
                      <div className="flex items-start gap-2 p-3 rounded-md border">
                        <FileJson className="h-4 w-4 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium mb-1">GeoParquet</p>
                          <p className="text-xs text-muted-foreground break-all">
                            {dataset.geoparquetUrl}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <CopyButton
                            value={dataset.geoparquetUrl}
                            label="URL"
                          />
                          <Button variant="ghost" size="sm" asChild>
                            <a
                              href={dataset.geoparquetUrl}
                              target="_blank"
                              rel="noopener"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                        </div>
                      </div>
                    )}
                    {wfsUrl && fullLayerName && (
                      <div className="flex items-start gap-2 p-3 rounded-md border">
                        <Globe className="h-4 w-4 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium mb-1">
                            WFS (Feature Service)
                          </p>
                          <p className="text-xs text-muted-foreground break-all">
                            {wfsUrl}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Layer:{" "}
                            <code className="bg-muted px-1 rounded">
                              {fullLayerName}
                            </code>
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <CopyButton value={wfsUrl} label="URL" />
                          <Button variant="ghost" size="sm" asChild>
                            <a
                              href={`${wfsUrl}?service=WFS&request=GetCapabilities`}
                              target="_blank"
                              rel="noopener"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                        </div>
                      </div>
                    )}
                    {wmsUrl && fullLayerName && (
                      <div className="flex items-start gap-2 p-3 rounded-md border">
                        <Map className="h-4 w-4 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium mb-1">
                            WMS (Map Service)
                          </p>
                          <p className="text-xs text-muted-foreground break-all">
                            {wmsUrl}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Layer:{" "}
                            <code className="bg-muted px-1 rounded">
                              {fullLayerName}
                            </code>
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <CopyButton value={wmsUrl} label="URL" />
                          <Button variant="ghost" size="sm" asChild>
                            <a
                              href={`${wmsUrl}?service=WMS&request=GetCapabilities`}
                              target="_blank"
                              rel="noopener"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            <Separator />

            <div className="text-xs text-muted-foreground space-y-1">
              <p>Created: {new Date(dataset.createdAt).toLocaleString()}</p>
              <p>Updated: {new Date(dataset.updatedAt).toLocaleString()}</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CatalogPage() {
  const { datasets: initialDatasets, stats } = Route.useLoaderData();
  const [searchQuery, setSearchQuery] = useState("");
  const [datasets, setDatasets] = useState<Dataset[]>(initialDatasets || []);
  const [isSearching, setIsSearching] = useState(false);

  const safeStats = stats || {
    total: 0,
    ready: 0,
    pending: 0,
    processing: 0,
    error: 0,
  };

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    setIsSearching(true);
    try {
      const trimmedQuery = query.trim();
      const results = trimmedQuery
        ? await searchDatasets({ data: trimmedQuery })
        : await fetchDatasets();
      setDatasets(results || []);
    } catch (error) {
      console.error("Search error:", error);
      setDatasets([]);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight">Dataset Catalog</h1>
          <p className="text-lg text-muted-foreground mt-2">
            Browse and connect to geospatial datasets
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-6">
          <Card>
            <CardHeader>
              <div className="text-muted-foreground mb-2">
                <Database className="h-8 w-8" />
              </div>
              <CardTitle className="text-3xl">{safeStats.total}</CardTitle>
              <CardDescription>Total Datasets</CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <div className="text-green-600 mb-2">
                <Check className="h-8 w-8" />
              </div>
              <CardTitle className="text-3xl text-green-600">
                {safeStats.ready}
              </CardTitle>
              <CardDescription>Ready</CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <div className="text-yellow-600 mb-2">
                <Loader2 className="h-8 w-8" />
              </div>
              <CardTitle className="text-3xl text-yellow-600">
                {safeStats.pending + safeStats.processing}
              </CardTitle>
              <CardDescription>Processing</CardDescription>
            </CardHeader>
          </Card>
        </div>

        {/* Search */}
        <Card>
          <CardContent className="pt-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search datasets by name or description..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-10"
              />
              {isSearching && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin" />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Dataset Grid */}
        {datasets.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Database className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="font-semibold">No datasets found</h3>
              <p className="text-sm text-muted-foreground">
                {searchQuery
                  ? "Try a different search"
                  : "No datasets have been added yet"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {datasets.map((dataset) => (
              <DatasetCard key={dataset.id} dataset={dataset} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
