import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { DownloadAnalyticsContext } from "@/lib/analytics";
import { trackDownloadClicked, trackDownloadFailed, trackDownloadSucceeded } from "@/lib/analytics";
import type { DatasetSource } from "@/lib/api-client";
import { createZipFromUrls, extractShapefileUrls } from "@/lib/zip-utils";

interface ShapefileZipSource {
  id?: number | undefined;
  url?: string | undefined;
  location?: DatasetSource["location"] | { path?: string | undefined; type?: string | undefined } | undefined;
  glob_pattern?: string | undefined;
}

interface ZipSourceInput {
  id?: number;
  url?: string;
  location?: { path?: string; type?: string };
  glob_pattern?: string;
}

interface ShapefileZipDownloadButtonProps {
  sources: ShapefileZipSource[];
  filename: string;
  label?: string;
  analyticsContext?: Omit<Partial<DownloadAnalyticsContext>, "download_method">;
}

function getUrlHost(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, window.location.origin).host || "local";
  } catch {
    return "unknown";
  }
}

function elapsedMs(startTime: number): number {
  return Math.round(performance.now() - startTime);
}

function toZipSourceInput(source: ShapefileZipSource): ZipSourceInput {
  const input: ZipSourceInput = {};
  if (source.id !== undefined) input.id = source.id;
  if (source.url) input.url = source.url;
  if (source.glob_pattern) input.glob_pattern = source.glob_pattern;
  if (source.location && "path" in source.location && source.location.path) {
    input.location = { path: source.location.path };
  }
  return input;
}

export async function executeShapefileZipDownload({
  sources,
  filename,
  analyticsContext,
  onProgress,
}: {
  sources: ShapefileZipDownloadButtonProps["sources"];
  filename: string;
  analyticsContext?: Omit<Partial<DownloadAnalyticsContext>, "download_method">;
  onProgress?: (progress: number) => void;
}) {
  const startTime = performance.now();
  const fileUrls = extractShapefileUrls(sources.map(toZipSourceInput));
  const sourceCount = fileUrls.length;
  const baseAnalyticsContext: DownloadAnalyticsContext = {
    ...analyticsContext,
    filename,
    url_host: getUrlHost(fileUrls[0]?.url),
    download_method: "client_zip",
    source_count: sourceCount,
  };

  trackDownloadClicked(baseAnalyticsContext);

  if (fileUrls.length === 0) {
    const errorMessage = "No shapefile URLs found in sources";
    console.error(errorMessage);
    trackDownloadFailed(baseAnalyticsContext, {
      error_category: "zip_error",
      source_count: sourceCount,
      duration_ms: elapsedMs(startTime),
    });
    return;
  }

  try {
    await createZipFromUrls(fileUrls, filename, onProgress);
    trackDownloadSucceeded(baseAnalyticsContext, {
      completion_status: "completed",
      source_count: sourceCount,
      received_bytes: analyticsContext?.expected_size_bytes,
      duration_ms: elapsedMs(startTime),
    });
  } catch (error) {
    console.error("Error creating zip file:", error);
    trackDownloadFailed(baseAnalyticsContext, {
      error_category: "zip_error",
      source_count: sourceCount,
      received_bytes: analyticsContext?.expected_size_bytes,
      duration_ms: elapsedMs(startTime),
    });
    alert(`Failed to create zip file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function ShapefileZipDownloadButton({
  sources,
  filename,
  label = "Download Zip",
  analyticsContext,
}: ShapefileZipDownloadButtonProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleDownload = async () => {
    setIsDownloading(true);
    setProgress(0);

    try {
      const downloadOptions: Parameters<typeof executeShapefileZipDownload>[0] = {
        sources,
        filename,
        onProgress: (progressValue) => {
          setProgress(progressValue);
        },
      };
      if (analyticsContext) {
        downloadOptions.analyticsContext = analyticsContext;
      }
      await executeShapefileZipDownload(downloadOptions);
    } finally {
      setIsDownloading(false);
      setProgress(0);
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" onClick={handleDownload} disabled={isDownloading}>
            {isDownloading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {progress > 0 ? `${progress}%` : "Creating..."}
              </>
            ) : (
              <Download className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{isDownloading ? `Creating zip... ${progress}%` : label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
