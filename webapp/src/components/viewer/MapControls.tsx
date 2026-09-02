import { type MapControl, MapControls as SharedMapControls } from "@hifld/map-ui";
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
  const renderControl = (control: MapControl) => (
    <MapControlTooltip label={control.label}>
      <Button
        variant={control.active ? "default" : "secondary"}
        size="icon"
        onClick={control.onClick}
        className="h-9 w-9 shadow-md"
        aria-label={control.ariaLabel}
        aria-pressed={control.active}
      >
        {control.icon}
      </Button>
    </MapControlTooltip>
  );

  return (
    <TooltipProvider delayDuration={0}>
      <SharedMapControls
        className="absolute right-4 top-4 z-[1000] flex flex-col gap-2"
        basemapMode={basemapMode}
        isSelectionActive={Boolean(isSelectionActive)}
        onToggleSelection={onToggleSelection}
        onClearSelection={onClearSelection}
        onToggleBasemap={onToggleBasemap}
        onZoomIn={() => mapRef.current?.zoomIn()}
        onZoomOut={() => mapRef.current?.zoomOut()}
        onToggleSettings={onToggleSettings}
        isSettingsCollapsed={isSettingsCollapsed}
        renderControl={renderControl}
      />
    </TooltipProvider>
  );
}
