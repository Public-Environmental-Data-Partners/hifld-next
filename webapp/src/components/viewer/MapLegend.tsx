import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LegendItem {
  label: string;
  color: string;
}

interface MapLegendProps {
  items: LegendItem[];
  visible: boolean;
  onToggle: () => void;
}

export function MapLegend({ items, visible, onToggle }: MapLegendProps) {
  if (!visible) {
    return (
      <div className="absolute bottom-4 left-4 z-10">
        <Button
          variant="secondary"
          size="icon"
          onClick={onToggle}
          className="h-9 w-9 shadow-md"
        >
          <Info className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="absolute bottom-6 left-6 z-10 max-w-[calc(100%-3rem)] rounded-lg border bg-background/95 p-4 shadow-lg">
      <div className="flex items-center justify-between gap-4 mb-2">
        <h3 className="text-sm font-semibold">Legend</h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onToggle}
        >
          <Info className="h-3 w-3" />
        </Button>
      </div>
      <div className="space-y-1.5">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-2 text-xs">
            <span
              className="h-3 w-3 rounded-sm border"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-muted-foreground">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

