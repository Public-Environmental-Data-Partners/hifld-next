import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import { trackUrlCopied } from "@/lib/analytics";
import { currentDatasetContext, trackUiFailure } from "@/lib/interaction-analytics";

interface CopyButtonProps {
  value: string;
  label: string;
  urlType?: "storage_uri" | "api_endpoint" | "duckdb_config";
  format?: string;
}

export function CopyButton({ value, label, urlType = "storage_uri", format }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const [failed, setFailed] = useState(false);

  const handleCopy = async () => {
    setFailed(false);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      const context = currentDatasetContext();
      trackUrlCopied(urlType, { datasetSlug: context.dataset_slug, fileSlug: context.file_slug, format });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setFailed(true);
      trackUiFailure("clipboard", "copy");
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" onClick={handleCopy} aria-label={label}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copied ? "Copied!" : label}</TooltipContent>
      </Tooltip>
      {failed && (
        <span role="alert" className="text-xs text-destructive">
          Could not copy. Please try again.
        </span>
      )}
    </TooltipProvider>
  );
}
