import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  DownloadAnalyticsContext,
} from "@/lib/analytics";
import {
  trackDownloadClicked,
  trackDownloadFailed,
  trackDownloadSucceeded,
} from "@/lib/analytics";
import { usesNativeBrowserDownload } from "./sourceUrls";

interface DownloadButtonProps {
  url: string;
  label: string;
  filename?: string; // Optional explicit filename to use instead of extracting from URL
  sizeBytes?: number; // Optional file size to determine if we should use streaming
  analyticsContext?: Omit<Partial<DownloadAnalyticsContext>, "download_method">;
}

function getUrlHost(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.host || "local";
  } catch {
    return "unknown";
  }
}

function elapsedMs(startTime: number): number {
  return Math.round(performance.now() - startTime);
}

export async function executeDownload({
  url,
  filename,
  analyticsContext,
  useDirectDownload,
}: {
  url: string;
  filename: string;
  analyticsContext?: Omit<Partial<DownloadAnalyticsContext>, "download_method">;
  useDirectDownload: boolean;
}) {
  const startTime = performance.now();
  const download_method = useDirectDownload ? "native_link" : "fetch_stream";
  const baseAnalyticsContext: DownloadAnalyticsContext = {
    ...analyticsContext,
    filename,
    url_host: getUrlHost(url),
    download_method,
  };

  trackDownloadClicked(baseAnalyticsContext);

  if (useDirectDownload) {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.target = "_blank";
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    trackDownloadSucceeded(baseAnalyticsContext, {
      completion_status: "handoff",
      duration_ms: elapsedMs(startTime),
    });
    return;
  }

  let receivedBytes = 0;
  let contentLengthBytes: number | undefined;

  try {
    const response = await fetch(url);
    const contentLength = response.headers.get('content-length');
    contentLengthBytes = contentLength ? parseInt(contentLength, 10) : undefined;

    if (!response.ok) {
      throw new Error(`Download failed: ${response.statusText}`);
    }

    const responseClone = response.clone();

    // @ts-ignore - File System Access API is not in all TypeScript definitions
    if ('showSaveFilePicker' in window) {
      try {
        // @ts-ignore
        const fileHandle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: 'Download file',
            accept: {
              'application/octet-stream': [filename.split('.').pop() || ''],
            },
          }],
        });

        const writable = await fileHandle.createWritable();
        const reader = response.body?.getReader();

        if (!reader) {
          throw new Error('Response body is not readable');
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          receivedBytes += value.length;
          await writable.write(value);
        }

        await writable.close();
        trackDownloadSucceeded(baseAnalyticsContext, {
          completion_status: "completed",
          received_bytes: receivedBytes,
          content_length_bytes: contentLengthBytes,
          duration_ms: elapsedMs(startTime),
        });
        return;
      } catch (fileSystemError: any) {
        if (fileSystemError.name === 'AbortError') {
          trackDownloadFailed(baseAnalyticsContext, {
            error_message: "Download canceled",
            received_bytes: receivedBytes,
            content_length_bytes: contentLengthBytes,
            duration_ms: elapsedMs(startTime),
          });
          return;
        }
        console.log('File System Access API not available, using blob method:', fileSystemError);
      }
    }

    const responseToUse = responseClone.body ? responseClone : response;
    const reader = responseToUse.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      receivedBytes += value.length;
    }

    const blob = new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    trackDownloadSucceeded(baseAnalyticsContext, {
      completion_status: "completed",
      received_bytes: receivedBytes,
      content_length_bytes: contentLengthBytes,
      duration_ms: elapsedMs(startTime),
    });

    setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
    }, 100);
  } catch (error) {
    console.error("Download error:", error);
    trackDownloadFailed(baseAnalyticsContext, {
      error_message: error instanceof Error ? error.message : String(error),
      received_bytes: receivedBytes || undefined,
      content_length_bytes: contentLengthBytes,
      duration_ms: elapsedMs(startTime),
    });
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.target = "_blank";
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

export function DownloadButton({
  url,
  label,
  filename: explicitFilename,
  analyticsContext,
}: DownloadButtonProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const useDirectDownload = usesNativeBrowserDownload(url);

  // Use explicit filename if provided, otherwise extract from URL or generate from label
  let filename: string;
  
  if (explicitFilename) {
    filename = explicitFilename;
  } else {
    try {
      const urlPath = new URL(url, window.location.origin).pathname;
      const extractedFilename = urlPath.split("/").pop();

      if (extractedFilename && extractedFilename.includes(".")) {
        // Only use extracted filename if it has an extension
        filename = extractedFilename;
      } else {
        // Generate filename based on label and common extensions
        const extension =
          label === "PMTiles"
            ? "pmtiles"
            : label === "GeoParquet"
              ? "parquet"
              : label === "GeoPackage"
                ? "gpkg"
                : label.toLowerCase().includes("zip")
                  ? "zip"
                  : "bin";
        filename = `${label.toLowerCase().replace(/\s+/g, "-")}.${extension}`;
      }
    } catch {
      // Fallback if URL parsing fails
      const extension =
        label === "PMTiles"
          ? "pmtiles"
          : label === "GeoParquet"
            ? "parquet"
            : label === "GeoPackage"
              ? "gpkg"
              : label.toLowerCase().includes("zip")
                ? "zip"
                : "bin";
      filename = `${label.toLowerCase().replace(/\s+/g, "-")}.${extension}`;
    }
  }

  const handleDownload = async () => {
    setIsDownloading(true);

    try {
      await executeDownload({
        url,
        filename,
        analyticsContext,
        useDirectDownload,
      });

      if (useDirectDownload) {
        setTimeout(() => {
          setIsDownloading(false);
        }, 500);
      }
    } finally {
      if (!useDirectDownload) {
        setIsDownloading(false);
      }
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            disabled={isDownloading}
          >
            {isDownloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {isDownloading ? "Downloading..." : label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
