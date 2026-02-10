import {
  Folder,
  File,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import type {
  DatasetWithUrls,
  DatasetFile,
} from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";

interface DatasetFileTreeProps {
  dataset: DatasetWithUrls;
  collectionSlug: string;
  datasetSlug: string;
}

export function DatasetFileTree({
  dataset,
  collectionSlug,
  datasetSlug,
}: DatasetFileTreeProps) {
  const files = dataset.files || [];

  if (files.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No files available for this dataset.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {files.map((file) => (
        <FileTreeNode
          key={file.id}
          file={file}
          collectionSlug={collectionSlug}
          datasetSlug={datasetSlug}
        />
      ))}
    </div>
  );
}

interface FileTreeNodeProps {
  file: DatasetFile;
  collectionSlug: string;
  datasetSlug: string;
}

function FileTreeNode({
  file,
  collectionSlug,
  datasetSlug,
}: FileTreeNodeProps) {
  const formats = file.formats || [];
  const hasFormats = formats.length > 0;

  return (
    <div className="select-none">
      <Link
        to="/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug"
        params={{
          collectionSlug: collectionSlug as any,
          datasetSlug: datasetSlug as any,
          fileSlug: file.slug as any,
        }}
        className={cn(
          "flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
        )}
      >
        {hasFormats ? (
          <Folder className="h-4 w-4 text-blue-500 flex-shrink-0" />
        ) : (
          <File className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
        <span className="flex-1 min-w-0 font-mono text-sm font-medium truncate">
          {file.name}
        </span>
        {file.layer_name && (
          <Badge variant="outline" className="font-mono text-xs flex-shrink-0">
            {file.layer_name}
          </Badge>
        )}
      </Link>
    </div>
  );
}
