import { ArrowLeft, PanelLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { DatasetFile } from "@/lib/api-client";

interface ViewerHeaderProps {
  collectionSlug: string;
  datasetSlug: string;
  file: DatasetFile;
  datasetName: string;
  onToggleEditor?: () => void;
  isEditorCollapsed?: boolean;
}

export function ViewerHeader({
  collectionSlug,
  datasetSlug,
  file,
  datasetName,
  onToggleEditor,
  isEditorCollapsed,
}: ViewerHeaderProps) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b bg-background shrink-0">
      <Button variant="ghost" size="sm" asChild>
        <Link
          to="/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug"
          params={{
            collectionSlug,
            datasetSlug,
            fileSlug: file.slug,
          }}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Link>
      </Button>
      <Separator orientation="vertical" className="h-6" />
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-sm font-medium text-muted-foreground truncate">
          {datasetName}
        </span>
        <span className="text-sm text-muted-foreground">/</span>
        <span className="text-sm font-medium truncate">
          {file.name || file.slug}
        </span>
      </div>
      {onToggleEditor && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleEditor}
          title={isEditorCollapsed ? "Show settings" : "Hide settings"}
        >
          <PanelLeft className="h-4 w-4" />
          {isEditorCollapsed ? "Settings" : "Hide"}
        </Button>
      )}
    </div>
  );
}

