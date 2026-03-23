import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { createZipFromUrls, extractShapefileUrls, FileUrl } from "@/lib/zip-utils";

interface ShapefileZipDownloadButtonProps {
  sources: Array<{
    id?: number;
    url?: string;
    location?: { path?: string; type?: string };
    glob_pattern?: string;
  }>;
  filename: string;
  label?: string;
}

export function ShapefileZipDownloadButton({
  sources,
  filename,
  label = "Download Zip",
}: ShapefileZipDownloadButtonProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleDownload = async () => {
    // Extract shapefile URLs from sources
    const fileUrls = extractShapefileUrls(sources);
    
    if (fileUrls.length === 0) {
      console.error("No shapefile URLs found in sources");
      return;
    }

    setIsDownloading(true);
    setProgress(0);

    try {
      await createZipFromUrls(
        fileUrls,
        filename,
        (progressValue) => {
          setProgress(progressValue);
        }
      );
    } catch (error) {
      console.error("Error creating zip file:", error);
      alert(`Failed to create zip file: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsDownloading(false);
      setProgress(0);
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
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {progress > 0 ? `${progress}%` : "Creating..."}
              </>
            ) : (
              <Download className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {isDownloading
            ? `Creating zip... ${progress}%`
            : label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

