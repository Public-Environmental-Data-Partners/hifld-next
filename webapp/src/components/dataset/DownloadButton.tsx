import { Download } from "lucide-react";
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
}

export function DownloadButton({ url, label }: DownloadButtonProps) {
  // Extract filename from URL or generate from label
  let filename: string;
  try {
    const urlPath = new URL(url).pathname;
    const extractedFilename = urlPath.split("/").pop();

    if (extractedFilename) {
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
            : "bin";
    filename = `${label.toLowerCase().replace(/\s+/g, "-")}.${extension}`;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" asChild>
            <a href={url} download={filename} target="_blank" rel="noopener">
              <Download className="h-4 w-4" />
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

