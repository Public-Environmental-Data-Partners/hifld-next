import { PanelLeft, ZoomIn, ZoomOut } from "lucide-react";
import type maplibregl from "maplibre-gl";
import { Button } from "@/components/ui/button";

interface MapControlsProps {
  mapRef: React.RefObject<maplibregl.Map | null>;
  onToggleSettings?: (() => void) | undefined;
  isSettingsCollapsed?: boolean | undefined;
}

export function MapControls({ mapRef, onToggleSettings, isSettingsCollapsed }: MapControlsProps) {
  return (
    <div className="absolute right-4 top-4 z-[1000] flex flex-col gap-2">
      {onToggleSettings && (
        <Button
          variant="secondary"
          size="icon"
          onClick={onToggleSettings}
          className="h-9 w-9 shadow-md"
          aria-label={isSettingsCollapsed ? "Show map settings" : "Hide map settings"}
          title={isSettingsCollapsed ? "Show map settings" : "Hide map settings"}
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
      )}
      <Button variant="secondary" size="icon" onClick={() => mapRef.current?.zoomIn()} className="h-9 w-9 shadow-md">
        <ZoomIn className="h-4 w-4" />
      </Button>
      <Button variant="secondary" size="icon" onClick={() => mapRef.current?.zoomOut()} className="h-9 w-9 shadow-md">
        <ZoomOut className="h-4 w-4" />
      </Button>
    </div>
  );
}
