import { Eraser, MapIcon, PanelLeft, Satellite, ScanSearch, ZoomIn, ZoomOut } from "lucide-react";
import type maplibregl from "maplibre-gl";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { BasemapMode } from "./useMapInitialization";

interface MapControlsProps {
  mapRef: React.RefObject<maplibregl.Map | null>;
  onToggleSettings?: (() => void) | undefined;
  isSettingsCollapsed?: boolean | undefined;
  isSelectionActive?: boolean | undefined;
  onToggleSelection?: (() => void) | undefined;
  onClearSelection?: (() => void) | undefined;
  basemapMode?: BasemapMode | undefined;
  onToggleBasemap?: (() => void) | undefined;
}

function MapControlTooltip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

export function MapControls({
  mapRef,
  onToggleSettings,
  isSettingsCollapsed,
  isSelectionActive,
  onToggleSelection,
  onClearSelection,
  basemapMode = "street",
  onToggleBasemap,
}: MapControlsProps) {
  const selectionLabel = isSelectionActive
    ? "Turn off region highlighting"
    : "Highlight a region on the map. You can also hold Shift.";
  const basemapLabel = basemapMode === "satellite" ? "Switch to street map" : "Switch to satellite imagery";

  return (
    <TooltipProvider delayDuration={0}>
      <div className="absolute right-4 top-4 z-[1000] flex flex-col gap-2">
        {onToggleSettings && (
          <MapControlTooltip label={isSettingsCollapsed ? "Show map settings" : "Hide map settings"}>
            <Button
              variant="secondary"
              size="icon"
              onClick={onToggleSettings}
              className="h-9 w-9 shadow-md"
              aria-label={isSettingsCollapsed ? "Show map settings" : "Hide map settings"}
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
          </MapControlTooltip>
        )}
        {onToggleSelection && (
          <MapControlTooltip label={selectionLabel}>
            <Button
              variant={isSelectionActive ? "default" : "secondary"}
              size="icon"
              onClick={onToggleSelection}
              className="h-9 w-9 shadow-md"
              aria-label={isSelectionActive ? "Turn off highlight region" : "Highlight a region"}
            >
              <ScanSearch className="h-4 w-4" />
            </Button>
          </MapControlTooltip>
        )}
        {onClearSelection && (
          <MapControlTooltip label="Clear the highlighted region and selected features">
            <Button
              variant="secondary"
              size="icon"
              onClick={onClearSelection}
              className="h-9 w-9 shadow-md"
              aria-label="Clear highlighted region"
            >
              <Eraser className="h-4 w-4" />
            </Button>
          </MapControlTooltip>
        )}
        {onToggleBasemap && (
          <MapControlTooltip label={basemapLabel}>
            <Button
              variant="secondary"
              size="icon"
              onClick={onToggleBasemap}
              className="h-9 w-9 shadow-md"
              aria-label={basemapLabel}
            >
              {basemapMode === "satellite" ? <MapIcon className="h-4 w-4" /> : <Satellite className="h-4 w-4" />}
            </Button>
          </MapControlTooltip>
        )}
        <MapControlTooltip label="Zoom in">
          <Button
            variant="secondary"
            size="icon"
            onClick={() => mapRef.current?.zoomIn()}
            className="h-9 w-9 shadow-md"
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </MapControlTooltip>
        <MapControlTooltip label="Zoom out">
          <Button
            variant="secondary"
            size="icon"
            onClick={() => mapRef.current?.zoomOut()}
            className="h-9 w-9 shadow-md"
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
        </MapControlTooltip>
      </div>
    </TooltipProvider>
  );
}
