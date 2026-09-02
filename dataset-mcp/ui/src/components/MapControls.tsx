import {
  type MapControl,
  MapControls as SharedMapControls,
} from "@hifld/map-ui";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { RefObject } from "react";
import type { MapConfiguration } from "../mcp/contracts";

interface MapControlsProps {
  mapRef: RefObject<MapLibreMap | null>;
  basemap: MapConfiguration["basemap"];
  onToggleBasemap: () => void;
  isSelectionActive: boolean;
  onToggleSelection: () => void;
  onClearSelection?: (() => void) | undefined;
  onFullscreen?: (() => void) | undefined;
}

export function MapControls({
  mapRef,
  basemap,
  onToggleBasemap,
  isSelectionActive,
  onToggleSelection,
  onClearSelection,
  onFullscreen,
}: MapControlsProps) {
  return (
    <SharedMapControls
      className="map-controls"
      basemapMode={basemap}
      isSelectionActive={isSelectionActive}
      onToggleSelection={onToggleSelection}
      onClearSelection={onClearSelection}
      onToggleBasemap={onToggleBasemap}
      onZoomIn={() => mapRef.current?.zoomIn()}
      onZoomOut={() => mapRef.current?.zoomOut()}
      onFullscreen={onFullscreen}
      renderControl={(control: MapControl) => (
        <button
          type="button"
          className={`map-control-button${control.active ? " map-control-button-active" : ""}`}
          onClick={control.onClick}
          aria-label={control.ariaLabel}
          title={control.label}
          aria-pressed={control.active}
        >
          {control.icon}
        </button>
      )}
    />
  );
}
