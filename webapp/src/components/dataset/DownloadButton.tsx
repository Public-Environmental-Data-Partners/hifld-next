import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { DownloadAnalyticsContext, DownloadFailureCategory } from "@/lib/analytics";
import {
  trackDownloadClicked,
  trackDownloadFailed,
  trackDownloadHandedOff,
  trackDownloadSucceeded,
} from "@/lib/analytics";
import { usesNativeBrowserDownload } from "./sourceUrls";

interface DownloadButtonProps {
  url: string;
  label: string;
  filename?: string; // Optional explicit filename to use instead of extracting from URL
  sizeBytes?: number | undefined; // Optional file size to determine if we should use streaming
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

type DownloadAnalyticsInput = Omit<Partial<DownloadAnalyticsContext>, "download_method">;

interface ExecuteDownloadOptions {
  url: string;
  filename: string;
  analyticsContext?: DownloadAnalyticsInput;
  useDirectDownload: boolean;
}

interface DownloadState {
  receivedBytes: number;
  contentLengthBytes?: number;
}

interface FilePickerAccept {
  [mimeType: string]: string[];
}

interface FilePickerType {
  description: string;
  accept: FilePickerAccept;
}

interface FilePickerOptions {
  suggestedName: string;
  types: FilePickerType[];
}

interface FilePickerWindow {
  showSaveFilePicker(options: FilePickerOptions): Promise<FileSystemFileHandle>;
}

function hasFilePicker(value: Window): value is Window & FilePickerWindow {
  return "showSaveFilePicker" in value;
}

function triggerAnchorDownload(url: string, filename: string, openInNewTab: boolean) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  if (openInNewTab) {
    link.target = "_blank";
    link.rel = "noopener";
  }
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

class HttpDownloadError extends Error {
  constructor() {
    super("Download request returned an unsuccessful status.");
  }
}

function isCanceledDownload(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function downloadFailureCategory(error: unknown): DownloadFailureCategory {
  if (isCanceledDownload(error)) return "canceled";
  if (error instanceof HttpDownloadError) return "http_error";
  return "network_error";
}

function extensionForLabel(label: string): string {
  if (label === "PMTiles") return "pmtiles";
  if (label === "GeoParquet") return "parquet";
  if (label === "GeoPackage") return "gpkg";
  return label.toLowerCase().includes("zip") ? "zip" : "bin";
}

function fallbackFilename(label: string): string {
  return `${label.toLowerCase().replace(/\s+/g, "-")}.${extensionForLabel(label)}`;
}

function filenameFromUrl(url: string, label: string): string {
  try {
    const urlPath = new URL(url, window.location.origin).pathname;
    const extractedFilename = urlPath.split("/").pop();
    return extractedFilename?.includes(".") ? extractedFilename : fallbackFilename(label);
  } catch {
    return fallbackFilename(label);
  }
}

async function streamToFile(response: Response, filename: string): Promise<number | null> {
  if (!hasFilePicker(window)) {
    return null;
  }

  try {
    const fileHandle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [
        {
          description: "Download file",
          accept: {
            "application/octet-stream": [filename.split(".").pop() || ""],
          },
        },
      ],
    });

    const writable = await fileHandle.createWritable();
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Response body is not readable");
    }

    let receivedBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.length;
      await writable.write(value);
    }

    await writable.close();
    return receivedBytes;
  } catch (fileSystemError) {
    if (fileSystemError instanceof DOMException && fileSystemError.name === "AbortError") {
      throw fileSystemError;
    }
    console.log("File System Access API not available, using blob method:", fileSystemError);
    return null;
  }
}

async function streamToBlobUrl(response: Response): Promise<{ blobUrl: string; receivedBytes: number }> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Response body is not readable");
  }

  const chunks: ArrayBuffer[] = [];
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    receivedBytes += value.length;
  }

  const blob = new Blob(chunks, { type: response.headers.get("content-type") || "application/octet-stream" });
  return { blobUrl: URL.createObjectURL(blob), receivedBytes };
}

function trackCompleted(baseAnalyticsContext: DownloadAnalyticsContext, state: DownloadState, startTime: number) {
  trackDownloadSucceeded(baseAnalyticsContext, {
    completion_status: "completed",
    received_bytes: state.receivedBytes || undefined,
    content_length_bytes: state.contentLengthBytes,
    duration_ms: elapsedMs(startTime),
  });
}

export async function executeDownload({ url, filename, analyticsContext, useDirectDownload }: ExecuteDownloadOptions) {
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
    triggerAnchorDownload(url, filename, true);
    trackDownloadHandedOff(baseAnalyticsContext, {
      duration_ms: elapsedMs(startTime),
    });
    return;
  }

  const state: DownloadState = { receivedBytes: 0 };

  try {
    const response = await fetch(url);
    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      state.contentLengthBytes = parseInt(contentLength, 10);
    }

    if (!response.ok) {
      throw new HttpDownloadError();
    }

    const responseClone = response.clone();

    try {
      const savedBytes = await streamToFile(response, filename);
      if (savedBytes !== null) {
        state.receivedBytes = savedBytes;
        trackCompleted(baseAnalyticsContext, state, startTime);
        return;
      }
    } catch (fileSystemError) {
      if (isCanceledDownload(fileSystemError)) {
        trackDownloadFailed(baseAnalyticsContext, {
          error_category: "canceled",
          received_bytes: state.receivedBytes,
          content_length_bytes: state.contentLengthBytes,
          duration_ms: elapsedMs(startTime),
        });
        return;
      }
      throw fileSystemError;
    }

    const responseToUse = responseClone.body ? responseClone : response;
    const { blobUrl, receivedBytes } = await streamToBlobUrl(responseToUse);
    state.receivedBytes = receivedBytes;
    triggerAnchorDownload(blobUrl, filename, false);
    trackCompleted(baseAnalyticsContext, state, startTime);

    setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
    }, 100);
  } catch (error) {
    console.error("Download error:", error);
    trackDownloadFailed(baseAnalyticsContext, {
      error_category: downloadFailureCategory(error),
      received_bytes: state.receivedBytes || undefined,
      content_length_bytes: state.contentLengthBytes,
      duration_ms: elapsedMs(startTime),
    });
    triggerAnchorDownload(url, filename, true);
    trackDownloadHandedOff(baseAnalyticsContext, {
      duration_ms: elapsedMs(startTime),
    });
  }
}

export function DownloadButton({ url, label, filename: explicitFilename, analyticsContext }: DownloadButtonProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const useDirectDownload = usesNativeBrowserDownload(url);

  const filename = explicitFilename ?? filenameFromUrl(url, label);

  const handleDownload = async () => {
    setIsDownloading(true);

    try {
      const downloadOptions: ExecuteDownloadOptions = {
        url,
        filename,
        useDirectDownload,
      };
      if (analyticsContext) {
        downloadOptions.analyticsContext = analyticsContext;
      }
      await executeDownload(downloadOptions);

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
          <Button variant="ghost" size="sm" onClick={handleDownload} disabled={isDownloading}>
            {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{isDownloading ? "Downloading..." : label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
