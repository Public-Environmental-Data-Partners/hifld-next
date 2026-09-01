import { Eye, EyeOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LoadedMapLayer } from "./multiLayerSources";

interface MapLayerListItemProps {
  layer: LoadedMapLayer;
  vectorLayerCount: number;
  onVisibleChange: (visible: boolean) => void;
  onRemove: () => void;
  children?: React.ReactNode;
}

export function MapLayerListItem({
  layer,
  vectorLayerCount,
  onVisibleChange,
  onRemove,
  children,
}: MapLayerListItemProps) {
  const description = layer.loadError
    ? "Layer unavailable"
    : layer.kind === "query_mvt"
      ? layer.status === "error"
        ? "Query layer unavailable"
        : "Query MVT layer"
      : `${vectorLayerCount} vector layers`;
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{layer.name}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}
            title={layer.visible ? "Hide layer" : "Show layer"}
            onClick={() => onVisibleChange(!layer.visible)}
          >
            {layer.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </Button>
          <Button size="icon" variant="ghost" aria-label={`Remove ${layer.name}`} onClick={onRemove}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {children}
    </div>
  );
}
