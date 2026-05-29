import { Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LegendItem {
  label: string;
  color: string;
}

export interface LegendGroup {
  id: string;
  title: string;
  field?: string | undefined;
  items: LegendItem[];
}

interface MapLegendProps {
  groups: LegendGroup[];
  title: string;
  visible: boolean;
  onToggle: () => void;
}

export function MapLegend({ groups, title, visible, onToggle }: MapLegendProps) {
  if (!visible) {
    return (
      <div className="absolute bottom-4 left-4 z-10">
        <Button variant="secondary" size="icon" onClick={onToggle} className="h-9 w-9 shadow-md" aria-label={title}>
          <Info className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="absolute bottom-4 left-4 z-10 flex max-h-[calc(100%-2rem)] max-w-[min(22rem,calc(100%-2rem))] flex-col overflow-hidden rounded-lg border bg-background/95 shadow-lg sm:bottom-6 sm:left-6 sm:max-h-[min(24rem,calc(100%-3rem))] sm:max-w-[min(22rem,calc(100%-3rem))]">
      <div className="shrink-0 flex items-center justify-between gap-4 border-b px-4 py-3">
        <h3 className="max-w-36 truncate text-sm font-semibold" title={title}>
          {title}
        </h3>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onToggle} aria-label={`Hide ${title}`}>
          <X className="h-3 w-3" />
        </Button>
      </div>
      <div data-testid="map-legend-scroll" className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.id} className="space-y-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-medium" title={group.title}>
                  {group.title}
                </div>
                <div className="truncate text-xs text-muted-foreground" title={group.field ?? "Solid color"}>
                  {group.field ? `Color by ${group.field}` : "Solid color"}
                </div>
              </div>
              <div className="space-y-1.5">
                {group.items.map((item) => (
                  <div key={`${group.id}-${item.label}`} className="flex items-center gap-2 text-xs">
                    <span className="h-3 w-3 shrink-0 rounded-sm border" style={{ backgroundColor: item.color }} />
                    <span className="truncate text-muted-foreground">{item.label}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
