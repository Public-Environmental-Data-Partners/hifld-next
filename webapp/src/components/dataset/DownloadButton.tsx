import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DownloadButtonProps {
  url: string;
  label: string;
  filename?: string; // Optional explicit filename to use instead of extracting from URL
  sizeBytes?: number; // Optional file size to determine if we should use streaming
}

export function DownloadButton({ url, label, filename: explicitFilename, sizeBytes }: DownloadButtonProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  
  // Determine if this is a direct storage URL (browser can stream) vs server endpoint
  // Direct URLs: storage.googleapis.com, localhost:8888 (SeaweedFS), etc.
  // Server endpoints: /api/... paths or GeoServer WFS endpoints
  const isDirectStorageUrl = (urlString: string): boolean => {
    try {
      const urlObj = new URL(urlString, window.location.origin);
      // Check if it's a storage URL (not a server API endpoint)
      const isStorageUrl = 
        urlObj.hostname.includes('storage.googleapis.com') ||
        urlObj.hostname.includes('storage.cloud.google.com') ||
        (urlObj.hostname.includes('localhost') && urlObj.port === '8888') ||
        urlObj.pathname.startsWith('/buckets/');
      
      // Check if it's NOT a server API endpoint
      const isServerEndpoint = 
        urlObj.pathname.startsWith('/api/') ||
        urlObj.pathname.includes('/wfs') ||
        urlObj.pathname.includes('/export/');
      
      return isStorageUrl && !isServerEndpoint;
    } catch {
      return false;
    }
  };
  
  const useDirectDownload = isDirectStorageUrl(url);

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
    
    // For direct storage URLs, let the browser handle streaming natively
    // This is more efficient for large files and doesn't load everything into memory
    if (useDirectDownload) {
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.target = "_blank";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // For direct downloads, show spinner briefly to indicate action was taken
      // The browser will handle the actual download streaming
      setTimeout(() => {
        setIsDownloading(false);
      }, 500);
      return;
    }
    
    // For server-side downloads (API endpoints), use streaming to avoid loading entire file into memory
    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Download failed: ${response.statusText}`);
      }

      // Clone the response before attempting File System Access API
      // This allows us to fall back to blob method if File System Access API fails
      // ReadableStreams can only be read once, so we need a clone for the fallback
      const responseClone = response.clone();

      // Try to use File System Access API for true streaming (Chrome/Edge only)
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

          // Stream the response directly to the file
          const writable = await fileHandle.createWritable();
          const reader = response.body?.getReader();
          
          if (!reader) {
            throw new Error('Response body is not readable');
          }

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            await writable.write(value);
          }
          
          await writable.close();
          setIsDownloading(false);
          return;
        } catch (fileSystemError: any) {
          // User cancelled or File System Access API failed, fall through to blob method
          if (fileSystemError.name === 'AbortError') {
            setIsDownloading(false);
            return;
          }
          console.log('File System Access API not available, using blob method:', fileSystemError);
          // Use the cloned response for the fallback
        }
      }

      // Fallback: Stream chunks and accumulate into blob (more memory efficient than response.blob())
      // This processes chunks as they arrive rather than waiting for the entire response
      // Use the cloned response if File System Access API was attempted, otherwise use original
      const responseToUse = responseClone.body ? responseClone : response;
      const reader = responseToUse.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const chunks: Uint8Array[] = [];
      let receivedBytes = 0;
      const contentLength = response.headers.get('content-length');
      const totalBytes = contentLength ? parseInt(contentLength, 10) : null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        chunks.push(value);
        receivedBytes += value.length;
        
        // Optional: Could update progress here if we had a progress callback
        // onProgress?.(totalBytes ? (receivedBytes / totalBytes) * 100 : 0);
      }

      // Combine chunks into a single blob
      const blob = new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' });
      
      // Create a blob URL and trigger download
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up blob URL after a short delay
      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
      }, 100);
    } catch (error) {
      console.error("Download error:", error);
      // Fallback to direct link if fetch fails (e.g., CORS issues)
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.target = "_blank";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setIsDownloading(false);
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

